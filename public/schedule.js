// ──────────────────────────────────────────────────────────
//  Fortis Scheduler – day view  (draw, dialog, drag, resize)
// ──────────────────────────────────────────────────────────

// ---------- helpers & palette ----------------------------
const COLORS = {
  Reservations     : '#16a34a',
  Dispatch         : '#b91c1c',
  Security         : '#be185d',
  Network          : '#475569',
  'Journey Desk'   : '#65a30d',
  Marketing        : '#7c3aed',
  Sales            : '#d97706',
  'Badges/Projects': '#0ea5e9',
  Lunch            : '#8b5a2b'                      // PTO & Lunch colours
};

const STEP = 15;                                    // minute snap
const hh   = h => `${String(h).padStart(2,'0')}:00`;
const fmt  = m => `${String(m/60|0).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const toMin = t => {                                // accepts 0815 | 08:15
  if (!t.includes(':') && t.length === 4) t = t.slice(0,2)+':'+t.slice(2);
  const [h,m] = t.split(':').map(Number);
  return h*60 + m;
};
const iso = d => d.toISOString().slice(0,10);

// ---------- state ----------------------------------------
let workers = [], abilities = [], shifts = [];
let day = location.hash ? new Date(location.hash.slice(1)) : new Date();

// ---------- DOM refs -------------------------------------
const grid  = document.getElementById('grid');
const wrap  = document.getElementById('wrap');
const dateH = document.getElementById('date');

const empIn = document.getElementById('empSel');
const empDl = document.getElementById('workerList');

// chat widget refs
const chatInput = document.getElementById('chatInput');
const chatSend  = document.getElementById('chatSend');
const chatBox   = document.getElementById('chatBox');

// ---------- load data ------------------------------------
(async () => {
  [workers, abilities, shifts] = await Promise.all([
    fetch('/api/workers').then(r => r.json()),
    fetch('/api/abilities').then(r => r.json()),
    fetch('/api/shifts').then(r => r.json())
  ]);
  if (!abilities.includes('Lunch')) abilities.push('Lunch');
  empDl.innerHTML = workers.map(w => `<option value="${w.Name}">`).join('');
  draw();
})();

// ---------- persistence helpers ---------------------------
const saveShift   = async s => {
  const { id } = await fetch('/api/shifts',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(s)
  }).then(r=>r.json());
  if (!s.id) s.id = id;
};
const deleteShift = id => fetch(`/api/shifts/${id}`,{method:'DELETE'});

// ---------- utilities -------------------------------------
const firstStart = name => {
  const s = shifts.filter(x=>x.name===name && x.date===iso(day))
                  .sort((a,b)=>a.start-b.start)[0];
  return s ? s.start : 1441;
};
const label = (txt,r=1,c=1) =>{
  const d=document.createElement('div');
  d.className='rowLabel'; d.textContent=txt;
  d.style=`grid-row:${r};grid-column:${c}`; return d;
};
const cell = (r,c,ds={}) =>{
  const d=document.createElement('div');
  d.className='cell'; d.style=`grid-row:${r};grid-column:${c}`;
  Object.assign(d.dataset,ds); return d;
};

// ---------- render ----------------------------------------
function draw(){
  // sort workers
  const sorted=[...workers].sort((a,b)=>{
    const sa=firstStart(a.Name), sb=firstStart(b.Name);
    return sa!==sb?sa-sb:a.Name.localeCompare(b.Name);
  });
  const rowOf=Object.fromEntries(sorted.map((w,i)=>[w.Name,i]));

  grid.innerHTML='';
  grid.style.gridTemplateRows=`30px repeat(${sorted.length},30px)`;
  grid.appendChild(label(''));
  for(let h=0;h<24;h++) grid.appendChild(label(hh(h),1,h+2));

  sorted.forEach((w,r)=>{
    grid.appendChild(label(w.Name,r+2,1));
    for(let h=0;h<24;h++) grid.appendChild(cell(r+2,h+2,{row:r,hour:h}));
    const band=document.createElement('div');
    band.className='band'; band.style.gridRow=r+2; grid.appendChild(band);
  });

  // PTO overlay (grey band spanning 24 h)
  workers.forEach((w,r)=>{
    if((w.PTO||[]).includes(iso(day))){
      const p=document.createElement('div');
      p.className='block'; p.textContent='PTO';
      p.style.cssText=`left:0;width:100%;background:#9ca3af;opacity:.35`;
      grid.querySelectorAll('.band')[r].appendChild(p);
    }
  });

  // normal shifts
  shifts.filter(s=>s.date===iso(day))
        .forEach((s,i)=>placeBlock(s,i,rowOf[s.name]));

  dateH.textContent = day.toDateString();
  location.hash     = iso(day);
}

