// Resolves the individual values of a geographic column to geographic entities (identified by their NIS).
//
// This module is independent from:
// - the type guessing (data_parser.js): it receives the selected type, it never decides it
// - Alpine / the UI: it only works on plain values and returns plain objects
// - the geographic data: every lookup goes through a geographic index, which can be injected (default: the real one)
//
// A resolution is a small immutable-by-convention object, it never embeds the entity: use the index to read it.
//
// {
//   value:      the original cell value, untouched
//   status:     "resolved" | "ambiguous" | "unmatched" | "empty"
//   nis:        the NIS of the entity when resolved, null otherwise
//   candidates: the NIS codes of all the possible entities ([nis] when resolved, [] when unmatched or empty)
//   method:     "automatic" | "contextual" | "manual"
// }
import { geographicIndex } from "./geographic_index.js";
import { isEmpty, toDigits } from "./utils.js";

export const STATUS = Object.freeze({
  RESOLVED: "resolved",
  AMBIGUOUS: "ambiguous",
  UNMATCHED: "unmatched",
  EMPTY: "empty",
});

export const METHOD = Object.freeze({ AUTOMATIC: "automatic", CONTEXTUAL: "contextual", MANUAL: "manual" });

/**
 * Return true if the selected type (a guess of data_parser.guessType) is a geographic one,
 * i.e. one that the values can be resolved with.
 *
 * @param {{type: string, level?: string}} selectedType
 */
export function isGeographicType(selectedType) {
  if (!selectedType) return false;
  if (selectedType.type === "postcode") return true;
  return (selectedType.type === "nis" || selectedType.type === "geo_name") && Boolean(selectedType.level);
}

/**
 * Resolve one value.
 *
 * @param {*} value raw cell value
 * @param {{type: string, level?: string}} selectedType the selected type of the column: a guess of guessType,
 *   e.g. {type: "geo_name", level: "municipality"}, {type: "nis", level: "province"} or {type: "postcode"}
 * @param {{constraints?: string[]}} [context] optional. `constraints` are the NIS codes already resolved for the same row
 *   in other columns. When the value is ambiguous, they are used to keep only the candidates that are an ancestor or a
 *   descendant of every constraint.
 * @param {object} [index] geographic index, defaults to the application's
 * @returns {{value, status, nis, candidates, method}}
 */
export function resolveValue(value, selectedType, context, index = geographicIndex) {
  return buildResolution(value, findCandidates(value, selectedType, index), context, index);
}

/**
 * Resolve all the values of a column. Each cell gets its own resolution (the context can be different for each row).
 *
 * @param {Array} values raw values of the column, one per row; they are not modified
 * @param {{type: string, level?: string}} selectedType
 * @param {{contexts?: Array<{constraints?: string[]}|undefined>, index?: object}} [options]
 *   `contexts` is parallel to `values`
 * @returns {{cells: Array}|null} the active resolution of the column, `null` if the selected type is not geographic
 */
export function resolveColumn(values, selectedType, { contexts, index = geographicIndex } = {}) {
  if (!isGeographicType(selectedType)) return null;

  // Looking up a name is the same for all the cells with the same value: do it once.
  // Only the context can make cells with the same value end up differently.
  const candidatesByValue = new Map();
  const cells = values.map((value, rowIndex) => {
    let candidates = candidatesByValue.get(value);
    if (!candidates) {
      candidates = findCandidates(value, selectedType, index);
      candidatesByValue.set(value, candidates);
    }
    return buildResolution(value, candidates, contexts?.[rowIndex], index);
  });
  return { cells };
}

/**
 * A resolution chosen by the user. It replaces the previous resolution of the cell, whatever its status was.
 * It is only application state: nothing is written to the geographic data.
 *
 * @param {*} value the original cell value
 * @param {string} nis NIS of the chosen entity, which must exist in the index
 */
