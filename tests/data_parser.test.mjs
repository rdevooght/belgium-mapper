import test from "node:test";
import assert from "node:assert/strict";

import { guessType } from "../static/js/data_parser.js";

test("empty input and empty values fall back to other", () => {
  assert.deepEqual(guessType([]), [{ type: "other", matchRate: 0, uniqueMatches: 0, unmatchedValues: [] }]);
  assert.deepEqual(guessType([null, undefined, NaN, "", "  "]), [
    { type: "other", matchRate: 0, uniqueMatches: 0, unmatchedValues: [] },
  ]);
});

test("recognizes postcodes stored as strings or numbers", () => {
  const [guess] = guessType(["1000", 1000]);

  assert.equal(guess.type, "postcode");
  assert.equal(guess.matchRate, 1);
  assert.equal(guess.uniqueMatches, 1);
  assert.deepEqual(guess.unmatchedValues, []);
});

test("recognizes NIS codes at the finest matching level and preserves leading zeroes", () => {
  const [guess] = guessType(["11002", 11002]);

  assert.deepEqual(guess, {
    type: "nis",
    level: "municipality",
    matchRate: 1,
    uniqueMatches: 1,
    unmatchedValues: [],
  });

  const [region] = guessType(["02000"]);
  assert.equal(region.type, "nis");
  assert.equal(region.level, "region");
});

test("matches geographical names case-insensitively and normalises accents and separators", () => {
  const [guess] = guessType(["  ANTWERPEN ", "Anvers"]);

  assert.equal(guess.type, "geo_name");
  assert.equal(guess.level, "municipality");
  assert.equal(guess.matchRate, 1);
  assert.equal(guess.uniqueMatches, 2);

  const [accented] = guessType(["Saint-Josse-ten-Noode"]);
  assert.equal(accented.type, "geo_name");
  assert.equal(accented.level, "municipality");
});

test("ignores empty entries when computing rates and counts repeated values once", () => {
  const [guess] = guessType(["1000", "1000", null, " "]);

  assert.equal(guess.type, "postcode");
  assert.equal(guess.matchRate, 1);
  assert.equal(guess.uniqueMatches, 1);
});

test("reports partial matches and distinct unmatched values", () => {
  const guesses = guessType(["1000", "not a postcode"]);
  const postcode = guesses.find(({ type }) => type === "postcode");

  assert.equal(postcode.matchRate, 0.5);
  assert.equal(postcode.uniqueMatches, 1);
  assert.deepEqual(postcode.unmatchedValues, ["not a postcode"]);
});

test("recognizes numeric values and retains non-numeric values as other", () => {
  const guesses = guessType(["12,5", 3, "hello"]);
  const numeric = guesses.find(({ type }) => type === "numeric");
  const other = guesses.find(({ type }) => type === "other");

  assert.equal(numeric.matchRate, 2 / 3);
  assert.equal(numeric.uniqueMatches, 2);
  assert.deepEqual(numeric.unmatchedValues, ["hello"]);
  assert.equal(other.matchRate, 1 / 3);
  assert.deepEqual(other.unmatchedValues, ["12,5", 3]);
});

test("puts high-confidence geographic guesses before generic guesses", () => {
  let pc_10 = Array(10).fill("1000");

  // 10 postcode out of 11 values -> >90% match rate -> postcode guess should be first
  const guesses = guessType(pc_10.concat(["not a postcode"]));

  assert.equal(guesses[0].type, "postcode");
  assert.ok(guesses.findIndex(({ type }) => type === "numeric") > 0);
  assert.ok(guesses.findIndex(({ type }) => type === "other") > 0);

  // 10 postcode out of 12 values -> <90% match rate -> postcode guess should not be first
  const guesses2 = guessType(pc_10.concat(["not a postcode", "not a postcode"]));

  assert.equal(guesses2[0].type, "numeric");
  assert.ok(guesses2.findIndex(({ type }) => type === "postcode") > 0);
  assert.ok(guesses2.findIndex(({ type }) => type === "other") > 0);
});
