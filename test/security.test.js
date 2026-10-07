import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { loadDiscordPublicKey, verifyDiscordRequest } from "../src/security.js";

const { privateKey, publicKey: exportedPublicKey } = generateKeyPairSync("ed25519");
const publicKeyHex = exportedPublicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const publicKey = loadDiscordPublicKey(publicKeyHex);
const timestamp = "1720000000";
const body = Buffer.from("{\"type\":1}");
const signature = sign(null, Buffer.concat([Buffer.from(timestamp), body]), privateKey).toString("hex");

test("accepts a correctly signed recent Discord request", () => {
  assert.equal(verifyDiscordRequest({ timestamp, signature, body, publicKey, nowSeconds: Number(timestamp) }), true);
});

test("rejects a changed body and an expired request", () => {
  assert.equal(verifyDiscordRequest({ timestamp, signature, body: Buffer.from("changed"), publicKey, nowSeconds: Number(timestamp) }), false);
  assert.equal(verifyDiscordRequest({ timestamp, signature, body, publicKey, nowSeconds: Number(timestamp) + 301 }), false);
});

test("rejects malformed signatures and public keys", () => {
  assert.equal(verifyDiscordRequest({ timestamp, signature: "bad", body, publicKey, nowSeconds: Number(timestamp) }), false);
  assert.throws(() => loadDiscordPublicKey("not-a-key"));
});