// ---------- place block -----------------------------------
function placeBlock(s,idx,row){
  const band=grid.querySelectorAll('.band')[row]; if(!band) return;
  const el  =document.createElement('div');
  el.className='block';
  el.style.cssText=`left:${s.start/1440*100}%;width:${(s.end-s.start)/1440*100}%;background:${COLORS[s.role]||'#2563eb'}`;
  el.textContent=`${s.role} ${fmt(s.start)}-${fmt(s.end)}`;
  el.ondblclick=()=>openDlg('edit',idx);

  ['l','r'].forEach(side=>{
    const h=document.createElement('span');
    h.style=`position:absolute;${side==='l'?'left':'right'}:0;top:0;bottom:0;width:6px;cursor:ew-resize`;
    h.onmousedown=e=>startResize(e,idx,side);
    el.appendChild(h);
  });

  el.onmousedown=e=>{
    if(e.target.tagName==='SPAN') return;
    startMove(e,idx,row,el);
  };

  band.appendChild(el);
}

// ---------- resize ----------------------------------------
let rs={};
function startResize(e,idx,side){
  e.stopPropagation();
  rs={idx,side,startX:e.clientX,orig:{...shifts[idx]}};
  document.onmousemove=doResize;
  document.onmouseup=endResize;
}
function doResize(e){
  if(rs.idx==null) return;
  const px=grid.querySelector('.band').getBoundingClientRect().width/1440;
  const diff=Math.round((e.clientX-rs.startX)/px/STEP)*STEP;
  const s=shifts[rs.idx];
  if(rs.side==='l') s.start=Math.max(0,Math.min(s.end-STEP,rs.orig.start+diff));
  else              s.end  =Math.min(1440,Math.max(s.start+STEP,rs.orig.end+diff));
  draw();
}
function endResize(){
  if(rs.idx!=null) saveShift(shifts[rs.idx]);
  rs={}; document.onmousemove=document.onmouseup=null;
}

// ---------- drag-move -------------------------------------
let mv=null;
function startMove(e,idx,row,orig){
  e.preventDefault();
  mv={idx,row,startX:e.clientX,startY:e.clientY,moved:false,orig};
  document.onmousemove=doMove;
  document.onmouseup=endMove;
}
function doMove(e){
  if(!mv) return;
  if(!mv.moved){
    if(Math.abs(e.clientX-mv.startX)<4 && Math.abs(e.clientY-mv.startY)<4) return;
    mv.moved=true;
    mv.preview=mv.orig.cloneNode(true);
    mv.preview.style.opacity=.5; mv.preview.style.pointerEvents='none';
    grid.appendChild(mv.preview);
  }
  const px=grid.querySelector('.band').getBoundingClientRect().width/1440;
  const diff=Math.round((e.clientX-mv.startX)/px/STEP)*STEP;
  const s=shifts[mv.idx];
  let st=Math.max(0,Math.min(1440-STEP,s.start+diff));
  let en=s.end+diff; if(en>1440){st-=en-1440; en=1440;}
  mv.preview.style.left = st/1440*100+'%';
  mv.preview.style.width= (en-st)/1440*100+'%';
  const diffRow=Math.round((e.clientY-mv.startY)/30);
  const newRow=Math.min(Math.max(0,mv.row+diffRow),workers.length-1);
  mv.preview.style.gridRow=newRow+2;
}
async function endMove(){
  document.onmousemove=document.onmouseup=null;
  if(!mv) return;
  if(!mv.moved){ openDlg('edit',mv.idx); mv=null; return; }
  const px=grid.querySelector('.band').getBoundingClientRect().width/1440;
  const diff=Math.round((event.clientX-mv.startX)/px/STEP)*STEP;
  const s=shifts[mv.idx];
  s.start=Math.max(0,Math.min(1440-STEP,s.start+diff));
  s.end  =Math.min(1440,Math.max(s.start+STEP,s.end+diff));
  const diffRow=Math.round((event.clientY-mv.startY)/30);
  const newRow=Math.min(Math.max(0,mv.row+diffRow),workers.length-1);
  s.name=workers[newRow].Name;
  mv.preview.remove(); mv=null;
  await saveShift(s); draw();
}

