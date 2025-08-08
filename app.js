// app.js — Fortis Scheduler backend (Vercel)
// -----------------------------------------------------------------------------
// • Express API (ESM) that serves JSON endpoints for Workers, Shifts, PTO
// • Google Sheets is the source of truth (via ./gsheets.js)
// • Overlap detection FIXED (uses capitalized keys)
// • Lunch is carved out of conflicting shifts (no more overlaps)
// • Chat endpoint supports basic tool calls; returns fresh shifts/workers
// • Designed for Vercel serverless. Node >=18. OpenAI is optional.
// -----------------------------------------------------------------------------

import express from "express";
import cors from "cors";

// Optional OpenAI — endpoint works without a key (returns guidance only)
let OpenAI;
try { OpenAI = (await import("openai")).default; } catch (_) { /* noop */ }

// Sheets I/O — make sure your repo has ./gsheets.js (no "(1)" suffix)
// Required exports (see NOTES at bottom if your names differ):
//   listWorkers(), writeWorkers(workers)
//   listShifts(date?), writeShifts(shifts)
//   upsertPTO({ name, date, on }) OR writePTO(name, dates[]) (we handle both)
import * as gs from "./gsheets.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ─────────────────────────────── Utilities ───────────────────────────────
const TZ = "America/New_York";
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

const toMinutes = (val) => {
  // Accepts "HH:MM", number (minutes), or Google decimal day
  if (val == null || val === "") return null;
  if (typeof val === "number") {
    // If it's a small decimal (<=1) treat as Google decimal day
    return val <= 1 ? Math.round(val * 24 * 60) : Math.round(val);
    }
  if (typeof val === "string") {
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(val);
    if (!m) return null;
    const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
    return h * 60 + mm;
  }
  return null;
};

