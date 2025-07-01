// app.js — Fortis Scheduler backend (Vercel-compatible with /tmp persistence)
import express      from 'express';
import cors         from 'cors';
import OpenAI       from 'openai';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync
} from 'fs';
import path         from 'path';
import { fileURLToPath } from 'url';
import { randomUUID   } from 'crypto';

/* -------------------------------------------------- paths / tmp setup */
const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);

const PKG_WORKER  = path.join(__dirname, 'data', 'workers.json');
const PKG_SHIFT   = path.join(__dirname, 'data', 'shifts.json');

const TMP_DIR     = '/tmp/fortis-data';          // writable on Vercel λ
const WORKER_FILE = path.join(TMP_DIR, 'workers.json');
const SHIFT_FILE  = path.join(TMP_DIR, 'shifts.json');

try {
  mkdirSync(TMP_DIR, { recursive: true });
  if (!existsSync(WORKER_FILE)) copyFileSync(PKG_WORKER, WORKER_FILE);
  if (!existsSync(SHIFT_FILE )) copyFileSync(PKG_SHIFT , SHIFT_FILE );
} catch (err) {
  console.error('❌ Failed to prepare /tmp data dir', err);
}

const loadJSON = file => {
  try   { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return []; }
};
const saveJSON = (file, obj) => {
  try   { writeFileSync(file, JSON.stringify(obj, null, 2)); }
  catch (err) { console.error('❌ Cannot write', file, err); }
};

let workers = loadJSON(WORKER_FILE);
let shifts  = loadJSON(SHIFT_FILE);

const saveWorkers = () => saveJSON(WORKER_FILE, workers);
const saveShifts  = () => saveJSON(SHIFT_FILE , shifts);

const uniqueAbilities = () => {
  const set = new Set();
  workers.forEach(w =>
    ['Primary Ability', 'Secondary Ability', 'Tertiary Ability']
      .forEach(k => w[k] && set.add(w[k]))
  );
  if (!set.has('Lunch')) set.add('Lunch');        // always present
  return Array.from(set).sort();
};

/* -------------------------------------------------- express */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* -------------------------------------------------- worker routes */
app.get('/api/workers',  (_, res) => res.json(workers));
app.get('/api/abilities',(_, res) => res.json(uniqueAbilities()));

app.post('/api/workers/add', (req, res) => {
  const w = req.body;
  if (!w?.Name)               return res.status(400).json({ error: 'Name required' });
  if (workers.some(x => x.Name === w.Name))
                               return res.status(400).json({ error: 'Exists' });
  workers.push(w);
  saveWorkers();
  res.json({ success: true });
});

app.post('/api/workers/update', (req, res) => {
  const upd = req.body;
  const i   = workers.findIndex(x => x.Name === upd.Name);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  workers[i] = { ...workers[i], ...upd };
  saveWorkers();
  res.json({ success: true });
});

app.delete('/api/workers/:name', (req, res) => {
  const { name } = req.params;
  const len = workers.length;
  workers   = workers.filter(x => x.Name !== name);
  if (workers.length === len) return res.status(404).json({ error: 'Not found' });
  saveWorkers();
  res.json({ success: true });
});

/* PTO modify */
app.post('/api/workers/pto', (req, res) => {
  const { name, date, action } = req.body;
  const w = workers.find(x => x.Name === name);
  if (!w) return res.status(404).json({ error: 'Worker not found' });
  w.PTO = w.PTO || [];
  if (action === 'add'    && !w.PTO.includes(date)) w.PTO.push(date);
  if (action === 'remove') w.PTO = w.PTO.filter(d => d !== date);
  saveWorkers();
  res.json({ success: true, PTO: w.PTO });
});

/* -------------------------------------------------- shift routes */
app.get('/api/shifts', (_, res) => res.json(shifts));

