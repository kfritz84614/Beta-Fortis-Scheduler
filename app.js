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

/* Scheduling Logic ---------------------------------------------------------- */

// Convert time string to minutes from midnight
const toMinutes = (timeString) => {
  if (!timeString) return 0;
  
  // Handle HH:MM format
  if (timeString.includes(':')) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  }
  
  // Handle HHMM format (legacy)
  const cleaned = timeString.replace(/[^0-9]/g, "").padStart(4, "0");
  return parseInt(cleaned.slice(0, 2)) * 60 + parseInt(cleaned.slice(2));
};

// Convert minutes to time string
const toTimeString = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};
/* ------------------------------------------------------------------
   Simple overlap detector (same worker, same date)
   ------------------------------------------------------------------*/
const hasOverlap = (existing, candidate) => {
  return existing.some(s =>
    s.worker === candidate.worker &&
    s.date   === candidate.date   &&
    Math.max(s.start, candidate.start) < Math.min(s.end, candidate.end)
  );
};

// Get date string for offset from today
const getDateString = (dayOffset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString().slice(0, 10);
};

// Get working hours using new column structure with fallback
const getWorkingHours = (worker) => {
  console.log(`👤 ${worker.Name}:`);
  
  // Try new format first
  if (worker.WorkStartTime && worker.WorkEndTime) {
    const start = toMinutes(worker.WorkStartTime);
    const end = toMinutes(worker.WorkEndTime);
    console.log(`   New format: ${worker.WorkStartTime} - ${worker.WorkEndTime} (${start}-${end} minutes)`);
    return { start, end };
  }
  
  // Fallback to old format during migration
  if (worker["Working Hours"]) {
    const workHours = worker["Working Hours"];
    if (workHours.includes('-')) {
      const [startStr, endStr] = workHours.split('-');
      const start = toMinutes(startStr);
      const end = toMinutes(endStr);
      console.log(`   Old format: ${workHours} → ${toTimeString(start)} - ${toTimeString(end)} (${start}-${end} minutes)`);
      return { start, end };
    }
  }
  
  console.warn(`   ⚠️ No valid working hours found, using defaults`);
  return { start: 450, end: 1020 }; // Default 7:30-17:00
};

