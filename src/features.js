import { discordRequest, auditReason } from "./discord-rest.js";
import { PERMISSIONS, optionValue, subcommand } from "./commands.js";

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const MANAGE_CHANNELS = 1n << 4n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const MAX_TIMEOUT_MINUTES = 40_320;
const DISCORD_EPOCH = 1_420_070_400_000n;

const id = (value) => encodeURIComponent(String(value));
const hasBit = (value, bit) => (BigInt(value || "0") & bit) !== 0n;
const safeText = (value) => String(value || "").replace(/@/g, "@\u200b").replace(/[\r\n]/g, " ").slice(0, 500);
const slug = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, "-")
  .replace(/^-+|-+$/g, "");

function permissionOverwritesForStaff(guildId, staffRoleIds) {
  const staffAccess = (VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY).toString();
  const rows = [{ id: guildId, type: 0, allow: "0", deny: VIEW_CHANNEL.toString() }];
  for (const roleId of staffRoleIds) rows.push({ id: roleId, type: 0, allow: staffAccess, deny: "0" });
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  if (applicationId) {
    rows.push({
      id: applicationId,
      type: 1,
      allow: (VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY | MANAGE_CHANNELS).toString(),
      deny: "0"
    });
  }
  return rows;
}

export async function applyGpyConfig(guildId, config) {
  const result = { categoriesCreated: 0, channelsCreated: 0, channelsMoved: 0, rolesCreated: 0, rolesRecolored: 0, conflicts: [] };
  const [guild, initialChannels, initialRoles] = await Promise.all([
    discordRequest("/guilds/" + id(guildId)),
    discordRequest("/guilds/" + id(guildId) + "/channels"),
    discordRequest("/guilds/" + id(guildId) + "/roles")
  ]);

  if (guild.name !== config.name) {
    await discordRequest("/guilds/" + id(guildId), {
      method: "PATCH",
      body: { name: config.name },
      reason: "Gpy: nom défini par une configuration validée"
    });
  }

  const roles = [...initialRoles];
  for (const roleSpec of config.roles) {
    let role = roles.find((item) => item.name.toLocaleLowerCase() === roleSpec.name.toLocaleLowerCase());
    if (!role) {
      role = await discordRequest("/guilds/" + id(guildId) + "/roles", {
        method: "POST",
        body: {
          name: roleSpec.name,
          color: roleSpec.color ?? 0,
          permissions: "0",
          hoist: false,
          mentionable: false
        },
        reason: "Gpy: création d'un rôle depuis une configuration validée"
      });
      roles.push(role);
      result.rolesCreated += 1;
    } else if (roleSpec.color !== null && role.color !== roleSpec.color) {
      role = await discordRequest("/guilds/" + id(guildId) + "/roles/" + id(role.id), {
        method: "PATCH",
        body: { color: roleSpec.color },
        reason: "Gpy: mise à jour de la couleur d'un rôle"
      });
      roles[roles.findIndex((item) => item.id === role.id)] = role;
      result.rolesRecolored += 1;
    }
  }

  const channels = [...initialChannels];
  for (const [categoryIndex, categorySpec] of config.categories.entries()) {
    let category = channels.find((item) => item.type === 4 && item.name.toLocaleLowerCase() === categorySpec.name.toLocaleLowerCase());
    if (!category) {
      category = await discordRequest("/guilds/" + id(guildId) + "/channels", {
        method: "POST",
        body: { name: categorySpec.name, type: 4, position: categoryIndex },
        reason: "Gpy: création d'une catégorie depuis une configuration validée"
      });
      channels.push(category);
      result.categoriesCreated += 1;
    }

    const existingSiblings = channels
      .filter((item) => item.parent_id === category.id)
      .sort((a, b) => a.position - b.position);
    for (const channelSpec of [...categorySpec.channels].sort((a, b) => a.position - b.position)) {
      const desiredType = channelSpec.type === "vocal" ? 2 : 0;
      let channel = channels.find((item) => item.name === channelSpec.name);
      if (channel && channel.type !== desiredType) {
        result.conflicts.push("#" + channelSpec.name + " existe déjà avec un autre type de salon.");
        continue;
      }
      const targetPosition = channelSpec.position - 1;
      if (!channel) {
        const body = {
          name: channelSpec.name,
          type: desiredType,
          parent_id: category.id,
          position: targetPosition
        };
        if (desiredType === 2 && channelSpec.userLimit > 0) body.user_limit = channelSpec.userLimit;
        channel = await discordRequest("/guilds/" + id(guildId) + "/channels", {
          method: "POST",
          body,
          reason: "Gpy: création d'un salon depuis une configuration validée"
        });
        channels.push(channel);
        result.channelsCreated += 1;
      } else if (channel.parent_id !== category.id || existingSiblings[targetPosition]?.id !== channel.id) {
        channel = await discordRequest("/channels/" + id(channel.id), {
          method: "PATCH",
          body: { parent_id: category.id, position: targetPosition },
          reason: "Gpy: placement d'un salon dans sa catégorie"
        });
        const oldIndex = channels.findIndex((item) => item.id === channel.id);
        if (oldIndex >= 0) channels[oldIndex] = channel;
        result.channelsMoved += 1;
      }
    }
  }
  return result;
}

