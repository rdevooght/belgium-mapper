import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PATH = new URL("../static/data/nis_entities.json", import.meta.url);
const raw = readFileSync(PATH, "utf-8");
const entities = JSON.parse(raw);
const all = Object.values(entities);

const ALLOWED_PARENT_TYPES = {
  region: [null],
  province: ["region"],
  district: ["province", "region"], // Brussels: the district hangs directly under the region
  municipality: ["district"],
};

test("every NIS is unique", () => {
  // JSON.parse silently keeps the last of two identical keys, so the raw text is checked too
  const keys = [...raw.matchAll(/^ +"([^"]+)": \{$/gm)].map((m) => m[1]);
  assert.equal(keys.length, all.length);
  assert.equal(new Set(keys).size, keys.length, "duplicate keys in the file");

  const nisValues = [...raw.matchAll(/^ {6}"nis": (.+?),?$/gm)].map((m) => m[1]);
  assert.equal(new Set(nisValues).size, nisValues.length, "duplicate nis values in the file");
});

test("NIS codes are 5 digit strings, never numbers, and match their key", () => {
  for (const [key, entity] of Object.entries(entities)) {
    assert.match(key, /^\d{5}$/);
    assert.equal(typeof entity.nis, "string");
    assert.equal(entity.nis, key);
  }
  // Leading zeroes survive
  assert.equal(entities["02000"].nis, "02000");

  // Raw text: no NIS-like value is written as a JSON number
  assert.doesNotMatch(raw, /"(nis|parentNis)": \d/);
  const childrenBlocks = [...raw.matchAll(/"childrenNis": \[([^\]]*)\]/g)].map((m) => m[1]);
  assert.ok(childrenBlocks.length > 0);
  for (const block of childrenBlocks) assert.doesNotMatch(block, /(^|[\s,])\d/);
});

test("entities have the expected fields and types", () => {
  const FIELDS = ["alternateNames", "childrenNis", "name", "nis", "parentNis", "type"];
  for (const entity of all) {
    assert.deepEqual(Object.keys(entity).sort(), FIELDS, entity.nis);
    assert.ok(entity.type in ALLOWED_PARENT_TYPES, `${entity.nis}: unknown type ${entity.type}`);
    assert.ok(entity.name && entity.name === entity.name.trim());
    assert.ok(Array.isArray(entity.alternateNames) && entity.alternateNames.length > 0);
    for (const name of entity.alternateNames) assert.ok(name && name === name.trim(), `${entity.nis}: ${name}`);
  }
});

test("every parentNis and childrenNis points to an existing entity", () => {
  for (const entity of all) {
    if (entity.parentNis !== null) {
      assert.ok(entity.parentNis in entities, `${entity.nis}: unknown parent ${entity.parentNis}`);
    }
    for (const childNis of entity.childrenNis) {
      assert.ok(childNis in entities, `${entity.nis}: unknown child ${childNis}`);
    }
  }
});

test("parent and children relationships are consistent", () => {
  for (const entity of all) {
    // child -> parent
    assert.equal(new Set(entity.childrenNis).size, entity.childrenNis.length, `${entity.nis}: duplicate children`);
    for (const childNis of entity.childrenNis) {
      assert.equal(entities[childNis].parentNis, entity.nis, `${childNis} should have ${entity.nis} as parent`);
    }
    // parent -> child
    if (entity.parentNis !== null) {
      assert.ok(entities[entity.parentNis].childrenNis.includes(entity.nis), `${entity.nis} missing from its parent`);
    }
    // levels
    const parentType = entity.parentNis === null ? null : entities[entity.parentNis].type;
    assert.ok(
      ALLOWED_PARENT_TYPES[entity.type].includes(parentType),
      `${entity.nis}: ${entity.type} under ${parentType}`,
    );
  }

  // Only regions are roots, and every entity reaches a region without loops
  for (const entity of all) {
    let current = entity;
    for (let depth = 0; current.parentNis !== null; depth++) {
      assert.ok(depth < 4, `${entity.nis}: loop or too deep`);
      current = entities[current.parentNis];
    }
    assert.equal(current.type, "region");
  }
});

test("Brussels district hangs directly under its region", () => {
  assert.equal(entities["21000"].type, "district");
  assert.equal(entities["21000"].parentNis, "04000");
  assert.deepEqual(entities["04000"].childrenNis, ["21000"]);
});

test("alternate names keep supporting the geographical detection", () => {
  assert.ok(entities["02000"].alternateNames.includes("flandre"));
  assert.ok(entities["10000"].alternateNames.includes("anvers"));
  assert.ok(entities["11000"].alternateNames.includes("arrondissement d'anvers"));
  assert.ok(entities["11002"].alternateNames.includes("commune d'anvers"));
  assert.ok(entities["04000"].alternateNames.includes("bruxelles capitale"));
});
