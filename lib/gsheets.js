/* lib/gsheets.js - FIXED VERSION for decimal time values */

import { google } from "googleapis";

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

function serializePTO(ptoArray) {
  if (!Array.isArray(ptoArray)) return '[]';
  return JSON.stringify(ptoArray.filter(date => typeof date === 'string'));
}

/**
 * Convert various time formats to HH:MM
 * Handles: decimal (0.3125), string with colon (7:30), string without colon (730)
 */
function formatTime(timeValue) {
  if (!timeValue && timeValue !== 0) return '';
  if (timeValue === 'None') return '';
  
  // Handle decimal time values (from Google Sheets)
  if (typeof timeValue === 'number' && timeValue >= 0 && timeValue <= 1) {
    // Convert decimal to total minutes (0.3125 * 24 * 60 = 450 minutes = 7:30)
    const totalMinutes = Math.round(timeValue * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  
  // Handle string formats
  const timeStr = timeValue.toString();
  
  // Already in HH:MM format
  if (timeStr.includes(':')) return timeStr;
  
  // Handle HHMM format (e.g., "0730")
  if (timeStr.length === 4) {
    return `${timeStr.slice(0, 2)}:${timeStr.slice(2)}`;
  }
  
  // Handle HMM format (e.g., "730")
  if (timeStr.length === 3) {
    return `0${timeStr.slice(0, 1)}:${timeStr.slice(1)}`;
  }
  
  return timeStr;
}

/**
 * Convert HH:MM time back to decimal for Google Sheets compatibility
 */
function timeToDecimal(timeStr) {
  if (!timeStr || timeStr === 'None') return '';
  
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours + minutes / 60) / 24;
}

export async function listWorkers() {
  try {
    console.log('🔍 Reading workers from Google Sheets...');
    
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Workers!A2:M",  // Skip header row
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
          /* Your column structure (A-M) */
          Name                 : r[0] ?? "",
          Email                : r[1] ?? "",
          WorkStartTime        : formatTime(r[2]),  // Convert decimal to HH:MM
          WorkEndTime          : formatTime(r[3]),  // Convert decimal to HH:MM
          LunchStartTime       : formatTime(r[4]),  // Convert decimal to HH:MM
          LunchEndTime         : formatTime(r[5]),  // Convert decimal to HH:MM
          TotalHoursWeek       : r[6] ?? "",
          "Primary Ability"    : r[7] ?? "",
          "Secondary Ability"  : r[8] ?? "",
          "Tertiary Ability"   : r[9] ?? "",
          TargetNumber         : r[10] ?? "",
          BackFillOrder        : r[11] ?? "",
          PTO                  : parsePTO(r[12]),
          
          // Computed fields for backward compatibility
          "Working Hours": (r[2] && r[3]) ? 
            `${formatTime(r[2]).replace(':', '')}-${formatTime(r[3]).replace(':', '')}` : "",
          "Lunch Time": (r[4] && r[5]) ? 
            `${formatTime(r[4]).replace(':', '')}-${formatTime(r[5]).replace(':', '')}` : "None",
          "Target Number of Time not on Dispatch or Reservations": r[10] ?? ""
        };

        console.log(`✅ Loaded: ${worker.Name} (${worker.WorkStartTime}-${worker.WorkEndTime})`);
        return worker;
      } catch (error) {
        console.error(`❌ Error processing worker row ${index}:`, error, r);
        // Return fallback worker
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
    throw new Error('Failed to fetch workers from Google Sheets: ' + error.message);
  }
}

export async function upsertWorker(worker) {
  try {
    console.log('💾 Saving worker:', worker.Name);
    
    const rows = await listWorkers();
    const idx = rows.findIndex(w => w.Name === worker.Name);

    // Handle time format conversion for saving
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

    // Convert times back to decimal format for Google Sheets
    const row = [
      worker.Name,
      worker.Email ?? "",
      workStart ? timeToDecimal(workStart) : "",      // Convert HH:MM to decimal
      workEnd ? timeToDecimal(workEnd) : "",          // Convert HH:MM to decimal
      lunchStart ? timeToDecimal(lunchStart) : "",    // Convert HH:MM to decimal
      lunchEnd ? timeToDecimal(lunchEnd) : "",        // Convert HH:MM to decimal
      worker.TotalHoursWeek ?? "",
      worker["Primary Ability"] ?? "",
      worker["Secondary Ability"] ?? "",
      worker["Tertiary Ability"] ?? "",
      worker.TargetNumber ?? worker["Target Number of Time not on Dispatch or Reservations"] ?? "",
      worker.BackFillOrder ?? "",
      serializePTO(worker.PTO)
    ];

    if (idx === -1) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "Workers!A:M",
        valueInputOption: "RAW",
        requestBody: { values: [row] },
      });
      console.log(`✅ Added new worker: ${worker.Name}`);
    } else {
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

export async function deleteWorker(name) {
  try {
    const rows = await listWorkers();
    const idx  = rows.findIndex(w => w.Name === name);
    if (idx === -1) {
      console.log(`Worker not found for deletion: ${name}`);
      return;
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: 0,
              dimension: "ROWS",
              startIndex: idx + 1,
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

// Rest of the functions remain the same...
const SHIFT_RANGE = "Shifts!A2:F";

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

export async function writeShifts(shifts) {
  try {
    const values = shifts.map(s => [
      s.Date, s.Role, s.Start, s.End, s.Worker, s.Notes ?? ""
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: SHIFT_RANGE,
    });

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
    console.warn('⚠️ Chat logging failed (this is optional):', error.message);
    if (error.message.includes('Unable to parse range: Chat')) {
      console.log('💡 Tip: Create a "Chat" tab in your Google Sheets to enable chat history logging');
    }
  }
}

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
      .slice(-limit);

    return messages;
  } catch (error) {
    console.warn('⚠️ Chat history fetch failed (this is optional):', error.message);
    if (error.message.includes('Unable to parse range: Chat')) {
      console.log('💡 Tip: Create a "Chat" tab in your Google Sheets to enable chat history');
    }
    return [];
  }
}