async function findModLogChannel(guildId) {
  const channels = await discordRequest("/guilds/" + id(guildId) + "/channels");
  return channels.find((channel) =>
    channel.type === 0 &&
    /(?:log|journal).*(?:mod|moderation)|(?:mod|moderation).*(?:log|journal)/.test(slug(channel.name))
  );
}

async function writeModLog(guildId, content) {
  const channel = await findModLogChannel(guildId);
  if (!channel) throw new Error("Ajoute un salon #logs-moderation à ta configuration Gpy pour enregistrer les avertissements.");
  await discordRequest("/channels/" + id(channel.id) + "/messages", {
    method: "POST",
    body: { content, allowed_mentions: { parse: [] } }
  });
}

async function writeModLogIfAvailable(guildId, content) {
  try {
    await writeModLog(guildId, content);
    return true;
  } catch (error) {
    console.error("Moderation action could not be written to the log channel:", error.message);
    return false;
  }
}

function targetId(interaction) {
  return optionValue(interaction, "membre");
}

function actorId(interaction) {
  return interaction.member?.user?.id || interaction.user?.id;
}

async function lockCurrentChannel(interaction, lock) {
  const channelId = interaction.channel_id;
  const guildId = interaction.guild_id;
  const channel = await discordRequest("/channels/" + id(channelId));
  if (![0, 5].includes(channel.type)) throw new Error("Le verrouillage Gpy s'applique aux salons textuels.");
  const overwrites = channel.permission_overwrites || [];
  const current = overwrites.find((row) => row.id === guildId && row.type === 0) || { allow: "0", deny: "0" };
  let allow = BigInt(current.allow || "0");
  let deny = BigInt(current.deny || "0");
  if (lock) {
    allow &= ~SEND_MESSAGES;
    deny |= SEND_MESSAGES;
  } else {
    deny &= ~SEND_MESSAGES;
  }
  await discordRequest("/channels/" + id(channelId) + "/permissions/" + id(guildId), {
    method: "PUT",
    body: { type: 0, allow: allow.toString(), deny: deny.toString() },
    reason: lock ? "Gpy: verrouillage demandé par un modérateur" : "Gpy: déverrouillage demandé par un modérateur"
  });
}

async function clearRecentMessages(channelId, count) {
  const messages = await discordRequest("/channels/" + id(channelId) + "/messages?limit=" + count);
  const now = BigInt(Date.now());
  const recent = [];
  const old = [];
  for (const message of messages.slice(0, count)) {
    const createdAt = (BigInt(message.id) >> 22n) + DISCORD_EPOCH;
    if (now - createdAt < 14n * 24n * 60n * 60n * 1000n) recent.push(message.id);
    else old.push(message.id);
  }
  if (recent.length > 1) {
    await discordRequest("/channels/" + id(channelId) + "/messages/bulk-delete", {
      method: "POST",
      body: { messages: recent },
      reason: "Gpy: nettoyage demandé par un modérateur"
    });
  } else if (recent.length === 1) {
    await discordRequest("/channels/" + id(channelId) + "/messages/" + id(recent[0]), {
      method: "DELETE",
      reason: "Gpy: nettoyage demandé par un modérateur"
    });
  }
  return { deleted: recent.length, tooOld: old.length };
}