export function manualResolution(value, nis, index = geographicIndex) {
  if (!index.getEntityByNis(nis)) throw new Error(`Unknown NIS: ${nis}`);
  return { value, status: STATUS.RESOLVED, nis, candidates: [nis], method: METHOD.MANUAL };
}

/**
 * The metadata of an entity, for display: canonical name, type and parent. `null` if the NIS is unknown.
 *
 * @returns {{nis: string, name: string, type: string, parent: {nis: string, name: string, type: string}|null}|null}
 */
export function describeEntity(nis, index = geographicIndex) {
  const entity = index.getEntityByNis(nis);
  if (!entity) return null;
  const parent = index.getEntityByNis(index.getParent(nis));
  return {
    nis: entity.nis,
    name: entity.name,
    type: entity.type,
    parent: parent ? { nis: parent.nis, name: parent.name, type: parent.type } : null,
  };
}

/** The entity of a resolved cell, `null` otherwise. */
export function resolvedEntity(resolution, index = geographicIndex) {
  return resolution?.nis ? describeEntity(resolution.nis, index) : null;
}

/** The entities that an ambiguous (or resolved) cell can be: what a candidate selector needs. */
export function candidateEntities(resolution, index = geographicIndex) {
  return (resolution?.candidates ?? []).map((nis) => describeEntity(nis, index)).filter(Boolean);
}

/** NIS codes of the entities the value can be, according to the selected type. Does not look at the context. */
function findCandidates(value, { type, level }, index) {
  if (isEmpty(value)) return [];

  if (type === "postcode") {
    const digits = toDigits(value);
    return digits === null ? [] : index.findByPostcode(digits);
  }

  if (type === "nis") {
    // A NIS has 5 digits: the leading zero of e.g. "02000" is lost when it is stored as a number
    const digits = toDigits(value);
    if (digits === null || (digits.length !== 4 && digits.length !== 5)) return [];
    return index.findByNisAndType(digits.padStart(5, "0"), level);
  }

  if (type === "geo_name") {
    return typeof value === "string" ? index.findByNameAndType(value, level) : [];
  }

  return [];
}

function buildResolution(value, candidates, context, index) {
  if (isEmpty(value)) return { value, status: STATUS.EMPTY, nis: null, candidates: [], method: METHOD.AUTOMATIC };
  if (candidates.length === 0)
    return { value, status: STATUS.UNMATCHED, nis: null, candidates: [], method: METHOD.AUTOMATIC };
  if (candidates.length === 1)
    return {
      value,
      status: STATUS.RESOLVED,
      nis: candidates[0],
      candidates: [...candidates],
      method: METHOD.AUTOMATIC,
    };

  const narrowed = narrowByContext(candidates, context?.constraints, index);
  if (narrowed.length === 1)
    return { value, status: STATUS.RESOLVED, nis: narrowed[0], candidates: [...narrowed], method: METHOD.CONTEXTUAL };
  return {
    value,
    status: STATUS.AMBIGUOUS,
    nis: null,
    candidates: [...narrowed],
    method: narrowed.length < candidates.length ? METHOD.CONTEXTUAL : METHOD.AUTOMATIC,
  };
}

// Keep the candidates related (ancestor, descendant or same entity) to every constraint.
// If the constraints contradict all the candidates, they are ignored rather than discarding every possibility.
function narrowByContext(candidates, constraints, index) {
  if (!constraints?.length) return candidates;
  const narrowed = candidates.filter((nis) => constraints.every((constraint) => areRelated(nis, constraint, index)));
  return narrowed.length > 0 ? narrowed : candidates;
}

function areRelated(a, b, index) {
  return a === b || ancestorsOf(a, index).has(b) || ancestorsOf(b, index).has(a);
}

function ancestorsOf(nis, index) {
  const ancestors = new Set();
  for (let parent = index.getParent(nis); parent && !ancestors.has(parent); parent = index.getParent(parent)) {
    ancestors.add(parent);
  }
  return ancestors;
}
