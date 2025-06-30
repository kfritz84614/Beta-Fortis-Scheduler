// app.js — Fortis Scheduler backend (Vercel-compatible)
import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'data', 'workers.json');

function loadWorkers() {
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('❌  workers.json not found or invalid:', err);
    return [];
  }
}
function saveWorkers(list) {
  writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}
let workers = loadWorkers();

function uniqueAbilities() {
  const set = new Set();
  workers.forEach(w => {
    ['Primary Ability', 'Secondary Ability', 'Tertiary Ability'].forEach(key => {
      if (w[key]) set.add(w[key]);
    });
  });
  return Array.from(set).sort();
}

// ---------------------------------------------------------------------
// Express app (exported, no app.listen for Vercel)
// ---------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------- API routes
app.get('/api/workers', (_, res) => res.json(workers));

app.get('/api/abilities', (_, res) => res.json(uniqueAbilities()));

// add new worker
app.post('/api/workers/add', (req, res) => {
  const newW = req.body;
  if (!newW?.Name) return res.status(400).json({ error: 'Name required' });
  if (workers.some(w => w.Name === newW.Name)) {
    return res.status(400).json({ error: 'Worker already exists' });
  }
  workers.push(newW);
  saveWorkers(workers);
  res.json({ success: true });
});

// update existing worker
app.post('/api/workers/update', (req, res) => {
  const updated = req.body;
  const idx = workers.findIndex(w => w.Name === updated.Name);
  if (idx === -1) return res.status(404).json({ error: 'Worker not found' });
  workers[idx] = { ...workers[idx], ...updated };
  saveWorkers(workers);
  res.json({ success: true });
});

// delete worker
app.delete('/api/workers/:name', (req, res) => {
  const { name } = req.params;
  const len = workers.length;
  workers = workers.filter(w => w.Name !== name);
  if (workers.length === len) return res.status(404).json({ error: 'Worker not found' });
  saveWorkers(workers);
  res.json({ success: true });
});

// PTO add / remove
app.post('/api/workers/pto', (req, res) => {
  const { name, date, action } = req.body;
  const w = workers.find(x => x.Name === name);
  if (!w) return res.status(404).json({ error: 'Worker not found' });
  w.PTO = w.PTO || [];
  if (action === 'add' && !w.PTO.includes(date)) w.PTO.push(date);
  if (action === 'remove') w.PTO = w.PTO.filter(d => d !== date);
  saveWorkers(workers);
  res.json({ success: true, PTO: w.PTO });
});

// (stub) proxy chat -> OpenAI
app.post('/api/chat', (_, res) => {
  res.json({ reply: 'chat feature coming soon' });
});

export default app;
