/**
 * SITE LOG — Google Apps Script sync backend
 * -------------------------------------------------
 * Receives records from the Site Log app and:
 *   1. Saves the photo into a Google Drive folder
 *   2. Appends a row to a Google Sheet log
 *
 * SETUP:
 * 1. Go to https://script.google.com -> New Project.
 * 2. Delete the default code, paste this whole file in.
 * 3. Edit SHEET_ID and FOLDER_ID below (see instructions in README.md
 *    for how to create/find these).
 * 4. Click Deploy > New deployment > type: Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 5. Copy the Web App URL it gives you (ends in /exec).
 * 6. Paste that URL into the app's Settings > "Google Apps Script Sync URL".
 */

const SHEET_ID = "PASTE_YOUR_GOOGLE_SHEET_ID_HERE";
const FOLDER_ID = "PASTE_YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE";
const SHEET_NAME = "SiteLog";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    let fileId = null;
    if (data.photoBase64) {
      const folder = DriveApp.getFolderById(FOLDER_ID);
      const bytes = Utilities.base64Decode(data.photoBase64);
      const blob = Utilities.newBlob(bytes, "image/jpeg", data.recordId + ".jpg");
      const file = folder.createFile(blob);
      fileId = file.getId();
    }

    const sheet = getOrCreateSheet();
    sheet.appendRow([
      data.recordId || "",
      new Date(data.timestamp || Date.now()),
      data.title || "",
      data.note || "",
      data.rawNote || "",
      data.category || "",
      data.station || "",
      data.lat || "",
      data.lng || "",
      fileId ? ("https://drive.google.com/file/d/" + fileId + "/view") : ""
    ]);

    return jsonResponse({ ok: true, fileId: fileId });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      "Record ID", "Timestamp", "Title", "Note (AI cleaned)", "Note (raw)",
      "Category", "Station", "Lat", "Lng", "Photo Link"
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Optional: quick manual test from the Apps Script editor (Run > testDoPost)
function testDoPost() {
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        recordId: "SL-2607-TEST",
        timestamp: Date.now(),
        title: "Test entry",
        note: "This is a test sync from the Apps Script editor.",
        rawNote: "test",
        category: "General",
        station: "Noida Sector 51",
        lat: 28.57, lng: 77.32,
        photoBase64: null
      })
    }
  };
  Logger.log(doPost(fakeEvent).getContent());
}