// Get lunch hours using new column structure with fallback
const getLunchHours = (worker) => {
  // Try new format first
  if (worker.LunchStartTime && worker.LunchEndTime) {
    const start = toMinutes(worker.LunchStartTime);
    const end = toMinutes(worker.LunchEndTime);
    console.log(`   Lunch: ${worker.LunchStartTime} - ${worker.LunchEndTime}`);
    return { start, end };
  }
  
  // Fallback to old format during migration
  if (worker["Lunch Time"] && worker["Lunch Time"] !== "None") {
    const lunchTime = worker["Lunch Time"];
    if (lunchTime.includes('-')) {
      const [startStr, endStr] = lunchTime.split('-');
      const start = toMinutes(startStr);
      const end = toMinutes(endStr);
      console.log(`   Lunch (old): ${lunchTime} → ${toTimeString(start)} - ${toTimeString(end)}`);
      return { start, end };
    }
  }
  
  // Return null for no lunch or invalid format
  return null;
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
    const { start, end } = getWorkingHours(worker);
    if (start >= end) {
      console.log(`   ❌ Invalid working hours (start >= end)`);
      return false;
    }
    
    console.log(`   ✅ Available`);
    return true;
  });

  console.log(`\n👥 Available workers: ${availableWorkers.length}/${workers.length}`);
  availableWorkers.forEach(w => console.log(`   - ${w.Name} (${w["Primary Ability"]})`));

  if (availableWorkers.length === 0) {
    console.log(`❌ No workers available for ${date}`);
    return shifts;
  }

  // Build core coverage (8am-5pm: 3 Reservations + 1 Dispatch)
  console.log(`\n🎯 Building core coverage (8am-5pm)...`);
  
  // Get Reservations workers
  const reservationsWorkers = availableWorkers.filter(w => 
    w.Name !== 'Antje' && 
    (w["Primary Ability"] === 'Reservations' || w["Secondary Ability"] === 'Reservations')
  );
  
  console.log(`📞 Reservations workers: ${reservationsWorkers.length}`);
  reservationsWorkers.forEach(w => console.log(`   - ${w.Name} (${w["Primary Ability"]})`));

  // Schedule 3 Reservations workers for core hours
  const selectedReservations = reservationsWorkers.slice(0, 3);
  selectedReservations.forEach((worker, index) => {
    const { start, end } = getWorkingHours(worker);
    
    // Core hours: 8am-5pm (480-1020 minutes)
    const shiftStart = Math.max(480, start);
    const shiftEnd = Math.min(1020, end);
    
    if (shiftEnd > shiftStart) {
      if (!hasOverlap(shifts, { Worker: worker.Name, Date: date, Start: shiftStart, End: shiftEnd })) {
        shifts.push({
          Date: date,
          Role: 'Reservations',
          Start: shiftStart,
          End: shiftEnd,
          Worker: worker.Name,
          Notes: `Core Reservations ${index + 1}/3`
        });
      }
      console.log(`   ✅ ${worker.Name}: Reservations ${toTimeString(shiftStart)}-${toTimeString(shiftEnd)}`);
    }
  });

  // Get Dispatch workers
  const dispatchWorkers = availableWorkers.filter(w => 
    w.Name !== 'Antje' && 
    (w["Primary Ability"] === 'Dispatch' || w["Secondary Ability"] === 'Dispatch')
  );
  
  console.log(`🚨 Dispatch workers: ${dispatchWorkers.length}`);
  dispatchWorkers.forEach(w => console.log(`   - ${w.Name} (${w["Primary Ability"]})`));

  // Schedule 1 Dispatch worker
  if (dispatchWorkers.length > 0) {
    const dispatchWorker = dispatchWorkers[0];
    const { start, end } = getWorkingHours(dispatchWorker);
    
    // Extended hours for dispatch
    const shiftStart = Math.max(480, start);
    const shiftEnd = Math.min(1260, end); // Up to 9pm
    
    if (shiftEnd > shiftStart) {
      if (!hasOverlap(shifts, { Worker: dispatchWorker.Name, Date: date, Start: shiftStart, End: shiftEnd })) {
        shifts.push({
          Date: date,
          Role: 'Dispatch',
          Start: shiftStart,
          End: shiftEnd,
          Worker: dispatchWorker.Name,
          Notes: 'Primary Dispatch coverage'
        });
      }
      console.log(`   ✅ ${dispatchWorker.Name}: Dispatch ${toTimeString(shiftStart)}-${toTimeString(shiftEnd)}`);
    }
  }

  // Fill evening coverage (5pm-9pm: 2+ Reservations + 1 Dispatch)
  console.log(`\n🌆 Building evening coverage (5pm-9pm)...`);
  
  const eveningWorkers = availableWorkers.filter(worker => {
    const { end } = getWorkingHours(worker);
    return end > 1020 && worker.Name !== 'Antje'; // Works past 5pm
  });

  console.log(`🌙 Evening workers: ${eveningWorkers.length}`);
  eveningWorkers.forEach(w => console.log(`   - ${w.Name}`));

  // Add evening Reservations coverage
  const additionalEvening = eveningWorkers
    .filter(w => !shifts.some(s => s.Worker === w.Name)) // Not already scheduled
    .slice(0, 2); // Add up to 2 more

  additionalEvening.forEach(worker => {
    const { start, end } = getWorkingHours(worker);
    const shiftStart = Math.max(1020, start); // Start at 5pm or later
    const shiftEnd = Math.min(1260, end); // Up to 9pm
    
    if (shiftEnd > shiftStart) {
      if (!hasOverlap(shifts, { Worker: worker.Name, Date: date, Start: shiftStart, End: shiftEnd })) {
        shifts.push({
          Date: date,
          Role: 'Reservations',
          Start: shiftStart,
          End: shiftEnd,
          Worker: worker.Name,
          Notes: 'Evening Reservations coverage'
        });
      }
      console.log(`   ✅ ${worker.Name}: Evening Reservations ${toTimeString(shiftStart)}-${toTimeString(shiftEnd)}`);
    }
  });

  // Schedule lunches using new format
  console.log(`\n🍽️ Scheduling lunches...`);
  
  // Get all workers who have shifts today
  const workingToday = [...new Set(shifts.map(s => s.Worker))];
  console.log(`🍽️ Workers needing lunch: ${workingToday.length}`);
  
  workingToday.forEach(workerName => {
    const worker = availableWorkers.find(w => w.Name === workerName);
    if (!worker) return;
    
    const lunchHours = getLunchHours(worker);
    
    if (lunchHours) {
      // Use specified lunch hours
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
      console.log(`   🍽️ ${worker.Name}: Default lunch ${lunchWindow.name}`);
    }
  });

  // Schedule specialist time
  console.log(`\n🎯 Scheduling specialist time...`);
  
  availableWorkers.forEach(worker => {
    // Special case: Antje only works Journey Desk
    if (worker.Name === 'Antje') {
      const { start, end } = getWorkingHours(worker);
      shifts.push({
        Date: date,
        Role: 'Journey Desk',
        Start: start,
        End: end,
        Worker: worker.Name,
        Notes: 'Journey Desk specialist'
      });
      console.log(`   🎯 ${worker.Name}: Journey Desk ${toTimeString(start)}-${toTimeString(end)}`);
      return;
    }

    // For others, check if they have specialist time
    const targetHours = parseInt(worker.TargetNumber || worker["Target Number of Time not on Dispatch or Reservations"] || 0);
    if (targetHours <= 0) return;

    // Find their specialist role
    const abilities = [
      worker["Primary Ability"],
      worker["Secondary Ability"], 
      worker["Tertiary Ability"]
    ].filter(ability => ability && ability !== "Reservations" && ability !== "Dispatch");
    
    const specialistRole = abilities[0];
    if (!specialistRole) return;

    // Calculate daily specialist time (weekly hours / 5 days)
    const dailyHours = targetHours / 5;
    const specialistMinutes = Math.round(dailyHours * 60);
    
    if (specialistMinutes >= 60) { // At least 1 hour
      const { start } = getWorkingHours(worker);
      const specialistEnd = start + specialistMinutes;
      
      shifts.push({
        Date: date,
        Role: specialistRole,
        Start: start,
        End: specialistEnd,
        Worker: worker.Name,
        Notes: `Specialist time (${targetHours}h/week)`
      });
      console.log(`   🎯 ${worker.Name}: ${specialistRole} ${toTimeString(start)}-${toTimeString(specialistEnd)}`);
    }
  });

  // Final summary
  console.log(`\n📊 Schedule Summary for ${date}:`);
  console.log(`   Total shifts: ${shifts.length}`);
  const shiftsByRole = {};
  shifts.forEach(s => {
    shiftsByRole[s.Role] = (shiftsByRole[s.Role] || 0) + 1;
  });
  Object.entries(shiftsByRole).forEach(([role, count]) => {
    console.log(`   ${role}: ${count}`);
  });

  // Validate coverage
  const violations = validateCoverage(shifts, date);
  if (violations.length > 0) {
    console.warn(`⚠️ Coverage violations:`, violations.slice(0, 5));
  } else {
    console.log(`✅ All coverage requirements met!`);
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

/* OpenAI Chat Integration - FIXED ERROR HANDLING --------------------------------------------------- */
let openaiClient;
const getOpenAI = () => {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      console.warn("⚠️ OPENAI_API_KEY not configured - chat will work in basic mode");
      return null;
    }
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
};

