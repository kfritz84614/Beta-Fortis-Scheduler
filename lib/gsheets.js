/* lib/gsheets.js - CORRECT VERSION for your new Google Sheets structure */
/* Matches your updated column layout exactly */

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

/**
 * Helper function to format time consistently
 * @param {string} timeStr - Time string in various formats
 * @returns {string} Time in HH:MM format
 */
function formatTime(timeStr) {
  if (!timeStr || timeStr === 'None') return '';
  
  // If it's already in HH:MM format, return as-is
  if (timeStr.includes(':')) return timeStr;
  
  // If it's in HHMM format, add colon
  if (timeStr.length === 4) {
    return `${timeStr.slice(0, 2)}:${timeStr.slice(2)}`;
  }
  
  // If it's in HMM format (e.g., 730), pad and add colon
  if (timeStr.length === 3) {
    return `0${timeStr.slice(0, 1)}:${timeStr.slice(1)}`;
  }
  
  return timeStr;
}

/* ------------------------------------------------------------------ */
/*   WORKERS TAB - Matches your NEW Google Sheets structure           */
/* ------------------------------------------------------------------ */

/** Read all workers from the "Workers" tab with your new column structure */
export async function listWorkers() {
  try {
    console.log('🔍 Reading workers from Google Sheets (new structure)...');
    
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Workers!A2:M",  // Your new structure A-M
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    console.log(`📊 Raw data rows: ${data.values?.length || 0}`);

    if (!data.values || data.values.length === 0) {
      console.warn('⚠️ No worker data found');
      return [];
    }

    return data.values.map((r, index) => {
      try {
        const worker = {
          /* Your NEW column structure (A-M) */
          /* A */ Name                 : r[0] ?? "",
          /* B */ Email                : r[1] ?? "",
          /* C */ WorkStartTime        : formatTime(r[2] ?? ""),
          /* D */ WorkEndTime          : formatTime(r[3] ?? ""),
          /* E */ LunchStartTime       : formatTime(r[4] ?? ""),
          /* F */ LunchEndTime         : formatTime(r[5] ?? ""),
          /* G */ TotalHoursWeek       : r[6] ?? "",
          /* H */ "Primary Ability"    : r[7] ?? "",
          /* I */ "Secondary Ability"  : r[8] ?? "",
          /* J */ "Tertiary Ability"   : r[9] ?? "",
          /* K */ TargetNumber         : r[10] ?? "",  // Specialist Hours Per Week
          /* L */ BackFillOrder        : r[11] ?? "",
          /* M */ PTO                  : parsePTO(r[12]),
          
          // Computed fields for backward compatibility
          "Working Hours": (r[2] && r[3]) ? `${r[2].replace(':', '')}-${r[3].replace(':', '')}` : "",
          "Lunch Time": (r[4] && r[5]) ? `${r[4].replace(':', '')}-${r[5].replace(':', '')}` : "None",
          
          // Additional compatibility fields
          "Target Number of Time not on Dispatch or Reservations": r[10] ?? ""
        };

        console.log(`👤 Loaded: ${worker.Name} (${worker.WorkStartTime}-${worker.WorkEndTime})`);
        return worker;
      } catch (error) {
        console.error(`❌ Error processing worker row ${index}:`, error);
        // Return a minimal worker object to prevent total failure
        return {
          Name: `Worker_${index}`,
          Email: '',
          WorkStartTime: '07:30',
          WorkEndTime: '17:00',
          LunchStartTime: '12:30',
          LunchEndTime: '14:00',
          "Working Hours": '0730-1700',
          "Lunch Time": '1230-1400',
          "Primary Ability": '',
          "Secondary Ability": '',
          "Tertiary Ability": '',
          TargetNumber: '0',
          "Target Number of Time not on Dispatch or Reservations": '0',
          BackFillOrder: '1',
          PTO: []
        };
      }
    });

  } catch (error) {
    console.error('❌ Error fetching workers from Google Sheets:', error);
    console.error('📋 Sheet ID:', SHEET_ID);
    throw new Error('Failed to fetch workers from Google Sheets: ' + error.message);
  }
}

/** Insert or update a worker row with your new column structure */
export async function upsertWorker(worker) {
  try {
    console.log('💾 Saving worker:', worker.Name);
    
    const rows = await listWorkers();
    const idx = rows.findIndex(w => w.Name === worker.Name);

    // Handle backward compatibility - extract times from old format if needed
    let workStart = worker.WorkStartTime || "";
    let workEnd = worker.WorkEndTime || "";
    let lunchStart = worker.LunchStartTime || "";
    let lunchEnd = worker.LunchEndTime || "";

    // If old format is provided, parse it
    if (worker["Working Hours"] && !workStart && !workEnd) {
      const [start, end] = worker["Working Hours"].split('-');
      workStart = formatTime(start);
      workEnd = formatTime(end);
    }

    if (worker["Lunch Time"] && worker["Lunch Time"] !== "None" && !lunchStart && !lunchEnd) {
      const [start, end] = worker["Lunch Time"].split('-');
      lunchStart = formatTime(start);
      lunchEnd = formatTime(end);
    }

    const row = [
      /* A */ worker.Name,
      /* B */ worker.Email ?? "",
      /* C */ workStart,                                    // Work Start Time
      /* D */ workEnd,                                      // Work End Time  
      /* E */ lunchStart,                                   // Lunch Start Time
      /* F */ lunchEnd,                                     // Lunch End Time
      /* G */ worker.TotalHoursWeek ?? "",
      /* H */ worker["Primary Ability"] ?? "",
      /* I */ worker["Secondary Ability"] ?? "",
      /* J */ worker["Tertiary Ability"] ?? "",
      /* K */ worker.TargetNumber ?? worker["Target Number of Time not on Dispatch or Reservations"] ?? "",
      /* L */ worker.BackFillOrder ?? "",
      /* M */ serializePTO(worker.PTO)
    ];

    if (idx === -1) {
      // append new worker
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "Workers!A:M",
        valueInputOption: "RAW",
        requestBody: { values: [row] },
      });
      console.log(`✅ Added new worker: ${worker.Name}`);
    } else {
      // update existing worker (row index +2 because header is row 1)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Workers!A${idx + 2}:M${idx + 2}`,
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
/*  CHAT HISTORY TAB (OPTIONAL - with improved error handling)       */
/* ================================================================== */

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
