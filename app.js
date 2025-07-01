// app.js — Fortis Scheduler backend (Vercel-compatible)
// =====================================================
import express      from 'express';
import cors         from 'cors';
import {
  readFileSync, writeFileSync,
  mkdirSync, existsSync, copyFileSync
}                    from 'fs';
import path          from 'path';
import { fileURLToPath } from 'url';
import { randomUUID }   from 'crypto';
import OpenAI          from 'openai';

// ──────────────────────────────────────────────────────
//  Resolve __dirname / __filename in ESM
// ──────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ──────────────────────────────────────────────────────
//  Writable copies of bundled JSONs →  /tmp
// ──────────────────────────────────────────────────────
const PKG_WORKER = path.join(__dirname, 'data', 'workers.json');
const PKG_SHIFT  = path.join(__dirname, 'data', 'shifts.json');

const TMP_DIR    = '/tmp/fortis-data';            // writable on Vercel
const WORKER_FILE= path.join(TMP_DIR, 'workers.json');
const SHIFT_FILE = path.join(TMP_DIR, 'shifts.json');

mkdirSync(TMP_DIR, { recursive:true });
if (!existsSync(WORKER_FILE)) copyFileSync(PKG_WORKER, WORKER_FILE);
if (!existsSync(SHIFT_FILE )) copyFileSync(PKG_SHIFT , SHIFT_FILE );

const loadJSON = f => JSON.parse(readFileSync(f,'utf8'));
const saveJSON = (f,obj)=>writeFileSync(f,JSON.stringify(obj,null,2));

let workers = loadJSON(WORKER_FILE);
let shifts  = loadJSON(SHIFT_FILE );

const saveWorkers = () => saveJSON(WORKER_FILE, workers);
const saveShifts  = () => saveJSON(SHIFT_FILE , shifts );

// unique ability names (for /api/abilities)
const uniqueAbilities = () => {
  const set=new Set();
  workers.forEach(w=>['Primary Ability','Secondary Ability','Tertiary Ability']
      .forEach(k=>w[k]&&set.add(w[k])));
  set.add('Lunch');                       // always present
  return [...set].sort();
};

// ──────────────────────────────────────────────────────
//  Express app
// ──────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));

// ─── Worker routes ───────────────────────────────────
app.get('/api/workers',  (_,res)=>res.json(workers));
app.get('/api/abilities',(_,res)=>res.json(uniqueAbilities()));

app.post('/api/workers/add',(req,res)=>{
  const w=req.body;
  if(!w?.Name) return res.status(400).json({error:'Name required'});
  if(workers.some(x=>x.Name===w.Name))
    return res.status(400).json({error:'Worker exists'});
  workers.push(w); saveWorkers(); res.json({success:true});
});

app.post('/api/workers/update',(req,res)=>{
  const upd=req.body;
  const i=workers.findIndex(x=>x.Name===upd.Name);
  if(i===-1) return res.status(404).json({error:'Not found'});
  workers[i] = {...workers[i], ...upd}; saveWorkers(); res.json({success:true});
});

app.delete('/api/workers/:name',(req,res)=>{
  const {name}=req.params;
  const len=workers.length;
  workers = workers.filter(w=>w.Name!==name);
  if(workers.length===len) return res.status(404).json({error:'Not found'});
  saveWorkers(); res.json({success:true});
});

// PTO toggle
app.post('/api/workers/pto',(req,res)=>{
  const {name,date,action}=req.body;
  const w=workers.find(x=>x.Name===name);
  if(!w) return res.status(404).json({error:'Worker not found'});
  w.PTO = w.PTO||[];
  if(action==='add' && !w.PTO.includes(date)) w.PTO.push(date);
  if(action==='remove') w.PTO = w.PTO.filter(d=>d!==date);
  saveWorkers(); res.json({success:true,PTO:w.PTO});
});