const ADVANCED_SYSTEM_PROMPT = `
You are Fortis SchedulerBot, an expert workforce scheduling assistant that AUTOMATICALLY FIXES problems instead of just reporting them.

## CORE PRINCIPLES:
🔧 **AUTO-FIX**: When you see coverage violations, IMMEDIATELY build/rebuild schedules to fix them
🎯 **COMPLETE COVERAGE**: Always ensure EXACTLY 3 Reservations + 1 Dispatch (8am-5pm) and 2+ Reservations + 1 Dispatch (5pm-9pm)
🧠 **CONTEXT AWARE**: Remember existing shifts and worker preferences when making changes
⚡ **PROACTIVE**: Don't just analyze - take action to solve scheduling problems

## COVERAGE REQUIREMENTS (NEVER VIOLATE):
### MANDATORY STAFFING:
- **8:00-17:00**: EXACTLY 3 Reservations + EXACTLY 1 Dispatch
- **17:00-21:00**: MINIMUM 2 Reservations + EXACTLY 1 Dispatch (prefer 3+1)
- **NO GAPS**: Ensure continuous coverage during operational hours
- **DISPATCH PRIORITY**: NEVER allow zero Dispatch coverage

### LUNCH RULES:
- **EVERYONE gets lunch** - No exceptions, ever
- **Greenville lunch windows**: 11:00-12:30, 12:00-13:30, 12:30-14:00 (1.5 hours each)
- **Katy (Reno) lunch**: 15:00-16:00 (1 hour) - This is THE ONLY exception
- **MAINTAIN COVERAGE**: Even during lunch, keep 3 Reservations + 1 Dispatch

### WORKER CONSTRAINTS:
- **Antje**: Journey Desk ONLY - NEVER Reservations or Dispatch
- **Kyle & Will Colones**: Security ONLY - NEVER Reservations or Dispatch
- **Everyone else**: Can work Reservations, Dispatch, OR specialist roles

### SPECIALIST TIME:
- Each worker has "Target Number of Time not on Dispatch or Reservations"
- Find their first non-Reservations/Dispatch ability for specialist work
- Allocate target hours per week to specialist functions
- **Example**: Hudson: Primary=Dispatch, Secondary=Reservations, Tertiary=Journey Desk, Target=5hrs
  → Allocate 5 hours/week to Journey Desk

## INTELLIGENT RESPONSES:

### WHEN USER SAYS: "Build schedule for [day]"
**YOU DO**: Call build_day_schedule immediately, then analyze results and auto-fix any violations

### WHEN USER SAYS: "There are coverage issues"  
**YOU DO**: Call build_day_schedule to rebuild and fix the issues automatically

### WHEN USER MENTIONS A SHIFT: "Move Sarah's morning shift to 9am"
**YOU DO**: 
1. Look at existing shifts for Sarah that day
2. Identify which shift they mean (morning = earliest shift)
3. Use move_shift with the correct parameters
4. Auto-fix any coverage gaps created

### WHEN USER SAYS: "Add [person] to [role]"
**YOU DO**: Add the shift AND verify coverage requirements are still met

## CONTEXT UNDERSTANDING:
- **"morning shift"** = earliest shift that day for that person
- **"afternoon shift"** = latest shift that day for that person  
- **"lunch shift"** = the Lunch role shift
- **"today"** = current date being viewed
- **"tomorrow"** = next day
- **"this week"** = Monday through Friday of current week

## RESPONSE PATTERNS:

✅ **GOOD**: "I'll build a complete schedule for today and ensure all coverage requirements are met."
[calls build_day_schedule, then reports success]

❌ **BAD**: "I see you have coverage violations. You need 3 Reservations but only have 1."
[reports problems without fixing them]

✅ **GOOD**: "I'll move Sarah's morning Reservations shift to start at 9am and adjust coverage as needed."
[calls move_shift, then checks/fixes coverage]

❌ **BAD**: "I need more details about which shift you want to move."
[asks for details when context is clear]

## FUNCTION USAGE PRIORITY:
1. **build_day_schedule** - For any "build", "create", "fix coverage" requests
2. **build_week_schedule** - For weekly requests  
3. **move_shift** - For time changes to existing shifts
4. **add_shift** - For adding single new shifts
5. **add_pto** - For time off requests

## ERROR HANDLING:
If a function call fails:
1. Try an alternative approach (e.g., if move_shift fails, try add_shift + delete)
2. Always aim to achieve the user's goal
3. Report what you accomplished, not what failed

Remember: You are a PROBLEM-SOLVING assistant, not just an analysis tool. When users mention issues, FIX them automatically!
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

    // Check if OpenAI is configured
    const openai = getOpenAI();
    if (!openai) {
      // Fallback response when OpenAI is not configured
      const fallbackResponse = `I understand you want help with "${userMessage}". 
      
