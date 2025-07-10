/* lib/gsheets.js ------------------------------------------------------ */
/* Google Sheets wrapper – ONE place the rest of the app talks to Sheets */

import { google } from "googleapis";

/* ------------------------------------------------------------------ */
/*   auth & client setup                                              */
/* ------------------------------------------------------------------ */
const KEY      = JSON.parse(process.env.GSHEETS_SERVICE_ACCOUNT);
const SCOPES   = ["https://www.googleapis.com/auth/spreadsheets"];
const SHEET_ID = process.env.GSHEETS_ID;

if (!KEY || !SHEET_ID) {
  throw new Error(
    "✖️  Missing GSHEETS_SERVICE_ACCOUNT or GSHEETS_ID env vars. " +
    "Add them in Vercel › Project › Settings › Environment Variables."
  );
}

const auth   = new google.auth.GoogleAuth({ credentials: KEY, scopes: SCOPES });
const sheets = google.sheets({ version: "v4", auth });

/* ------------------------------------------------------------------ */
/*   helpers                                                          */
/* ------------------------------------------------------------------ */

/** Read all workers from the “Workers” tab (row 2 → N). */
export async function listWorkers () {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Workers!A2:J",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  return (data.values || []).map(r => ({
    /* A */ Name            : r[0] ?? "",
    /* B */ Email           : r[1] ?? "",
    /* C */ "Working Hours" : r[2] ?? "",
    /* D */ TotalHoursWeek  : r[3] ?? "",      // not used yet
    /* E */ "Lunch Time"    : r[4] ?? "",
    /* F */ "Primary Ability"   : r[5] ?? "",
    /* G */ "Secondary Ability" : r[6] ?? "",
    /* H */ "Tertiary Ability"  : r[7] ?? "",
    /* I */ TargetNumber    : r[8] ?? "",
    /* J */ BackFillOrder   : r[9] ?? "",

    /* PTO column isn’t present in the sheet yet */
    PTO: [],
  }));
}

/** Insert or update a worker row (matched by Name). */
export async function upsertWorker (worker) {
  const rows  = await listWorkers();
  const idx   = rows.findIndex(w => w.Name === worker.Name);

  const row = [
    worker.Name,
    worker.Email ?? "",
    worker["Working Hours"] ?? "",
    worker.TotalHoursWeek ?? "",
    worker["Lunch Time"] ?? "",
    worker["Primary Ability"] ?? "",
    worker["Secondary Ability"] ?? "",
    worker["Tertiary Ability"] ?? "",
    worker.TargetNumber ?? "",
    worker.BackFillOrder ?? "",
    // PTO column would go here when you add one
  ];

  if (idx === -1) {
    // append new
    await sheets.spreadsheets.values.append({
      spreadsheetId : SHEET_ID,
      range         : "Workers!A:J",
      valueInputOption: "RAW",
      requestBody   : { values: [row] },
    });
  } else {
    // update existing (row index +2 because header is row 1)
    await sheets.spreadsheets.values.update({
      spreadsheetId : SHEET_ID,
      range         : `Workers!A${idx + 2}:J${idx + 2}`,
      valueInputOption: "RAW",
      requestBody   : { values: [row] },
    });
  }
}

/** Delete a worker row by Name. */
export async function deleteWorker (name) {
  const rows = await listWorkers();
  const idx  = rows.findIndex(w => w.Name === name);
  if (idx === -1) return;                     // nothing to do

  /* gid of the first tab is always 0; adjust if “Workers” isn’t first */
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId : 0,
            dimension: "ROWS",
            startIndex: idx + 1,  // 0-based; +1 skips header
            endIndex  : idx + 2,
          },
        },
      }],
    },
  });
}
/* ================================================================== */
/*  SHIFTS TAB                                                        */
/* ================================================================== */

const SHIFT_RANGE = "Shifts!A2:F";     // header is row 1, data from row 2

export async function listShifts () {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHIFT_RANGE,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (data.values || []).map(r => ({
    Date   : r[0] ?? "",
    Role   : r[1] ?? "",
    Start  : r[2] ?? "",
    End    : r[3] ?? "",
    Worker : r[4] ?? "",
    Notes  : r[5] ?? "",
  }));
}

/** Bulk-overwrite the Shifts tab with the provided array of objects. */
export async function writeShifts (shifts) {
  const values = shifts.map(s => [
    s.Date, s.Role, s.Start, s.End, s.Worker, s.Notes ?? ""
  ]);

  /* 1️⃣ clear existing rows --------------------------------------- */
  await sheets.spreadsheets.values.clear({
    spreadsheetId : SHEET_ID,
    range         : SHIFT_RANGE,
  });

  /* 2️⃣ write new rows ------------------------------------------- */
  if (values.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId : SHEET_ID,
      range         : SHIFT_RANGE,
      valueInputOption : "RAW",
      requestBody   : { values },
    });
  }
}