// ─── Shift routes ────────────────────────────────────
app.get('/api/shifts',(_,res)=>res.json(shifts));

app.post('/api/shifts',(req,res)=>{
  const s=req.body;
  if(!s) return res.status(400).json({error:'no body'});
  if(!s.id){ s.id=randomUUID(); shifts.push(s); }
  else {
    const i=shifts.findIndex(x=>x.id===s.id);
    if(i===-1) shifts.push(s); else shifts[i]=s;
  }
  saveShifts(); res.json({success:true,id:s.id});
});

app.delete('/api/shifts/:id',(req,res)=>{
  const {id}=req.params;
  const len=shifts.length;
  shifts = shifts.filter(x=>x.id!==id);
  if(shifts.length===len) return res.status(404).json({error:'Not found'});
  saveShifts(); res.json({success:true});
});

// ─── OpenAI chat route ───────────────────────────────
const openai = new OpenAI(); // uses OPENAI_API_KEY

const SYS_PROMPT = `
You are Fortis SchedulerBot. 
• Respond conversationally.
• If the user asks to add PTO, add a shift, move, or change one, call the **appropriate function**.
• Strict scheduling rules:
  – Lunch shifts are always named "Lunch" and are 30-60 min.
  – Do not let shifts overlap for the same employee.
  – PTO blocks out the whole day.
Return "OK" after function_call responses.
`.trim();

const functions = [
  {
    name:"addPTO",
    description:"Mark a worker out for the whole day (blocking scheduling).",
    parameters:{
      type:"object",
      properties:{
        name:{type:"string"},
        date:{type:"string",description:"YYYY-MM-DD"}
      },
      required:["name","date"]
    }
  },
  {
    name:"addShift",
    description:"Create a shift",
    parameters:{
      type:"object",
      properties:{
        name :{type:"string"},
        role :{type:"string"},
        date :{type:"string",description:"YYYY-MM-DD"},
        start:{type:"integer",description:"minutes from 00:00"},
        end  :{type:"integer",description:"minutes from 00:00"}
      },
      required:["name","role","date","start","end"]
    }
  },
  {
    name:"moveShift",
    description:"Change an existing shift’s start/end or worker",
    parameters:{
      type:"object",
      properties:{
        id   :{type:"string"},
        name :{type:"string"},
        start:{type:"integer"},
        end  :{type:"integer"}
      },
      required:["id"]
    }
  }
];

app.post('/api/chat', async (req,res)=>{
  const userMsg = req.body?.message || '';
  try{
    const chat = await openai.chat.completions.create({
      model:"gpt-4o-mini",
      messages:[
        {role:"system",content:SYS_PROMPT},
        {role:"user",content:userMsg}
      ],
      functions,
      function_call:"auto"
    });

    const reply = chat.choices[0].message;
    if(reply.function_call){
      const {name,arguments:argsJSON}=reply.function_call;
      const args = JSON.parse(argsJSON||'{}');
      let fnResp="";

      // --- safe function execution --------------------------------
      if(name==="addPTO"){
        const w=workers.find(w=>w.Name===args.name);
        if(w){
          w.PTO=w.PTO||[];
          if(!w.PTO.includes(args.date)){ w.PTO.push(args.date); saveWorkers(); }
        }
        fnResp="PTO added.";
      }
      else if(name==="addShift"){
        const shift={...args,id:randomUUID()};
        shifts.push(shift); saveShifts(); fnResp="Shift added.";
      }
      else if(name==="moveShift"){
        const i=shifts.findIndex(s=>s.id===args.id);
        if(i!==-1){
          shifts[i]={...shifts[i],...args}; saveShifts(); fnResp="Shift updated.";
        }
      }

      return res.json({reply:"OK",functionResult:fnResp});
    }

    // normal assistant reply
    res.json({reply:reply.content});
  }catch(err){
    console.error(err);
    res.status(500).json({error:"chat error"});
  }
});

export default app;
