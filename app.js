// app.js — Fortis Scheduler backend ✨ CLEAN ARCHITECTURE
// -----------------------------------------------------------------------------
// • 100% Google Sheets integration - zero local file dependencies
// • Clean, focused code with no legacy remnants
// • Proper error handling and logging throughout
// • Ready for production deployment
// -----------------------------------------------------------------------------

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import path from "path";

/* Google Sheets integration ------------------------------------------------ */
import {
  listWorkers,
  upsertWorker,
  deleteWorker,
  listShifts,
  writeShifts,
  addChatMessage,
  getChatHistory
} from "./lib/gsheets.js";

/* Express setup ------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, "public")));

/* Utilities ----------------------------------------------------------------- */
const uniqueAbilities = async () => {
  try {
    const workers = await listWorkers();
    const abilities = new Set();
    
    workers.forEach(worker => {
      ["Primary Ability", "Secondary Ability", "Tertiary Ability"].forEach(field => {
        if (worker[field] && worker[field].trim()) {
          abilities.add(worker[field].trim());
        }
      });
    });
    
    abilities.add("Lunch");
    return Array.from(abilities).sort();
  } catch (error) {
    console.error("❌ Error building abilities list:", error);
    return ["Lunch"]; // Fallback to basic ability
  }
};

const toMinutes = (timeString) => {
  if (!timeString) return 0;
  const cleaned = timeString.replace(/[^0-9]/g, "").padStart(4, "0");
  return parseInt(cleaned.slice(0, 2)) * 60 + parseInt(cleaned.slice(2));
};

const normalizeDate = (dateInput) => {
  if (!dateInput) return new Date().toISOString().slice(0, 10);
  
  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dateInput;
  }
  
  // Handle relative dates
  const today = new Date();
  if (/tomorrow/i.test(dateInput)) {
    today.setDate(today.getDate() + 1);
  } else if (/yesterday/i.test(dateInput)) {
    today.setDate(today.getDate() - 1);
  }
  
  return today.toISOString().slice(0, 10);
};

/* API Endpoints ------------------------------------------------------------- */

/* Workers Management */
app.get("/api/workers", async (req, res) => {
  try {
    const workers = await listWorkers();
    console.log(`✅ Retrieved ${workers.length} workers from Google Sheets`);
    res.json(workers);
  } catch (error) {
    console.error("❌ Failed to fetch workers:", error);
    res.status(500).json({ 
      error: "Unable to fetch workers from Google Sheets",
      details: error.message 
    });
  }
});

app.get("/api/abilities", async (req, res) => {
  try {
    const abilities = await uniqueAbilities();
    res.json(abilities);
  } catch (error) {
    console.error("❌ Failed to fetch abilities:", error);
    res.status(500).json({ 
      error: "Unable to generate abilities list",
      details: error.message 
    });
  }
});

app.post("/api/workers/add", async (req, res) => {
  try {
    const workerData = {
      ...req.body,
      PTO: req.body.PTO || [] // Ensure PTO field exists
    };
    
    await upsertWorker(workerData);
    console.log(`✅ Added worker: ${workerData.Name}`);
    res.json({ success: true, message: "Worker added successfully" });
  } catch (error) {
    console.error("❌ Failed to add worker:", error);
    res.status(500).json({ 
      error: "Unable to add worker",
      details: error.message 
    });
  }
});

app.post("/api/workers/update", async (req, res) => {
  try {
    const workerData = {
      ...req.body,
      PTO: req.body.PTO || [] // Ensure PTO field exists
    };
    
    await upsertWorker(workerData);
    console.log(`✅ Updated worker: ${workerData.Name}`);
    res.json({ success: true, message: "Worker updated successfully" });
  } catch (error) {
    console.error("❌ Failed to update worker:", error);
    res.status(500).json({ 
      error: "Unable to update worker",
      details: error.message 
    });
  }
});

app.delete("/api/workers/:name", async (req, res) => {
  try {
    const workerName = decodeURIComponent(req.params.name);
    await deleteWorker(workerName);
    console.log(`✅ Deleted worker: ${workerName}`);
    res.json({ success: true, message: "Worker deleted successfully" });
  } catch (error) {
    console.error("❌ Failed to delete worker:", error);
    res.status(500).json({ 
      error: "Unable to delete worker",
      details: error.message 
    });
  }
});