const toHHMM = (mins) => {
  if (mins == null || isNaN(mins)) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const minutesToDecimalDay = (m) => (m / 60) / 24; // for writing back to Sheets when needed

// ✅ FIXED: overlap detection uses capitalized keys (Worker/Date/Start/End)
const hasOverlap = (existing, candidate) => {
  return existing.some((s) =>
    s.Worker === candidate.Worker &&
    s.Date === candidate.Date &&
    Math.max(
      typeof s.Start === "number" ? s.Start : toMinutes(s.Start),
      typeof candidate.Start === "number" ? candidate.Start : toMinutes(candidate.Start)
    ) <
    Math.min(
      typeof s.End === "number" ? s.End : toMinutes(s.End),
      typeof candidate.End === "number" ? candidate.End : toMinutes(candidate.End)
    )
  );
};

function carveOutLunch(shifts, date, workerName, lunchStart, lunchEnd) {
  // Split a worker's other shifts around the lunch period if they overlap
  const dayShifts = shifts.filter(
    (s) => s.Date === date && s.Worker === workerName && s.Role !== "Lunch"
  );

  dayShifts.forEach((s) => {
    const sStart = typeof s.Start === "number" ? s.Start : toMinutes(s.Start);
    const sEnd = typeof s.End === "number" ? s.End : toMinutes(s.End);

    const overlapStart = Math.max(sStart, lunchStart);
    const overlapEnd = Math.min(sEnd, lunchEnd);

    if (overlapStart < overlapEnd) {
      // remove original
      const idx = shifts.indexOf(s);
      if (idx !== -1) shifts.splice(idx, 1);

      // left segment
      if (sStart < lunchStart) {
        shifts.push({ ...s, Start: sStart, End: lunchStart });
      }
      // right segment
      if (lunchEnd < sEnd) {
        shifts.push({ ...s, Start: lunchEnd, End: sEnd });
      }
    }
  });
}

// Coverage policy (Mon–Fri business hours in ET)
const COVERAGE_DAY = [
  { from: 8 * 60, to: 17 * 60, reservations: 3, dispatch: 1 },
  { from: 17 * 60, to: 21 * 60, reservations: 2, dispatch: 1 },
];

const roleKey = (r) => (r || "").toLowerCase();

function sampleCoverage(shifts, date, stepMins = 30) {
  // Return an array of samples with required vs actual by role
  const samples = [];
  for (const window of COVERAGE_DAY) {
    for (let t = window.from; t < window.to; t += stepMins) {
      const t2 = t + stepMins;
      const active = shifts.filter((s) =>
        s.Date === date &&
        Math.max(toMinutes(s.Start), t) < Math.min(toMinutes(s.End), t2) &&
        s.Role !== "Lunch"
      );
      const actual = {
        reservations: active.filter((s) => roleKey(s.Role) === "reservations").length,
        dispatch: active.filter((s) => roleKey(s.Role) === "dispatch").length,
      };
      samples.push({ t, t2, required: { reservations: window.reservations, dispatch: window.dispatch }, actual });
    }
  }
  return samples;
}

function coverageSummaryForDate(shifts, date) {
  const samples = sampleCoverage(shifts, date, 30);
  let ok = true, warnings = [];
  for (const s of samples) {
    if (s.actual.reservations < s.required.reservations || s.actual.dispatch < s.required.dispatch) {
      ok = false;
      warnings.push({
        window: `${toHHMM(s.t)}–${toHHMM(s.t2)}`,
        need: s.required,
        have: s.actual,
      });
    }
  }
  return { ok, warnings, samples };
}

// ─────────────────────────────── Health ───────────────────────────────
app.get("/api/health", async (_req, res) => {
  const sheet = !!process.env.GSHEETS_ID;
  const svc = !!process.env.GSHEETS_SERVICE_ACCOUNT;
  const openai = !!process.env.OPENAI_API_KEY;
  res.json({ status: "ok", sheets: sheet && svc, openai });
});

// ─────────────────────────────── Workers ───────────────────────────────
app.get("/api/workers", async (_req, res) => {
  try {
    const workers = await gs.listWorkers();
    res.json({ workers });
  } catch (err) {
    console.error("/api/workers error:", err);
    res.status(500).json({ error: "Failed to load workers" });
  }
});

// Save PTO: accepts { name, dates: [YYYY-MM-DD], on: true|false }
app.post("/api/workers/pto", async (req, res) => {
  try {
    const { name, dates = [], on = true } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });

    if (typeof gs.upsertPTO === "function") {
      for (const d of dates) await gs.upsertPTO({ name, date: d, on });
    } else if (typeof gs.writePTO === "function") {
      await gs.writePTO(name, dates, on);
    } else {
      return res.status(500).json({ error: "PTO writer not implemented in gsheets.js" });
    }

    const workers = await gs.listWorkers();
    res.json({ ok: true, workers });
  } catch (err) {
    console.error("/api/workers/pto error:", err);
    res.status(500).json({ error: "Failed to update PTO" });
  }
});

// ─────────────────────────────── Shifts ───────────────────────────────
app.get("/api/shifts", async (req, res) => {
  try {
    const date = (req.query.date || todayISO()).toString();
    const all = await gs.listShifts();
    const shifts = all.filter((s) => s.Date === date);
    res.json({ date, shifts });
  } catch (err) {
    console.error("/api/shifts GET error:", err);
    res.status(500).json({ error: "Failed to load shifts" });
  }
});

app.post("/api/shifts", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload) return res.status(400).json({ error: "payload required" });
    const all = await gs.listShifts();

    const candidate = {
      Date: payload.Date || todayISO(),
      Role: payload.Role,
      Start: toMinutes(payload.Start),
      End: toMinutes(payload.End),
      Worker: payload.Worker,
      Notes: payload.Notes || "",
    };

    if (candidate.Role === "Lunch") {
      carveOutLunch(all, candidate.Date, candidate.Worker, candidate.Start, candidate.End);
    }

    if (hasOverlap(all, candidate)) {
      return res.status(409).json({ error: "Overlapping shift for this worker" });
    }

    all.push(candidate);
    await gs.writeShifts(all);

    const coverage = coverageSummaryForDate(
      all.filter((s) => s.Date === candidate.Date),
      candidate.Date
    );

    res.json({ ok: true, shift: candidate, shifts: all, coverage });
  } catch (err) {
    console.error("/api/shifts POST error:", err);
    res.status(500).json({ error: "Failed to add shift" });
  }
});

