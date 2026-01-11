
function parseData(filedata) {
  var data = extractData(filedata);
  var columnsTypesPredictions = getColumnsTypesPredictions(data);
}

/**
 * Takes a file and returns a JSON object contaning the data
 * it uses the XLSX library to parse the file
 * the json has the following structure:
 * [{col1: value1, col2: value1, ...}, {col1: value2, col2: value2, ...}, ...]
 * @param {*} filedata is the output of a FileReader object
 */
function extractData(filedata) {
  var data = new Uint8Array(e.target.result);
  var workbook = XLSX.read(data, {type: 'array'});
  // Now you can access the workbook object and read its sheets.
  // For example, to read the first sheet as JSON:
  var firstSheet = workbook.SheetNames[0];
  var jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
  return jsonData;
}


/**
 * For each column, guess the type of data it contains:
 * - postcode
 * - NIS + NIS level
 * - geo_name + level
 * - numerical value
 * - other
 * 
 * The detection of geographical data is based on lists of known geographical names, NIS and postcodes, that are in a possible_geo_identifiers variable
 * @param {*} data array of objects: [{col1: value1, col2: value1, ...}, {col1: value2, col2: value2, ...}, ...]
 */
function getColumnsTypesPredictions(data) {

}

/**
 * Return true if the value is a postcode
 * 
 * Uses possible_geo_identifiers.postcodes as a list of known postcodes
 * 
 * @param {string or int} value 
 */
function matchPostcode(value) {
  // First check if it is a string or an int
  if (typeof value === 'string' || value instanceof String) {
    // check if that string is a 4 digit number
    if (!value.match(/^\d{4}$/)) {
      return false;
    }
    // parse the string to an int
    value = parseInt(value);
  }
  // check if the value is in the list of postcodes
  return possible_geo_identifiers.postcodes.includes(value);
}

/**
 * Return true if the value is a nis of the given level
 * 
 * Uses possible_geo_identifiers.nis[level] as a list of known NIS
 * 
 * @param {string or int} value 
 * @param {string} level :  Region | Province | Arrondissement | Commune
 */
function matchNIS(value, level) {
  // First check if it is a string or an int
  if (typeof value === 'string' || value instanceof String) {
    // check if that string is a 4 or 5 digit number
    if (!value.match(/^\d{4,5}$/)) {
      return false;
    }
    // parse the string to an int
    value = parseInt(value);
  }
  // check if the value is in the list of NIS
  return possible_geo_identifiers.nis[level].includes(value);
}

/**
 * Return true if the value is the name of a geographical entity of the given level
 * 
 * Uses possible_geo_identifiers.normalised_names[level] as a list of known names
 * 
 * @param {*} value 
 * @param {string} level :  Region | Province | Arrondissement | Commune
 */
function matchNIS(value, level) {
  // First check if it is a string or an int
  if (typeof value === 'string' || value instanceof String) {
    // normalise the string
    value = normalise_string(value);

    // check if the value is in the list of postcodes
    return possible_geo_identifiers.normalised_names[level].includes(value);
  } else {
    return false;
  }
  
}

/**
 * Normalise a given string
 * 
 * @param {*} s 
 * @returns 
 */
function normalise_string(s) {
  s = s.trim();  // Remove leading and trailing whitespace
  s = s.toLowerCase();  // Convert to lowercase
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");  // Remove accents
  s = s.replace('-', ' ');  // Replace dashes with spaces
  s = s.replace(/\s+/g, ' ');  // Replace multiple spaces with a single space

  return s;
}
