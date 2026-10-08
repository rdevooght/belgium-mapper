import test from "node:test";
import assert from "node:assert/strict";
import entities from "../static/data/nis_entities.json" with { type: "json" };
import { createGeographicIndex, geographicIndex } from "../static/js/geographic_index.js";
import {
  candidateEntities,
  describeEntity,
  isGeographicType,
  manualResolution,
  resolveColumn,
  resolveValue,
  resolvedEntity,
} from "../static/js/geographic_resolver.js";

const municipality = { type: "geo_name", level: "municipality" };
const province = { type: "geo_name", level: "province" };

test("exact municipality match", () => {
  assert.deepEqual(resolveValue("Gent", municipality), {
    value: "Gent",
    status: "resolved",
    nis: "44021",
    candidates: ["44021"],
    method: "automatic",
  });
});

test("exact province match", () => {
  const resolution = resolveValue("Province de Liège", province);
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.nis, "60000");
  // the same name at the municipality level is another entity
  assert.equal(resolveValue("Liège", municipality).nis, "62063");
});

test("alternate names, case, accents and separators match", () => {
  assert.equal(resolveValue("Anvers", municipality).nis, resolveValue("ANTWERPEN", municipality).nis);
  assert.equal(resolveValue("  sint-genesius-rode ", municipality).status, "resolved");
  assert.equal(resolveValue("Brussel", municipality).nis, "21004");
});

test("postcode resolution, stored as a string or a number", () => {
  assert.equal(resolveValue("1000", { type: "postcode" }).nis, "21004");
  assert.equal(resolveValue(1000, { type: "postcode" }).nis, "21004");
  assert.equal(resolveValue("9999", { type: "postcode" }).status, "unmatched");
});

test("NIS resolution keeps leading zeroes and checks the level", () => {
  assert.equal(resolveValue("02000", { type: "nis", level: "region" }).nis, "02000");
  // the leading zero is lost when the NIS is stored as a number
  assert.equal(resolveValue(2000, { type: "nis", level: "region" }).nis, "02000");
  assert.equal(resolveValue("44021", { type: "nis", level: "municipality" }).nis, "44021");
  // right NIS, wrong level
  assert.equal(resolveValue("44021", { type: "nis", level: "province" }).status, "unmatched");
  // Brussels has no province: its region counts as one
  assert.equal(resolveValue("04000", { type: "nis", level: "province" }).nis, "04000");
});

test("empty values are not unmatched values", () => {
  for (const value of [null, undefined, NaN, "", "   "]) {
    const resolution = resolveValue(value, municipality);
    assert.equal(resolution.status, "empty", JSON.stringify(value));
    assert.equal(resolution.nis, null);
    assert.deepEqual(resolution.candidates, []);
  }
  assert.equal(resolveValue("nowhere", municipality).status, "unmatched");
});

test("unmatched value: no NIS, no candidates", () => {
  assert.deepEqual(resolveValue("Atlantis", municipality), {
    value: "Atlantis",
    status: "unmatched",
    nis: null,
    candidates: [],
    method: "automatic",
  });
  // a value that cannot be of the selected type
  assert.equal(resolveValue(12.5, municipality).status, "unmatched");
  assert.equal(resolveValue("abc", { type: "nis", level: "municipality" }).status, "unmatched");
});

test("duplicate names produce an ambiguous resolution with every candidate", () => {
  const resolution = resolveValue("Saint-Nicolas", municipality);
  assert.equal(resolution.status, "ambiguous");
  assert.equal(resolution.nis, null);
  assert.deepEqual([...resolution.candidates].sort(), ["46021", "62093"]);
  assert.equal(resolution.method, "automatic");
});

test("NIS and entity metadata lookup", () => {
  assert.deepEqual(describeEntity("62093"), {
    nis: "62093",
    name: entities["62093"].name,
    type: "municipality",
    parent: { nis: "62000", name: entities["62000"].name, type: "district" },
  });
  assert.equal(describeEntity("00000"), null);
  assert.equal(describeEntity("02000").parent, null);

  assert.equal(resolvedEntity(resolveValue("Gent", municipality)).nis, "44021");
  assert.equal(resolvedEntity(resolveValue("Atlantis", municipality)), null);
  assert.deepEqual(
    candidateEntities(resolveValue("Saint-Nicolas", municipality)).map(({ nis }) => nis).sort(),
    ["46021", "62093"],
  );
  assert.deepEqual(candidateEntities(resolveValue("", municipality)), []);
});

