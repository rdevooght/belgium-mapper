/**
 * Data Parser Module
 * Analyzes data columns to detect geographic information and values
 */

const DataParser = {
  /**
   * Analyze all columns and detect their types
   * @param {Array<Object>} data - Array of row objects
   * @param {string[]} columns - Column names
   * @returns {Object} Column analysis results
   */
  analyzeColumns(data, columns) {
    const analysis = {};

    columns.forEach(col => {
      analysis[col] = this.analyzeColumn(data, col);
    });

    return analysis;
  },

  /**
   * Analyze a single column
   * @param {Array<Object>} data 
   * @param {string} column 
   * @returns {Object} Column type info
   */
  analyzeColumn(data, column) {
    const values = data.map(row => row[column]).filter(v => v !== null && v !== undefined);

    if (values.length === 0) {
      return { type: 'empty', matchRate: 0 };
    }

    // Check for numeric values
    const numericCount = values.filter(v => typeof v === 'number').length;
    const numericRate = numericCount / values.length;

    // Check for geographic types
    const postcodeMatch = this.matchPostcodes(values);
    const nisMatch = this.matchNIS(values);
    const nameMatch = this.matchNames(values);

    // Determine best type
    if (postcodeMatch.rate > 0.7) {
      return { type: 'postcode', matchRate: postcodeMatch.rate, level: 'municipality' };
    }

    if (nisMatch.rate > 0.7) {
      return { type: 'nis', matchRate: nisMatch.rate, level: nisMatch.level };
    }

    if (nameMatch.rate > 0.5) {
      return { type: 'name', matchRate: nameMatch.rate, level: nameMatch.level };
    }

    if (numericRate > 0.8) {
      return { type: 'numeric', matchRate: numericRate };
    }

    return { type: 'other', matchRate: 0 };
  },

  /**
   * Check how many values match Belgian postcodes
   * @param {Array} values 
   * @returns {{ rate: number }}
   */
  matchPostcodes(values) {
    if (!geoLookups || !geoLookups.postcodeToNis) {
      return { rate: 0 };
    }

    let matches = 0;

    for (const value of values) {
      const postcode = this.normalizePostcode(value);
      if (postcode && geoLookups.postcodeToNis[postcode]) {
        matches++;
      }
    }

    return { rate: matches / values.length };
  },

  /**
   * Check how many values match NIS codes
   * @param {Array} values 
   * @returns {{ rate: number, level: string }}
   */
  matchNIS(values) {
    if (!geoLookups || !geoLookups.nisToEntity) {
      return { rate: 0, level: null };
    }

    let matches = 0;
    const levelCounts = {};

    for (const value of values) {
      const nis = String(value).trim();
      const entity = geoLookups.nisToEntity[nis];

      if (entity) {
        matches++;
        const level = entity.level;
        levelCounts[level] = (levelCounts[level] || 0) + 1;
      }
    }

    // Find dominant level
    let dominantLevel = null;
    let maxCount = 0;
    for (const [level, count] of Object.entries(levelCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantLevel = level;
      }
    }

    return { rate: matches / values.length, level: dominantLevel };
  },

  /**
   * Check how many values match geographic names
   * @param {Array} values 
   * @returns {{ rate: number, level: string }}
   */
  matchNames(values) {
    if (!geoLookups || !geoLookups.nameToNis) {
      return { rate: 0, level: null };
    }

    let matches = 0;
    const levelCounts = {};

    for (const value of values) {
      if (typeof value !== 'string') continue;

      const normalized = this.normalizeString(value);
      const nisMatches = geoLookups.nameToNis[normalized];

      if (nisMatches && nisMatches.length > 0) {
        matches++;

        // Get level from first matched NIS
        const entity = geoLookups.nisToEntity[String(nisMatches[0])];
        if (entity) {
          const level = entity.level;
          levelCounts[level] = (levelCounts[level] || 0) + 1;
        }
      }
    }

    // Find dominant level
    let dominantLevel = null;
    let maxCount = 0;
    for (const [level, count] of Object.entries(levelCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantLevel = level;
      }
    }

    return { rate: matches / values.length, level: dominantLevel };
  },

  /**
   * Detect the best geographic column
   * @param {Array<Object>} data 
   * @param {string[]} columns 
   * @returns {{ column: string, type: string, level: string } | null}
   */
  detectGeoColumn(data, columns) {
    const analysis = this.analyzeColumns(data, columns);

    let bestColumn = null;
    let bestRate = 0;
    let bestType = null;
    let bestLevel = null;

    for (const [col, info] of Object.entries(analysis)) {
      if (['postcode', 'nis', 'name'].includes(info.type) && info.matchRate > bestRate) {
        bestRate = info.matchRate;
        bestColumn = col;
        bestType = info.type;
        bestLevel = info.level;
      }
    }

    if (bestColumn) {
      return { column: bestColumn, type: bestType, level: bestLevel, matchRate: bestRate };
    }

    return null;
  },

  /**
   * Detect numeric columns that could be used as values
   * @param {Array<Object>} data 
   * @param {string[]} columns 
   * @returns {string[]}
   */
  detectValueColumns(data, columns) {
    const analysis = this.analyzeColumns(data, columns);

    return columns.filter(col => {
      const info = analysis[col];
      return info.type === 'numeric' && info.matchRate > 0.5;
    });
  },

  /**
   * Map data rows to NIS codes
   * @param {Array<Object>} data 
   * @param {string} geoColumn 
   * @param {string} geoType - 'postcode', 'nis', or 'name'
   * @returns {Map<number, Array>} NIS code to data rows mapping
   */
  mapToNIS(data, geoColumn, geoType) {
    const mapping = new Map();

    for (const row of data) {
      const value = row[geoColumn];
      let nisCodes = [];

      if (geoType === 'postcode') {
        const postcode = this.normalizePostcode(value);
        if (postcode && geoLookups.postcodeToNis[postcode]) {
          nisCodes = geoLookups.postcodeToNis[postcode];
        }
      } else if (geoType === 'nis') {
        const nis = parseInt(String(value).trim());
        if (!isNaN(nis) && geoLookups.nisToEntity[String(nis)]) {
          nisCodes = [nis];
        }
      } else if (geoType === 'name') {
        const normalized = this.normalizeString(String(value));
        if (geoLookups.nameToNis[normalized]) {
          nisCodes = geoLookups.nameToNis[normalized];
        }
      }

      // Add row to each matched NIS
      for (const nis of nisCodes) {
        if (!mapping.has(nis)) {
          mapping.set(nis, []);
        }
        mapping.get(nis).push(row);
      }
    }

    return mapping;
  },

  /**
   * Aggregate values by NIS code
   * @param {Map<number, Array>} nisMapping 
   * @param {string} valueColumn 
   * @param {'sum' | 'avg' | 'count'} aggregation 
   * @returns {Map<number, number>}
   */
  aggregateByNIS(nisMapping, valueColumn, aggregation = 'sum') {
    const result = new Map();

    for (const [nis, rows] of nisMapping) {
      const values = rows
        .map(r => r[valueColumn])
        .filter(v => typeof v === 'number');

      if (values.length === 0) continue;

      let aggregated;
      switch (aggregation) {
        case 'sum':
          aggregated = values.reduce((a, b) => a + b, 0);
          break;
        case 'avg':
          aggregated = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'count':
          aggregated = values.length;
          break;
        default:
          aggregated = values.reduce((a, b) => a + b, 0);
      }

      result.set(nis, aggregated);
    }

    return result;
  },

  /**
   * Normalize a postcode value to string
   * @param {any} value 
   * @returns {string | null}
   */
  normalizePostcode(value) {
    if (value === null || value === undefined) return null;

    const str = String(value).trim();

    // Belgian postcodes are 4 digits
    if (/^\d{4}$/.test(str)) {
      return str;
    }

    // Try to extract 4 digits
    const match = str.match(/^\d{4}/);
    if (match) return match[0];

    return null;
  },

  /**
   * Normalize a string for matching
   * @param {string} s 
   * @returns {string}
   */
  normalizeString(s) {
    if (!s) return '';

    return s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ');
  }
};
