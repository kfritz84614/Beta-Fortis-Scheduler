// app.js — Fortis Scheduler backend ✨ UPDATED FOR NEW COLUMN STRUCTURE
// -----------------------------------------------------------------------------
// • Enhanced OpenAI integration with complex scheduling rules
// • Full day/week schedule generation capabilities  
// • Coverage validation and optimization
// • Specialist time allocation logic
// • NEW: Support for separate time columns
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

// ── Time helpers (drop in near top, replace old versions) ────────────────────
const toMinutes = (timeValue) => {
  if (timeValue == null || timeValue === "") return 0;

  // If number: could be minutes already or a Google Sheets day fraction
  if (typeof timeValue === "number") {
    // Heuristic: decimals between 0 and 1 are day-fractions → convert to minutes
    if (timeValue >= 0 && timeValue <= 1) return Math.round(timeValue * 24 * 60);
    // Otherwise assume it’s already minutes
    return Math.round(timeValue);
  }

  const s = String(timeValue).trim();

  // HH:MM
  if (s.includes(":")) {
    const [h, m] = s.split(":").map(n => parseInt(n, 10) || 0);
    return h * 60 + m;
  }

  // HHMM (e.g. "0730")
  const cleaned = s.replace(/[^0-9]/g, "").padStart(4, "0");
  return parseInt(cleaned.slice(0, 2), 10) * 60 + parseInt(cleaned.slice(2), 10);
};

