// app.js — Fortis Scheduler backend ✨ ADVANCED SCHEDULING BOT
// -----------------------------------------------------------------------------
// • Enhanced OpenAI integration with complex scheduling rules
// • Full day/week schedule generation capabilities  
// • Coverage validation and optimization
// • Specialist time allocation logic
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

/* Scheduling Logic ---------------------------------------------------------- */

// Convert time string to minutes from midnight
const toMinutes = (timeString) => {
  if (!timeString) return 0;
  const cleaned = timeString.replace(/[^0-9]/g, "").padStart(4, "0");
  return parseInt(cleaned.slice(0, 2)) * 60 + parseInt(cleaned.slice(2));
};

// Convert minutes to time string
const toTimeString = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

// Get date string for offset from today
const getDateString = (dayOffset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString().slice(0, 10);
};

// Validate coverage requirements
const validateCoverage = (shifts, date) => {
  const dayShifts = shifts.filter(s => s.Date === date);
  const violations = [];
  
  // Check every 30-minute slot from 08:00 to 21:00
  for (let time = 480; time < 1260; time += 30) {
    const activeShifts = dayShifts.filter(s => 
      s.Start <= time && s.End > time && s.Role !== 'Lunch'
    );
    
    const reservations = activeShifts.filter(s => s.Role === 'Reservations').length;
    const dispatch = activeShifts.filter(s => s.Role === 'Dispatch').length;
    
    const timeStr = toTimeString(time);
    
    // Daytime coverage (08:00-17:00)
    if (time >= 480 && time < 1020) {
      if (reservations !== 3) {
        violations.push(`${timeStr}: Expected 3 Reservations, got ${reservations}`);
      }
      if (dispatch !== 1) {
        violations.push(`${timeStr}: Expected 1 Dispatch, got ${dispatch}`);
      }
    }
    // Evening coverage (17:00+)
    else if (time >= 1020) {
      if (reservations < 2) {
        violations.push(`${timeStr}: Expected 2+ Reservations, got ${reservations}`);
      }
      if (dispatch < 1) {
        violations.push(`${timeStr}: Expected 1+ Dispatch, got ${dispatch}`);
      }
    }
  }
  
  return violations;
};

