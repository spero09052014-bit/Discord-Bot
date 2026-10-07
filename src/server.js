import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { AI_PROMPT, formatGpyPreview, parseGpyConfig } from "./gpy-config.js";
import { discordRequest, editInteractionResponse } from "./discord-rest.js";
import { applyGpyConfig, closeTicket, openTicket, publishTicketPanel, runModeration } from "./features.js";
import { COMMANDS, hasPermission, optionValue, PERMISSIONS, subcommand } from "./commands.js";
import { loadDiscordPublicKey, verifyDiscordRequest } from "./security.js";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const MAX_BODY_BYTES = 1_000_000;
const MAX_CONFIG_FILE_BYTES = 20_000;
const SETUP_PERMISSIONS = PERMISSIONS.MANAGE_GUILD | PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.MANAGE_ROLES;
const previews = new Map();
const publicKey = loadDiscordPublicKey(process.env.DISCORD_PUBLIC_KEY);

if (!APPLICATION_ID || !/^\d+$/.test(APPLICATION_ID)) {
  throw new Error("Set DISCORD_APPLICATION_ID to the Discord application ID.");
}
if (!process.env.DISCORD_BOT_TOKEN) {
  throw new Error("Set DISCORD_BOT_TOKEN in the Render environment.");
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error("Request body too large."), { statusCode: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks, size));
    });
    req.on("error", reject);
  });
}

function ephemeral(content, components = []) {
  return {
    type: 4,
    data: {
      content,
      flags: 64,
      components,
      allowed_mentions: { parse: [] }
    }
  };
}

function isGuildInteraction(interaction) {
  return Boolean(interaction.guild_id);
}

function setupPermissionError(interaction) {
  if (!isGuildInteraction(interaction)) return "Cette commande doit être utilisée dans un serveur Discord.";
  if (!hasPermission(interaction, SETUP_PERMISSIONS)) {
    return "Il faut les permissions Gérer le serveur, Gérer les salons et Gérer les rôles.";
  }
  return null;
}

function makePreview(interaction, config) {
  const now = Date.now();
  for (const [key, value] of previews) {
    if (value.expiresAt <= now) previews.delete(key);
  }
  const previewId = randomBytes(8).toString("hex");
  previews.set(previewId, {
    config,
    guildId: interaction.guild_id,
    userId: interaction.member?.user?.id || interaction.user?.id,
    expiresAt: now + 10 * 60_000
  });
  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Appliquer", custom_id: "gpy:apply:" + previewId },
      { type: 2, style: 4, label: "Annuler", custom_id: "gpy:cancel:" + previewId }
    ]
  }];
  return ephemeral(formatGpyPreview(config) + "\n\nL'aperçu expire dans 10 minutes. Clique sur **Appliquer** pour continuer.", components);
}

function modalResponse() {
  return {
    type: 9,
    data: {
      custom_id: "gpy:code:v1",
      title: "Configuration Gpy",
      components: [{
        type: 1,
        components: [{
          type: 4,
          custom_id: "gpy_config",
          style: 2,
          label: "Colle le code généré par ton IA",
          placeholder: "#nom Gpy\n#categorie ACCUEIL\n#salonordre 1 reglement | type=texte",
          required: true,
          min_length: 1,
          max_length: 4000
        }]
      }]
    }
  };
}

function modalText(interaction) {
  for (const row of interaction.data?.components || []) {
    for (const component of row.components || []) {
      if (component.custom_id === "gpy_config") return component.value || "";
    }
  }
  return "";
}

