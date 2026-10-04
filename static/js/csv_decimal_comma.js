// Candidate field delimiters, in priority order (used to break ties).
const DELIMITERS = [",", ";", "\t", "|"];

/**
 * Convert decimal commas to decimal points before SheetJS parses the CSV.
 *
 * SheetJS only recognises "3.14" as a number; "3,14" would be imported as text.
 * This function rewrites the raw CSV text so that numeric-looking fields use a
 * dot as decimal separator, and leaves everything else byte-for-byte intact.
 *
 * It works as a small state machine: it walks the text one character at a time,
 * tracks whether we are inside a quoted cell, collects each field, and runs
 * every completed field through normalizeField().
 */
export function normalizeCsvDecimalCommas(csv) {
  // Figure out which character separates columns in this file.
  const delimiter = detectDelimiter(csv);

  let output = ""; // The rewritten CSV, built up progressively.
  let field = ""; // The field currently being collected (quotes included).
  let inQuotes = false; // True while we are between an opening and closing quote.

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];

    if (char === '"') {
      // Inside quotes, a doubled quote ("") is an escaped literal quote:
      // copy both characters and skip the second one so it does not
      // toggle the quote state.
      if (inQuotes && csv[i + 1] === '"') {
        field += '""';
        i++;
        continue;
      }
      // Otherwise this quote opens or closes a quoted section.
      // It stays in the field so normalizeField() can see it.
      inQuotes = !inQuotes;
      field += char;
      continue;
    }

    // A delimiter or line break only counts as a separator OUTSIDE quotes.
    // At that point the current field is complete: normalize it, write it out,
    // then write the separator itself unchanged and start a new field.
    if (!inQuotes && (char === delimiter || char === "\n" || char === "\r")) {
      output += normalizeField(field, delimiter);
      field = "";
      output += char;
      continue;
    }

    // Any other character (or a delimiter/newline inside quotes)
    // simply belongs to the current field.
    field += char;
  }

  // The file usually does not end with a separator, so the last field
  // is still pending: normalize and flush it.
  return output + normalizeField(field, delimiter);
}

/**
 * Normalize a single raw field (as it appears in the file, quotes included).
 * Only fields that look like a decimal-comma number are modified.
 */
function normalizeField(field, delimiter) {
  // Case 1: a quoted decimal such as "12,5" (optionally with spaces around).
  // This is how a decimal comma appears in a comma-delimited file: the comma
  // must be quoted, otherwise it would split the column.
  // The match covers the whole field, so we replace it with 12.5 (quotes removed).
  const quotedDecimal = field.match(/^\s*"([+-]?\d+),(\d+)"\s*$/);
  if (quotedDecimal) {
    return field.replace(quotedDecimal[0], `${quotedDecimal[1]}.${quotedDecimal[2]}`);
  }

  // Case 2: an unquoted decimal such as 12,5 (optional sign, optional spaces).
  // Only safe when the delimiter is NOT a comma: with a comma delimiter an
  // unquoted comma would already have been a column break, so it can't be a decimal.
  if (delimiter !== ",") {
    return field.replace(/^(\s*[+-]?\d+),(\d+\s*)$/, "$1.$2");
  }

  // Anything else (text, dates, already-valid numbers, ...) is left as is.
  return field;
}

/**
 * Guess the delimiter by counting candidate characters on the FIRST line only.
 * Characters inside quoted cells are ignored, so a header like
 * "Name, first";Age still resolves to ";".
 */
function detectDelimiter(csv) {
  // One counter per candidate delimiter, all starting at zero.
  const counts = new Map(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        // Escaped quote: skip the second one, stay inside quotes.
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (char === "\n" || char === "\r")) {
      // End of the header line: enough data to decide.
      break;
    } else if (!inQuotes && counts.has(char)) {
      // An unquoted candidate delimiter: count it.
      counts.set(char, counts.get(char) + 1);
    }
  }

  // Pick the most frequent candidate. The strict ">" means ties keep the
  // earlier one, and with no seed value reduce starts from "," so comma
  // is the default when nothing (or a tie) is found.
  return DELIMITERS.reduce((best, delimiter) => (counts.get(delimiter) > counts.get(best) ? delimiter : best));
}
