import Alpine from "https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/module.esm.js";
import { loadFile as loadFileUtil } from "./file_loader.js";
import { guessType, isEmpty } from "./data_parser.js";

function App() {
  return {
    dragging: false,
    fileName: "",
    rows: [], // array of objects, one per line: { columnName: value, ... }
    columns: [], // { name, guesses, selectedGuessIndex, emptyCount }
    filter: null, // null, or { columnIndex, kind: "unmatched" | "empty" }: at most one filter at a time
    error: "",

    async loadFile(file) {
      if (!file) return;
      this.error = "";

      try {
        const result = await loadFileUtil(file);
        this.rows = result.rows;
        this.columns = result.columns.map((name) => ({
          name,
          guesses: guessType(result.rows.map((row) => row[name])),
          selectedGuessIndex: 0,
          emptyCount: result.rows.filter((row) => isEmpty(row[name])).length,
        }));
        this.filter = null;
        this.fileName = result.fileName;
      } catch (e) {
        this.error = "Could not read this file. Please use a valid CSV or Excel file.";
      }
    },

    selectedGuess(column) {
      return column.guesses[column.selectedGuessIndex];
    },

    // The rows to display: all of them, or only those matching the active filter
    get visibleRows() {
      if (!this.filter) return this.rows;

      const column = this.columns[this.filter.columnIndex];
      if (this.filter.kind === "empty") {
        return this.rows.filter((row) => isEmpty(row[column.name]));
      }

      // Empty cells are never "unmatched": they are not part of unmatchedValues
      const unmatched = new Set(this.selectedGuess(column).unmatchedValues);
      return this.rows.filter((row) => unmatched.has(row[column.name]));
    },

    isFilterActive(columnIndex, kind) {
      return this.filter?.columnIndex === columnIndex && this.filter.kind === kind;
    },

    // Clicking the active button turns the filter off; clicking another one switches to it
    toggleFilter(columnIndex, kind) {
      this.filter = this.isFilterActive(columnIndex, kind) ? null : { columnIndex, kind };
    },

    // The unmatched values depend on the selected type: a filter on them no longer applies when it changes
    resetUnmatchedFilter(columnIndex) {
      if (this.isFilterActive(columnIndex, "unmatched")) this.filter = null;
    },

    guessLabel(guess) {
      const labels = {
        postcode: "Postcode",
        nis: "NIS",
        geo_name: "Geographical name",
        numeric: "Numeric",
        other: "Other",
      };
      const label = labels[guess.type] || guess.type;
      return guess.level ? `${label} — ${guess.level}` : label;
    },
  };
}

Alpine.data("App", App);

Alpine.start();
