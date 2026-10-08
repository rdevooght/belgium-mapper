import test from "node:test";
import assert from "node:assert/strict";
import entities from "../static/data/nis_entities.json" with { type: "json" };
import postcodes from "../static/data/postcode2nis.json" with { type: "json" };
import { createGeographicIndex, geographicIndex, normalizeGeographicName } from "../static/js/geographic_index.js";

const fixture = {
  "01001": {
    nis: "01001",
    type: "municipality",
    name: "Saint-Nicolas",
    alternateNames: ["Sint-Niklaas"],
    parentNis: "01000",
    childrenNis: [],
  },
  "01002": {
    nis: "01002",
    type: "municipality",
    name: "Saint Nicolas",
    alternateNames: ["Sint-Niklaas"],
    parentNis: "01000",
    childrenNis: [],
  },
  "01000": {
    nis: "01000",
    type: "district",
    name: "Parent",
    alternateNames: ["Parent"],
    parentNis: null,
    childrenNis: ["01001", "01002"],
  },
};
const index = createGeographicIndex(fixture, { 1000: "01001" });

test("normalizes accents, case, separators, and whitespace", () => {
  assert.equal(normalizeGeographicName("  ÉTÉ—TEST  ".replace("—", "-")), "ete test");
});

test("finds a unique entity name by type", () => {
  const gent = Object.values(entities).find((entity) => entity.type === "municipality" && entity.name === "Gent");
  assert.deepEqual(geographicIndex.findByNameAndType("Gent", "municipality"), [gent.nis]);

  assert.deepEqual(geographicIndex.findByNameAndType("Région bruxelles capitale", "region"), ["04000"]);
  assert.deepEqual(geographicIndex.findByNameAndType("Région bruxelles capitale", "province"), ["04000"]);
  assert.deepEqual(geographicIndex.findByNameAndType("gemeinde anderlecht", "municipality"), ["21001"]);
});

test("duplicate names resolve to multiple municipality NIS codes", () => {
  assert.deepEqual(index.findByNameAndType(" saint   nicolas ", "municipality"), ["01001", "01002"]);
  assert.deepEqual(index.findByName("Saint-Nicolas"), ["01001", "01002"]);
  assert.deepEqual(index.findByName("SINT NIKLAAS"), ["01001", "01002"]);
});

test("NIS lookup returns the canonical entity", () => {
  assert.equal(index.getEntityByNis("01001"), fixture["01001"]);
});

test("parent and child lookups use NIS identifiers", () => {
  assert.equal(index.getParent("01001"), "01000");
  assert.deepEqual(index.getChildren("01000"), ["01001", "01002"]);
});

test("unknown names, NIS codes, parents, and children return empty results", () => {
  assert.deepEqual(index.findByName("nowhere"), []);
  assert.deepEqual(index.findByNameAndType("nowhere", "municipality"), []);
  assert.equal(index.getEntityByNis("99999"), null);
  assert.equal(index.getParent("99999"), null);
  assert.deepEqual(index.getChildren("99999"), []);
});

test("postcode lookup uses the postcode to NIS mapping", () => {
  assert.deepEqual(index.findByPostcode("1000"), ["01001"]);
  assert.deepEqual(geographicIndex.findByPostcode("1000"), [postcodes["1000"]]);
  assert.equal(geographicIndex.getEntityByNis(geographicIndex.findByPostcode("1000")[0]), entities[postcodes["1000"]]);
  assert.deepEqual(index.findByPostcode("9999"), []);
});

test("NIS lookup by type, with Brussels counting as a province", () => {
  assert.deepEqual(index.findByNisAndType("01001", "municipality"), ["01001"]);
  assert.deepEqual(index.findByNisAndType("01001", "province"), []);
  assert.deepEqual(index.findByNisAndType("99999", "municipality"), []);
  assert.deepEqual(index.findByNisAndType(1001, "municipality"), []);
  assert.deepEqual(geographicIndex.findByNisAndType("04000", "region"), ["04000"]);
  assert.deepEqual(geographicIndex.findByNisAndType("04000", "province"), ["04000"]);
  assert.deepEqual(geographicIndex.findByNisAndType("02000", "province"), []);
});
