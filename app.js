// app.js  — Fortis Scheduler backend (Vercel-compatible: /tmp persistence)
import express from 'express';
import cors from 'cors';
import {
  readFileSync, writeFileSync, mkdirSync,
  existsSync, copyFileSync
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

/* ---------- resolve __dirname in ES-modules ------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ---------- package-side data files (read-only) --------------- */
const PKG_DIR    = path.join(__dirname, 'data');
const PKG_WORKER = path.join(PKG_DIR, 'workers.json');
const PKG_SHIFT  = path.join(PKG_DIR, 'shifts.json');
const PKG_ABIL   = path.join(PKG_DIR, 'abilities.json');

/* ---------- writable /tmp mirrors ----------------------------- */
const TMP_DIR     = '/tmp/fortis-data';             // lambda-writable
const WORKER_FILE = path.join(TMP_DIR, 'workers.json');
const SHIFT_FILE  = path.join(TMP_DIR, 'shifts.json');
const ABIL_FILE   = path.join(TMP_DIR, 'abilities.json');

/* ---------- ensure /tmp copies exist -------------------------- */
function prepTmp() {
  mkdirSync(TMP_DIR, { recursive: true });
  if (!existsSync(WORKER_FILE)) copyFileSync(PKG_WORKER, WORKER_FILE);
  if (!existsSync(SHIFT_FILE )) copyFileSync(PKG_SHIFT , SHIFT_FILE );
  if (!existsSync(ABIL_FILE )) {
    // first boot: derive abilities from workers, add Lunch
    const base = JSON.parse(readFileSync(PKG_WORKER));
    const set  = new Set(['Lunch']);
    base.forEach(w =>
      ['Primary Ability','Secondary Ability','Tertiary Ability']
        .forEach(k => w[k] && set.add(w[k])));
    writeFileSync(ABIL_FILE, JSON.stringify([...set], null, 2));
  }
}
prepTmp();

/* ---------- small helpers ------------------------------------- */
const load  = f => JSON.parse(readFileSync(f,'utf8'));
const save  = (f,obj) => writeFileSync(f, JSON.stringify(obj,null,2));

let workers   = load(WORKER_FILE);
let shifts    = load(SHIFT_FILE);
let abilities = load(ABIL_FILE);

const syncWorkers   = () => save(WORKER_FILE, workers);
const syncShifts    = () => save(SHIFT_FILE , shifts );
const syncAbilities = () => save(ABIL_FILE  , abilities);

/* ---------- express setup ------------------------------------- */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- abilities ----------------------------------------- */
app.get('/api/abilities', (_ ,res) => {
  if (!abilities.includes('Lunch')) { abilities.push('Lunch'); syncAbilities(); }
  res.json(abilities);
});

/* ---------- workers CRUD -------------------------------------- */
app.get('/api/workers',   (_ ,res) => res.json(workers));

app.post('/api/workers/add', (req,res) => {
  const w = req.body;
  if (!w?.Name) return res.status(400).json({ error:'Name required' });
  if (workers.some(x => x.Name === w.Name))
    return res.status(409).json({ error:'Worker exists' });
  workers.push(w); syncWorkers();
  res.json({ success:true });
});

app.post('/api/workers/update', (req,res) => {
  const upd = req.body;
  const i   = workers.findIndex(x => x.Name === upd.Name);
  if (i === -1) return res.status(404).json({ error:'Not found' });
  workers[i] = { ...workers[i], ...upd };
  syncWorkers();
  res.json({ success:true });
});

app.delete('/api/workers/:name', (req,res) => {
  const { name } = req.params;
  const before = workers.length;
  workers = workers.filter(w => w.Name !== name);
  if (workers.length === before) return res.status(404).json({ error:'Not found' });
  syncWorkers();
  res.json({ success:true });
});

/* ---------- PTO (replace full array) -------------------------- */
app.post('/api/workers/pto', (req,res) => {
  const { name, pto } = req.body;
  const w = workers.find(x => x.Name === name);
  if (!w) return res.status(404).json({ error:'Worker not found' });
  w.PTO = pto;           // overwrite
  syncWorkers();
  res.json({ success:true, PTO:w.PTO });
});

/* ---------- shifts CRUD --------------------------------------- */
app.get('/api/shifts', (_ ,res) => res.json(shifts));

app.post('/api/shifts', (req,res) => {
  const s = req.body;
  if (!s) return res.status(400).json({ error:'No body' });
  if (!s.id) {
    s.id = randomUUID();
    shifts.push(s);
  } else {
    const i = shifts.findIndex(x => x.id === s.id);
    if (i === -1) shifts.push(s); else shifts[i] = s;
  }
  syncShifts();
  res.json({ success:true, id:s.id });
});

app.delete('/api/shifts/:id', (req,res) => {
  const { id } = req.params;
  const before = shifts.length;
  shifts = shifts.filter(s => s.id !== id);
  if (shifts.length === before) return res.status(404).json({ error:'Not found' });
  syncShifts();
  res.json({ success:true });
});

/* ---------- stub chat route ----------------------------------- */
app.post('/api/chat', (_ ,res) => res.json({ reply:'chat feature coming soon' }));

/* ---------- export (Vercel handles listener) ------------------ */
export default app;