export async function runModeration(interaction) {
  const guildId = interaction.guild_id;
  const action = subcommand(interaction);
  const actor = actorId(interaction);
  const memberId = targetId(interaction);
  const reason = auditReason(optionValue(interaction, "raison") || "Aucune raison indiquée");

  if (action === "warn") {
    if (!memberId) throw new Error("Choisis un membre à avertir.");
    await writeModLog(guildId, "⚠️ **Avertissement**\nMembre : <@" + memberId + ">\nModérateur : <@" + actor + ">\nRaison : " + safeText(reason));
    return "Avertissement enregistré dans le salon de modération.";
  }
  if (action === "timeout") {
    const minutes = Number(optionValue(interaction, "minutes"));
    if (!memberId || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TIMEOUT_MINUTES) {
      throw new Error("Choisis un membre et une durée de 1 à 40 320 minutes.");
    }
    await discordRequest("/guilds/" + id(guildId) + "/members/" + id(memberId), {
      method: "PATCH",
      body: { communication_disabled_until: new Date(Date.now() + minutes * 60_000).toISOString() },
      reason
    });
    const logged = await writeModLogIfAvailable(guildId, "⏱️ <@" + memberId + "> a reçu un timeout de " + minutes + " min par <@" + actor + ">.\nRaison : " + safeText(reason));
    return "Timeout appliqué à <@" + memberId + "> pour " + minutes + " minute(s)." + (logged ? "" : " Aucun salon de logs n'a été trouvé.");
  }
  if (action === "kick" || action === "ban") {
    if (!memberId) throw new Error("Choisis un membre.");
    const route = "/guilds/" + id(guildId) + (action === "kick" ? "/members/" : "/bans/") + id(memberId);
    await discordRequest(route, {
      method: action === "kick" ? "DELETE" : "PUT",
      body: action === "ban" ? { delete_message_seconds: 0 } : undefined,
      reason
    });
    const logged = await writeModLogIfAvailable(guildId, (action === "kick" ? "👢 Expulsion" : "🔨 Bannissement") + " : <@" + memberId + "> par <@" + actor + ">.\nRaison : " + safeText(reason));
    return (action === "kick" ? "Membre expulsé : " : "Membre banni : ") + "<@" + memberId + ">." + (logged ? "" : " Aucun salon de logs n'a été trouvé.");
  }
  if (action === "unban") {
    const userId = String(optionValue(interaction, "identifiant") || "");
    if (!/^\d{17,20}$/.test(userId)) throw new Error("L'identifiant Discord doit contenir de 17 à 20 chiffres.");
    await discordRequest("/guilds/" + id(guildId) + "/bans/" + id(userId), { method: "DELETE", reason });
    const logged = await writeModLogIfAvailable(guildId, "✅ Débannissement de l'utilisateur " + userId + " par <@" + actor + ">.\nRaison : " + safeText(reason));
    return "Utilisateur débanni : " + userId + "." + (logged ? "" : " Aucun salon de logs n'a été trouvé.");
  }
  if (action === "clear") {
    const count = Number(optionValue(interaction, "nombre"));
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Le nombre doit être entre 1 et 100.");
    const result = await clearRecentMessages(interaction.channel_id, count);
    const logged = await writeModLogIfAvailable(guildId, "🧹 Nettoyage par <@" + actor + "> : " + result.deleted + " message(s) supprimé(s), " + result.tooOld + " ignoré(s) car trop anciens.");
    return result.deleted + " message(s) supprimé(s)." + (result.tooOld ? " " + result.tooOld + " message(s) trop ancien(s) ont été conservé(s)." : "") + (logged ? "" : " Aucun salon de logs n'a été trouvé.");
  }
  if (action === "lock" || action === "unlock") {
    await lockCurrentChannel(interaction, action === "lock");
    const logged = await writeModLogIfAvailable(guildId, (action === "lock" ? "🔒 Salon verrouillé" : "🔓 Salon déverrouillé") + " par <@" + actor + ">.");
    return (action === "lock" ? "Salon verrouillé." : "Salon déverrouillé.") + (logged ? "" : " Aucun salon de logs n'a été trouvé.");
  }
  throw new Error("Commande de modération inconnue.");
}

export async function publishTicketPanel(channelId) {
  await discordRequest("/channels/" + id(channelId) + "/messages", {
    method: "POST",
    body: {
      content: "🎫 **Besoin d'aide ?** Clique sur le bouton pour ouvrir un salon privé avec l'équipe.",
      components: [{
        type: 1,
        components: [{ type: 2, style: 1, label: "Ouvrir un ticket", emoji: { name: "🎫" }, custom_id: "gpy:ticket:open" }]
      }]
    }
  });
  return "Panneau de tickets publié dans ce salon.";
}

