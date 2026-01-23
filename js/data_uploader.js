/**
 * Data Uploader Module
 * Handles file uploads and parsing for Excel and CSV files
 */

const DataUploader = {
  /**
   * Parse an uploaded file and return standardized data
   * @param {File} file - The uploaded file
   * @returns {Promise<{data: Array<Object>, columns: string[]}>}
   */
  async parseFile(file) {
    const fileType = this.getFileType(file);

    if (fileType === "csv") {
      return this.parseCSV(file);
    } else if (fileType === "excel") {
      return this.parseExcel(file);
    } else {
      throw new Error(`Type de fichier non supporté: ${file.name}`);
    }
  },

  /**
   * Get the file type from the file extension
   * @param {File} file
   * @returns {'csv' | 'excel' | 'unknown'}
   */
  getFileType(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "csv") return "csv";
    if (["xlsx", "xls"].includes(ext)) return "excel";
    return "unknown";
  },

  /**
   * Parse a CSV file
   * @param {File} file
   * @returns {Promise<{data: Array<Object>, columns: string[]}>}
   */
  async parseCSV(file) {
    const text = await file.text();
    const lines = text.trim().split("\n");

    if (lines.length < 2) {
      throw new Error(
        "Le fichier CSV doit contenir au moins un en-tête et une ligne de données",
      );
    }

    // Detect delimiter (comma, semicolon, or tab)
    const firstLine = lines[0];
    let delimiter = ",";
    if (firstLine.includes(";") && !firstLine.includes(",")) {
      delimiter = ";";
    } else if (
      firstLine.includes("\t") &&
      !firstLine.includes(",") &&
      !firstLine.includes(";")
    ) {
      delimiter = "\t";
    }

    const columns = this.parseCSVLine(lines[0], delimiter);
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = this.parseCSVLine(line, delimiter);
      const row = {};

      columns.forEach((col, idx) => {
        row[col] = this.parseValue(values[idx]);
      });

      data.push(row);
    }

    return { data, columns };
  },

  /**
   * Parse a single CSV line handling quoted values
   * @param {string} line
   * @param {string} delimiter
   * @returns {string[]}
   */
  parseCSVLine(line, delimiter) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  },

  /**
   * Parse an Excel file using SheetJS
   * @param {File} file
   * @returns {Promise<{data: Array<Object>, columns: string[]}>}
   */
  async parseExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target.result;
          const workbook = XLSX.read(arrayBuffer, { type: "array" });

          // Use the first sheet
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];

          // Convert to JSON
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

          if (jsonData.length === 0) {
            throw new Error("Le fichier Excel est vide");
          }

          const columns = Object.keys(jsonData[0]);

          // Parse values
          const data = jsonData.map((row) => {
            const parsedRow = {};
            columns.forEach((col) => {
              parsedRow[col] = this.parseValue(row[col]);
            });
            return parsedRow;
          });

          resolve({ data, columns });
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () =>
        reject(new Error("Erreur lors de la lecture du fichier"));
      reader.readAsArrayBuffer(file);
    });
  },

  /**
   * Parse a value to appropriate type (number or string)
   * @param {any} value
   * @returns {number | string}
   */
  parseValue(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    // If already a number, return it
    if (typeof value === "number") {
      return value;
    }

    const str = String(value).trim();

    // Try to parse as number
    // Handle European format (comma as decimal separator)
    const normalized = str.replace(",", ".");
    const num = parseFloat(normalized);

    if (!isNaN(num) && isFinite(num) && /^-?\d*[.,]?\d+$/.test(str)) {
      return num;
    }

    return str;
  },
};