const toTimeString = (minutes) => {
  const mins = Math.max(0, Math.round(minutes||0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
};

/* ------------------------------------------------------------------
   Overlap detector for "Sheets-format" shifts (Worker/Date/Start/End)
   ------------------------------------------------------------------*/
const hasOverlap = (existing, candidate) => {
  const cStart = typeof candidate.Start === 'number' ? candidate.Start : toMinutes(candidate.Start);
  const cEnd   = typeof candidate.End   === 'number' ? candidate.End   : toMinutes(candidate.End);
  return existing.some(s => {
    if (s.Worker !== candidate.Worker) return false;
    if (s.Date   !== candidate.Date)   return false;
    const eStart = typeof s.Start === 'number' ? s.Start : toMinutes(s.Start);
    const eEnd   = typeof s.End   === 'number' ? s.End   : toMinutes(s.End);
    return Math.max(eStart, cStart) < Math.min(eEnd, cEnd);
  });
};

// Get date string for offset from today
const getDateString = (dayOffset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString().slice(0, 10);
};

// ── Hours readers with migration fallback ─────────────────────────────────────
const getWorkingHours = (worker) => {
  // New columns take precedence
  if (worker.WorkStartTime && worker.WorkEndTime) {
    return { start: toMinutes(worker.WorkStartTime), end: toMinutes(worker.WorkEndTime) };
  }
  // Legacy "0730-1700"
  if (worker["Working Hours"] && worker["Working Hours"].includes("-")) {
    const [s, e] = worker["Working Hours"].split("-");
    return { start: toMinutes(s), end: toMinutes(e) };
  }
  // Sensible default (07:30–17:00)
  return { start: 450, end: 1020 };
};

const getLunchHours = (worker) => {
  if (worker.LunchStartTime && worker.LunchEndTime) {
    return { start: toMinutes(worker.LunchStartTime), end: toMinutes(worker.LunchEndTime) };
  }
  if (worker["Lunch Time"] && worker["Lunch Time"] !== "None" && worker["Lunch Time"].includes("-")) {
    const [s, e] = worker["Lunch Time"].split("-");
    return { start: toMinutes(s), end: toMinutes(e) };
  }
  // null means “no explicit lunch provided; use defaults later”
  return null;
};

// Role priority for assignment
const ROLE_PRIORITY = {
  Dispatch: 1,
  Reservations: 2,
  Lunch: 9
};

// Validate coverage with 30-min slots and evening rules
const validateCoverage = (dayShifts, date) => {
  const violations = [];
  const slots = [];
  // Build 30-min slots from 08:00 to 17:00
  for (let t = 8*60; t < 17*60; t += 30) slots.push([t, t+30]);

  const active = (start, end, role) => dayShifts.filter(s => {
    const sStart = typeof s.Start === 'number' ? s.Start : toMinutes(s.Start);
    const sEnd   = typeof s.End   === 'number' ? s.End   : toMinutes(s.End);
    return sStart < end && sEnd > start && (role ? s.Role === role : s.Role !== 'Lunch');
  });

  for (const [s,e] of slots) {
    const resCount = active(s,e,'Reservations').length;
    const disCount = active(s,e,'Dispatch').length;
    if (resCount !== 3) violations.push(`${toTimeString(s)}-${toTimeString(e)}: Expected 3 Reservations, got ${resCount}`);
    if (disCount !== 1) violations.push(`${toTimeString(s)}-${toTimeString(e)}: Expected 1 Dispatch, got ${disCount}`);
  }

  // Evening guard (17:00–18:00 must be covered by at least one Reservations)
  const eveStart = 17*60; const eveEnd = 18*60;
  if (active(eveStart, eveEnd, 'Reservations').length < 1) {
    violations.push(`17:00-18:00: At least 1 Reservations required`);
  }

  return violations;
};

// Generate schedule for a specific date - UPDATED for new column structure
const generateDaySchedule = async (date, workers) => {
  const shifts = [];
  const dayOfWeek = new Date(date).getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  console.log(`🏗️ Building complete schedule for ${date} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeek]})`);
  
  // Skip weekends for now
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log(`⏭️ Skipping weekend day`);
    return shifts;
  }

  // Filter available workers with better logging
  const availableWorkers = workers.filter(worker => {
    console.log(`\n🔍 Checking ${worker.Name}:`);
    
    // Check PTO
    if (worker.PTO && worker.PTO.includes(date)) {
      console.log(`   ❌ On PTO`);
      return false;
    }
    
    // Check working hours
    const hours = getWorkingHours(worker);
    if (hours.end - hours.start < 8*60) {
      console.log(`   ❌ Insufficient working hours (${toTimeString(hours.start)}-${toTimeString(hours.end)})`);
      return false;
    }
    
    // Check abilities
    if (!worker.Abilities || (!worker.Abilities.includes('Reservations') && !worker.Abilities.includes('Dispatch'))) {
      console.log(`   ❌ Lacks required abilities`);
      return false;
    }
    
    console.log(`   ✅ Available (${toTimeString(hours.start)}-${toTimeString(hours.end)}), Abilities: ${worker.Abilities}`);
    return true;
  });

  // Assign core coverage: 3 Reservations + 1 Dispatch for each 30-min block between 8–5
  const slots = [];
  for (let t = 8*60; t < 17*60; t += 30) slots.push([t, t+30]);

  // Helper to find next free worker for role
  const pickWorker = (role, start, end) => {
    // Sort by priority (lower number = higher priority), then by least total minutes that day
    const totals = new Map();
    for (const w of availableWorkers) totals.set(w.Name, 0);

    for (const s of shifts) {
      if (!totals.has(s.Worker)) continue;
      const sStart = typeof s.Start === 'number' ? s.Start : toMinutes(s.Start);
      const sEnd   = typeof s.End   === 'number' ? s.End   : toMinutes(s.End);
      totals.set(s.Worker, totals.get(s.Worker) + Math.max(0, Math.min(end, sEnd) - Math.max(start, sStart)));
    }

    const candidates = availableWorkers
      .filter(w => (w.Abilities || '').includes(role))
      .filter(w => {
        const wh = getWorkingHours(w);
        return wh.start <= start && wh.end >= end;
      })
      .sort((a,b) => (ROLE_PRIORITY[role] - ROLE_PRIORITY[role]) || (totals.get(a.Name) - totals.get(b.Name)));

    // Pick first candidate not overlapping
    for (const w of candidates) {
      if (!hasOverlap(shifts, { Worker: w.Name, Date: date, Start: start, End: end })) {
        return w;
      }
    }
    return null;
  };

  for (const [s,e] of slots) {
    // Fill Reservations up to 3
    while (shifts.filter(x => x.Date === date && x.Role === 'Reservations' && x.Start <= s && x.End >= e).length < 3) {
      const w = pickWorker('Reservations', s, e);
      if (!w) break; // Can't fill more
      shifts.push({ Date: date, Role: 'Reservations', Start: s, End: e, Worker: w.Name, Notes: 'Auto' });
    }
    // Fill Dispatch up to 1
    if (shifts.filter(x => x.Date === date && x.Role === 'Dispatch' && x.Start <= s && x.End >= e).length < 1) {
      const w = pickWorker('Dispatch', s, e);
      if (w) shifts.push({ Date: date, Role: 'Dispatch', Start: s, End: e, Worker: w.Name, Notes: 'Auto' });
    }
  }

  // Add lunch for each worker (respect explicit times first)
  for (const worker of availableWorkers) {
    const lunchHours = getLunchHours(worker);
    if (lunchHours) {
      if (!hasOverlap(shifts, { Worker: worker.Name, Date: date, Start: lunchHours.start, End: lunchHours.end })) {
        shifts.push({
          Date: date,
          Role: 'Lunch',
          Start: lunchHours.start,
          End: lunchHours.end,
          Worker: worker.Name,
          Notes: 'Scheduled lunch break'
        });
      }
      console.log(`   🍽️ ${worker.Name}: Lunch ${toTimeString(lunchHours.start)}-${toTimeString(lunchHours.end)}`);
    } else {
      // Default lunch scheduling logic for workers without specified lunch times
      const defaultLunchWindows = [
        { start: 660, end: 750, name: "11:00-12:30" },
        { start: 720, end: 810, name: "12:00-13:30" },
        { start: 750, end: 840, name: "12:30-14:00" }
      ];
      
      const lunchWindow = defaultLunchWindows[Math.floor(Math.random() * defaultLunchWindows.length)];
      if (!hasOverlap(shifts, { Worker: worker.Name, Date: date, Start: lunchWindow.start, End: lunchWindow.end })) {
        shifts.push({
          Date: date,
          Role: 'Lunch',
          Start: lunchWindow.start,
          End: lunchWindow.end,
          Worker: worker.Name,
          Notes: 'Default lunch break'
        });
      }
    }
  }

  // Return the built shifts
  return shifts;
};

/* REST API ------------------------------------------------------------------ */

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.get("/schedule.html", (req, res) => res.sendFile(path.join(__dirname, "public/schedule.html")));
app.get("/admin.html", (req, res) => res.sendFile(path.join(__dirname, "public/admin.html")));

/* Workers */
app.get("/api/workers", async (req, res) => {
  try {
    const workers = await listWorkers();
    res.json(workers);
  } catch (error) {
    console.error("❌ Failed to fetch workers:", error);
    res.status(500).json({ error: "Unable to fetch workers" });
  }
});

app.post("/api/workers", async (req, res) => {
  try {
    await upsertWorker(req.body);
    console.log(`✅ Added worker: ${req.body.Name}`);
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

/* Shifts */
app.get("/api/shifts", async (req, res) => {
  try {
    const shifts = await listShifts();
    res.json(shifts);
  } catch (error) {
    console.error("❌ Failed to fetch shifts:", error);
    res.status(500).json({ error: "Unable to fetch shifts" });
  }
});

app.post("/api/shifts", async (req, res) => {
  try {
    const newShift = req.body;
    const shifts = await listShifts();

    if (hasOverlap(shifts, newShift)) {
      return res.status(400).json({ error: "Shift overlaps with an existing shift for this worker." });
    }

    shifts.push(newShift);
    await writeShifts(shifts);
    console.log(`✅ Added shift for ${newShift.Worker} on ${newShift.Date}`);
    res.json({ success: true, message: "Shift added successfully" });
  } catch (error) {
    console.error("❌ Failed to add shift:", error);
    res.status(500).json({ error: "Unable to add shift" });
  }
});

/* Chatbot Orchestration ----------------------------------------------------- */

// Tools schema for OpenAI function calling
const tools = [
  {
    type: "function",
    function: {
      name: "add_shift",
      description: "Add a shift for a worker",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "ISO date YYYY-MM-DD" },
          role: { type: "string", enum: ["Reservations","Dispatch","Lunch"] },
          name: { type: "string" },
          start: { type: ["string","number"], description: "Start time (HH:MM or minutes or day-fraction)" },
          end: { type: ["string","number"], description: "End time (HH:MM or minutes or day-fraction)" },
          notes: { type: "string" }
        },
        required: ["date","role","name","start","end"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "move_shift",
      description: "Move or edit an existing shift",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string" },
          role: { type: "string" },
          name: { type: "string" },
          start: { type: ["string","number"] },
          end: { type: ["string","number"] }
        },
        required: ["date","name","start","end"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_pto",
      description: "Mark a worker as PTO for a date",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          date: { type: "string" }
        },
        required: ["name","date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "build_day_schedule",
      description: "Auto-generate a full day schedule meeting coverage rules",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string" },
          replace_existing: { type: "boolean", default: true }
        },
        required: ["date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "build_week_schedule",
      description: "Auto-generate a full week schedule (Mon–Fri)",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "Monday of the week" },
          replace_existing: { type: "boolean", default: true }
        },
        required: ["start_date"]
      }
    }
  }
];

