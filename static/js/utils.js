// Helpers on raw cell values, shared by type guessing and value resolution.
// They know nothing about geographic data.

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
export function toDigits(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "string") {
    const s = value.trim();
    return /^\d+$/.test(s) ? s : null;
  }
  return null;
}
