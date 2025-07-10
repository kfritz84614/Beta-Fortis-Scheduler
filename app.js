// app.js — Fortis Scheduler backend  ✨ FINAL STABLE 2025‑07‑07
// -----------------------------------------------------------------------------
// • Thin Express API that serves static front‑end + JSON endpoints
// • Durable JSON persistence in /tmp (fine for demo; swap for DB later)
// • /api/chat now **always** returns a tool call (`tool_choice:"auto"`)
//   and *also* returns the fresh `shifts` & `workers` arrays so the
//   front‑end can repaint immediately without a second fetch.
// • Compatible with both `tool_calls` (array) and legacy `function_call`.
// -----------------------------------------------------------------------------

import express from "express";
import cors    from "cors";
import OpenAI  from "openai";
/* Google Sheets wrapper ------------------------------------------------ */
import {
  listWorkers,
  upsertWorker,
  deleteWorker as gsDeleteWorker,
} from "./lib/gsheets.js";
import path              from "path";
import { fileURLToPath } from "url";
import { randomUUID }    from "crypto";

/* -------------------------------------------------- paths / tmp setup */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PKG_DIR    = path.join(__dirname, "data");
const PKG_WORK   = path.join(PKG_DIR, "workers.json");
const PKG_SHIFT  = path.join(PKG_DIR, "shifts.json");

const TMP_DIR    = "/tmp/fortis-data";         // writable in Vercel/λ
const WORK_FILE  = path.join(TMP_DIR, "workers.json");
const SHIFT_FILE = path.join(TMP_DIR, "shifts.json");

mkdirSync(TMP_DIR, { recursive: true });
if (!existsSync(WORK_FILE )) copyFileSync(PKG_WORK , WORK_FILE );
if (!existsSync(SHIFT_FILE)) copyFileSync(PKG_SHIFT, SHIFT_FILE);

const loadJSON = f => JSON.parse(readFileSync(f, "utf8"));
const saveJSON = (f, obj) => writeFileSync(f, JSON.stringify(obj, null, 2));

let workers = loadJSON(WORK_FILE);
let shifts  = loadJSON(SHIFT_FILE);
const saveWorkers = () => saveJSON(WORK_FILE, workers);
const saveShifts  = () => saveJSON(SHIFT_FILE, shifts);

const uniqueAbilities = () => {
  const s = new Set();
  workers.forEach(w => ["Primary Ability","Secondary Ability","Tertiary Ability"].forEach(k => w[k] && s.add(w[k])));
  s.add("Lunch");
  return [...s].sort();
};

/* -------------------------------------------------- express */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- workers ---------------- */
app.get("/api/workers", async (_req, res) =>
  res.json({ workers: await listWorkers() })
);
app.get("/api/abilities", (_, res) => res.json(uniqueAbilities()));

app.post("/api/workers/add", async (req, res) => {
  await upsertWorker(req.body);              // inserts when not found
  res.json({ success: true });
});

app.post("/api/workers/update", async (req, res) => {
  await upsertWorker(req.body);              // updates when Name matches
  res.json({ success: true });
});

app.delete("/api/workers/:name", async (req, res) => {
  await gsDeleteWorker(req.params.name);
  res.json({ success: true });
});

/* -------------- PTO (bulk-array or legacy single-day) ---------- */
app.post("/api/workers/pto", async (req, res) => {
  const { name, date, action, pto } = req.body;

  const all = await listWorkers();
  const w   = all.find((x) => x.Name === name);
  if (!w) return res.status(404).json({ error: "worker" });

  /* ---- bulk array mode ------------------------------------------- */
  if (Array.isArray(pto)) {
    w.PTO = pto;

  /* ---- legacy single-day mode ------------------------------------ */
  } else {
    w.PTO = w.PTO || [];
    if (action === "add"    && !w.PTO.includes(date)) w.PTO.push(date);
    if (action === "remove") w.PTO = w.PTO.filter((d) => d !== date);
  }

  await upsertWorker(w);
  res.json({ success: true, PTO: w.PTO });
});

/* ---------------- shifts ---------------- */
app.get("/api/shifts", (_, res) => res.json(shifts));