// ---------- drag-create blank box --------------------------
let dc=null;
grid.onmousedown=e=>{
  if(!e.target.dataset.hour) return;
  dc={row:+e.target.dataset.row,start:+e.target.dataset.hour*60,
      box:Object.assign(document.createElement('div'),{className:'dragBox'})};
  grid.querySelectorAll('.band')[dc.row].appendChild(dc.box);
};
grid.onmousemove=e=>{
  if(!dc||+e.target.dataset.row!==dc.row||!e.target.dataset.hour) return;
  const end=(+e.target.dataset.hour+1)*60;
  dc.box.style.left  = dc.start/1440*100+'%';
  dc.box.style.width = Math.max(STEP,end-dc.start)/1440*100+'%';
};
grid.onmouseup=()=>{
  if(!dc) return;
  const dur=parseFloat(dc.box.style.width)/100*1440;
  openDlg('new',null,{row:dc.row,start:dc.start,end:dc.start+Math.round(dur/STEP)*STEP});
  dc.box.remove(); dc=null;
};

// ---------- dialog ----------------------------------------
const dlg=document.getElementById('shiftDlg');
const f  =document.getElementById('shiftForm');
const roleSel=document.getElementById('roleSel');
const startI =document.getElementById('start');
const endI   =document.getElementById('end');
const notesI =document.getElementById('notes');
const delBtn =document.getElementById('del');

function fillRoles(sel=''){
  roleSel.innerHTML=abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
                   +'<option value="__new__">Other…</option>';
}
roleSel.onchange=()=>{
  if(roleSel.value!=='__new__') return;
  const v=prompt('New ability name'); if(v){abilities.push(v);fillRoles(v);}else roleSel.selectedIndex=0;
};

function openDlg(mode,idx,seed){
  fillRoles();
  if(mode==='edit'){
    const s=shifts[idx];
    f.index.value=idx;
    empIn.value  =s.name;
    roleSel.value=s.role;
    startI.value =fmt(s.start);
    endI.value   =fmt(s.end);
    notesI.value =s.notes||'';
    delBtn.classList.remove('hidden');
  }else{
    f.index.value='';
    empIn.value  =workers[seed.row].Name;
    roleSel.selectedIndex=0;
    startI.value =fmt(seed.start);
    endI.value   =fmt(seed.end);
    notesI.value ='';
    delBtn.classList.add('hidden');
  }
  dlg.showModal();
}

f.onsubmit=async e=>{
  e.preventDefault();
  const name=empIn.value.trim();
  if(!workers.some(w=>w.Name===name)) return alert('unknown employee');
  const s={name,role:roleSel.value,start:toMin(startI.value),end:toMin(endI.value),
           notes:notesI.value.trim(),date:iso(day)};
  if(s.start>=s.end) return alert('end must be after start');
  if(f.index.value==='') shifts.push(s); else{s.id=shifts[f.index.value].id; shifts[f.index.value]=s;}
  await saveShift(s); dlg.close(); draw();
};
delBtn.onclick = async()=>{
  const idx=+f.index.value;
  await deleteShift(shifts[idx].id);
  shifts.splice(idx,1);
  dlg.close(); draw();
};
document.getElementById('cancel').onclick=()=>dlg.close();

// ---------- nav buttons -----------------------------------
document.getElementById('prev').onclick   =()=>{day.setDate(day.getDate()-1);draw();};
document.getElementById('next').onclick   =()=>{day.setDate(day.getDate()+1);draw();};
document.getElementById('todayBtn').onclick=()=>{day=new Date();draw();};

// ───────────── chat widget – GPT-4o assistant ──────────────
async function sendChat(){
  const text = chatInput.value.trim();
  if(!text) return;
  chatBox.appendChild(bubble(text,'user'));
  chatInput.value='';

  try{
    const r=await fetch('/api/chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:text,date:iso(day)})
    });
    if(!r.ok) throw new Error(await r.text());
    const {reply}=await r.json();
    chatBox.appendChild(bubble(reply,'bot'));
    // reload data if the bot said “OK”
    if(reply==='OK'){
      shifts=await fetch('/api/shifts').then(r=>r.json());
      draw();
    }
  }catch(err){
    console.error('/api/chat',err);
    chatBox.appendChild(bubble('⚠ '+err.message,'bot'));
  }
  chatBox.scrollTop=chatBox.scrollHeight;
}
function bubble(txt,who){
  const d=document.createElement('div');
  d.className='bubble '+who; d.textContent=txt; return d;
}
chatSend.onclick          = sendChat;
chatInput.onkeydown = e => { if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(); } };
