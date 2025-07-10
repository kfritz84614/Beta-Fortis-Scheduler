// app.js — Fortis Scheduler backend ✨ GOOGLE SHEETS ONLY VERSION
// -----------------------------------------------------------------------------
// • Pure Google Sheets integration - no local JSON files
// • Chat logging to Google Sheets
// • Improved error handling and logging
// • Fixed all import and syntax errors
// -----------------------------------------------------------------------------

import express from "express";
import cors    from "cors";
import OpenAI  from "openai";
import { fileURLToPath } from "url";
import path from "path";
import { randomUUID } from "crypto";

/* Google Sheets wrapper ------------------------------------------------ */
import {
  listWorkers,
  upsertWorker,
  deleteWorker as gsDeleteWorker,
  listShifts,
  writeShifts,
  addChatMessage,
  getChatHistory
} from "./lib/gsheets.js";

/* -------------------------------------------------- paths setup */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* -------------------------------------------------- express */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* -------------------------------------------------- helpers */
const uniqueAbilities = async () => {
  const s = new Set();
  (await listWorkers()).forEach(w =>
    ["Primary Ability","Secondary Ability","Tertiary Ability"]
      .forEach(k => w[k] && s.add(w[k]))
  );
  s.add("Lunch");
  return [...s].sort();
};

/* ---------------- workers endpoints ---------------- */
app.get("/api/workers", async (_req, res) => {
  try {
    const workers = await listWorkers();
    console.log(`✅ Fetched ${workers.length} workers from Google Sheets`);
    res.json(workers);
  } catch (error) {
    console.error("❌ Error fetching workers:", error);
    res.status(500).json({ error: "Failed to fetch workers from Google Sheets" });
  }
});

app.get("/api/abilities", async (_req, res) => {
  try {
    const abilities = await uniqueAbilities();
    res.json(abilities);
  } catch (error) {
    console.error("❌ Error fetching abilities:", error);
    res.status(500).json({ error: "Failed to fetch abilities" });
  }
});

app.post("/api/workers/add", async (req, res) => {
  try {
    await upsertWorker(req.body);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error adding worker:", error);
    res.status(500).json({ error: "Failed to add worker to Google Sheets" });
  }
});

app.post("/api/workers/update", async (req, res) => {
  try {
    await upsertWorker(req.body);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error updating worker:", error);
    res.status(500).json({ error: "Failed to update worker in Google Sheets" });
  }
});

app.delete("/api/workers/:name", async (req, res) => {
  try {
    await gsDeleteWorker(req.params.name);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error deleting worker:", error);
    res.status(500).json({ error: "Failed to delete worker from Google Sheets" });
  }
});

/* -------------- PTO endpoint (Google Sheets) ---------- */
app.post("/api/workers/pto", async (req, res) => {
  try {
    const { name, date, action, pto } = req.body;

    const workers = await listWorkers();
    const worker = workers.find(w => w.Name === name);
    if (!worker) {
      return res.status(404).json({ error: "Worker not found" });
    }

    /* ---- bulk array mode (from admin panel) ---------------- */
    if (Array.isArray(pto)) {
      worker.PTO = pto;

    /* ---- legacy single-day mode ----------------------------- */
    } else {
      worker.PTO = worker.PTO || [];
      if (action === "add" && !worker.PTO.includes(date)) {
        worker.PTO.push(date);
      }
      if (action === "remove") {
        worker.PTO = worker.PTO.filter(d => d !== date);
      }
    }

    await upsertWorker(worker);
    console.log(`✅ Updated PTO for ${name}: ${worker.PTO.length} days`);
    res.json({ success: true, PTO: worker.PTO });
  } catch (error) {
    console.error("❌ Error updating PTO:", error);
    res.status(500).json({ error: "Failed to update PTO in Google Sheets" });
  }
});

/* ---------------- shifts endpoints (Google Sheets) ---------- */
app.get("/api/shifts", async (_req, res) => {
  try {
    const shifts = await listShifts();
    console.log(`✅ Fetched ${shifts.length} shifts from Google Sheets`);
    res.json(shifts);
  } catch (error) {
    console.error("❌ Error fetching shifts:", error);
    res.status(500).json({ error: "Failed to fetch shifts from Google Sheets" });
  }
});