While I'd love to help with AI-powered scheduling, I need an OpenAI API key to be configured. 

For now, you can:
🔧 Manually create shifts using the day view (drag to create, double-click to edit)
📅 Use the week view to see the big picture
⚙️ Manage workers and PTO in the Admin section

Ask your administrator to add the OPENAI_API_KEY environment variable in Vercel to enable full AI assistance!`;

      await addChatMessage("bot", fallbackResponse);
      return res.json({ reply: fallbackResponse });
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
      
      let summary = `${dateLabel}:\n`;
      Object.entries(shiftsByWorker).forEach(([worker, workerShifts]) => {
        const shiftDescs = workerShifts.map(s => `${s.role} ${s.start}-${s.end}`).join(', ');
        summary += `- ${worker}: ${shiftDescs}\n`;
      });
      
      return summary;
    };

    // Analyze coverage for context
    const analyzeCoverageForDate = (dateShifts, date) => {
      const violations = [];
      
      // Check core hours (8am-5pm)
      for (let hour = 8; hour < 17; hour++) {
        const timeStart = hour * 60;
        const timeEnd = timeStart + 60;
        
        const activeShifts = dateShifts.filter(s => {
          const start = typeof s.Start === 'number' ? s.Start : toMinutes(s.Start);
          const end = typeof s.End === 'number' ? s.End : toMinutes(s.End);
          return start < timeEnd && end > timeStart && s.Role !== 'Lunch';
        });
        
        const reservations = activeShifts.filter(s => s.Role === 'Reservations').length;
        const dispatch = activeShifts.filter(s => s.Role === 'Dispatch').length;
        
        if (reservations !== 3) {
          violations.push(`${hour}:00 - Expected 3 Reservations, got ${reservations}`);
        }
        if (dispatch !== 1) {
          violations.push(`${hour}:00 - Expected 1 Dispatch, got ${dispatch}`);
        }
      }
      
      return violations;
    };

    const todayCoverage = analyzeCoverageForDate(todayShifts, today);
    const tomorrowCoverage = analyzeCoverageForDate(tomorrowShifts, tomorrow);

    // Build rich context message
    const contextMessage = `
