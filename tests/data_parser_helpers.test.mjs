import test from "node:test";
import assert from "node:assert/strict";

import { matchName, matchNIS, matchNumeric, matchPostcode } from "../static/js/data_parser.js";

test("matchNumeric accepts finite numbers and decimal strings", () => {
  for (const value of [0, -2, 1.25, "12", " -12 ", "+0.5", "12,5"]) {
    assert.equal(matchNumeric(value), true, `${JSON.stringify(value)} should be numeric`);
  }

  for (const value of [NaN, Infinity, "", "1,", ".5", "1 2", "hello", null]) {
    assert.equal(matchNumeric(value), false, `${JSON.stringify(value)} should not be numeric`);
  }
});

test("matchName requires a string and matches normalized names at the requested level", () => {
  assert.equal(matchName("  VLAAMS-GEWEST ", "Region"), true);
  assert.equal(matchName("Région de Bruxelles-Capitale", "Region"), true);
  assert.equal(matchName("Région Bruxelles-Capitale", "Region"), true);
  assert.equal(matchName("Bruxelles Capitale", "Region"), true);
  assert.equal(matchName("Anvers", "Province"), true);
  assert.equal(matchName("arrondissement d'anvers", "District"), true);
  assert.equal(matchName("ANTWERPEN", "Municipality"), true);

  assert.equal(matchName("Antwerpen", "Region"), false);
  assert.equal(matchName(11002, "Municipality"), false);
  assert.equal(matchName(null, "Municipality"), false);
});

test("matchNIS accepts known codes with optional leading zeroes", () => {
  assert.equal(matchNIS("02000", "Region"), true);
  assert.equal(matchNIS(2000, "Region"), true);
  assert.equal(matchNIS("10000", "Province"), true);
  assert.equal(matchNIS("11000", "District"), true);
  assert.equal(matchNIS("11002", "Municipality"), true);

  assert.equal(matchNIS("99999", "Municipality"), false);
  assert.equal(matchNIS("11002", "District"), false);
  assert.equal(matchNIS("11002", "Unknown"), false);
  assert.equal(matchNIS("11002.0", "Municipality"), false);
});

test("matchPostcode accepts known four-digit postcodes as strings or numbers", () => {
  assert.equal(matchPostcode("1000"), true);
  assert.equal(matchPostcode(1000), true);
  assert.equal(matchPostcode(" 1000 "), true);

  assert.equal(matchPostcode("0000"), false);
  assert.equal(matchPostcode("01000"), false);
  assert.equal(matchPostcode("9999"), false);
  assert.equal(matchPostcode(1000.5), false);
  assert.equal(matchPostcode("10a0"), false);

  assert.equal(matchPostcode("6851"), true);
  assert.equal(matchPostcode(6851), true);
  assert.equal(matchPostcode("68,51"), false);
  assert.equal(matchPostcode("68.51"), false);
  assert.equal(matchPostcode(68.51), false);
});
