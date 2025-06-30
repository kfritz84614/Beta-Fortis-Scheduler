// app.js — Fortis Scheduler backend (Vercel‑compatible with /tmp persistence)
import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------
// Resolve __dirname / __filename in ES‑modules
// ---------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------------------------------------------------
// Packaged JSON files (read‑only in Vercel) → copy once to /tmp so we can
// write updates during the lifetime of the serverless function instance.
// ---------------------------------------------------------------------
const PKG_WORKER = path.join(__dirname, 'data', 'workers.json');
const PKG_SHIFT  = path.join(__dirname, 'data', 'shifts.json');

const TMP_DIR    = '/tmp/fortis-data';                 // writable in Lambda
const WORKER_FILE= path.join(TMP_DIR, 'workers.json');
const SHIFT_FILE = path.join(TMP_DIR, 'shifts.json');

try {
  mkdirSync(TMP_DIR, { recursive: true });
  if (!existsSync(WORKER_FILE)) copyFileSync(PKG_WORKER, WORKER_FILE);
  if (!existsSync(SHIFT_FILE )) copyFileSync(PKG_SHIFT , SHIFT_FILE );
} catch (err) {
  console.error('❌ Failed to prepare /tmp data dir', err);
}

const loadJSON = file => {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return []; }
};
const saveJSON = (file, obj) => {
  try { writeFileSync(file, JSON.stringify(obj, null, 2)); }
  catch (err) { console.error('❌ Cannot write', file, err); }
};

let workers = loadJSON(WORKER_FILE);
let shifts  = loadJSON(SHIFT_FILE);

const saveWorkers = () => saveJSON(WORKER_FILE, workers);
const saveShifts  = () => saveJSON(SHIFT_FILE , shifts );

const uniqueAbilities = () => {
  const set = new Set();
  workers.forEach(w => ['Primary Ability','Secondary Ability','Tertiary Ability']
    .forEach(k => w[k] && set.add(w[k])));
  return Array.from(set).sort();
};

// ---------------------------------------------------------------------
// Express app (no app.listen — Vercel handles that)
// ---------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------- Worker routes
app.get('/api/workers',  (_,res)=>res.json(workers));
app.get('/api/abilities',(_,res)=>res.json(uniqueAbilities()));

app.post('/api/workers/add', (req,res)=>{
  const w=req.body; if(!w?.Name) return res.status(400).json({error:'Name required'});
  if(workers.some(x=>x.Name===w.Name)) return res.status(400).json({error:'Exists'});
  workers.push(w); saveWorkers(); res.json({success:true});
});

app.post('/api/workers/update',(req,res)=>{
  const upd=req.body; const i=workers.findIndex(x=>x.Name===upd.Name);
  if(i===-1) return res.status(404).json({error:'Not found'});
  workers[i] = { ...workers[i], ...upd }; saveWorkers(); res.json({success:true});
});

app.delete('/api/workers/:name',(req,res)=>{
  const {name}=req.params; const len=workers.length;
  workers = workers.filter(x=>x.Name!==name);
  if(workers.length===len) return res.status(404).json({error:'Not found'});
  saveWorkers(); res.json({success:true});
});

// PTO modify
app.post('/api/workers/pto',(req,res)=>{
  const {name,date,action}=req.body; const w=workers.find(x=>x.Name===name);
  if(!w) return res.status(404).json({error:'Worker not found'});
  w.PTO = w.PTO || [];
  if(action==='add' && !w.PTO.includes(date)) w.PTO.push(date);
  if(action==='remove') w.PTO = w.PTO.filter(d=>d!==date);
  saveWorkers(); res.json({success:true,PTO:w.PTO});
});

// -------------------------------------------------- Shift routes
app.get('/api/shifts', (_,res)=>res.json(shifts));

app.post('/api/shifts', (req,res)=>{
  const s=req.body; if(!s) return res.status(400).json({error:'no body'});
  if(!s.id){ s.id=randomUUID(); shifts.push(s); }
  else {
    const i=shifts.findIndex(x=>x.id===s.id);
    if(i===-1) shifts.push(s); else shifts[i]=s;
  }
  saveShifts(); res.json({success:true,id:s.id});
});

app.delete('/api/shifts/:id',(req,res)=>{
  const {id}=req.params; const len=shifts.length;
  shifts = shifts.filter(x=>x.id!==id);
  if(shifts.length===len) return res.status(404).json({error:'Not found'});
  saveShifts(); res.json({success:true});
});

// -------------------------------------------------- Chat stub
app.post('/api/chat',(_,res)=>res.json({reply:'chat feature coming soon'}));

export default app;