app.patch("/api/shifts/:idx", async (req, res) => {
  // index is the position in the flat list (stable across reads/writes)
  try {
    const idx = Number(req.params.idx);
    const { Date: newDate, Start, End, Role, Worker, Notes } = req.body || {};
    const all = await gs.listShifts();
    if (!(idx >= 0 && idx < all.length)) return res.status(404).json({ error: "Shift not found" });

    const prev = all[idx];
    const updated = {
      ...prev,
      Date: newDate ?? prev.Date,
      Start: Start != null ? toMinutes(Start) : prev.Start,
      End: End != null ? toMinutes(End) : prev.End,
      Role: Role ?? prev.Role,
      Worker: Worker ?? prev.Worker,
      Notes: Notes ?? prev.Notes,
    };

    // lunch carve-out if becomes/overlaps with lunch
    if (updated.Role === "Lunch") {
      carveOutLunch(all.filter((_, i) => i !== idx), updated.Date, updated.Worker, updated.Start, updated.End);
    }

    // overlap check against all other shifts
    const others = all.filter((_, i) => i !== idx);
    if (hasOverlap(others, updated)) {
      return res.status(409).json({ error: "Overlapping shift for this worker" });
    }

    all[idx] = updated;
    await gs.writeShifts(all);

    const coverage = coverageSummaryForDate(
      all.filter((s) => s.Date === (updated.Date || prev.Date)),
      updated.Date || prev.Date
    );
    res.json({ ok: true, shift: updated, shifts: all, coverage });
  } catch (err) {
    console.error("/api/shifts PATCH error:", err);
    res.status(500).json({ error: "Failed to update shift" });
  }
});

app.delete("/api/shifts/:idx", async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const all = await gs.listShifts();
    if (!(idx >= 0 && idx < all.length)) return res.status(404).json({ error: "Shift not found" });
    const removed = all.splice(idx, 1)[0];
    await gs.writeShifts(all);

    const coverage = coverageSummaryForDate(
      all.filter((s) => s.Date === removed.Date),
      removed.Date
    );

    res.json({ ok: true, removed, shifts: all, coverage });
  } catch (err) {
    console.error("/api/shifts DELETE error:", err);
    res.status(500).json({ error: "Failed to delete shift" });
  }
});

