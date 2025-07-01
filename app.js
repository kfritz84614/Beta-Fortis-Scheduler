// app.js — Fortis Scheduler backend (Vercel‑ready, OpenAI *tools* API)
// -----------------------------------------------------------------------------
// • Uses the new `tools` array + `tool_choice:"auto"` so OpenAI *must* emit a
//   function_call. This resolves the 400 error "tool_choice only allowed when
//   tools are specified".
// -----------------------------------------------------------------------------

import express      from "express";
import cors         from "cors";
import OpenAI       from "openai";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync
} from "fs";
import path              from "path";
import { fileURLToPath } from "url";
import { randomUUID }    from "crypto";

/* -------------------------------------------------- paths / tmp setup */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PKG_DIR    = path.join(__dirname, "data");
const PKG_WORK   = path.join(PKG_DIR, "workers.json");
const PKG_SHIFT  = path.join(PKG_DIR, "shifts.json");
const TMP_DIR    = "/tmp/fortis-data";
const WORK_FILE  = path.join(TMP_DIR, "workers.json");
const SHIFT_FILE = path.join(TMP_DIR, "shifts.json");

mkdirSync(TMP_DIR, { recursive: true });
if (!existsSync(WORK_FILE )) copyFileSync(PKG_WORK , WORK_FILE );
if (!existsSync(SHIFT_FILE)) copyFileSync(PKG_SHIFT, SHIFT_FILE);

const load = f => JSON.parse(readFileSync(f, "utf8"));
const save = (f, obj) => writeFileSync(f, JSON.stringify(obj, null, 2));

let workers = load(WORK_FILE);
let shifts  = load(SHIFT_FILE);
const saveWorkers = () => save(WORK_FILE, workers);
const saveShifts  = () => save(SHIFT_FILE, shifts);

const uniqueAbilities = () => {
  const set = new Set();
  workers.forEach(w => ["Primary Ability","Secondary Ability","Tertiary Ability"].forEach(k=>w[k]&&set.add(w[k])));
  set.add("Lunch"); return [...set].sort();
};

/* -------------------------------------------------- express */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- workers routes ---------------- */
app.get ("/api/workers",  (_,res)=>res.json(workers));
app.get ("/api/abilities",(_,res)=>res.json(uniqueAbilities()));
app.post("/api/workers/add", (req,res)=>{
  const w=req.body; if(!w?.Name) return res.status(400).json({error:"Name required"});
  if(workers.some(x=>x.Name===w.Name)) return res.status(409).json({error:"Exists"});
  workers.push(w); saveWorkers(); res.json({success:true});
});
app.post("/api/workers/update", (req,res)=>{
  const w=req.body; const i=workers.findIndex(x=>x.Name===w.Name);
  if(i===-1) return res.status(404).json({error:"Not found"});
  workers[i]={...workers[i],...w}; saveWorkers(); res.json({success:true});
});
app.delete("/api/workers/:name", (req,res)=>{
  const {name}=req.params; const len=workers.length;
  workers=workers.filter(x=>x.Name!==name);
  if(workers.length===len) return res.status(404).json({error:"Not found"});
  saveWorkers(); res.json({success:true});
});
app.post("/api/workers/pto", (req,res)=>{
  const {name,date,action}=req.body; const w=workers.find(x=>x.Name===name);
  if(!w) return res.status(404).json({error:"Worker not found"});
  w.PTO=w.PTO||[];
  if(action==="add"   && !w.PTO.includes(date)) w.PTO.push(date);
  if(action==="remove") w.PTO=w.PTO.filter(d=>d!==date);
  saveWorkers(); res.json({success:true,PTO:w.PTO});
});

/* ---------------- shifts routes ---------------- */
app.get ("/api/shifts",  (_,res)=>res.json(shifts));
app.post("/api/shifts", (req,res)=>{
  const s=req.body; if(!s.id){s.id=randomUUID(); shifts.push(s);} else {
    const i=shifts.findIndex(x=>x.id===s.id); if(i===-1) shifts.push(s); else shifts[i]=s;
  }
  saveShifts(); res.json({success:true,id:s.id});
});
app.delete("/api/shifts/:id", (req,res)=>{
  const {id}=req.params; const len=shifts.length;
  shifts=shifts.filter(x=>x.id!==id);
  if(shifts.length===len) return res.status(404).json({error:"Not found"});
  saveShifts(); res.json({success:true});
});

/* -------------------------------------------------- OpenAI chat */
let _openai; const ai=()=>_openai||(_openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY}));
const SYS_PROMPT="You are Fortis SchedulerBot. Map natural language to add_shift, add_pto, move_shift and reply OK.";

// tools array (new API structure)
const TOOLS = [
  { type:"function", function:{
      name:"add_shift",
      description:"Add a work shift",
      parameters:{type:"object",properties:{name:{type:"string"},role:{type:"string"},date:{type:"string"},start:{type:"string"},end:{type:"string"},notes:{type:"string",nullable:true}},required:["name","role","date","start","end"]}
  }},
  { type:"function", function:{
      name:"add_pto",
      description:"Add PTO day",
      parameters:{type:"object",properties:{name:{type:"string"},date:{type:"string"}},required:["name","date"]}
  }},
  { type:"function", function:{
      name:"move_shift",
      description:"Move an existing shift",
      parameters:{type:"object",properties:{id:{type:"string"},start:{type:"string"},end:{type:"string"}},required:["id","start","end"]}
  }}
];

const toMin = s => {const d=s.replace(/[^0-9]/g,"").padStart(4,"0"); return +d.slice(0,2)*60 + +d.slice(2)};

app.post("/api/chat", async (req,res)=>{
  const user=req.body.message?.trim(); if(!user) return res.status(400).json({error:"empty"});
  try{
    const openai=ai();
    const out = await openai.chat.completions.create({
      model:"gpt-4o-mini",
      messages:[{role:"system",content:SYS_PROMPT},{role:"user",content:user}],
      tools:TOOLS,
      tool_choice:"auto"                    // forces a function call
    });

    const m=out.choices[0].message;
    if(m.tool_call){                       // new field name in v4 SDK
      const { name:fn, arguments:argStr } = m.tool_call;
      const a = JSON.parse(argStr||"{}");

      if(a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date)){
        const d=new Date(); if(/tomorrow/i.test(a.date)) d.setDate(d.getDate()+1);
        a.date=d.toISOString().slice(0,10);
      }

      if(fn==="add_shift"){
        shifts.push({id:randomUUID(),name:a.name,role:a.role,date:a.date,start:toMin(a.start),end:toMin(a.end),notes:a.notes||""});
        saveShifts(); return res.json({reply:"OK"});
      }
      if(fn==="add_pto"){
        const w=workers.find(x=>x.Name===a.name); if(!w) return res.status(404).json({error:"worker"});
        w.PTO=w.PTO||[]; if(!w.PTO.includes(a.date)) w.PTO.push(a.date); saveWorkers();
        return res.json({reply:"OK"});
      }
      if(fn==="move_shift"){
        const s=shifts.find(x=>x.id===a.id); if(!s) return res.status(404).json({error:"shift"});
        s.start=toMin(a.start); s.end=toMin(a.end); saveShifts();
        return res.json({reply:"OK"});
      }
      return res.status(400).json({error:"unknown fn"});
    }

    res.json({reply:m.content});
  }catch(err){console.error("/api/chat",err); res.status(500).json({error:"openai"});}
});

/* -------------------------------------------------- export for Vercel */
export default app;
