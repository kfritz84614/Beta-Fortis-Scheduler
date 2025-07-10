import { google } from "googleapis";

/* ------------------------------------------------------------------ */
/*  tiny wrapper – all other code calls these helpers                 */
/* ------------------------------------------------------------------ */
const SCOPES   = ["https://www.googleapis.com/auth/spreadsheets"];
const KEY      = JSON.parse(process.env.GSHEETS_SERVICE_ACCOUNT);
const SHEET_ID = process.env.GSHEETS_ID;

/* Auth object is cached across Vercel edge invocations -------------- */
const auth   = new google.auth.GoogleAuth({ credentials: KEY, scopes: SCOPES });
const sheets = google.sheets({ version: "v4", auth });

/* Helpers ----------------------------------------------------------- */
export async function listWorkers() {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Workers!A2:F",                    // skip header row
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (data.values || []).map((r) => ({
    Name: r[0],
    Email: r[1],
    WorkingHours: r[2],
    Abilities: (r[3] || "").split(",").map((x) => x.trim()).filter(Boolean),
    TargetHours: Number(r[4] || 0),
    PTO: (r[5] || "").split(",").filter(Boolean),
  }));
}

export async function upsertWorker(worker) {
  const rows  = await listWorkers();
  const idx   = rows.findIndex((w) => w.Name === worker.Name);
  const row   = [
    worker.Name,
    worker.Email || "",
    worker.WorkingHours || "",
    (worker.Abilities || []).join(","),
    worker.TargetHours ?? "",
    (worker.PTO || []).join(","),
  ];

  if (idx === -1) {
    // append
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Workers!A:F",
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } else {
    // update in-place
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Workers!A${idx + 2}:F${idx + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  }
}

export async function deleteWorker(name) {
  const rows  = await listWorkers();
  const idx   = rows.findIndex((w) => w.Name === name);
  if (idx === -1) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: 0,            // “Workers” is the first tab (gid 0)
              dimension: "ROWS",
              startIndex: idx + 1,   // zero-based; +1 skips header
              endIndex: idx + 2,
            },
          },
        },
      ],
    },
  });
}
