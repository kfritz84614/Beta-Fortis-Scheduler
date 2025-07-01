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
  – Lunch shifts are always named "Lunch" and are 90 min.
  – Do not let shifts overlap for the same employee.
  – PTO blocks out the whole day.
  – There must always be 3 people scheduled for reservations from 0800–1700.
  – There must always be 1 person scheduled for dispatch from 0800–1700.
Return "OK" after function_call responses.
`.trim();

app.post('/api/chat', async (req, res) => {
  const userMsg = req.body.message?.trim();
  if (!userMsg) return res.status(400).json({ error: 'empty prompt' });

  try {
    const openai = getClient();

    const completion = await openai.chat.completions.create({
      model    : 'gpt-4.1',
      messages : [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user',   content: userMsg }
      ],
      functions: [
        {
          name       : 'add_shift',
          description: 'Create a new shift for an employee',
          parameters : {
            type: 'object',
            properties: {
              name : { type:'string' },
              role : { type:'string' },
              date : { type:'string', description:'YYYY-MM-DD' },
              start: { type:'string', description:'HHMM e.g. 0800' },
              end  : { type:'string', description:'HHMM e.g. 1200' }
            },
            required:['name','role','date','start','end']
          }
        },
        {
          name       : 'add_pto',
          description: 'Mark PTO for an employee (whole day)',
          parameters : {
            type:'object',
            properties:{
              name:{type:'string'},
              date:{type:'string',description:'YYYY-MM-DD'}
            },
            required:['name','date']
          }
        },
        {
          name       : 'move_shift',
          description: 'Move an existing shift (by id) to a new start/end',
          parameters : {
            type:'object',
            properties:{
              id   :{type:'string'},
              start:{type:'string'},
              end  :{type:'string'}
            },
            required:['id','start','end']
          }
        }
      ],
      function_call:'auto'
    });

    const msg = completion.choices[0].message;

    // ---- handle tool calls ------------------------------------
    if (msg.function_call) {
      const fn  = msg.function_call.name;
      const args= JSON.parse(msg.function_call.arguments || '{}');

      if (fn === 'add_shift') {
        const s = {
          id    : randomUUID(),
          name  : args.name,
          role  : args.role,
          date  : args.date,
          start : parseInt(args.start,10).toString().padStart(4,'0'),
          end   : parseInt(args.end  ,10).toString().padStart(4,'0')
        };
        shifts.push({
          ...s,
          start: parseInt(s.start.slice(0,2))*60 + parseInt(s.start.slice(2)),
          end  : parseInt(s.end.slice(0,2))  *60 + parseInt(s.end.slice(2))
        });
        saveShifts();
        return res.json({ reply:'OK', function:fn, args });
      }

      if (fn === 'add_pto') {
        const w = workers.find(x => x.Name === args.name);
        if (w) {
          w.PTO = w.PTO || [];
          if (!w.PTO.includes(args.date)) w.PTO.push(args.date);
          saveWorkers();
          return res.json({ reply:'OK', function:fn, args });
        }
      }

      if (fn === 'move_shift') {
        const s = shifts.find(x => x.id === args.id);
        if (s) {
          s.start = parseInt(args.start.slice(0,2))*60 + parseInt(args.start.slice(2));
          s.end   = parseInt(args.end  .slice(0,2))*60 + parseInt(args.end  .slice(2));
          saveShifts();
          return res.json({ reply:'OK', function:fn, args });
        }
      }

      // fallback if function unknown / fails
      return res.status(400).json({ error:'unknown function or bad args' });
    }

    /* no function_call → just answer normally */
    res.json({ reply: msg.content });
  } catch (err) {
    console.error('✖ /api/chat error:', err);
    res.status(500).json({ error: 'openai failure' });
  }
});

/* -------------------------------------------------- export for Vercel */
export default app;
