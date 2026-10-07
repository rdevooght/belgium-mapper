// nisEntities is the canonical flat geographic data: {"<nis>": {nis, type, name, alternateNames, parentNis, childrenNis}}
// (see static/data/structure.md)
import { geographicIndex, normalizeGeographicName } from "./geographic_index.js";

const LEVELS = ["Region", "Province", "District", "Municipality"];
const GEO_THRESHOLD = 0.9;

const ENTITY_TYPE = { Region: "region", Province: "province", District: "district", Municipality: "municipality" };

/**
 * For each column, guess the type of data it contains:
 * - postcode
 * - NIS + NIS level
 * - geo_name + level
 * - numerical value
 * - other
 *
 * It produces a list of guesses for each column, with the most likely type first and some stats on each options:
 * - percentage of values that match the type
 * - number of unique matches
 *
 * The detection of geographical data is based on lists of known geographical names, NIS and postcodes
 *
 * Empty values (null, undefined, NaN, blank strings) are ignored.
 *
 * Each guess has the shape:
 * {type: 'postcode' | 'nis' | 'geo_name' | 'numeric' | 'other', level?: 'region' | 'province' | 'district' | 'municipality',
 *  matchRate: share of the non-empty values matching (0 to 1), uniqueMatches: number of distinct matching values,
 *  unmatchedValues: distinct non-empty values that do not match this type}
 *
 * Guesses that match nothing are left out. They are ordered from the most specific to the most generic type:
 * the geographical guesses first (best matchRate first), then the generic ones, 'numeric' and 'other'
 * (best matchRate first). Generic types are a fallback: they would otherwise always win on matchRate
 * (every postcode is also a number). If everything else is equal, the finest geographical level comes first.
 *
 * @param {*} values array of values: that could be strings or numbers
 * @returns {Array<{type: string, level?: string, matchRate: number, uniqueMatches: number}>}
 */
export function guessType(values) {
  // Count the non-empty values, so each distinct value only has to be tested once
  const counts = new Map();
  let total = 0;
  for (const value of values) {
    if (isEmpty(value)) continue;
    total++;
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  if (total === 0) return [{ type: "other", matchRate: 0, uniqueMatches: 0, unmatchedValues: [] }];

  // `group` gives the priority of the type, `key` identifies a distinct match
  // (e.g. "Gent" and " gent " are the same name, 1000 and "1000" the same postcode)
  const finestFirst = [...LEVELS].reverse();
  const candidates = [
    { type: "postcode", geo: true, test: matchPostcode, key: toNumber },
    ...finestFirst.map((level) => ({
      type: "nis",
      geo: true,
      level,
      test: (value) => matchNIS(value, level),
      key: toNumber,
    })),
    ...finestFirst.map((level) => ({
      type: "geo_name",
      geo: true,
      level,
      test: (value) => matchName(value, level),
      key: normalizeGeographicName,
    })),
    { type: "numeric", test: matchNumeric, key: toNumber },
    {
      type: "other",
      test: (value) => !matchNumeric(value),
      key: (value) => (typeof value === "string" ? normalizeGeographicName(value) : String(value)),
    },
  ];

  const guesses = [];
  for (const { type, level, test, key, geo = false } of candidates) {
    let matches = 0;
    const uniqueMatches = new Set();
    const unmatchedValues = [];
    for (const [value, count] of counts) {
      if (test(value)) {
        matches += count;
        uniqueMatches.add(key(value));
      } else unmatchedValues.push(value);
    }
    if (matches === 0) continue;

    const matchRate = matches / total;
    const guess = {
      type,
      matchRate,
      uniqueMatches: uniqueMatches.size,
      unmatchedValues,
    };
    if (level) guess.level = level.toLowerCase();
    guesses.push({ group: geo && matchRate >= GEO_THRESHOLD ? 0 : geo ? 2 : 1, guess });
  }

  // Qualified geographic guesses lead; generic types come next, then lower confidence geo guesses.
  guesses.sort(
    (a, b) =>
      a.group - b.group || b.guess.matchRate - a.guess.matchRate || b.guess.uniqueMatches - a.guess.uniqueMatches,
  );

  return guesses.map(({ guess }) => guess);
}

/**
 * Return true if the value is empty: null, undefined, NaN or a blank string
 *
 * @param {*} value
 */
export function isEmpty(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isNaN(value)) ||
    (typeof value === "string" && value.trim() === "")
  );
}

/**
 * Return the value as a string of digits if it is a non-negative integer
 * (stored as a number or as a string), null otherwise
 *
 * @param {string or int} value
 */
function toDigits(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "string") {
    const s = value.trim();
    return /^\d+$/.test(s) ? s : null;
  }
  return null;
}

/**
 * Return true if the value is a number (stored as a number or as a string, "," or "." as decimal separator)
 *
 * @param {string or number} value
 */
export function matchNumeric(value) {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && /^[-+]?\d+([.,]\d+)?$/.test(value.trim());
}

/**
 * Convert a value for which matchNumeric is true to a number
 *
 * @param {string or number} value
 */
function toNumber(value) {
  return typeof value === "number" ? value : Number(value.trim().replace(",", "."));
}

/**
 * Return true if the value is a postcode
 *
 * @param {string or int} value
 */
export function matchPostcode(value) {
  // First check that it is a 4 digit number (it can be stored as a string or a number)
  const digits = toDigits(value);
  if (digits === null || digits.length !== 4) return false;

  // Then check if the value is in the list of postcodes
  return geographicIndex.findByPostcode(digits).length > 0;
}

/**
 * Return true if the value is a nis of the given level
 *
 * @param {string or int} value
 * @param {string} level :  Region | Province | District | Municipality
 */
export function matchNIS(value, level) {
  if (!ENTITY_TYPE[level]) return false;

  // First check that it is a 4 or 5 digit number (it can be stored as a string or a number)
  const digits = toDigits(value);
  if (digits === null || (digits.length !== 4 && digits.length !== 5)) return false;

  // Then check if the value is in the list of NIS for the given level
  // A NIS has 5 digits: the leading zero of e.g. "02000" is lost when stored as a number
  const entity = geographicIndex.getEntityByNis(digits.padStart(5, "0"));
  return (
    entity !== null &&
    (entity.type === ENTITY_TYPE[level] ||
      // special case for Brussels
      (level === "Province" && entity.nis === "04000"))
  );
}

/**
 * Return true if the value is the name of a geographical entity of the given level
 *
 * @param {*} value
 * @param {string} level :  Region | Province | District | Municipality
 */
export function matchName(value, level) {
  if (!ENTITY_TYPE[level]) return false;

  // Check if the value is a string
  if (typeof value !== "string") return false;

  // Then check if the value is in the list of normalised names for the given level
  return geographicIndex.findByNameAndType(value, ENTITY_TYPE[level]).length > 0;
}
