import test from "node:test";
import assert from "node:assert/strict";
import entities from "../static/data/nis_entities.json" with { type: "json" };
import { guessType } from "../static/js/data_parser.js";
import { selectGuess, resolveSelectedGuess, setManualResolution } from "../static/js/column_resolution.js";

const indexOfGuess = (column, type, level) =>
  column.guesses.findIndex((guess) => guess.type === type && guess.level === level);

// Same as the application: the column starts with the best guess, the user can then pick another type.
// Values with some unmatched entries fall under the guesser's confidence threshold, so a test that needs
// a geographic type picks it explicitly, as the user would in the type selector.
function makeColumn(values, selected) {
  const column = { name: "place", guesses: guessType(values), selectedGuessIndex: 0, resolution: null };
  resolveSelectedGuess(column, values);
  if (selected) {
    const guessIndex = indexOfGuess(column, selected.type, selected.level);
    assert.ok(guessIndex >= 0, `no ${selected.type} ${selected.level} guess`);
    selectGuess(column, guessIndex, values);
  }
  return column;
}

const asMunicipalityName = { type: "geo_name", level: "municipality" };

test("a geographic column is resolved as soon as it has its selected type", () => {
  const values = ["Gent", "Saint-Nicolas", "", "Atlantis"];
  const column = makeColumn(values, asMunicipalityName);

  assert.deepEqual(
    column.resolution.cells.map(({ status }) => status),
    ["resolved", "ambiguous", "empty", "unmatched"],
  );
});

test("the best guess is resolved on load, without any user action", () => {
  const column = makeColumn(["Gent", "Antwerpen", "Brugge"]);
  assert.equal(column.guesses[0].type, "geo_name");
  assert.deepEqual(column.resolution.cells.map(({ status }) => status), ["resolved", "resolved", "resolved"]);
});

test("a column that is not geographic has no resolution", () => {
  const column = makeColumn(["a", "b", "c"]);
  assert.equal(column.guesses[0].type, "other");
  assert.equal(column.resolution, null);
});

test("changing the selected type discards the previous resolution and resolves again", () => {
  const values = ["Liège", "Gent"];
  const column = makeColumn(values);

  const asMunicipality = indexOfGuess(column, "geo_name", "municipality");
  const asProvince = indexOfGuess(column, "geo_name", "province");
  assert.ok(asMunicipality >= 0 && asProvince >= 0);

  selectGuess(column, asMunicipality, values);
  const first = column.resolution;
  assert.deepEqual(first.cells.map(({ nis }) => nis), ["62063", "44021"]);

  selectGuess(column, asProvince, values);
  assert.equal(column.selectedGuessIndex, asProvince);
  assert.notEqual(column.resolution, first);
  assert.deepEqual(column.resolution.cells.map(({ status }) => status), ["resolved", "unmatched"]);
  assert.equal(column.resolution.cells[0].nis, "60000");

  // going back resolves again from scratch, nothing is remembered from the other type
  selectGuess(column, asMunicipality, values);
  assert.notEqual(column.resolution, first);
  assert.deepEqual(column.resolution, first);
});

test("selecting a non-geographic type removes the resolution", () => {
  const values = ["1000", "2000"];
  const column = makeColumn(values);
  assert.ok(column.resolution);

  selectGuess(column, indexOfGuess(column, "numeric", undefined), values);
  assert.equal(column.resolution, null);
});

test("changing the type discards manual resolutions too", () => {
  const values = ["Gent", "Atlantis"];
  const column = makeColumn(values, asMunicipalityName);
  setManualResolution(column, 1, "44021");
  assert.equal(column.resolution.cells[1].method, "manual");

  resolveSelectedGuess(column, values);
  assert.equal(column.resolution.cells[1].status, "unmatched");
});

test("manual resolution replaces an ambiguous or unmatched resolution, only for that cell", () => {
  const values = ["Saint-Nicolas", "Saint-Nicolas", "Atlantis"];
  const column = makeColumn(values, asMunicipalityName);
  const before = [...column.resolution.cells];

  setManualResolution(column, 0, "62093");
  setManualResolution(column, 2, "44021");

  const [ambiguous, untouched, unmatched] = column.resolution.cells;
  assert.deepEqual(ambiguous, { value: "Saint-Nicolas", status: "resolved", nis: "62093", candidates: ["62093"], method: "manual" });
  assert.equal(untouched, before[1]);
  assert.equal(untouched.status, "ambiguous");
  assert.deepEqual(unmatched, { value: "Atlantis", status: "resolved", nis: "44021", candidates: ["44021"], method: "manual" });
});

test("manual resolution rejects unknown NIS and non-geographic columns", () => {
  const column = makeColumn(["Saint-Nicolas"], asMunicipalityName);
  assert.throws(() => setManualResolution(column, 0, "00000"), /Unknown NIS/);
  assert.equal(column.resolution.cells[0].status, "ambiguous");

  const other = makeColumn(["a", "b"]);
  assert.throws(() => setManualResolution(other, 0, "44021"));
});

test("raw values and geographic data are never modified", () => {
  const values = Object.freeze(["Saint-Nicolas", "Gent", ""]);
  const entitiesBefore = JSON.stringify(entities);
  const column = makeColumn(values, asMunicipalityName);

  setManualResolution(column, 0, "62093");
  selectGuess(column, indexOfGuess(column, "geo_name", "district"), values);

  assert.deepEqual(values, ["Saint-Nicolas", "Gent", ""]);
  assert.equal(JSON.stringify(entities), entitiesBefore);
});
