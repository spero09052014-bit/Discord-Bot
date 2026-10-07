import test from "node:test";
import assert from "node:assert/strict";
import { buildInteractionResponse, COMMANDS } from "../src/commands.js";

test("registers the starter slash commands", () => {
  assert.deepEqual(COMMANDS.map((command) => command.name), ["ping", "help"]);
});

test("answers Discord PING with PONG", () => {
  assert.deepEqual(buildInteractionResponse({ type: 1 }), { type: 1 });
});

test("answers /ping privately", () => {
  assert.deepEqual(buildInteractionResponse({ type: 2, data: { name: "ping" } }), {
    type: 4,
    data: { content: "Pong ! 🏓", flags: 64 }
  });
});

test("answers /help and unknown commands privately", () => {
  assert.match(buildInteractionResponse({ type: 2, data: { name: "help" } }).data.content, /\/ping/);
  assert.equal(buildInteractionResponse({ type: 2, data: { name: "other" } }).data.flags, 64);
});
