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
    matchingRows: null, // null when no filter is active, otherwise the Set of the indexes of the rows matching it
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
        this.setFilter(null);
        this.fileName = result.fileName;
      } catch (e) {
        this.error = "Could not read this file. Please use a valid CSV or Excel file.";
      }
    },

    selectedGuess(column) {
      return column.guesses[column.selectedGuessIndex];
    },

    // All the rows stay in the table, the ones that do not match the filter are hidden:
    // creating and destroying thousands of cells on each toggle would be slow
    isRowVisible(rowIndex) {
      return !this.matchingRows || this.matchingRows.has(rowIndex);
    },

    get visibleCount() {
      return this.matchingRows ? this.matchingRows.size : this.rows.length;
    },

    isFilterActive(columnIndex, kind) {
      return this.filter?.columnIndex === columnIndex && this.filter.kind === kind;
    },

    // Clicking the active button turns the filter off; clicking another one switches to it
    toggleFilter(columnIndex, kind) {
      this.setFilter(this.isFilterActive(columnIndex, kind) ? null : { columnIndex, kind });
    },

    // The unmatched values depend on the selected type: a filter on them no longer applies when it changes
    resetUnmatchedFilter(columnIndex) {
      if (this.isFilterActive(columnIndex, "unmatched")) this.setFilter(null);
    },

    setFilter(filter) {
      this.filter = filter;
      this.matchingRows = filter ? this.findMatchingRows(filter) : null;
    },

    // Indexes of the rows with an empty / unmatched value in the filter's column
    findMatchingRows({ columnIndex, kind }) {
      const column = this.columns[columnIndex];
      // Empty cells are never "unmatched": they are not part of unmatchedValues
      const unmatched = kind === "unmatched" ? new Set(this.selectedGuess(column).unmatchedValues) : null;

      const matching = new Set();
      this.rows.forEach((row, rowIndex) => {
        const value = row[column.name];
        if (unmatched ? unmatched.has(value) : isEmpty(value)) matching.add(rowIndex);
      });
      return matching;
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