/* PTO Management */
app.post("/api/workers/pto", async (req, res) => {
  try {
    const { name, date, action, pto } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Worker name is required" });
    }

    const workers = await listWorkers();
    const worker = workers.find(w => w.Name === name);
    
    if (!worker) {
      return res.status(404).json({ error: `Worker '${name}' not found` });
    }

    // Initialize PTO array if it doesn't exist
    worker.PTO = worker.PTO || [];

    if (Array.isArray(pto)) {
      // Bulk update mode (from admin panel)
      worker.PTO = pto.filter(d => d && typeof d === 'string');
    } else if (date) {
      // Single date mode (legacy support)
      const normalizedDate = normalizeDate(date);
      
      if (action === "add" && !worker.PTO.includes(normalizedDate)) {
        worker.PTO.push(normalizedDate);
      } else if (action === "remove") {
        worker.PTO = worker.PTO.filter(d => d !== normalizedDate);
      }
    }

    await upsertWorker(worker);
    console.log(`✅ Updated PTO for ${name}: ${worker.PTO.length} days`);
    
    res.json({ 
      success: true, 
      PTO: worker.PTO,
      message: `PTO updated for ${name}` 
    });
  } catch (error) {
    console.error("❌ Failed to update PTO:", error);
    res.status(500).json({ 
      error: "Unable to update PTO",
      details: error.message 
    });
  }
});

/* Shifts Management */
app.get("/api/shifts", async (req, res) => {
  try {
    const shifts = await listShifts();
    console.log(`✅ Retrieved ${shifts.length} shifts from Google Sheets`);
    res.json(shifts);
  } catch (error) {
    console.error("❌ Failed to fetch shifts:", error);
    res.status(500).json({ 
      error: "Unable to fetch shifts from Google Sheets",
      details: error.message 
    });
  }
});

app.post("/api/shifts/bulk", async (req, res) => {
  try {
    const { shifts = [] } = req.body;
    
    if (!Array.isArray(shifts)) {
      return res.status(400).json({ error: "Shifts must be an array" });
    }

    await writeShifts(shifts);
    console.log(`✅ Saved ${shifts.length} shifts to Google Sheets`);
    
    res.json({ 
      success: true, 
      count: shifts.length,
      message: "Shifts saved successfully" 
    });
  } catch (error) {
    console.error("❌ Failed to save shifts:", error);
    res.status(500).json({ 
      error: "Unable to save shifts",
      details: error.message 
    });
  }
});

/* OpenAI Chat Integration --------------------------------------------------- */
let openaiClient;
const getOpenAI = () => {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
};

const SYSTEM_PROMPT = `
You are Fortis SchedulerBot, an AI assistant for managing work schedules.

RULES:
• For scheduling requests (add shift, move shift, add PTO), respond with exactly ONE function call and no additional text
• For general questions or chat, respond normally without function calls
• Always use ISO date format (YYYY-MM-DD) for dates
• Times should be in 24-hour format (e.g., "0800", "1630")

AVAILABLE FUNCTIONS:
• add_shift: Create a new work shift
• add_pto: Add time off for a worker  
• move_shift: Change the time of an existing shift
`.trim();

const FUNCTION_TOOLS = [
  {
    type: "function",
    function: {
      name: "add_shift",
      description: "Add a new work shift for a worker",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Worker's name" },
          role: { type: "string", description: "Type of work (Dispatch, Reservations, etc.)" },
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          start: { type: "string", description: "Start time in 24h format (e.g., '0800')" },
          end: { type: "string", description: "End time in 24h format (e.g., '1700')" },
          notes: { type: "string", description: "Optional notes" }
        },
        required: ["name", "role", "date", "start", "end"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_pto",
      description: "Add paid time off (PTO) for a worker",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Worker's name" },
          date: { type: "string", description: "PTO date in YYYY-MM-DD format" }
        },
        required: ["name", "date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "move_shift",
      description: "Change the start/end time of an existing shift",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Worker's name" },
          date: { type: "string", description: "Shift date in YYYY-MM-DD format" },
          role: { type: "string", description: "Shift type to identify the specific shift" },
          start: { type: "string", description: "New start time in 24h format" },
          end: { type: "string", description: "New end time in 24h format" }
        },
        required: ["name", "date", "role", "start", "end"]
      }
    }
  }
];

