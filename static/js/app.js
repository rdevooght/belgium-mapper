import Alpine from "https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/module.esm.js";
import { loadFile as loadFileUtil } from "./file_loader.js";
import { guessType } from "./data_parser.js";
import { isEmpty } from "./utils.js";
import { resolveSelectedGuess, selectGuess as selectColumnGuess, setManualResolution } from "./column_resolution.js";
import { describeEntity, candidateEntities } from "./geographic_resolver.js";

function App() {
  return {
    dragging: false,
    fileName: "",
    rows: [], // array of objects, one per line: { columnName: value, ... }
    columns: [], // { name, guesses, selectedGuessIndex, emptyCount, resolution }: resolution is null unless the selected type is geographic, see column_resolution.js
    filter: null, // null, or { columnIndex, kind: "unmatched" | "empty" | "notResolved" }: at most one filter at a time
    matchingRows: null, // null when no filter is active, otherwise the Set of the indexes of the rows matching it
    columnSearches: {}, // column index -> { text, min, max }
    error: "",

    async loadFile(file) {
      if (!file) return;
      this.error = "";

      try {
        const result = await loadFileUtil(file);
        this.rows = result.rows;
        this.columns = result.columns.map((name) => {
          const values = this.columnValues({ name });
          const column = {
            name,
            guesses: guessType(values),
            selectedGuessIndex: 0,
            emptyCount: values.filter(isEmpty).length,
            resolution: null,
          };
          resolveSelectedGuess(column, values);
          return column;
        });
        this.columnSearches = Object.fromEntries(this.columns.map((_, index) => [index, { text: "", min: "", max: "" }]));
        this.setFilter(null);
        this.fileName = result.fileName;
      } catch (e) {
        this.error = "Could not read this file. Please use a valid CSV or Excel file.";
      }
    },

    selectedGuess(column) {
      return column.guesses[column.selectedGuessIndex];
    },

    // Selecting another type discards the active resolution of the column and resolves its values again
    selectGuess(columnIndex, guessIndex) {
      const column = this.columns[columnIndex];
      selectColumnGuess(column, Number(guessIndex), this.columnValues(column));
      this.resetColumnFilter(columnIndex);
    },

    isNumericColumn(column) {
      return this.selectedGuess(column).type === "numeric";
    },

    updateColumnSearch() {
      if (this.hasColumnSearches) this.filter = null;
      this.refreshMatchingRows();
    },

    get hasColumnSearches() {
      return Object.values(this.columnSearches).some(({ text, min, max }) =>
        text.trim() !== "" || min !== "" || max !== "",
      );
    },

    get hasActiveFilters() {
      return Boolean(this.filter) || this.hasColumnSearches;
    },

    columnValues(column) {
      return this.rows.map((row) => row[column.name]);
    },

    // The active resolution of a cell, null if its column is not geographic
    cellResolution(column, rowIndex) {
      return column.resolution?.cells[rowIndex] ?? null;
    },

    unresolvedCount(column) {
      return column.resolution?.cells.filter(({ status }) => status !== "resolved").length ?? 0;
    },

    cellClass(column, rowIndex) {
      const resolution = this.cellResolution(column, rowIndex);
      return resolution ? `cell-${resolution.status}` : "";
    },

    // Tooltip: what the value was resolved to, or why it is not
    cellTitle(column, rowIndex) {
      const resolution = this.cellResolution(column, rowIndex);
      if (!resolution) return "";
      if (resolution.status === "resolved") {
        const manual = resolution.method === "manual" ? " (chosen manually)" : "";
        return `${this.entityLabel(describeEntity(resolution.nis))}${manual}`;
      }
      if (resolution.status === "ambiguous") return `Ambiguous: ${resolution.candidates.length} possible entities`;
      if (resolution.status === "unmatched") return "No geographic entity matches this value";
      return "";
    },

    cellCandidates(column, rowIndex) {
      return candidateEntities(this.cellResolution(column, rowIndex));
    },

    entityLabel(entity) {
      if (!entity) return "";
      const parent = entity.parent ? `, ${entity.parent.name}` : "";
      return `${entity.name} (${entity.type}${parent}) — NIS ${entity.nis}`;
    },

    // Replace the resolution of the cell with the candidate chosen by the user
    chooseCandidate(columnIndex, rowIndex, nis, updateFilter = false) {
      if (nis) setManualResolution(this.columns[columnIndex], rowIndex, nis);
      if (updateFilter && this.filter?.columnIndex === columnIndex && this.filter.kind === "notResolved") {
        this.refreshMatchingRows();
      }
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
    resetColumnFilter(columnIndex) {
      if (this.filter?.columnIndex === columnIndex) this.setFilter(null);
    },

    setFilter(filter) {
      this.filter = filter;
      if (filter) {
        this.columnSearches = Object.fromEntries(
          this.columns.map((_, index) => [index, { text: "", min: "", max: "" }]),
        );
      }
      this.refreshMatchingRows();
    },

    refreshMatchingRows() {
      if (!this.hasActiveFilters) {
        this.matchingRows = null;
        return;
      }
      const legacyMatches = this.filter ? this.findMatchingRows(this.filter) : null;
      this.matchingRows = new Set();
      this.rows.forEach((row, rowIndex) => {
        if (legacyMatches && !legacyMatches.has(rowIndex)) return;
        const passesSearches = this.columns.every((column, columnIndex) => {
          const search = this.columnSearches[columnIndex];
          const value = row[column.name];
          if (this.isNumericColumn(column)) {
            if (search.min !== "" || search.max !== "") {
              const numericValue = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
              if (!Number.isFinite(numericValue)) return false;
              if (search.min !== "" && numericValue < Number(search.min)) return false;
              if (search.max !== "" && numericValue > Number(search.max)) return false;
            }
          } else if (search.text.trim() !== "") {
            if (!normalizeSearchString(value).includes(normalizeSearchString(search.text))) return false;
          }
          return true;
        });
        if (passesSearches) this.matchingRows.add(rowIndex);
      });
    },

    // Indexes of rows matching the selected value or resolution filter
    findMatchingRows({ columnIndex, kind }) {
      const column = this.columns[columnIndex];
      // Empty cells are never "unmatched": they are not part of unmatchedValues
      const unmatched = kind === "unmatched" ? new Set(this.selectedGuess(column).unmatchedValues) : null;

      const matching = new Set();
      this.rows.forEach((row, rowIndex) => {
        const value = row[column.name];
        const resolution = this.cellResolution(column, rowIndex);
        if (
          kind === "notResolved" ? resolution?.status !== "resolved" : unmatched ? unmatched.has(value) : isEmpty(value)
        )
          matching.add(rowIndex);
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

function normalizeSearchString(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

Alpine.data("App", App);

Alpine.start();
