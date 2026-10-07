import { COMMANDS } from "../src/commands.js";

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!APPLICATION_ID || !/^\d+$/.test(APPLICATION_ID)) {
  throw new Error("Set DISCORD_APPLICATION_ID to the Discord application ID.");
}
if (!BOT_TOKEN) {
  throw new Error("Set DISCORD_BOT_TOKEN before registering slash commands.");
}
if (GUILD_ID && !/^\d+$/.test(GUILD_ID)) {
  throw new Error("DISCORD_GUILD_ID must contain only digits.");
}

const route = GUILD_ID
  ? "applications/" + APPLICATION_ID + "/guilds/" + GUILD_ID + "/commands"
  : "applications/" + APPLICATION_ID + "/commands";

try {
  const response = await fetch("https://discord.com/api/v10/" + route, {
    method: "PUT",
    headers: {
      authorization: "Bot " + BOT_TOKEN,
      "content-type": "application/json"
    },
    body: JSON.stringify(COMMANDS)
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    console.error("Discord rejected command registration (HTTP " + response.status + "): " + detail);
    process.exitCode = 1;
  } else {
    console.log("Registered " + COMMANDS.length + " slash commands " + (GUILD_ID ? "for test guild " + GUILD_ID : "globally") + ".");
  }
} catch (error) {
  console.error("Could not reach the Discord API:", error.message);
  process.exitCode = 1;
}