test("context: a parent entity disambiguates a child", () => {
  const ambiguous = resolveValue("Saint-Nicolas", municipality);
  assert.equal(ambiguous.status, "ambiguous");

  // the province column of the same row was resolved to the province of Liège
  const liege = resolveValue("Province de Liège", province);
  const contextual = resolveValue("Saint-Nicolas", municipality, { constraints: [liege.nis] });
  assert.deepEqual(contextual, {
    value: "Saint-Nicolas",
    status: "resolved",
    nis: "62093",
    candidates: ["62093"],
    method: "contextual",
  });

  // the other province selects the other municipality
  assert.equal(resolveValue("Saint-Nicolas", municipality, { constraints: ["40000"] }).nis, "46021");
});

test("context never gets in the way of a value that is not ambiguous", () => {
  const resolution = resolveValue("Gent", municipality, { constraints: ["60000"] });
  assert.equal(resolution.nis, "44021");
  assert.equal(resolution.method, "automatic");
});

test("context that contradicts every candidate, or is empty, is ignored", () => {
  assert.equal(resolveValue("Saint-Nicolas", municipality, { constraints: ["44000"] }).status, "ambiguous");
  assert.equal(resolveValue("Saint-Nicolas", municipality, {}).status, "ambiguous");
  assert.equal(resolveValue("Saint-Nicolas", municipality, { constraints: [] }).status, "ambiguous");
});

test("context that keeps several candidates narrows the ambiguity without resolving it", () => {
  const fixture = {
    "01000": { nis: "01000", type: "district", name: "Parent", alternateNames: [], parentNis: "09000", childrenNis: ["01001", "01002"] },
    "09000": { nis: "09000", type: "province", name: "Other parent", alternateNames: [], parentNis: null, childrenNis: ["01000", "02001"] },
    "01001": { nis: "01001", type: "municipality", name: "Twin", alternateNames: [], parentNis: "01000", childrenNis: [] },
    "01002": { nis: "01002", type: "municipality", name: "Twin", alternateNames: [], parentNis: "01000", childrenNis: [] },
    "02001": { nis: "02001", type: "municipality", name: "Twin", alternateNames: [], parentNis: "09000", childrenNis: [] },
  };
  const index = createGeographicIndex(fixture);
  const resolution = resolveValue("Twin", municipality, { constraints: ["01000"] }, index);
  assert.equal(resolution.status, "ambiguous");
  assert.deepEqual(resolution.candidates, ["01001", "01002"]);
  assert.equal(resolution.method, "contextual");
  // the injected index is the one that is used
  assert.equal(resolveValue("Gent", municipality, undefined, index).status, "unmatched");
});

test("a column is resolved cell by cell; the context can differ for each row", () => {
  const values = ["Saint-Nicolas", "Saint-Nicolas", "Gent", "", "Atlantis"];
  const contexts = [{ constraints: ["60000"] }, undefined];

  const { cells } = resolveColumn(values, municipality, { contexts });
  assert.deepEqual(
    cells.map(({ status }) => status),
    ["resolved", "ambiguous", "resolved", "empty", "unmatched"],
  );
  assert.deepEqual(cells.map(({ value }) => value), values);
  assert.notEqual(cells[0], cells[1]);
});

test("resolving does not modify the raw values", () => {
  const values = Object.freeze(["Gent", 1000, null]);
  assert.doesNotThrow(() => resolveColumn(values, municipality));
  assert.deepEqual(values, ["Gent", 1000, null]);
});

test("only geographic types can be resolved", () => {
  assert.equal(isGeographicType({ type: "postcode" }), true);
  assert.equal(isGeographicType({ type: "nis", level: "region" }), true);
  assert.equal(isGeographicType({ type: "geo_name", level: "district" }), true);
  assert.equal(isGeographicType({ type: "geo_name" }), false);
  assert.equal(isGeographicType({ type: "numeric" }), false);
  assert.equal(isGeographicType({ type: "other" }), false);
  assert.equal(isGeographicType(undefined), false);
  assert.equal(resolveColumn(["Gent"], { type: "other" }), null);
});

test("manual resolution is a resolved resolution, validated against the index", () => {
  assert.deepEqual(manualResolution("Saint-Nicolas", "62093"), {
    value: "Saint-Nicolas",
    status: "resolved",
    nis: "62093",
    candidates: ["62093"],
    method: "manual",
  });
  assert.throws(() => manualResolution("x", "00000"), /Unknown NIS/);
});

test("manual resolution does not touch the geographic data", () => {
  const before = JSON.stringify(entities);
  const unmatched = resolveValue("Atlantis", municipality);
  const manual = manualResolution(unmatched.value, "44021");
  assert.equal(JSON.stringify(entities), before);
  assert.equal(geographicIndex.findByNameAndType("Atlantis", "municipality").length, 0);
  assert.equal(manual.status, "resolved");
  assert.equal(unmatched.status, "unmatched");
});
