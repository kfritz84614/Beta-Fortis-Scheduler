// app.js
import express from 'express';
import { readFileSync, writeFileSync } from 'fs';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'data', 'workers.json');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let workers;
try {
  workers = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  console.error('❌ Unable to read workers.json:', e);
  workers = [];
}

app.get('/api/workers', (_, res) => {
  res.json(workers);
});

app.post('/api/workers/update', (req, res) => {
  const updated = req.body;
  const idx = workers.findIndex(w => w.Name === updated.Name);
  if (idx !== -1) {
    workers[idx] = updated;
    writeFileSync(DATA_FILE, JSON.stringify(workers, null, 2));
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Worker not found' });
});

app.post('/api/workers/pto', (req, res) => {
  const { name, date, action } = req.body;
  const worker = workers.find(w => w.Name === name);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  worker.PTO = worker.PTO || [];
  if (action === 'add' && !worker.PTO.includes(date)) worker.PTO.push(date);
  if (action === 'remove') worker.PTO = worker.PTO.filter(d => d !== date);

  writeFileSync(DATA_FILE, JSON.stringify(workers, null, 2));
  res.json({ success: true });
});

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  // (omitted) — same OpenAI proxy logic
  res.json({ reply: 'stub' });
});

export default app;