Current Scheduling Context:

${createShiftSummary(todayShifts, "Today")}
${todayCoverage.length > 0 ? `Coverage Issues Today: ${todayCoverage.slice(0, 3).join(', ')}` : 'Today: Coverage requirements met ✅'}

${createShiftSummary(tomorrowShifts, "Tomorrow")}
${tomorrowCoverage.length > 0 ? `Coverage Issues Tomorrow: ${tomorrowCoverage.slice(0, 3).join(', ')}` : 'Tomorrow: Coverage requirements met ✅'}

Available Workers: ${workers.map(w => w.Name).join(', ')}

User Request: ${userMessage}
    `.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: ADVANCED_SYSTEM_PROMPT },
        { role: "user", content: contextMessage }
      ],
      tools: ADVANCED_FUNCTION_TOOLS,
      tool_choice: "auto"
    });

    const assistantMessage = completion.choices[0].message;
    const toolCalls = assistantMessage.tool_calls || [];

    if (toolCalls.length > 0) {
      // Handle function calls with enhanced error handling
      let functionsExecuted = 0;
      let lastError = null;

      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name;
        let args;
        
        try {
          args = JSON.parse(toolCall.function.arguments);
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

        try {
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
              functionsExecuted++;
              break;

            case "add_pto":
              const worker = workers.find(w => w.Name === args.name);
              if (!worker) {
                throw new Error(`Worker '${args.name}' not found`);
              }
              
              worker.PTO = worker.PTO || [];
              if (!worker.PTO.includes(args.date)) {
                worker.PTO.push(args.date);
                await upsertWorker(worker);
                console.log(`✅ Added PTO: ${args.name} on ${args.date}`);
                functionsExecuted++;
              }
              break;

            case "move_shift":
              // Enhanced shift finding with fuzzy matching
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
              break;

            case "build_day_schedule":
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
                shifts = shifts.filter(s => !weekDates.includes(s.Date));
              }
              
              let totalNewShifts = 0;
              for (const date of weekDates) {
                const daySchedule = await generateDaySchedule(date, workers);
                shifts.push(...daySchedule);
                totalNewShifts += daySchedule.length;
              }
              
              await writeShifts(shifts);
              console.log(`✅ Generated week schedule: ${totalNewShifts} shifts across 5 days`);
              functionsExecuted++;
              break;

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
        // Refresh shift data
        shifts = await listShifts();
        
        // Analyze final coverage
        const finalCoverage = analyzeCoverageForDate(
          shifts.filter(s => s.Date === (args?.date || today)), 
          args?.date || today
        );
        
        responseMessage = `✅ Successfully executed ${functionsExecuted} scheduling action(s)! `;
        
        if (finalCoverage.length === 0) {
          responseMessage += "All coverage requirements are now met! 🎯";
        } else {
          responseMessage += `${finalCoverage.length} coverage issue(s) remain - would you like me to fix them automatically?`;
        }
      } else {
        responseMessage = lastError 
          ? `❌ I encountered an issue: ${lastError.message}. Please provide more details or try a different approach.`
          : "I wasn't able to complete that action. Could you please rephrase your request?";
      }

      await addChatMessage("bot", responseMessage);
      
      return res.json({
        reply: responseMessage,
        shifts: shifts,
        workers: workers
      });
    }

    // Regular chat response (no function calls)
    const botReply = assistantMessage.content || "I'm here to help with scheduling. Try asking me to build a schedule or fix coverage issues!";
    await addChatMessage("bot", botReply);
    
    res.json({ reply: botReply });

  } catch (error) {
    console.error("❌ Chat error:", error);
    await addChatMessage("bot", "[error]");
    
    // More specific error handling
    let errorMessage = "I'm having trouble right now. Please try again.";
    
    if (error.message.includes('insufficient_quota')) {
      errorMessage = "⚠️ OpenAI quota exceeded. Please check your API usage or try again later.";
    } else if (error.message.includes('invalid_api_key')) {
      errorMessage = "⚠️ OpenAI API key is invalid. Please check your configuration.";
    } else if (error.message.includes('rate_limit')) {
      errorMessage = "⚠️ Too many requests. Please wait a moment and try again.";
    }
    
    res.status(500).json({ 
      error: errorMessage,
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