app.post("/api/shifts/bulk", async (req, res) => {
  try {
    const shifts = req.body.shifts || [];
    await writeShifts(shifts);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error writing shifts:", error);
    res.status(500).json({ error: "Failed to write shifts to Google Sheets" });
  }
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
  const userMessage = req.body.message?.trim();
  if (!userMessage) {
    return res.status(400).json({ error: "Message cannot be empty" });
  }

  try {
    // 📝 Log user message to Google Sheets
    await addChatMessage("user", userMessage);

    const completion = await ai().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYS_PROMPT },
        { role: "user",   content: userMessage }
      ],
      tools: TOOLS,
      tool_choice: "auto"
    });

    const msg = completion.choices[0].message;
    const calls = msg.tool_calls
      ? msg.tool_calls
      : msg.function_call
        ? [msg]
        : [];

    /* -------------------------------------------------- apply tool calls */
    if (calls.length) {
      // Get fresh data from Google Sheets
      let [workers, shifts] = await Promise.all([
        listWorkers(),
        listShifts()
      ]);

      for (const call of calls) {
        const fn = call.function?.name || call.function_call?.name;
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
          const newShift = {
            Date: args.date,
            Role: args.role,
            Start: toMin(args.start),
            End: toMin(args.end),
            Worker: args.name,
            Notes: args.notes || ""
          };
          shifts.push(newShift);
          await writeShifts(shifts);
          console.log(`✅ Added shift: ${args.name} - ${args.role} on ${args.date}`);

        } else if (fn === "add_pto") {
          const worker = workers.find(w => w.Name === args.name);
          if (!worker) {
            return res.status(404).json({ error: "Worker not found" });
          }
          worker.PTO = worker.PTO || [];
          if (!worker.PTO.includes(args.date)) {
            worker.PTO.push(args.date);
          }
          await upsertWorker(worker);
          console.log(`✅ Added PTO: ${args.name} on ${args.date}`);

        } else if (fn === "move_shift") {
          const shift = shifts.find(s => 
            s.Worker === args.name && s.Date === args.date // Simplified lookup
          );
          if (!shift) {
            return res.status(404).json({ error: "Shift not found" });
          }
          shift.Start = toMin(args.start);
          shift.End = toMin(args.end);
          await writeShifts(shifts);
          console.log(`✅ Moved shift: ${shift.Worker} - ${shift.Role}`);

        } else {
          return res.status(400).json({ error: "Unknown function" });
        }
      }

      // 📝 Log bot response to Google Sheets
      await addChatMessage("bot", "OK");

      /* return fresh data so frontend can redraw instantly */
      return res.json({ 
        reply: "OK", 
        shifts: await listShifts(),
        workers: await listWorkers()
      });
    }

    /* -------------------------------------------------- no tool call */
    const botReply = msg.content || "[no reply]";
    
    // 📝 Log bot response to Google Sheets
    await addChatMessage("bot", botReply);
    
    res.json({ reply: botReply });
  } catch (error) {
    console.error("❌ /api/chat error:", error);
    
    // 📝 Log error to Google Sheets
    await addChatMessage("bot", "[error]");
    
    res.status(500).json({ error: "OpenAI API error" });
  }
});

/* -------------------------------------------------- chat history endpoint */
app.get("/api/chat/history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = await getChatHistory(limit);
    res.json(history);
  } catch (error) {
    console.error("❌ Error fetching chat history:", error);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

/* -------------------------------------------------- start server (for local dev) */
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅ Fortis Scheduler running on port ${PORT}`);
    console.log(`🔗 Workers: http://localhost:${PORT}`);
    console.log(`🔗 Schedule: http://localhost:${PORT}/schedule.html`);
    console.log(`🔗 Admin: http://localhost:${PORT}/admin.html`);
  });
}

/* -------------------------------------------------- export for Vercel */
export default app;
