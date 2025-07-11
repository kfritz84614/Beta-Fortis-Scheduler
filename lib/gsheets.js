/* lib/gsheets.js - DEBUG VERSION with detailed logging */

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

function formatTime(timeStr) {
  if (!timeStr || timeStr === 'None') return '';
  if (timeStr.includes(':')) return timeStr;
  if (timeStr.length === 4) {
    return `${timeStr.slice(0, 2)}:${timeStr.slice(2)}`;
  }
  if (timeStr.length === 3) {
    return `0${timeStr.slice(0, 1)}:${timeStr.slice(1)}`;
  }
  return timeStr;
}

export async function listWorkers() {
  try {
    console.log('🔍 Reading workers from Google Sheets...');
    
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Workers!A1:M",  // Include header row for debugging
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    console.log(`📊 Total rows: ${data.values?.length || 0}`);
    
    if (!data.values || data.values.length === 0) {
      console.warn('⚠️ No data found');
      return [];
    }

    // Log the header row
    const headers = data.values[0] || [];
    console.log('📋 Headers:', headers);
    
    // Log a sample data row
    if (data.values.length > 1) {
      console.log('📝 Sample data row:', data.values[1]);
    }

    // Process data rows (skip header)
    const workers = data.values.slice(1).map((r, index) => {
      console.log(`\n🔍 Processing row ${index}:`, r);
      
      try {
        const worker = {
          Name                 : r[0] ?? `EmptyName_${index}`,
          Email                : r[1] ?? "",
          WorkStartTime        : formatTime(r[2] ?? ""),
          WorkEndTime          : formatTime(r[3] ?? ""),
          LunchStartTime       : formatTime(r[4] ?? ""),
          LunchEndTime         : formatTime(r[5] ?? ""),
          TotalHoursWeek       : r[6] ?? "",
          "Primary Ability"    : r[7] ?? "",
          "Secondary Ability"  : r[8] ?? "",
          "Tertiary Ability"   : r[9] ?? "",
          TargetNumber         : r[10] ?? "",
          BackFillOrder        : r[11] ?? "",
          PTO                  : parsePTO(r[12]),
          
          // Computed fields for backward compatibility
          "Working Hours": (r[2] && r[3]) ? `${r[2].toString().replace(':', '')}-${r[3].toString().replace(':', '')}` : "",
          "Lunch Time": (r[4] && r[5]) ? `${r[4].toString().replace(':', '')}-${r[5].toString().replace(':', '')}` : "None",
          "Target Number of Time not on Dispatch or Reservations": r[10] ?? ""
        };

        console.log(`✅ Successfully processed: ${worker.Name}`);
        console.log(`   Work: ${worker.WorkStartTime}-${worker.WorkEndTime}`);
        console.log(`   Primary: ${worker["Primary Ability"]}`);
        
        return worker;
      } catch (error) {
        console.error(`❌ ERROR processing row ${index}:`, error);
        console.error(`   Raw row data:`, r);
        
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

    console.log(`\n✅ Final result: ${workers.length} workers processed`);
    console.log('👥 Worker names:', workers.map(w => w.Name));
    
    return workers;

  } catch (error) {
    console.error('❌ CRITICAL ERROR in listWorkers:', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

export async function upsertWorker(worker) {
  try {
    console.log('💾 Saving worker:', worker.Name);
    
    const rows = await listWorkers();
    const idx = rows.findIndex(w => w.Name === worker.Name);

    let workStart = worker.WorkStartTime || "";
    let workEnd = worker.WorkEndTime || "";
    let lunchStart = worker.LunchStartTime || "";
    let lunchEnd = worker.LunchEndTime || "";

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
      worker.Name,
      worker.Email ?? "",
      workStart,
      workEnd,
      lunchStart,
      lunchEnd,
      worker.TotalHoursWeek ?? "",
      worker["Primary Ability"] ?? "",
      worker["Secondary Ability"] ?? "",
      worker["Tertiary Ability"] ?? "",
      worker.TargetNumber ?? worker["Target Number of Time not on Dispatch or Reservations"] ?? "",
      worker.BackFillOrder ?? "",
      serializePTO(worker.PTO)
    ];

    console.log('💾 Row to save:', row);

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
    console.error('❌ Error saving worker:', error);
    throw new Error(`Failed to save worker: ${worker.Name} - ${error.message}`);
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
