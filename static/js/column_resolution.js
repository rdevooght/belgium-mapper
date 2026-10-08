// Glue between the column metadata (selected type) and the active geographic resolution of the column.
// Framework-free: `column` is a plain object ({name, guesses, selectedGuessIndex, resolution}), which Alpine can proxy.
//
//   raw rows -> column.selectedGuessIndex -> column.resolution
//
// The raw rows are only read. The resolution only lives in the column.
import { resolveColumn, manualResolution } from "./geographic_resolver.js";

/**
 * Select a type for the column and replace its active resolution:
 * the previous one is discarded, and the values are resolved again with the new type.
 *
 * @param {object} column
 * @param {number} guessIndex index in column.guesses
 * @param {Array} values raw values of the column, one per row
 * @param {object} [options] see resolveColumn
 */
export function selectGuess(column, guessIndex, values, options) {
  column.selectedGuessIndex = guessIndex;
  column.resolution = resolveColumn(values, column.guesses[guessIndex], options);
}

/** Resolve the column with the type that is currently selected. */
export function resolveSelectedGuess(column, values, options) {
  selectGuess(column, column.selectedGuessIndex, values, options);
}

/**
 * Replace the resolution of one cell with the entity chosen by the user.
 * Only this cell is affected, and the raw value is kept.
 */
export function setManualResolution(column, rowIndex, nis, options) {
  const current = column.resolution?.cells[rowIndex];
  if (!current) throw new Error(`Column ${column.name} has no resolution for row ${rowIndex}`);
  column.resolution.cells[rowIndex] = manualResolution(current.value, nis, options?.index);
}
