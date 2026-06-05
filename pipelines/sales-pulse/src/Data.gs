// ============================================================
// Data.gs — reads all files from the "Weekly Distribution Pulse"
// Drive folder. Supports CSV, Google Sheets, and Excel (.xlsx).
// When the real API arrives, replace this file only.
// ============================================================

function SP_loadSalesData_() {
  var folderName = SP_dataFolderName_();
  var folders = DriveApp.getFoldersByName(folderName);
  if (!folders.hasNext()) {
    throw new Error('Drive folder "' + folderName + '" not found. Check the name matches exactly.');
  }
  var folder = folders.next();
  Logger.log("Folder found: " + folder.getName() + " (" + folder.getId() + ")");

  var parts = [];
  var allFiles = folder.getFiles();
  while (allFiles.hasNext()) {
    var file = allFiles.next();
    var name = file.getName();
    var mime = file.getMimeType();
    Logger.log("File: " + name + " | MIME: " + mime);

    var nameLower = name.toLowerCase();
    if (nameLower.slice(-4) === ".csv" ||
        mime === MimeType.CSV ||
        mime === "text/csv" ||
        mime === "text/plain") {
      parts.push(SP_readCsvFile_(file));
    } else if (mime === MimeType.GOOGLE_SHEETS) {
      parts.push(SP_readSpreadsheetFile_(file.getId(), name));
    } else if (nameLower.slice(-5) === ".xlsx" ||
               mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      parts.push(SP_readExcelFile_(file.getId(), name));
    } else {
      Logger.log("Skipped (unsupported type): " + name);
    }
  }

  if (parts.length === 0) {
    throw new Error('No readable files found in "' + folderName + '". Check the Execution log for file names and MIME types.');
  }

  Logger.log("Files read: " + parts.length);
  return parts.join("\n\n");
}

// Reads a CSV file and formats it as a tab-separated table.
function SP_readCsvFile_(file) {
  var content = file.getBlob().getDataAsString();
  var rows = Utilities.parseCsv(content);
  var lines = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var hasData = row.some(function(c) { return c !== ""; });
    if (!hasData) continue;
    lines.push(row.join("\t"));
  }
  return "=== FILE: " + file.getName() + " ===\n" + lines.join("\n");
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
    try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) { /* ignore */ }
  }
}

// Reads all non-empty sheets from a Spreadsheet object.
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

// Converts a 2D array to a tab-separated plain-text table.
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