export async function openTicket(guildId, user, botId) {
  if (!user?.id) throw new Error("Impossible d'identifier le membre.");
  const channels = await discordRequest("/guilds/" + id(guildId) + "/channels");
  const existing = channels.find((channel) => channel.type === 0 && channel.topic === "gpy-ticket:" + user.id);
  if (existing) return "Tu as déjà un ticket ouvert : <#" + existing.id + ">.";

  const roles = await discordRequest("/guilds/" + id(guildId) + "/roles");
  let staffRoles = roles.filter((role) => /support|mod[eé]rateur/i.test(role.name)).slice(0, 5);
  if (!staffRoles.length) {
    const supportRole = await discordRequest("/guilds/" + id(guildId) + "/roles", {
      method: "POST",
      body: { name: "Support", color: 0x00d2d3, permissions: "0", hoist: false, mentionable: false },
      reason: "Gpy: création du rôle Support pour les tickets"
    });
    staffRoles = [supportRole];
  }
  let category = channels.find((channel) => channel.type === 4 && /support|ticket|aide/i.test(channel.name));
  if (!category) {
    category = await discordRequest("/guilds/" + id(guildId) + "/channels", {
      method: "POST",
      body: {
        name: "SUPPORT | TICKETS",
        type: 4,
        permission_overwrites: permissionOverwritesForStaff(guildId, staffRoles.map((role) => role.id))
      },
      reason: "Gpy: préparation de la catégorie des tickets"
    });
  }
  const username = slug(user.username || "membre").slice(0, 48) || "membre";
  const channel = await discordRequest("/guilds/" + id(guildId) + "/channels", {
    method: "POST",
    body: {
      name: "ticket-" + username + "-" + user.id.slice(-4),
      type: 0,
      parent_id: category.id,
      topic: "gpy-ticket:" + user.id,
      permission_overwrites: [
        { id: guildId, type: 0, allow: "0", deny: VIEW_CHANNEL.toString() },
        { id: user.id, type: 1, allow: (VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY).toString(), deny: "0" },
        ...staffRoles.map((role) => ({ id: role.id, type: 0, allow: (VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY).toString(), deny: "0" })),
        ...(botId ? [{
          id: botId,
          type: 1,
          allow: (VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY | MANAGE_CHANNELS).toString(),
          deny: "0"
        }] : [])
      ]
    },
    reason: "Gpy: ouverture d'un ticket privé"
  });

  await discordRequest("/channels/" + id(channel.id) + "/messages", {
    method: "POST",
    body: {
      content: "<@" + user.id + "> explique ta demande ici. L'équipe te répondra dans ce ticket.",
      components: [{
        type: 1,
        components: [{ type: 2, style: 4, label: "Fermer le ticket", emoji: { name: "🔒" }, custom_id: "gpy:ticket:close" }]
      }],
      allowed_mentions: { users: [user.id] }
    }
  });
  return "Ticket créé : <#" + channel.id + ">.";
}

export async function closeTicket(interaction, botId) {
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  const actor = interaction.member?.user?.id || interaction.user?.id;
  const channel = await discordRequest("/channels/" + id(channelId));
  const match = /^gpy-ticket:(\d+)$/.exec(channel.topic || "");
  if (!match) throw new Error("Cette commande doit être utilisée dans un ticket Gpy.");
  const ownerId = match[1];
  const roles = await discordRequest("/guilds/" + id(guildId) + "/roles");
  const staffRoleIds = roles
    .filter((role) => /support|mod[eé]rateur/i.test(role.name))
    .map((role) => role.id);
  const memberRoleIds = interaction.member?.roles || [];
  const isStaff = memberRoleIds.some((roleId) => staffRoleIds.includes(roleId));
  const canManage = hasBit(interaction.member?.permissions, PERMISSIONS.MANAGE_CHANNELS) ||
    hasBit(interaction.member?.permissions, PERMISSIONS.ADMINISTRATOR);
  if (actor !== ownerId && !isStaff && !canManage) {
    throw new Error("Seul l'auteur du ticket ou l'équipe de support peut le fermer.");
  }

  await discordRequest("/channels/" + id(channelId) + "/permissions/" + id(ownerId), {
    method: "PUT",
    body: {
      type: 1,
      allow: (VIEW_CHANNEL | READ_MESSAGE_HISTORY).toString(),
      deny: SEND_MESSAGES.toString()
    },
    reason: "Gpy: fermeture d'un ticket"
  });
  if (!channel.name.startsWith("closed-")) {
    await discordRequest("/channels/" + id(channelId), {
      method: "PATCH",
      body: { name: ("closed-" + channel.name).slice(0, 100) },
      reason: "Gpy: archivage d'un ticket fermé"
    });
  }
  return "Ticket fermé et conservé en archive ; aucun message n'a été supprimé.";
}
