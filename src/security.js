import { createPublicKey, verify } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HEX_32_BYTES = /^[0-9a-f]{64}$/i;
const HEX_64_BYTES = /^[0-9a-f]{128}$/i;

export function loadDiscordPublicKey(publicKeyHex) {
  if (typeof publicKeyHex !== "string" || !HEX_32_BYTES.test(publicKeyHex)) {
    throw new Error("DISCORD_PUBLIC_KEY must be a 32-byte hexadecimal key.");
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
    format: "der",
    type: "spki"
  });
}

export function verifyDiscordRequest({
  timestamp,
  signature,
  body,
  publicKey,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = 300
}) {
  if (typeof timestamp !== "string" || !/^\d+$/.test(timestamp)) return false;
  if (typeof signature !== "string" || !HEX_64_BYTES.test(signature)) return false;
  const signedAt = Number(timestamp);
  if (!Number.isSafeInteger(signedAt) || Math.abs(nowSeconds - signedAt) > maxAgeSeconds) return false;
  try {
    return verify(
      null,
      Buffer.concat([Buffer.from(timestamp, "utf8"), body]),
      publicKey,
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}