async function downloadConfigAttachment(interaction) {
  const attachmentId = optionValue(interaction, "fichier");
  const attachment = interaction.data?.resolved?.attachments?.[attachmentId];
  if (!attachment?.url) throw new Error("Le fichier joint est introuvable.");
  if (!["cdn.discordapp.com", "media.discordapp.net"].includes(new URL(attachment.url).hostname)) {
    throw new Error("Le fichier doit être joint depuis Discord.");
  }
  if (attachment.size > MAX_CONFIG_FILE_BYTES) throw new Error("Le fichier Gpy ne doit pas dépasser 20 Ko.");
  const response = await fetch(attachment.url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Impossible de lire le fichier joint.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_CONFIG_FILE_BYTES) throw new Error("Le fichier Gpy ne doit pas dépasser 20 Ko.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function getCommandOptions(interaction) {
  return interaction.data?.options?.[0]?.options || [];
}

function deferredTask(interaction, task) {
  return {
    response: { type: 5, data: { flags: 64 } },
    afterAck: async () => {
      try {
        const content = await task();
        await editInteractionResponse(interaction, { content, allowed_mentions: { parse: [] } });
      } catch (error) {
        console.error("Deferred Discord action failed:", error.message);
        try {
          await editInteractionResponse(interaction, {
            content: "Action interrompue : " + error.message.slice(0, 700),
            allowed_mentions: { parse: [] }
          });
        } catch (editError) {
          console.error("Could not update Discord response:", editError.message);
        }
      }
    }
  };
}

function deferredPreview(interaction, readConfig) {
  return {
    response: { type: 5, data: { flags: 64 } },
    afterAck: async () => {
      try {
        const input = await readConfig();
        const config = parseGpyConfig(input);
        const payload = makePreview(interaction, config).data;
        await editInteractionResponse(interaction, payload);
      } catch (error) {
        await editInteractionResponse(interaction, {
          content: "Configuration refusée : " + error.message.slice(0, 1500),
          allowed_mentions: { parse: [] }
        });
      }
    }
  };
}

async function dispatchCommand(interaction) {
  const name = interaction.data?.name;
  if (name === "ping") return { response: ephemeral("Pong ! Gpy répond normalement.") };
  if (name === "aide") {
    return {
      response: ephemeral(
        "**Commandes Gpy**\n" +
        "• `/gpy-prompt` : récupère les consignes à donner à Claude ou une autre IA.\n" +
        "• `/code` : colle une configuration Gpy, prévisualise puis applique.\n" +
        "• `/gpy-import` : importe un fichier `.gpy` plus long.\n" +
        "• `/mod` : avertissement, timeout, kick, ban, unban, clear, lock/unlock.\n" +
        "• `/ticket panneau` et `/ticket fermer` : tickets privés.\n" +
        "Aucune commande de configuration ne supprime de salon ou de rôle."
      )
    };
  }
  if (name === "gpy-prompt") {
    return {
      response: ephemeral("Copie ce prompt dans Claude ou une autre IA, remplace la dernière ligne par ton idée, puis colle le résultat dans `/code` :\n\n```text\n" + AI_PROMPT + "\n```")
    };
  }
  if (name === "code") {
    const error = setupPermissionError(interaction);
    return { response: error ? ephemeral(error) : modalResponse() };
  }
  if (name === "gpy-import") {
    const error = setupPermissionError(interaction);
    if (error) return { response: ephemeral(error) };
    return deferredPreview(interaction, () => downloadConfigAttachment(interaction));
  }
  if (name === "mod") {
    if (!isGuildInteraction(interaction)) return { response: ephemeral("La modération Gpy doit être utilisée dans un serveur.") };
    const sub = interaction.data?.options?.[0]?.name;
    const permissionByAction = {
      warn: PERMISSIONS.MODERATE_MEMBERS,
      timeout: PERMISSIONS.MODERATE_MEMBERS,
      kick: PERMISSIONS.KICK_MEMBERS,
      ban: PERMISSIONS.BAN_MEMBERS,
      unban: PERMISSIONS.BAN_MEMBERS,
      clear: PERMISSIONS.MANAGE_MESSAGES,
      lock: PERMISSIONS.MANAGE_CHANNELS,
      unlock: PERMISSIONS.MANAGE_CHANNELS
    };
    const required = permissionByAction[sub];
    if (!required) return { response: ephemeral("Commande de modération inconnue.") };
    if (!hasPermission(interaction, required)) return { response: ephemeral("Tu n'as pas la permission Discord nécessaire pour cette action.") };
    return deferredTask(interaction, async () => await runModeration(interaction));
  }
  if (name === "ticket") {
    if (!isGuildInteraction(interaction)) return { response: ephemeral("Les tickets Gpy doivent être utilisés dans un serveur.") };
    const sub = interaction.data?.options?.[0]?.name;
    if (sub === "panneau") {
      const required = PERMISSIONS.MANAGE_CHANNELS;
      if (!hasPermission(interaction, required)) return { response: ephemeral("Il faut la permission Gérer les salons pour publier un panneau.") };
      return deferredTask(interaction, () => publishTicketPanel(interaction.channel_id));
    }
    if (sub === "fermer") return deferredTask(interaction, () => closeTicket(interaction));
  }
  return { response: ephemeral("Commande inconnue. Utilise `/aide`.") };
}

async function dispatchModal(interaction) {
  if (interaction.data?.custom_id !== "gpy:code:v1") return { response: ephemeral("Formulaire Gpy inconnu ou expiré.") };
  const error = setupPermissionError(interaction);
  if (error) return { response: ephemeral(error) };
  try {
    const config = parseGpyConfig(modalText(interaction));
    return { response: makePreview(interaction, config) };
  } catch (parseError) {
    return { response: ephemeral("Configuration refusée : " + parseError.message.slice(0, 1500)) };
  }
}

async function dispatchComponent(interaction) {
  const customId = interaction.data?.custom_id || "";
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const applyMatch = /^gpy:apply:([0-9a-f]+)$/.exec(customId);
  if (applyMatch) {
    const preview = previews.get(applyMatch[1]);
    if (!preview || preview.expiresAt <= Date.now()) {
      previews.delete(applyMatch[1]);
      return { response: { type: 7, data: { content: "Cet aperçu a expiré. Relance `/code`.", components: [] } } };
    }
    if (preview.guildId !== interaction.guild_id || preview.userId !== userId) {
      return { response: ephemeral("Seule la personne qui a créé cet aperçu peut l'appliquer dans ce serveur.") };
    }
    const error = setupPermissionError(interaction);
    if (error) return { response: ephemeral(error) };
    previews.delete(applyMatch[1]);
    return deferredTask(interaction, async () => {
      const result = await applyGpyConfig(interaction.guild_id, preview.config);
      const lines = [
        "Configuration Gpy appliquée à **" + preview.config.name + "**.",
        "Créés : " + result.categoriesCreated + " catégorie(s), " + result.channelsCreated + " salon(s), " + result.rolesCreated + " rôle(s).",
        "Déplacés : " + result.channelsMoved + " salon(s) ; recolorés : " + result.rolesRecolored + " rôle(s).",
        "Aucun salon ou rôle n'a été supprimé."
      ];
      if (result.conflicts.length) lines.push("Conflits ignorés : " + result.conflicts.slice(0, 8).join(" ; "));
      return lines.join("\n");
    });
  }
  const cancelMatch = /^gpy:cancel:([0-9a-f]+)$/.exec(customId);
  if (cancelMatch) {
    const preview = previews.get(cancelMatch[1]);
    if (preview && (preview.userId !== userId || preview.guildId !== interaction.guild_id)) {
      return { response: ephemeral("Seule la personne qui a créé cet aperçu peut l'annuler.") };
    }
    previews.delete(cancelMatch[1]);
    return { response: { type: 7, data: { content: "Configuration annulée. Aucun changement n'a été appliqué.", components: [] } } };
  }
  if (customId === "gpy:ticket:open") {
    if (!isGuildInteraction(interaction)) return { response: ephemeral("Les tickets doivent être ouverts depuis un serveur.") };
    const user = interaction.member?.user || interaction.user;
    return deferredTask(interaction, () => openTicket(interaction.guild_id, user, APPLICATION_ID));
  }
  if (customId === "gpy:ticket:close") {
    if (!isGuildInteraction(interaction)) return { response: ephemeral("Ce bouton doit être utilisé dans un serveur.") };
    return deferredTask(interaction, () => closeTicket(interaction));
  }
  return { response: ephemeral("Bouton inconnu ou expiré.") };
}

async function dispatch(interaction) {
  if (interaction.application_id !== APPLICATION_ID) {
    return { response: { type: 4, data: { content: "Application incorrecte.", flags: 64 } } };
  }
  if (interaction.type === 1) return { response: { type: 1 } };
  if (interaction.type === 2) return dispatchCommand(interaction);
  if (interaction.type === 3) return dispatchComponent(interaction);
  if (interaction.type === 5) return dispatchModal(interaction);
  return { response: ephemeral("Type d'interaction non pris en charge.") };
}

const server = createServer(async (req, res) => {
  const path = (req.url || "/").split("?", 1)[0];
  if (req.method === "GET" && path === "/healthz") {
    json(res, 200, { status: "ok", service: "gpy-discord-bot" });
    return;
  }
  if (req.method !== "POST" || path !== "/interactions") {
    json(res, 404, { error: "Not found" });
    return;
  }
  if (!(req.headers["content-type"] || "").includes("application/json")) {
    json(res, 415, { error: "Expected application/json" });
    return;
  }

  try {
    const body = await readBody(req);
    if (!verifyDiscordRequest({
      timestamp: req.headers["x-signature-timestamp"],
      signature: req.headers["x-signature-ed25519"],
      body,
      publicKey
    })) {
      json(res, 401, { error: "Invalid Discord signature" });
      return;
    }
    const interaction = JSON.parse(body.toString("utf8"));
    const result = await dispatch(interaction);
    json(res, 200, result.response);
    if (result.afterAck) {
      void result.afterAck().catch((error) => console.error("Background interaction failed:", error.message));
    }
  } catch (error) {
    const status = error.statusCode || 500;
    json(res, status, { error: status === 413 ? "Request body too large" : "Internal server error" });
    if (status !== 413) console.error("Interaction request failed:", error.message);
  }
});

server.keepAliveTimeout = 5000;
server.headersTimeout = 10000;
server.requestTimeout = 10000;
server.listen(PORT, "0.0.0.0", () => console.log("Gpy is ready on port " + PORT + "."));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

export { COMMANDS };