// Generate schedule for a specific date
const generateDaySchedule = async (date, workers) => {
  const shifts = [];
  const dayOfWeek = new Date(date).getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Skip weekends for now
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return shifts;
  }
  
  // Define lunch windows (in minutes from midnight)
  const lunchWindows = [
    { start: 660, end: 750 },   // 11:00-12:30
    { start: 720, end: 810 },   // 12:00-13:30  
    { start: 750, end: 840 }    // 12:30-14:00
  ];
  
  // Helper function to get specialist role and target hours for a worker
  const getSpecialistInfo = (worker) => {
    // Special case: Antje only works Journey Desk
    if (worker.Name === 'Antje') {
      return {
        role: 'Journey Desk',
        weeklyHours: parseInt(worker.TargetNumber || worker["Target Number of Time not on Dispatch or Reservations"] || 30)
      };
    }
    
    // For others, find first ability that isn't Reservations or Dispatch
    const abilities = [
      worker["Primary Ability"],
      worker["Secondary Ability"], 
      worker["Tertiary Ability"]
    ].filter(ability => ability && ability !== "Reservations" && ability !== "Dispatch");
    
    const specialistRole = abilities[0] || null;
    const weeklyHours = parseInt(worker.TargetNumber || worker["Target Number of Time not on Dispatch or Reservations"] || 0);
    
    return {
      role: specialistRole,
      weeklyHours: weeklyHours
    };
  };
  
  // Filter workers who should work this day
  const workingToday = workers.filter(w => {
    if (w.PTO && w.PTO.includes(date)) return false;
    
    const workHours = w["Working Hours"] || "";
    const startTime = toMinutes(workHours.split('-')[0] || "0730");
    const endTime = toMinutes(workHours.split('-')[1] || "1700");
    
    return startTime < endTime; // Valid working hours
  });
  
  // Step 1: Schedule core coverage (Reservations + Dispatch)
  const reservationWorkers = workingToday.filter(w => 
    w.Name !== 'Antje' && // Antje only does Journey Desk
    ['Reservations', 'Dispatch'].includes(w["Primary Ability"])
  );
  
  // Schedule 3 Reservations workers for core hours (08:00-17:00)
  for (let i = 0; i < Math.min(3, reservationWorkers.length); i++) {
    const worker = reservationWorkers[i];
    const workHours = worker["Working Hours"] || "0730-1700";
    const [startStr, endStr] = workHours.split('-');
    
    shifts.push({
      Date: date,
      Role: 'Reservations',
      Start: Math.max(480, toMinutes(startStr)), // Start at 08:00 or worker start time
      End: Math.min(1020, toMinutes(endStr)),   // End at 17:00 or worker end time  
      Worker: worker.Name,
      Notes: 'Core coverage'
    });
  }
  
  // Schedule 1 Dispatch worker for extended hours
  const dispatchWorker = reservationWorkers.find(w => 
    w["Primary Ability"] === 'Dispatch' && 
    !shifts.some(s => s.Worker === w.Name)
  );
  
  if (dispatchWorker) {
    const workHours = dispatchWorker["Working Hours"] || "0730-1700";
    const [startStr, endStr] = workHours.split('-');
    
    shifts.push({
      Date: date,
      Role: 'Dispatch',
      Start: toMinutes(startStr),
      End: toMinutes(endStr),
      Worker: dispatchWorker.Name,
      Notes: 'Core dispatch coverage'
    });
  }
  
  // Step 2: Schedule lunches
  let lunchWindowIndex = 0;
  for (const worker of workingToday) {
    const workerShifts = shifts.filter(s => s.Worker === worker.Name);
    if (workerShifts.length === 0) continue;
    
    // Special case for Katy (Reno) - 15:00-16:00 lunch
    if (worker.Name === 'Katy') {
      shifts.push({
        Date: date,
        Role: 'Lunch',
        Start: 900, // 15:00
        End: 960,   // 16:00
        Worker: worker.Name,
        Notes: 'Reno lunch time'
      });
    } else {
      // Standard lunch windows for Greenville staff
      const lunchWindow = lunchWindows[lunchWindowIndex % lunchWindows.length];
      shifts.push({
        Date: date,
        Role: 'Lunch',
        Start: lunchWindow.start,
        End: lunchWindow.end,
        Worker: worker.Name,
        Notes: 'Standard lunch break'
      });
      lunchWindowIndex++;
    }
  }
  
  // Step 3: Fill specialist time using dynamic worker data
  for (const worker of workingToday) {
    const specialistInfo = getSpecialistInfo(worker);
    
    if (!specialistInfo.role || specialistInfo.weeklyHours <= 0) continue;
    
    const workHours = worker["Working Hours"] || "0730-1700";
    const [startStr, endStr] = workHours.split('-');
    const workStart = toMinutes(startStr);
    const workEnd = toMinutes(endStr);
    
    // Calculate daily specialist time (weekly hours / 5 days)
    const dailySpecialistHours = specialistInfo.weeklyHours / 5;
    const specialistMinutes = Math.round(dailySpecialistHours * 60);
    
    // Special handling for Antje - she works ONLY Journey Desk
    if (worker.Name === 'Antje') {
      shifts.push({
        Date: date,
        Role: 'Journey Desk',
        Start: workStart,
        End: workEnd,
        Worker: worker.Name,
        Notes: `Specialist role - ${specialistInfo.weeklyHours}h/week target`
      });
    } else if (specialistMinutes > 0) {
      // Schedule specialist time for others
      const specialistEnd = Math.min(workEnd, workStart + specialistMinutes);
      if (specialistEnd > workStart) {
        shifts.push({
          Date: date,
          Role: specialistInfo.role,
          Start: workStart,
          End: specialistEnd,
          Worker: worker.Name,
          Notes: `Specialist time - ${specialistInfo.weeklyHours}h/week target`
        });
      }
    }
  }
  
  return shifts;
};

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
  } else if (/monday/i.test(dateInput)) {
    const daysUntilMonday = (1 + 7 - today.getDay()) % 7;
    today.setDate(today.getDate() + (daysUntilMonday || 7));
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

const ADVANCED_SYSTEM_PROMPT = `
You are Fortis SchedulerBot, an expert workforce scheduling assistant with deep knowledge of coverage requirements, lunch scheduling, and specialist time allocation.

## CORE SCHEDULING RULES (NEVER VIOLATE):

### COVERAGE REQUIREMENTS:
- EXACTLY 3 Reservations + EXACTLY 1 Dispatch from 08:00-17:00 EVERY DAY
- EXACTLY 2+ Reservations + EXACTLY 1 Dispatch from 17:00+ (goal: 3+1)
- NEVER exceed: Don't put 4+ people on Reservations when only 3 are needed
- DISPATCH CONTINUITY: NEVER allow zero Dispatch coverage during operational hours

### LUNCH CONSTRAINTS:
- EVERYONE gets lunch - No exceptions
- Greenville lunch windows ONLY: 11:00-12:30, 12:00-13:30, 12:30-14:00 (1.5 hours each)
- Katy (Reno): 15:00-16:00 (1 hour) - This is the ONLY exception
- Maintain EXACTLY 3 Reservations + 1 Dispatch even during lunch periods

### EMPLOYEE RESTRICTIONS:
- Antje: ONLY works Journey Desk - NEVER Reservations or Dispatch
- All others: Can work Reservations, Dispatch, OR specialist functions

### SPECIALIST TIME ALLOCATION:
- Each worker has a "Target Number of Time not on Dispatch or Reservations" 
- Find their first ability that isn't "Reservations" or "Dispatch"
- Allocate their target hours per week to that specialist function
- Example: If Hudson has Primary=Dispatch, Secondary=Reservations, Tertiary=Journey Desk, and TargetNumber=5, then allocate 5 hours/week to Journey Desk

## FUNCTION USAGE:
- For single shifts: Use add_shift, move_shift, add_pto
- For full day/week schedules: Use build_day_schedule or build_week_schedule
- Always validate coverage requirements before responding
- Provide coverage analysis with your schedule recommendations

## RESPONSE FORMAT:
- For scheduling requests: Respond with appropriate function call(s)
- For coverage questions: Analyze and explain coverage gaps/compliance
- For general chat: Answer normally about scheduling topics
`.trim();

const ADVANCED_FUNCTION_TOOLS = [
  {
    type: "function",
    function: {
      name: "add_shift",
      description: "Add a single work shift",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Worker's name" },
          role: { type: "string", description: "Shift type (Reservations, Dispatch, etc.)" },
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
  },
  {
    type: "function", 
    function: {
      name: "build_day_schedule",
      description: "Generate a complete daily schedule following all coverage and specialist time rules",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date to schedule in YYYY-MM-DD format" },
          replace_existing: { type: "boolean", description: "Whether to replace existing shifts for this date" }
        },
        required: ["date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "build_week_schedule", 
      description: "Generate a complete weekly schedule (Monday-Friday) following all rules",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "Monday date to start the week in YYYY-MM-DD format" },
          replace_existing: { type: "boolean", description: "Whether to replace existing shifts for this week" }
        },
        required: ["start_date"]
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
        { role: "system", content: ADVANCED_SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ],
      tools: ADVANCED_FUNCTION_TOOLS,
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

        // Normalize dates
        if (args.date) {
          args.date = normalizeDate(args.date);
        }
        if (args.start_date) {
          args.start_date = normalizeDate(args.start_date);
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

          case "build_day_schedule":
            if (args.replace_existing) {
              // Remove existing shifts for this date
              shifts = shifts.filter(s => s.Date !== args.date);
            }
            
            const daySchedule = await generateDaySchedule(args.date, workers);
            shifts.push(...daySchedule);
            await writeShifts(shifts);
            
            const violations = validateCoverage(shifts, args.date);
            console.log(`✅ Generated day schedule for ${args.date}: ${daySchedule.length} shifts`);
            if (violations.length > 0) {
              console.warn(`⚠️ Coverage violations:`, violations);
            }
            break;

          case "build_week_schedule":
            const startDate = new Date(args.start_date);
            const weekDates = [];
            
            // Generate Monday-Friday dates
            for (let i = 0; i < 5; i++) {
              const date = new Date(startDate);
              date.setDate(startDate.getDate() + i);
              weekDates.push(date.toISOString().slice(0, 10));
            }
            
            if (args.replace_existing) {
              // Remove existing shifts for this week
              shifts = shifts.filter(s => !weekDates.includes(s.Date));
            }
            
            // Generate schedule for each day
            let totalNewShifts = 0;
            for (const date of weekDates) {
              const daySchedule = await generateDaySchedule(date, workers);
              shifts.push(...daySchedule);
              totalNewShifts += daySchedule.length;
            }
            
            await writeShifts(shifts);
            console.log(`✅ Generated week schedule: ${totalNewShifts} shifts across 5 days`);
            break;

          default:
            console.warn(`⚠️ Unknown function: ${functionName}`);
        }
      }

      // Log bot response and return fresh data
      await addChatMessage("bot", "Schedule updated successfully! Check the coverage and let me know if you need any adjustments.");
      
      return res.json({
        reply: "Schedule updated successfully! Check the coverage and let me know if you need any adjustments.",
        shifts: await listShifts(),
        workers: workers
      });
    }

    // Regular chat response (no function calls)
    const botReply = assistantMessage.content || "I'm here to help with scheduling. Try asking me to build a schedule or add specific shifts!";
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
    console.log(`\n🚀 Fortis Advanced Scheduler running on port ${PORT}`);
    console.log(`📊 Workers: http://localhost:${PORT}`);
    console.log(`📅 Schedule: http://localhost:${PORT}/schedule.html`);
    console.log(`⚙️  Admin: http://localhost:${PORT}/admin.html`);
    console.log(`❤️  Health: http://localhost:${PORT}/api/health\n`);
  });
}

export default app;