app.post('/api/shifts', (req, res) => {
  const s = req.body;
  if (!s) return res.status(400).json({ error: 'no body' });
  if (!s.id) {                // new
    s.id = randomUUID();
    shifts.push(s);
  } else {                    // update
    const i = shifts.findIndex(x => x.id === s.id);
    if (i === -1) shifts.push(s);
    else          shifts[i] = s;
  }
  saveShifts();
  res.json({ success: true, id: s.id });
});

app.delete('/api/shifts/:id', (req, res) => {
  const { id } = req.params;
  const len = shifts.length;
  shifts = shifts.filter(x => x.id !== id);
  if (shifts.length === len) return res.status(404).json({ error: 'Not found' });
  saveShifts();
  res.json({ success: true });
});

// 🔧 Patch for /api/chat in app.js — robust time parsing & date fallback
// Paste this snippet over the existing chat‑route handler.

/* -------------------------------------------------- OpenAI chat route */
let _openai;                                  // lazy singleton
function getClient () {
  if (!_openai)
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const SYS_PROMPT = `
You are Fortis SchedulerBot.
• Respond conversationally.
• If the user asks to add PTO, add a shift, move, or change one, call the **appropriate function**.
• Strict scheduling rules:
  – Lunch shifts are always named "Lunch" and are 90 min.
  – Do not let shifts overlap for the same employee.
  – PTO blocks out the whole day.
  – There must always be 3 people scheduled for reservations from 0800–1700.
  – There must always be 1 person scheduled for dispatch from 0800–1700.
Return "OK" after function_call responses.`.trim();

// helper → converts "0730" or "07:30" to minutes‑since‑midnight
function toMinutes (str) {
  const digits = str.replace(/[^0-9]/g, "").padStart(4, "0"); // 730 → 0730
  const h = parseInt(digits.slice(0, 2), 10);
  const m = parseInt(digits.slice(2), 10);
  return h * 60 + m;
}

app.post('/api/chat', async (req, res) => {
  const userMsg = req.body.message?.trim();
  if (!userMsg) return res.status(400).json({ error: 'empty prompt' });

  try {
    const openai = getClient();

    const completion = await openai.chat.completions.create({
      model    : 'gpt-4o-mini',            // updated model name
      messages : [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user',   content: userMsg }
      ],
      functions: [ /* unchanged function schemas … */ ],
      function_call:'auto'
    });

    const msg = completion.choices[0].message;

    /* ---------- tool invocation ---------------------------------- */
    if (msg.function_call) {
      const fn   = msg.function_call.name;
      const args = JSON.parse(msg.function_call.arguments || '{}');

      // fall back to today if model uses words like "today" / "tomorrow"
      if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date))
        args.date = new Date().toISOString().slice(0, 10);

      if (fn === 'add_shift') {
        const s = {
          id   : randomUUID(),
          name : args.name,
          role : args.role,
          date : args.date,
          start: toMinutes(args.start),
          end  : toMinutes(args.end),
          notes: args.notes || ''
        };
        shifts.push(s); saveShifts();
        return res.json({ reply:'OK', function:fn, args });
      }

      if (fn === 'add_pto') {
        const w = workers.find(x => x.Name === args.name);
        if (!w) return res.status(404).json({ error:'worker not found' });
        w.PTO = w.PTO || [];
        if (!w.PTO.includes(args.date)) w.PTO.push(args.date);
        saveWorkers();
        return res.json({ reply:'OK', function:fn, args });
      }

      if (fn === 'move_shift') {
        const s = shifts.find(x => x.id === args.id);
        if (!s)  return res.status(404).json({ error:'shift not found' });
        s.start = toMinutes(args.start);
        s.end   = toMinutes(args.end);
        saveShifts();
        return res.json({ reply:'OK', function:fn, args });
      }

      return res.status(400).json({ error:'unknown function' });
    }

    /* no tool call → regular ChatGPT response */
    res.json({ reply: msg.content });
  } catch (err) {
    console.error('✖ /api/chat error:', err);
    res.status(500).json({ error: 'openai failure' });
  }
});

/* -------------------------------------------------- export for Vercel */
export default app;