app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message?.trim();
  
  if (!userMessage) {
    return res.status(400).json({ error: "Message cannot be empty" });
  }

  try {
    // Log user message
    await addChatMessage("user", userMessage);

    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ],
      tools: FUNCTION_TOOLS,
      tool_choice: "auto"
    });

    const assistantMessage = completion.choices[0].message;
    const toolCalls = assistantMessage.tool_calls || [];

    if (toolCalls.length > 0) {
      // Handle function calls - get fresh data from Google Sheets
      let [workers, shifts] = await Promise.all([
        listWorkers(),
        listShifts()
      ]);

      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        // Normalize date
        if (args.date) {
          args.date = normalizeDate(args.date);
        }

        switch (functionName) {
          case "add_shift":
            const newShift = {
              Date: args.date,
              Role: args.role,
              Start: toMinutes(args.start),
              End: toMinutes(args.end),
              Worker: args.name,
              Notes: args.notes || ""
            };
            
            shifts.push(newShift);
            await writeShifts(shifts);
            console.log(`✅ Added shift: ${args.name} - ${args.role} on ${args.date}`);
            break;

          case "add_pto":
            const worker = workers.find(w => w.Name === args.name);
            if (!worker) {
              return res.status(404).json({ error: `Worker '${args.name}' not found` });
            }
            
            worker.PTO = worker.PTO || [];
            if (!worker.PTO.includes(args.date)) {
              worker.PTO.push(args.date);
              await upsertWorker(worker);
              console.log(`✅ Added PTO: ${args.name} on ${args.date}`);
              
              // Update local workers array to include new PTO
              const workerIndex = workers.findIndex(w => w.Name === args.name);
              if (workerIndex !== -1) {
                workers[workerIndex] = worker;
              }
            }
            break;

          case "move_shift":
            const shiftIndex = shifts.findIndex(s => 
              s.Worker === args.name && 
              s.Date === args.date && 
              s.Role === args.role
            );
            
            if (shiftIndex === -1) {
              return res.status(404).json({ 
                error: `Shift not found for ${args.name} on ${args.date}` 
              });
            }
            
            shifts[shiftIndex].Start = toMinutes(args.start);
            shifts[shiftIndex].End = toMinutes(args.end);
            await writeShifts(shifts);
            console.log(`✅ Moved shift: ${args.name} - ${args.role} on ${args.date}`);
            break;

          default:
            console.warn(`⚠️ Unknown function: ${functionName}`);
        }
      }

      // Log bot response and return fresh data in Google Sheets format
      await addChatMessage("bot", "OK");
      
      return res.json({
        reply: "OK",
        shifts: await listShifts(),  // Fresh data from Google Sheets
        workers: workers
      });
    }

    // Regular chat response (no function calls)
    const botReply = assistantMessage.content || "I'm not sure how to respond to that.";
    await addChatMessage("bot", botReply);
    
    res.json({ reply: botReply });

  } catch (error) {
    console.error("❌ Chat error:", error);
    await addChatMessage("bot", "[error]");
    
    res.status(500).json({ 
      error: "Chat service temporarily unavailable",
      details: error.message 
    });
  }
});

/* Chat History */
app.get("/api/chat/history", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200); // Cap at 200
    const history = await getChatHistory(limit);
    res.json(history);
  } catch (error) {
    console.error("❌ Failed to fetch chat history:", error);
    res.status(500).json({ 
      error: "Unable to fetch chat history",
      details: error.message 
    });
  }
});

/* Health Check */
app.get("/api/health", async (req, res) => {
  try {
    // Test Google Sheets connectivity
    await listWorkers();
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      services: {
        googleSheets: "connected",
        openai: process.env.OPENAI_API_KEY ? "configured" : "missing"
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: "unhealthy", 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/* Development Server -------------------------------------------------------- */
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n🚀 Fortis Scheduler running on port ${PORT}`);
    console.log(`📊 Workers: http://localhost:${PORT}`);
    console.log(`📅 Schedule: http://localhost:${PORT}/schedule.html`);
    console.log(`⚙️  Admin: http://localhost:${PORT}/admin.html`);
    console.log(`❤️  Health: http://localhost:${PORT}/api/health\n`);
  });
}

/* Vercel Export ------------------------------------------------------------- */
export default app;
