// ============================================================
// Data.gs — reads all spreadsheet files from the
// "Weekly Distribution Pulse" Drive folder.
//
// Each file becomes a labeled block of tab-separated tables
// in the Claude prompt. File name is used as the label so
// Claude knows which distributor or report type it's reading.
//
// Supports: Google Sheets files and Excel (.xlsx) uploads.
// When the real API arrives, replace this file only.
// ============================================================

function SP_loadSalesData_() {
  var folderName = SP_dataFolderName_();
  var folders = DriveApp.getFoldersByName(folderName);
  if (!folders.hasNext()) {
    throw new Error('Drive folder "' + folderName + '" not found. Check the name matches exactly.');
  }
  var folder = folders.next();

  var parts = [];

  // Read Google Sheets files
  var sheets = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (sheets.hasNext()) {
    var file = sheets.next();
    parts.push(SP_readSpreadsheetFile_(file.getId(), file.getName()));
  }

  // Read Excel files (.xlsx)
  var excels = folder.getFilesByType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  while (excels.hasNext()) {
    var xFile = excels.next();
    parts.push(SP_readExcelFile_(xFile.getId(), xFile.getName()));
  }

  if (parts.length === 0) {
    throw new Error('No spreadsheet files found in "' + folderName + '". ' +
      'Folder exists but is empty or contains unsupported file types.');
  }

  Logger.log("Files read from Drive: " + parts.length);
  return parts.join("\n\n");
}

// Opens a Google Sheets file and reads all non-empty sheets.
function SP_readSpreadsheetFile_(fileId, fileName) {
  var ss = SpreadsheetApp.openById(fileId);
  return SP_spreadsheetToText_(ss, fileName);
}

// Converts an uploaded Excel file to Sheets in-memory, reads it,
// then deletes the temp conversion file.
function SP_readExcelFile_(fileId, fileName) {
  var blob = DriveApp.getFileById(fileId).getBlob();
  var resource = { title: "_sp_temp_" + fileId, mimeType: MimeType.GOOGLE_SHEETS };
  var converted = Drive.Files.insert(resource, blob, { convert: true });
  var tempId = converted.id;

  try {
    var ss = SpreadsheetApp.openById(tempId);
    return SP_spreadsheetToText_(ss, fileName);
  } finally {
    try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) { /* ignore cleanup errors */ }
  }
}

// Reads all non-empty sheets from a Spreadsheet and formats them
// as tab-separated tables under a file+sheet label.
function SP_spreadsheetToText_(ss, fileName) {
  var sheetParts = [];
  var sheets = ss.getSheets();

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var values = sheet.getDataRange().getValues();
    if (values.length === 0) continue;

    var label = sheets.length === 1
      ? "=== FILE: " + fileName + " ==="
      : "=== FILE: " + fileName + " | SHEET: " + sheet.getName() + " ===";

    sheetParts.push(label);
    sheetParts.push(SP_valuesToTable_(values));
  }

  return sheetParts.join("\n\n");
}

// Converts a 2D array to a plain-text tab-separated table.
// Skips fully empty rows. Formats Dates as YYYY-MM-DD.
function SP_valuesToTable_(values) {
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var hasData = row.some(function(c) { return c !== "" && c !== null && c !== undefined; });
    if (!hasData) continue;
    var cells = row.map(function(c) {
      if (c instanceof Date) return SP_isoDate_(c);
      return (c === null || c === undefined) ? "" : String(c);
    });
    rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}

function SP_isoDate_(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
