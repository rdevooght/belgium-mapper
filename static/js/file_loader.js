import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
import { normalizeCsvDecimalCommas } from "./csv_decimal_comma.js";

// Reads a csv or Excel file and returns its content as a JSON object.
// { rows: [], columns: [], fileName: "" }
export async function loadFile(file) {
  if (!file) return { rows: [], columns: [], fileName: "" };

  const workbook = await readWorkbook(file);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

  // The first row is used as the header. defval keeps empty cells as "".
  const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

  return {
    rows: rows,
    columns: rows.length ? Object.keys(rows[0]) : [],
    fileName: file.name,
  };
}

// CSV is read as text (keeps accents correct); Excel is read as binary.
async function readWorkbook(file) {
  if (file.name.toLowerCase().endsWith(".csv")) {
    const csv = normalizeCsvDecimalCommas(await file.text());
    return XLSX.read(csv, { type: "string" });
  }
  return XLSX.read(await file.arrayBuffer(), { type: "array" });
}
