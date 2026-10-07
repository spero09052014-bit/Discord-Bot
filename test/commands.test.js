import test from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, hasPermission, optionValue, PERMISSIONS, subcommand } from "../src/commands.js";

test("registers Gpy code, moderation and ticket commands", () => {
  const names = COMMANDS.map((command) => command.name);
  assert.ok(names.includes("gpy-prompt"));
  assert.ok(names.includes("code"));
  assert.ok(names.includes("gpy-import"));
  assert.ok(names.includes("mod"));
  assert.ok(names.includes("ticket"));
});

test("permission checks accept the exact permission or administrator", () => {
  assert.equal(hasPermission({ member: { permissions: String(PERMISSIONS.BAN_MEMBERS) } }, PERMISSIONS.BAN_MEMBERS), true);
  assert.equal(hasPermission({ member: { permissions: String(PERMISSIONS.KICK_MEMBERS) } }, PERMISSIONS.BAN_MEMBERS), false);
  assert.equal(hasPermission({ member: { permissions: String(PERMISSIONS.ADMINISTRATOR) } }, PERMISSIONS.MANAGE_ROLES), true);
});

test("reads a slash subcommand", () => {
  assert.equal(subcommand({ data: { options: [{ name: "ban" }] } }), "ban");
});

test("reads both direct attachment options and nested moderation options", () => {
  assert.equal(optionValue({ data: { options: [{ name: "fichier", value: "attachment-id" }] } }, "fichier"), "attachment-id");
  assert.equal(optionValue({ data: { options: [{ name: "ban", options: [{ name: "raison", value: "spam" }] }] } }, "raison"), "spam");
});
