import Alpine from "https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/module.esm.js";
import { loadFile as loadFileUtil } from "./file_loader.js";
import { guessType } from "./data_parser.js";

function App() {
  return {
    dragging: false,
    fileName: "",
    rows: [], // array of objects, one per line: { columnName: value, ... }
    columns: [], // { name, guesses, selectedGuessIndex }
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
        }));
        this.fileName = result.fileName;
      } catch (e) {
        this.error = "Could not read this file. Please use a valid CSV or Excel file.";
      }
    },

    selectedGuess(column) {
      return column.guesses[column.selectedGuessIndex];
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