app.post("/api/shifts", (req, res) => {
  const s = req.body;
  if (!s.id) {
    s.id = randomUUID(); shifts.push(s);
  } else {
    const i = shifts.findIndex(x => x.id === s.id);
    if (i === -1) shifts.push(s); else shifts[i] = s;
  }
  saveShifts(); res.json({ success: true, id: s.id });
});

app.delete("/api/shifts/:id", (req, res) => {
  const { id } = req.params;
  const before = shifts.length;
  shifts       = shifts.filter(x => x.id !== id);
  if (before === shifts.length) return res.status(404).json({ error: "Not found" });
  saveShifts(); res.json({ success: true });
});

/* -------------------------------------------------- OpenAI chat */
let _openai;
const ai = () =>
  _openai || (_openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

const SYS_PROMPT = `
You are Fortis SchedulerBot.

• If the user wants to add, move, or remove a shift—or add PTO—you MUST
  respond with exactly **one** function call (add_shift, add_pto, or
  move_shift) and no free-text.
• For any other chit-chat you may answer normally.
`.trim();

const TOOLS = [
  {
    type: "function",
    function: {
      name: "add_shift",
      description: "Add a work shift",
      parameters: {
        type: "object",
        properties: {
          name:  { type: "string" },
          role:  { type: "string" },
          date:  { type: "string" },
          start: { type: "string" },
          end:   { type: "string" },
          notes: { type: "string", nullable: true }
        },
        required: ["name", "role", "date", "start", "end"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_pto",
      description: "Add PTO",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          date: { type: "string" }
        },
        required: ["name", "date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "move_shift",
      description: "Move an existing shift on the same day",
      parameters: {
        type: "object",
        properties: {
          id:    { type: "string" },
          start: { type: "string" },
          end:   { type: "string" }
        },
        required: ["id", "start", "end"]
      }
    }
  }
];

const toMin = t => {
  const d = t.replace(/[^0-9]/g, "").padStart(4, "0");
  return +d.slice(0, 2) * 60 + +d.slice(2);
};

app.post("/api/chat", async (req, res) => {
  const user = req.body.message?.trim();
  if (!user) return res.status(400).json({ error: "empty" });

  try {
    const completion = await ai().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYS_PROMPT },
        { role: "user",   content: user }
      ],
      tools: TOOLS,
      tool_choice: "auto"               // ← model MUST pick a tool
    });

    const msg   = completion.choices[0].message;
    const calls = msg.tool_calls
      ? msg.tool_calls                       // new array form
      : msg.function_call
        ? [msg]                              // legacy single-call form
        : [];

    /* -------------------------------------------------- apply tool calls */
    if (calls.length) {
      for (const call of calls) {
        const fn   = call.function?.name || call.function_call?.name;
        const args = JSON.parse(
          call.function?.arguments || call.function_call?.arguments || "{}"
        );

        /* normalize date words → ISO YYYY-MM-DD */
        if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
          const d = new Date();
          if (/tomorrow/i.test(args.date)) d.setDate(d.getDate() + 1);
          args.date = d.toISOString().slice(0, 10);
        }
        if (fn === "add_shift") {
          shifts.push({
            id:    randomUUID(),
            name:  args.name,
            role:  args.role,
            date:  args.date,
            start: toMin(args.start),
            end:   toMin(args.end),
            notes: args.notes || ""
          });
          saveShifts();
        } else if (fn === "add_pto") {
          const w = workers.find(x => x.Name === args.name);
          if (!w) return res.status(404).json({ error: "worker" });
          w.PTO = w.PTO || [];
          if (!w.PTO.includes(args.date)) w.PTO.push(args.date);
          saveWorkers();
        } else if (fn === "move_shift") {
          const s = shifts.find(x => x.id === args.id);
          if (!s) return res.status(404).json({ error: "shift" });
          s.start = toMin(args.start);
          s.end   = toMin(args.end);
          saveShifts();
        } else {
          return res.status(400).json({ error: "unknown fn" });
        }
      }

      /* return the fresh arrays so the front-end can redraw instantly */
      return res.json({ reply: "OK", shifts, workers });
    }

    /* -------------------------------------------------- no tool call */
    res.json({ reply: msg.content || "[no reply]" });
  } catch (err) {
    console.error("/api/chat", err);
    res.status(500).json({ error: "openai" });
  }
});

/* -------------------------------------------------- export for Vercel */
export default app;
