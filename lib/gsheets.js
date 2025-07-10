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

/** 
 * Parse PTO data from sheet (JSON string) to array
 * @param {string} ptoString - JSON string from sheet
 * @returns {string[]} Array of ISO date strings
 */
function parsePTO(ptoString) {
  if (!ptoString || ptoString.trim() === '') return [];
  try {
    const parsed = JSON.parse(ptoString);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Invalid PTO JSON:', ptoString, error);
    return [];
  }
}

/**
 * Serialize PTO array to JSON string for sheet storage
 * @param {string[]} ptoArray - Array of ISO date strings
 * @returns {string} JSON string
 */
function serializePTO(ptoArray) {
  if (!Array.isArray(ptoArray)) return '[]';
  return JSON.stringify(ptoArray.filter(date => typeof date === 'string'));
}

/** Read all workers from the "Workers" tab (row 2 → N). */
export async function listWorkers() {
  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Workers!A2:K",  // ← EXPANDED: Now includes column K for PTO
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    return (data.values || []).map(r => ({
      /* A */ Name                : r[0] ?? "",
      /* B */ Email               : r[1] ?? "",
      /* C */ "Working Hours"     : r[2] ?? "",
      /* D */ TotalHoursWeek      : r[3] ?? "",
      /* E */ "Lunch Time"        : r[4] ?? "",
      /* F */ "Primary Ability"   : r[5] ?? "",
      /* G */ "Secondary Ability" : r[6] ?? "",
      /* H */ "Tertiary Ability"  : r[7] ?? "",
      /* I */ TargetNumber        : r[8] ?? "",
      /* J */ BackFillOrder       : r[9] ?? "",
      /* K */ PTO                 : parsePTO(r[10])  // ← NEW: Parse PTO from JSON
    }));
  } catch (error) {
    console.error('Error fetching workers from Google Sheets:', error);
    throw new Error('Failed to fetch workers from Google Sheets');
  }
}

/** Insert or update a worker row (matched by Name). */
export async function upsertWorker(worker) {
  try {
    const rows = await listWorkers();
    const idx  = rows.findIndex(w => w.Name === worker.Name);

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
      serializePTO(worker.PTO)  // ← NEW: Serialize PTO array to JSON string
    ];

    if (idx === -1) {
      // append new worker
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "Workers!A:K",  // ← UPDATED: Include column K
        valueInputOption: "RAW",
        requestBody: { values: [row] },
      });
      console.log(`✅ Added new worker: ${worker.Name}`);
    } else {
      // update existing worker (row index +2 because header is row 1)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Workers!A${idx + 2}:K${idx + 2}`,  // ← UPDATED: Include column K
        valueInputOption: "RAW",
        requestBody: { values: [row] },
      });
      console.log(`✅ Updated worker: ${worker.Name}`);
    }
  } catch (error) {
    console.error('Error upserting worker:', error);
    throw new Error(`Failed to save worker: ${worker.Name}`);
  }
}

/** Delete a worker row by Name. */
export async function deleteWorker(name) {
  try {
    const rows = await listWorkers();
    const idx  = rows.findIndex(w => w.Name === name);
    if (idx === -1) {
      console.log(`Worker not found for deletion: ${name}`);
      return;
    }

    /* gid of the first tab is always 0; adjust if "Workers" isn't first */
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: 0,
              dimension: "ROWS",
              startIndex: idx + 1,  // 0-based; +1 skips header
              endIndex: idx + 2,
            },
          },
        }],
      },
    });
    console.log(`✅ Deleted worker: ${name}`);
  } catch (error) {
    console.error('Error deleting worker:', error);
    throw new Error(`Failed to delete worker: ${name}`);
  }
}

/* ================================================================== */
/*  SHIFTS TAB                                                        */
/* ================================================================== */

const SHIFT_RANGE = "Shifts!A2:F";     // header is row 1, data from row 2

export async function listShifts() {
  try {
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
  } catch (error) {
    console.error('Error fetching shifts from Google Sheets:', error);
    throw new Error('Failed to fetch shifts from Google Sheets');
  }
}

/** Bulk-overwrite the Shifts tab with the provided array of objects. */
export async function writeShifts(shifts) {
  try {
    const values = shifts.map(s => [
      s.Date, s.Role, s.Start, s.End, s.Worker, s.Notes ?? ""
    ]);

    /* 1️⃣ clear existing rows --------------------------------------- */
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: SHIFT_RANGE,
    });

    /* 2️⃣ write new rows ------------------------------------------- */
    if (values.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: SHIFT_RANGE,
        valueInputOption: "RAW",
        requestBody: { values },
      });
    }
    
    console.log(`✅ Updated ${shifts.length} shifts in Google Sheets`);
  } catch (error) {
    console.error('Error writing shifts to Google Sheets:', error);
    throw new Error('Failed to write shifts to Google Sheets');
  }
}

/* ================================================================== */
/*  CHAT HISTORY TAB (BONUS - for future use)                        */
/* ================================================================== */

// Fix for gsheets.js - Replace the addChatMessage and getChatHistory functions

/**
 * Add a chat message to the Chat tab (optional - won't break if tab doesn't exist)
 * @param {string} sender - 'user' or 'bot'
 * @param {string} message - The message content
 */
export async function addChatMessage(sender, message) {
  try {
    const timestamp = new Date().toISOString();
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Chat!A:C",
      valueInputOption: "RAW",
      requestBody: {
        values: [[timestamp, sender, message]]
      },
    });
    
    console.log(`✅ Chat message logged: ${sender}`);
  } catch (error) {
    // Don't break the app if chat logging fails - just log the error
    console.warn('⚠️ Chat logging failed (this is optional):', error.message);
    // Optionally create the Chat tab if it doesn't exist
    if (error.message.includes('Unable to parse range: Chat')) {
      console.log('💡 Tip: Create a "Chat" tab in your Google Sheets to enable chat history logging');
    }
  }
}

/**
 * Get recent chat history (optional - returns empty array if tab doesn't exist)
 * @param {number} limit - Number of recent messages to fetch
 * @returns {Array} Array of {timestamp, sender, message} objects
 */
export async function getChatHistory(limit = 50) {
  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Chat!A2:C",
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const messages = (data.values || [])
      .map(r => ({
        timestamp: r[0] ?? "",
        sender: r[1] ?? "",
        message: r[2] ?? ""
      }))
      .slice(-limit);  // Get last N messages

    return messages;
  } catch (error) {
    console.warn('⚠️ Chat history fetch failed (this is optional):', error.message);
    if (error.message.includes('Unable to parse range: Chat')) {
      console.log('💡 Tip: Create a "Chat" tab in your Google Sheets to enable chat history');
    }
    return [];  // Return empty array on error
  }
}