// Normalize input date strings like "today", "tomorrow", etc.
const normalizeDate = (input) => {
  const s = String(input || '').trim().toLowerCase();
  if (s === 'today') return getDateString(0);
  if (s === 'tomorrow') return getDateString(1);
  if (s === 'yesterday') return getDateString(-1);
  return s.match(/^\d{4}-\d{2}-\d{2}$/) ? s : getDateString(0);
};

/* Chat endpoint */
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = (req.body?.message || '').slice(0, 4000);
    const openaiKey = process.env.OPENAI_API_KEY;

    await addChatMessage("user", userMessage);

    if (!openaiKey) {
      // OpenAI is not configured
      const fallbackResponse = `I understand you want help with "${userMessage}". 
      
While I'd love to help with AI-powered scheduling, I need an OpenAI API key to be configured. 

For now, you can:
🔧 Manually create shifts using the day view (drag to create, double-click to edit)
📅 Use the week view to see the big picture
⚙️ Manage workers and PTO in the Admin section

Ask your administrator to add the OPENAI_API_KEY environment variable in Vercel to enable full AI assistance!`;

      await addChatMessage("bot", fallbackResponse);
      // Send current data so the UI can still repaint
      return res.json({ reply: fallbackResponse, shifts: await listShifts(), workers: await listWorkers() });
    }

    // Get fresh data from Google Sheets for context
    let [workers, shifts] = await Promise.all([
      listWorkers(),
      listShifts()
    ]);

    // Build context about current schedules for better AI understanding
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24*60*60*1000).toISOString().slice(0, 10);
    
    // Analyze current shifts by date
    const todayShifts = shifts.filter(s => s.Date === today);
    const tomorrowShifts = shifts.filter(s => s.Date === tomorrow);
    
    // Create shift summaries for context
    const createShiftSummary = (dayShifts, dateLabel) => {
      if (dayShifts.length === 0) return `${dateLabel}: No shifts scheduled`;
      
      const shiftsByWorker = {};
      dayShifts.forEach(shift => {
        if (!shiftsByWorker[shift.Worker]) {
          shiftsByWorker[shift.Worker] = [];
        }
        shiftsByWorker[shift.Worker].push({
          role: shift.Role,
          start: typeof shift.Start === 'number' ? toTimeString(shift.Start) : shift.Start,
          end: typeof shift.End === 'number' ? toTimeString(shift.End) : shift.End
        });
      });
      
      let summary = `${dateLabel} (total ${dayShifts.length}):\n`;
      Object.entries(shiftsByWorker).forEach(([worker, workerShifts]) => {
        const shiftDescs = workerShifts.map(s => `${s.role} ${s.start}-${s.end}`).join(', ');
        summary += `- ${worker}: ${shiftDescs}\n`;
      });
      
      return summary;
    };

    // Analyze coverage for context — use strict validator for consistency
    const analyzeCoverageForDate = (dateShifts, date) => {
      // Reuse the strict validator defined above so reporting matches enforcement
      return validateCoverage(dateShifts.map(s => ({
        ...s,
        Start: typeof s.Start === 'number' ? s.Start : toMinutes(s.Start),
        End:   typeof s.End   === 'number' ? s.End   : toMinutes(s.End),
      })), date);
    };

    const todayCoverage = analyzeCoverageForDate(todayShifts, today);
    const tomorrowCoverage = analyzeCoverageForDate(tomorrowShifts, tomorrow);

    const systemPrompt = `You are Fortis Scheduler, an expert workforce scheduler for a reservations/dispatch team. 

STRICT RULES YOU MUST ALWAYS ENFORCE:
• Monday–Friday only. Working day is 08:00–17:00 (ET)
• Every 30-min slot 08:00–17:00 must have: (a) 3 people on Reservations, (b) 1 on Dispatch
• Schedule explicit lunches (either from worker's lunch columns or a reasonable default window). Lunches don't count towards coverage
• Do not create overlapping shifts for a worker
• Respect PTO and stated working hours

EVENING GUARD (soft rule):
• Try to keep at least one Reservations covered 17:00–18:00 if people’s hours allow

AVAILABLE WORKERS (JSON):\n${JSON.stringify(workers).slice(0, 8000)}\n\n`;

    const client = new OpenAI({ apiKey: openaiKey });

    // Ask model what to do, with tool calling
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      tool_choice: "auto",
      tools,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
        { role: "system", content: `Context:\n${createShiftSummary(todayShifts, 'Today')}\n\n${createShiftSummary(tomorrowShifts, 'Tomorrow')}` }
      ]
    });

    const message = completion.choices[0].message;
    const toolCalls = message.tool_calls || [];

    // Execute tool calls
    let functionsExecuted = 0;
    let lastError = null;

    const affectedDates = new Set();
    for (const toolCall of toolCalls) {
      const functionName = toolCall.function.name;
      let args;
      
      try {
        args = JSON.parse(toolCall.function.arguments)
      } catch (parseError) {
        console.error(`❌ Failed to parse function arguments:`, parseError);
        continue;
      }

      // Normalize dates
      if (args.date) {
        args.date = normalizeDate(args.date);
      }
      if (args.start_date) {
        args.start_date = normalizeDate(args.start_date);
      }

      // Track affected dates for accurate post-run coverage reporting
      if (args.date) affectedDates.add(args.date);
      if (args.start_date) affectedDates.add(args.start_date);

      try {
        switch (functionName) {
          case "add_shift": {
            const start = toMinutes(args.start);
            const end   = toMinutes(args.end);

            const newShift = { Date: args.date, Role: args.role, Start: start, End: end, Worker: args.name, Notes: args.notes || '' };

            if (hasOverlap(shifts, newShift)) {
              throw new Error(`Overlap detected for ${args.name} on ${args.date}`);
            }

            shifts.push(newShift);
            await writeShifts(shifts);
            console.log(`✅ Added shift: ${args.name} - ${args.role} ${toTimeString(start)}-${toTimeString(end)} on ${args.date}`);
            functionsExecuted++;
            affectedDates.add(args.date);
            break;
          }

          case "add_pto": {
            const person = workers.find(w => w.Name === args.name);
            if (!person) throw new Error(`Worker ${args.name} not found`);
            person.PTO = Array.isArray(person.PTO) ? person.PTO : [];
            if (!person.PTO.includes(args.date)) person.PTO.push(args.date);
            await upsertWorker(person);
            // Remove that worker’s shifts that day
            shifts = shifts.filter(s => !(s.Worker === args.name && s.Date === args.date));
            await writeShifts(shifts);
            console.log(`✅ Added PTO for ${args.name} on ${args.date}`);
            functionsExecuted++;
            affectedDates.add(args.date);
            break;
          }

          case "move_shift": {
            // Try to find the shift by (name, date, role) primarily
            let shiftToMove = shifts.find(s => 
              s.Worker === args.name && 
              s.Date === args.date && 
              s.Role === args.role
            );
            
            // If exact match not found, try to find by worker and date only
            if (!shiftToMove) {
              const workerShifts = shifts.filter(s => 
                s.Worker === args.name && s.Date === args.date && s.Role !== 'Lunch'
              );
              
              if (workerShifts.length === 1) {
                shiftToMove = workerShifts[0];
              } else if (workerShifts.length > 1) {
                // Try to guess which shift they mean
                const startTime = toMinutes(args.start);
                shiftToMove = workerShifts.find(s => {
                  const shiftStart = typeof s.Start === 'number' ? s.Start : toMinutes(s.Start);
                  return Math.abs(shiftStart - startTime) < 120; // Within 2 hours
                }) || workerShifts[0]; // Default to first shift
              }
            }
            
            if (!shiftToMove) {
              throw new Error(`No suitable shift found for ${args.name} on ${args.date}`);
            }
            
            shiftToMove.Start = toMinutes(args.start);
            shiftToMove.End = toMinutes(args.end);
            if (args.role && args.role !== shiftToMove.Role) {
              shiftToMove.Role = args.role;
            }
            
            await writeShifts(shifts);
            console.log(`✅ Moved shift: ${args.name} - ${shiftToMove.Role} on ${args.date}`);
            functionsExecuted++;
            affectedDates.add(args.date);
            break;
          }

          case "build_day_schedule": {
            if (args.replace_existing) {
              shifts = shifts.filter(s => s.Date !== args.date);
            }
            
            const daySchedule = await generateDaySchedule(args.date, workers);
            shifts.push(...daySchedule);
            await writeShifts(shifts);
            
            const violations = validateCoverage(shifts, args.date);
            console.log(`✅ Generated day schedule for ${args.date}: ${daySchedule.length} shifts`);
            
            if (violations.length > 0) {
              console.warn(`⚠️ Coverage violations remain:`, violations.slice(0, 3));
            }

            functionsExecuted++;
            affectedDates.add(args.date);
            break;
          }

          case "build_week_schedule": {
            const monday = new Date(args.start_date);
            const weekDates = Array.from({ length: 5 }, (_, i) => {
              const d = new Date(monday);
              d.setDate(monday.getDate() + i);
              return d.toISOString().slice(0,10);
            });
              weekDates.forEach(d => affectedDates.add(d));

            if (args.replace_existing) {
              shifts = shifts.filter(s => !weekDates.includes(s.Date));
            }

            for (const d of weekDates) {
              const daySchedule = await generateDaySchedule(d, workers);
              shifts.push(...daySchedule);
            }
            
            await writeShifts(shifts);
            functionsExecuted++;
            break;
          }

          default:
            console.warn(`⚠️ Unknown function: ${functionName}`);
        }
      } catch (error) {
        console.error(`❌ Error executing ${functionName}:`, error);
        lastError = error;
      }
    }

    // Generate response based on execution results
    let responseMessage;
    if (functionsExecuted > 0) {
      // Refresh shifts to be safe
      shifts = await listShifts();

      // Analyze coverage for each affected date
      const issues = [];
      for (const d of affectedDates) {
        const dateShifts = shifts.filter(s => s.Date === d);
        const v = analyzeCoverageForDate(dateShifts, d);
        if (v.length > 0) {
          issues.push({ date: d, count: v.length, samples: v.slice(0, 3) });
        }
      }

      responseMessage = `✅ Executed ${functionsExecuted} scheduling action(s). `;
      if (issues.length === 0) {
        responseMessage += "All coverage requirements are met for affected dates. 🎯";
      } else {
        const first = issues[0];
        responseMessage += `${issues.reduce((a,b)=>a+b.count,0)} coverage issue(s) remain across ${issues.length} day(s). First problematic day ${first.date}: ${first.samples.join(" | ")}. Want me to auto-fix?`;
      }
    } else {
      responseMessage = lastError
        ? `❌ I encountered an issue: ${lastError.message}. Please provide more details or try a different approach.`
        : "I wasn't able to complete that action. Could you please rephrase your request?";
    }

    await addChatMessage("bot", responseMessage);
    
    // Return the updated shifts and workers for immediate UI repaint
    res.json({ reply: responseMessage, shifts, workers });
  } catch (error) {
    console.error("/api/chat error:", error);
    res.status(500).json({ 
      error: "Failed to process chat",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* Chat History */
app.get("/api/chat/history", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
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
    await listWorkers();
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      services: {
        googleSheets: "connected",
        openai: process.env.OPENAI_API_KEY ? "configured" : "missing"
      },
      links: {
        schedule: "/schedule.html",
        admin: "/admin.html"
      }
    });
  } catch (error) {
    res.status(500).json({ status: "degraded", error: error.message });
  }
});

/* Development Server -------------------------------------------------------- */
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n🚀 Fortis Advanced Scheduler running on port ${PORT}`);
    console.log(`📊 Workers: http://localhost:${PORT}`);
    console.log(`📅 Schedule: http://localhost:${PORT}/schedule.html`);
    console.log(`⚙️  Admin: http://localhost:${PORT}/admin.html`);
    console.log(`❤️  Health: http://localhost:${PORT}/api/health\n`);
  });
}

export default app;
