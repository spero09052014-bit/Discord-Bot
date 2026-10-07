import { createServer } from "node:http";
import { buildInteractionResponse } from "./commands.js";
import { loadDiscordPublicKey, verifyDiscordRequest } from "./security.js";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const MAX_BODY_BYTES = 1_000_000;

if (!APPLICATION_ID || !/^\d+$/.test(APPLICATION_ID)) {
  throw new Error("Set DISCORD_APPLICATION_ID to the Discord application ID.");
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

const publicKey = loadDiscordPublicKey(process.env.DISCORD_PUBLIC_KEY);

function sendJson(res, statusCode, payload) {
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

const server = createServer(async (req, res) => {
  const path = (req.url || "/").split("?", 1)[0];

  if (req.method === "GET" && path === "/healthz") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method !== "POST" || path !== "/interactions") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (!(req.headers["content-type"] || "").includes("application/json")) {
    sendJson(res, 415, { error: "Expected application/json" });
    return;
  }

  try {
    const body = await readBody(req);
    const validSignature = verifyDiscordRequest({
      timestamp: req.headers["x-signature-timestamp"],
      signature: req.headers["x-signature-ed25519"],
      body,
      publicKey
    });
    if (!validSignature) {
      sendJson(res, 401, { error: "Invalid Discord signature" });
      return;
    }

    let interaction;
    try {
      interaction = JSON.parse(body.toString("utf8"));
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    if (interaction.application_id !== APPLICATION_ID) {
      sendJson(res, 400, { error: "Wrong Discord application" });
      return;
    }

    sendJson(res, 200, buildInteractionResponse(interaction));
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.statusCode === 413 ? "Request body too large" : "Internal server error" });
    if (!error.statusCode) console.error("Interaction request failed:", error.message);
  }
});

server.keepAliveTimeout = 5000;
server.headersTimeout = 10000;
server.requestTimeout = 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Discord interactions service listening on port " + PORT);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
