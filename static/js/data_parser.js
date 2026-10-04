import nisHierarchy from "../data/nis_hierarchy.json" with { type: "json" };

// postcode2nis is a map from postcode to NIS code of the shape {"postcode": "nis", ...}
import postcode2nis from "../data/postcode2nis.json" with { type: "json" };

const LEVELS = ["Region", "Province", "District", "Municipality"];

/**
 * Return all the entities (objects with `nis`, `name` and `alternateNames`) of the given level
 *
 * @param {string} level :  Region | Province | District | Municipality
 */
function getEntities(level) {
  const regions = nisHierarchy.regions;
  if (level === "Region") return regions;

  const provinces = regions.flatMap((region) => region.provinces);
  if (level === "Province") return provinces;

  const districts = provinces.flatMap((province) => province.districts);
  if (level === "District") return districts;

  return districts.flatMap((district) => district.municipalities);
}

/**
 * Return the list of normalised names existing for the given level
 *
 * The names are extracted from the nisHierarchy object
 * (and normalised, as the alternate names can contain dashes, e.g. "vlaams-brabant")
 *
 * @param {string} level :  Region | Province | District | Municipality
 */
function getNormalisedNames(level) {
  const names = getEntities(level).flatMap((entity) => entity.alternateNames.map(normalise_string));

  // Remove duplicates
  return [...new Set(names)];
}

/**
 * Return the list of NIS codes (5 digit strings) existing for the given level
 *
 * @param {string} level :  Region | Province | District | Municipality
 */
function getNIS(level) {
  return [...new Set(getEntities(level).map((entity) => entity.nis))];
}

// Lookup tables, built once: Set.has is much faster than Array.includes
const postcodes = new Set(Object.keys(postcode2nis));
const nisCodes = Object.fromEntries(LEVELS.map((level) => [level, new Set(getNIS(level))]));
const normalisedNames = Object.fromEntries(LEVELS.map((level) => [level, new Set(getNormalisedNames(level))]));

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
 *  matchRate: share of the non-empty values matching (0 to 1), uniqueMatches: number of distinct matching values}
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

  if (total === 0) return [{ type: "other", matchRate: 0, uniqueMatches: 0 }];

  // `group` gives the priority of the type, `key` identifies a distinct match
  // (e.g. "Gent" and " gent " are the same name, 1000 and "1000" the same postcode)
  const finestFirst = [...LEVELS].reverse();
  const candidates = [
    { group: 0, type: "postcode", test: matchPostcode, key: toNumber },
    ...finestFirst.map((level) => ({
      group: 0,
      type: "nis",
      level,
      test: (value) => matchNIS(value, level),
      key: toNumber,
    })),
    ...finestFirst.map((level) => ({
      group: 0,
      type: "geo_name",
      level,
      test: (value) => matchName(value, level),
      key: normalise_string,
    })),
    { group: 1, type: "numeric", test: matchNumeric, key: toNumber },
    {
      group: 1,
      type: "other",
      test: (value) => !matchNumeric(value),
      key: (value) => (typeof value === "string" ? normalise_string(value) : String(value)),
    },
  ];

  const guesses = [];
  for (const { group, type, level, test, key } of candidates) {
    let matches = 0;
    const uniqueMatches = new Set();
    for (const [value, count] of counts) {
      if (test(value)) {
        matches += count;
        uniqueMatches.add(key(value));
      }
    }
    if (matches === 0) continue;

    const guess = { type, matchRate: matches / total, uniqueMatches: uniqueMatches.size };
    if (level) guess.level = level.toLowerCase();
    guesses.push({ group, guess });
  }

  // Array.prototype.sort is stable, so ties keep the order of the candidates above
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
function isEmpty(value) {
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
function matchNumeric(value) {
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
function matchPostcode(value) {
  // First check that it is a 4 digit number (it can be stored as a string or a number)
  const digits = toDigits(value);
  if (digits === null || digits.length !== 4) return false;

  // Then check if the value is in the list of postcodes
  return postcodes.has(digits);
}

/**
 * Return true if the value is a nis of the given level
 *
 * @param {string or int} value
 * @param {string} level :  Region | Province | District | Municipality
 */
function matchNIS(value, level) {
  // First check that it is a 4 or 5 digit number (it can be stored as a string or a number)
  const digits = toDigits(value);
  if (digits === null || (digits.length !== 4 && digits.length !== 5)) return false;

  // Then check if the value is in the list of NIS for the given level
  // A NIS has 5 digits: the leading zero of e.g. "02000" is lost when stored as a number
  return nisCodes[level].has(digits.padStart(5, "0"));
}

/**
 * Return true if the value is the name of a geographical entity of the given level
 *
 * @param {*} value
 * @param {string} level :  Region | Province | District | Municipality
 */
function matchName(value, level) {
  // Check if the value is a string
  if (typeof value !== "string") return false;

  // Then check if the value is in the list of normalised names for the given level
  return normalisedNames[level].has(normalise_string(value));
}

/**
 * Normalise a given string
 *
 * @param {*} s
 * @returns
 */
function normalise_string(s) {
  s = s.trim(); // Remove leading and trailing whitespace
  s = s.toLowerCase(); // Convert to lowercase
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Remove accents
  s = s.replace(/-/g, " "); // Replace dashes with spaces
  s = s.replace(/\s+/g, " "); // Replace multiple spaces with a single space

  return s;
}
