import test from "node:test";
import assert from "node:assert/strict";
import { AI_PROMPT, formatGpyPreview, GPY_EXAMPLE, parseGpyConfig } from "../src/gpy-config.js";

test("parses the Gpy example into a server plan", () => {
  const config = parseGpyConfig(GPY_EXAMPLE);
  assert.equal(config.name, "Gpy");
  assert.equal(config.categories.length, 5);
  assert.equal(config.channelCount, 11);
  assert.equal(config.roles.length, 7);
  assert.equal(config.categories[1].channels[2].type, "vocal");
  assert.equal(config.categories[1].channels[2].userLimit, 0);
});

test("normalizes channel slugs and parses role colors", () => {
  const config = parseGpyConfig([
    "#nom Gpy",
    "#categorie Accueil",
    "#salonordre 1 #règlement général | type=texte",
    "#role Modérateur | couleur=#3498DB"
  ].join("\n"));
  assert.equal(config.categories[0].channels[0].name, "reglement-general");
  assert.equal(config.roles[0].color, 0x3498db);
});

test("rejects unknown directives, duplicate channels and privileged role permissions", () => {
  assert.throws(() => parseGpyConfig("#nom Gpy\n#commande ban-all"), /directive inconnue/i);
  assert.throws(() => parseGpyConfig("#nom Gpy\n#categorie Test\n#salonordre 1 general\n#salonordre 2 general"), /dupliqué/i);
  assert.throws(() => parseGpyConfig("#nom Gpy\n#categorie Test\n#salonordre 1 general\n#role Admin | permissions=ADMINISTRATOR"), /option couleur/i);
});

test("provides a prompt that fits in a Discord response and a useful preview", () => {
  const config = parseGpyConfig(GPY_EXAMPLE);
  assert.ok(AI_PROMPT.length < 1800);
  assert.match(formatGpyPreview(config), /Aperçu Gpy/);
  assert.match(formatGpyPreview(config), /aucun élément ne sera supprimé/i);
});

test("rejects malformed categories, limits and oversized configurations", () => {
  assert.throws(() => parseGpyConfig("#nom Gpy\n#salonordre 1 general"), /#categorie/i);
  assert.throws(() => parseGpyConfig("#nom Gpy\n#categorie Vocal\n#salonordre 1 lounge | type=vocal | limite=100"), /entre 0 et 99/i);
  assert.throws(() => parseGpyConfig("x".repeat(20_001)), /20 000 caractères/i);
});
