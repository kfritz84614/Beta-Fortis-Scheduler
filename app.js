import express from 'express';
import { readFileSync, writeFileSync } from 'fs';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let workers = JSON.parse(readFileSync('./data/workers.json'));

app.get('/api/workers', (req, res) => {
  res.json(workers);
});

app.post('/api/workers/update', (req, res) => {
  const updatedWorker = req.body;
  const index = workers.findIndex(w => w.Name === updatedWorker.Name);
  if (index !== -1) {
    workers[index] = updatedWorker;
    writeFileSync('./data/workers.json', JSON.stringify(workers, null, 2));
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Worker not found' });
  }
});

app.post('/api/workers/pto', (req, res) => {
  const { name, date, action } = req.body;
  const worker = workers.find(w => w.Name === name);
  if (worker) {
    if (!worker.PTO) worker.PTO = [];
    if (action === 'add') {
      worker.PTO.push(date);
    } else {
      worker.PTO = worker.PTO.filter(d => d !== date);
    }
    writeFileSync('./data/workers.json', JSON.stringify(workers, null, 2));
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Worker not found' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  const systemPrompt = `You are the Fortis scheduling assistant. You help manage weekly shift schedules. Use Eastern Time. Workers have preferences and minimums for lunch and off-task time. You respond with updated JSON schedules.`;

  const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ]
    })
  });

  const json = await chatRes.json();
  res.json({ reply: json.choices[0].message.content });
});

// ⚠️ IMPORTANT: Do not listen on a port
export default app;
