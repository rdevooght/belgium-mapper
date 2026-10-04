import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { normalizeCsvDecimalCommas } from "../static/js/csv_decimal_comma.js";

test("converts quoted decimal commas in the sample CSV without changing other content", async () => {
  const csv = await readFile(new URL("./test_data/test_data.csv", import.meta.url), "utf8");

  assert.equal(
    normalizeCsvDecimalCommas(csv),
    "postcode,valeur,valeur2,valeur3\n1030,1,1.56,1.98\n1050,2,2.6,2.0\n1000,3,3,84.689\n1180,5,150.0,87\n",
  );
});

test("preserves quoted text and escaped quotes", () => {
  const csv = 'text,decimal\n"A, B says ""hi""","1,25"\n';

  assert.equal(normalizeCsvDecimalCommas(csv), 'text,decimal\n"A, B says ""hi""",1.25\n');
});

test("converts unquoted decimal commas when semicolons separate the columns", () => {
  const csv = 'text;decimal\n"A, B says ""hi""";1,25\nNext;150,0\n';

  assert.equal(normalizeCsvDecimalCommas(csv), 'text;decimal\n"A, B says ""hi""";1.25\nNext;150.0\n');
});
