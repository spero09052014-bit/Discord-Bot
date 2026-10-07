import { COMMANDS } from "../src/commands.js";

const applicationId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!applicationId || !/^\d+$/.test(applicationId)) {
  throw new Error("Configure DISCORD_APPLICATION_ID avant d'enregistrer les commandes.");
}
if (!token) throw new Error("Configure DISCORD_BOT_TOKEN avant d'enregistrer les commandes.");
if (guildId && !/^\d+$/.test(guildId)) throw new Error("DISCORD_GUILD_ID doit être un ID numérique.");

const endpoint = guildId
  ? "https://discord.com/api/v10/applications/" + applicationId + "/guilds/" + guildId + "/commands"
  : "https://discord.com/api/v10/applications/" + applicationId + "/commands";

const response = await fetch(endpoint, {
  method: "PUT",
  headers: {
    authorization: "Bot " + token,
    "content-type": "application/json"
  },
  body: JSON.stringify(COMMANDS)
});
const text = await response.text();
if (!response.ok) {
  console.error("Discord a refusé les commandes (HTTP " + response.status + ") : " + text.slice(0, 1000));
  process.exitCode = 1;
} else {
  console.log(
    COMMANDS.length + " commandes Gpy enregistrées " +
    (guildId ? "pour le serveur de test " + guildId : "globalement") + "."
  );
}
