import Alpine from "https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/module.esm.js";
import { loadFile as loadFileUtil } from "./file_loader.js";

function App() {
  return {
    dragging: false,
    fileName: "",
    rows: [], // array of objects, one per line: { columnName: value, ... }
    columns: [], // list of column names
    error: "",

    async loadFile(file) {
      if (!file) return;
      this.error = "";

      try {
        const result = await loadFileUtil(file);
        this.rows = result.rows;
        this.columns = result.columns;
        this.fileName = result.fileName;
      } catch (e) {
        this.fileName = "";
        this.error = "Could not read this file. Please use a valid CSV or Excel file.";
      }
    },
  };
}

Alpine.data("App", App);

Alpine.start();