// ─────────────────────────────── Chat (optional OpenAI) ─────────────────
const openai = process.env.OPENAI_API_KEY && OpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Helper used by chat tools
async function buildDaySchedule({ date }) {
  const workers = await gs.listWorkers();
  const all = await gs.listShifts();
  const shifts = all.filter((s) => s.Date === date);

  // Naive builder: ensure minimum coverage windows using available workers
  const can = (w, role) => {
    const ab = (w.Abilities || []).map((x) => (x || "").toString().toLowerCase());
    const r = roleKey(role);
    if (r === "reservations") return ab.includes("reservations");
    if (r === "dispatch") return ab.includes("dispatch");
    return false;
  };

  // pick next available worker at time t for role
  const pick = (t, role) => {
    return workers.find((w) => {
      const ws = toMinutes(w.WorkStartTime ?? w.WorkingStart ?? w.WorkStart ?? w.Start);
      const we = toMinutes(w.WorkEndTime ?? w.WorkingEnd ?? w.WorkEnd ?? w.End);
      if (!(ws <= t && t < we)) return false;
      if (!can(w, role)) return false;
      const hasShift = shifts.some((s) => s.Worker === w.Name && Math.max(toMinutes(s.Start), t) < Math.min(toMinutes(s.End), t + 30));
      return !hasShift;
    });
  };

  // ensure lunch for each worker (carve first, then add)
  for (const w of workers) {
    const ls = toMinutes(w.LunchStartTime ?? w.LunchStart);
    const le = toMinutes(w.LunchEndTime   ?? w.LunchEnd);
    if (ls != null && le != null && ls < le) {
      carveOutLunch(shifts, date, w.Name, ls, le);
      if (!hasOverlap(shifts, { Date: date, Worker: w.Name, Start: ls, End: le })) {
        shifts.push({ Date: date, Role: "Lunch", Start: ls, End: le, Worker: w.Name, Notes: "Scheduled lunch" });
      }
    }
  }

  // fill coverage per 30-minute block
  for (const window of COVERAGE_DAY) {
    for (let t = window.from; t < window.to; t += 30) {
      let activeRes = shifts.filter((s) => s.Date === date && roleKey(s.Role) === "reservations" && toMinutes(s.Start) <= t && t < toMinutes(s.End)).length;
      let activeDis = shifts.filter((s) => s.Date === date && roleKey(s.Role) === "dispatch" && toMinutes(s.Start) <= t && t < toMinutes(s.End)).length;

      while (activeRes < window.reservations) {
        const w = pick(t, "reservations");
        if (!w) break;
        const we = toMinutes(w.WorkEndTime ?? w.WorkingEnd ?? w.WorkEnd ?? w.End);
        const end = Math.min(we, t + 60); // give 1 hour blocks
        const cand = { Date: date, Role: "Reservations", Start: t, End: end, Worker: w.Name, Notes: "Auto" };
        if (!hasOverlap(shifts, cand)) { shifts.push(cand); activeRes++; } else { break; }
      }

      while (activeDis < window.dispatch) {
        const w = pick(t, "dispatch");
        if (!w) break;
        const we = toMinutes(w.WorkEndTime ?? w.WorkingEnd ?? w.WorkEnd ?? w.End);
        const end = Math.min(we, t + 60);
        const cand = { Date: date, Role: "Dispatch", Start: t, End: end, Worker: w.Name, Notes: "Auto" };
        if (!hasOverlap(shifts, cand)) { shifts.push(cand); activeDis++; } else { break; }
      }
    }
  }

  const merged = (await gs.listShifts()).filter((s) => s.Date !== date).concat(shifts);
  await gs.writeShifts(merged);
  const coverage = coverageSummaryForDate(shifts, date);
  return { date, shifts: merged, coverage };
}

app.post("/api/chat", async (req, res) => {
  try {
    const msg = (req.body && req.body.message) || "";
    const dateArg = (req.body && req.body.date) || todayISO();

    // If no OpenAI key, run a local day build and tell the user
    if (!openai) {
      const result = await buildDaySchedule({ date: dateArg });
      return res.json({
        reply: "Built schedule locally (no OpenAI key configured).",
        ...result,
      });
    }

    // Minimal assistant: Classify intents and call our builder
    const prompt = `You are a scheduling assistant. If the user asks to build or fix today's schedule, respond with JSON {action:"build_day", date:"YYYY-MM-DD"}. If they mention a specific date, use it. Otherwise return {action:"none"}. User: ${msg}`;
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Return only compact JSON. No prose." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    });

    let action = { action: "none" };
    try { action = JSON.parse(r.choices?.[0]?.message?.content || "{}"); } catch (_) {}

    let lastScheduledDate = dateArg; // ✅ FIXED: do not reference args out of scope
    if (action.action === "build_day") {
      const dd = action.date || dateArg;
      lastScheduledDate = dd;
      const result = await buildDaySchedule({ date: dd });
      return res.json({ reply: `Built schedule for ${dd}.`, ...result });
    }

    const all = await gs.listShifts();
    const finalDate = lastScheduledDate || todayISO();
    const coverage = coverageSummaryForDate(all.filter((s) => s.Date === finalDate), finalDate);
    res.json({ reply: "Okay.", date: finalDate, shifts: all, coverage });
  } catch (err) {
    console.error("/api/chat error:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

// ─────────────────────────────── Vercel export ──────────────────────────
export default app;

// ─────────────────────────────── NOTES ──────────────────────────────────
// If your ./gsheets.js exports different names, map them like so:
// export async function listWorkers() { return getWorkersFromSheet(); }
// export async function listShifts()  { return getShiftsFromSheet(); }
// export async function writeShifts(all) { return saveShiftsToSheet(all); }
// export async function upsertPTO({ name, date, on }) { /* toggle in sheet */ }
//
// Make sure /vercel.json routes /api/* to this file, and static files come
// from /public (index.html, schedule.html, admin.html, plus your JS).
