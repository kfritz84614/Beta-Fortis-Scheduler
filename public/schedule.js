//  public/schedule.js  (bot + grid + dialog)

/* ---------- helpers & palette -------------------------------- */
const COLORS = {
  Reservations     : '#16a34a',
  Dispatch         : '#b91c1c',
  Security         : '#be185d',
  Network          : '#475569',
  'Journey Desk'   : '#65a30d',
  Marketing        : '#7c3aed',
  Sales            : '#d97706',
  'Badges/Projects': '#0ea5e9',
  Lunch            : '#8b5a2b'
};

const STEP = 15, hh=h=>`${String(h).padStart(2,'0')}:00`;
const fmt  = m => `${String(m/60|0).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const toMin=t=>{ if(!t.includes(':')&&t.length===4)t=t.slice(0,2)+':'+t.slice(2);
                 const[a,b]=t.split(':').map(Number); return a*60+b; };
const iso  = d=>d.toISOString().slice(0,10);

/* ---------- state & refs ------------------------------------- */
let workers=[],abilities=[],shifts=[],day=location.hash?new Date(location.hash.slice(1)):new Date();

const grid=document.getElementById('grid'),wrap=document.getElementById('wrap'),
      dateH=document.getElementById('date'),empIn=document.getElementById('empSel'),
      empDl=document.getElementById('workerList');

/* ---------- load -------------------------------------------- */
(async()=>{
  [workers,abilities,shifts]=await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json()),
    fetch('/api/shifts').then(r=>r.json())
  ]);
  if(!abilities.includes('Lunch'))abilities.push('Lunch');
  empDl.innerHTML=workers.map(w=>`<option value="${w.Name}">`).join('');
  draw(); initChat();
})();

/* ---------- persistence helpers ------------------------------ */
const saveShift=async s=>{
  const {id}=await fetch('/api/shifts',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)
  }).then(r=>r.json());
  if(!s.id)s.id=id;
};
const deleteShift=id=>fetch(`/api/shifts/${id}`,{method:'DELETE'});

/* ---------- draw grid ---------------------------------------- */
function firstStart(n){const f=shifts.filter(s=>s.name===n&&s.date===iso(day))
                                   .sort((a,b)=>a.start-b.start)[0];return f?f.start:1441;}

function draw(){
  const sorted=[...workers].sort((a,b)=>{const sa=firstStart(a.Name),sb=firstStart(b.Name);
    return sa!==sb?sa-sb:a.Name.localeCompare(b.Name);});
  const rowOf=Object.fromEntries(sorted.map((w,i)=>[w.Name,i]));

  grid.innerHTML='';
  grid.style.gridTemplateRows=`30px repeat(${sorted.length},30px)`;
  grid.appendChild(lbl(''));
  for(let h=0;h<24;h++)grid.appendChild(lbl(hh(h),1,h+2));
  sorted.forEach((w,r)=>{
    grid.appendChild(lbl(w.Name,r+2,1));
    for(let h=0;h<24;h++)grid.appendChild(cell(r+2,h+2,{row:r,hour:h}));
    const b=document.createElement('div');b.className='band';b.style.gridRow=r+2;grid.appendChild(b);
  });

  shifts.filter(s=>s.date===iso(day)).forEach((s,i)=>placeBlock(s,i,rowOf[s.name]));
  dateH.textContent=day.toDateString(); location.hash=iso(day);
}

const lbl=(t,r=1,c=1)=>{const d=document.createElement('div');d.className='rowLabel';
                        d.textContent=t;d.style=`grid-row:${r};grid-column:${c}`;return d;};
const cell=(r,c,ds={})=>{const d=document.createElement('div');d.className='cell';
                         d.style=`grid-row:${r};grid-column:${c}`;Object.assign(d.dataset,ds);return d;};

/* ---------- place block -------------------------------------- */
function placeBlock(s,idx,row){
  const band=grid.querySelectorAll('.band')[row];if(!band)return;
  const el=document.createElement('div');
  el.className='block';
  el.style.cssText=`left:${s.start/1440*100}%;width:${(s.end-s.start)/1440*100}%`
                 +`;background:${COLORS[s.role]||'#2563eb'}`;
  el.textContent=`${s.role} ${fmt(s.start)}-${fmt(s.end)}`;
  el.ondblclick=()=>openDlg('edit',idx);

  ['l','r'].forEach(side=>{
    const h=document.createElement('span');
    h.style=`position:absolute;${side==='l'?'left':'right'}:0;top:0;bottom:0;width:6px;cursor:ew-resize`;
    h.onmousedown=e=>startResize(e,idx,side);
    el.appendChild(h);
  });
  el.onmousedown=e=>{if(e.target.tagName==='SPAN')return;startMove(e,idx,row,el);};
  band.appendChild(el);
}

/* ---------- resize ------------------------------------------- */
let rs={};
function startResize(e,idx,side){e.stopPropagation();rs={idx,side,startX:e.clientX,orig:{...shifts[idx]}};
  document.onmousemove=doResize;document.onmouseup=endResize;}
function doResize(e){if(rs.idx==null)return;const px=grid.querySelector('.band').getBoundingClientRect().width/1440;
  const diff=Math.round((e.clientX-rs.startX)/px/STEP)*STEP;const s=shifts[rs.idx];
  if(rs.side==='l')s.start=Math.max(0,Math.min(s.end-STEP,rs.orig.start+diff));
  else s.end=Math.min(1440,Math.max(s.start+STEP,rs.orig.end+diff));draw();}
function endResize(){if(rs.idx!=null)saveShift(shifts[rs.idx]);rs={};document.onmousemove=document.onmouseup=null;}

/* ---------- move --------------------------------------------- */
let mv=null;
function startMove(e,idx,row,orig){e.preventDefault();mv={idx,row,startX:e.clientX,startY:e.clientY,moved:false,orig};
  document.onmousemove=doMove;document.onmouseup=endMove;}
function doMove(e){if(!mv)return;if(!mv.moved){if(Math.abs(e.clientX-mv.startX)<4&&Math.abs(e.clientY-mv.startY)<4)return;
  mv.moved=true;mv.preview=mv.orig.cloneNode(true);mv.preview.style.opacity=.5;
  mv.preview.style.pointerEvents='none';grid.appendChild(mv.preview);}
  const px=grid.querySelector('.band').getBoundingClientRect().width/1440;
  const diff=Math.round((e.clientX-mv.startX)/px/STEP)*STEP;const s=shifts[mv.idx];
  let st=Math.max(0,Math.min(1440-STEP,s.start+diff));let en=s.end+diff;if(en>1440){st-=en-1440;en=1440;}
  mv.preview.style.left=st/1440*100+'%';mv.preview.style.width=(en-st)/1440*100+'%';
  const diffRow=Math.round((e.clientY-mv.startY)/30);const newRow=Math.min(Math.max(0,mv.row+diffRow),workers.length-1);
  mv.preview.style.gridRow=newRow+2;}
async function endMove(){document.onmousemove=document.onmouseup=null;if(!mv)return;
  if(!mv.moved){openDlg('edit',mv.idx);mv=null;return;}
  const px=grid.querySelector('.band').getBoundingClientRect().width/1440;
  const diff=Math.round((event.clientX-mv.startX)/px/STEP)*STEP;const s=shifts[mv.idx];
  s.start=Math.max(0,Math.min(1440-STEP,s.start+diff));
  s.end=Math.min(1440,Math.max(s.start+STEP,s.end+diff));
  const diffRow=Math.round((event.clientY-mv.startY)/30);
  s.name=workers[Math.min(Math.max(0,mv.row+diffRow),workers.length-1)].Name;
  mv.preview.remove();mv=null;await saveShift(s);draw();}

/* ---------- drag-create -------------------------------------- */
let dc=null;
grid.onmousedown=e=>{
  if(!e.target.dataset.hour)return;
  dc={row:+e.target.dataset.row,start:+e.target.dataset.hour*60,
      box:Object.assign(document.createElement('div'),{className:'dragBox'})};
  grid.querySelectorAll('.band')[dc.row].appendChild(dc.box);};
grid.onmousemove=e=>{
  if(!dc||+e.target.dataset.row!==dc.row||!e.target.dataset.hour)return;
  const end=(+e.target.dataset.hour+1)*60;
  dc.box.style.left=dc.start/1440*100+'%';
  dc.box.style.width=Math.max(STEP,end-dc.start)/1440*100+'%';};
grid.onmouseup=()=>{
  if(!dc)return;
  const dur=parseFloat(dc.box.style.width)/100*1440;
  openDlg('new',null,{row:dc.row,start:dc.start,end:dc.start+Math.round(dur/STEP)*STEP});
  dc.box.remove();dc=null;};

/* ---------- dialog ------------------------------------------- */
const dlg=document.getElementById('shiftDlg'),f=document.getElementById('shiftForm'),
      roleSel=document.getElementById('roleSel'),startI=document.getElementById('start'),
      endI=document.getElementById('end'),notesI=document.getElementById('notes'),
      delBtn=document.getElementById('del');

function fillRoles(sel=''){roleSel.innerHTML=abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
  +'<option value="__new__">Other…</option>'; }
roleSel.onchange=()=>{if(roleSel.value!=='__new__')return;
  const v=prompt('New ability');if(v){abilities.push(v);fillRoles(v);}else roleSel.selectedIndex=0;};

function openDlg(mode,idx,p){
  fillRoles();
  if(mode==='edit'){
    const s=shifts[idx];f.index.value=idx;empIn.value=s.name;roleSel.value=s.role;
    startI.value=fmt(s.start);endI.value=fmt(s.end);notesI.value=s.notes||'';
    delBtn.classList.remove('hidden');
  }else{
    f.index.value='';empIn.value=workers[p.row].Name;roleSel.selectedIndex=0;
    startI.value=fmt(p.start);endI.value=fmt(p.end);notesI.value='';
    delBtn.classList.add('hidden');
  }
  dlg.showModal();
}

f.onsubmit=async e=>{
  e.preventDefault();
  const name=empIn.value.trim();
  if(!workers.some(w=>w.Name===name))return alert('Unknown employee');
  const s={name,role:roleSel.value,start:toMin(startI.value),end:toMin(endI.value),
           notes:notesI.value.trim(),date:iso(day)};
  if(s.start>=s.end)return alert('End must be after start');
  if(f.index.value==='')shifts.push(s);else{s.id=shifts[+f.index.value].id;shifts[+f.index.value]=s;}
  await saveShift(s);dlg.close();draw();
};
delBtn.onclick=async()=>{const i=+f.index.value;await deleteShift(shifts[i].id);shifts.splice(i,1);dlg.close();draw();};
document.getElementById('cancel').onclick=()=>dlg.close();

/* ---------- navigation --------------------------------------- */
document.getElementById('prev').onclick=()=>{day.setDate(day.getDate()-1);draw();};
document.getElementById('next').onclick=()=>{day.setDate(day.getDate()+1);draw();};
document.getElementById('todayBtn').onclick=()=>{day=new Date();draw();};

/* ---------- chat widget -------------------------------------- */
function initChat(){
  const box=document.getElementById('chatBox');
  box.innerHTML=`<div class="bg-white shadow rounded flex flex-col h-72">
    <div class="px-3 py-1 font-semibold border-b">SydPo Bot</div>
    <div id="chatLog" class="flex-1 overflow-y-auto space-y-1 p-2 text-sm"></div>
    <div class="border-t p-2 flex gap-2">
      <input id="chatInput" class="flex-1 border rounded px-2 py-1 text-sm" placeholder="Ask me to add PTO…">
      <button id="chatSend" class="text-blue-600 text-xl leading-none">&#x27A4;</button>
    </div></div>`;

  const log=box.querySelector('#chatLog'),input=box.querySelector('#chatInput');
  const add=(t,cls)=>{const p=document.createElement('div');p.className=cls==='user'?'text-right':'';
                      p.innerHTML=`<span class="inline-block px-2 py-1 rounded ${cls==='user'?'bg-blue-200':'bg-gray-200'}`+
                                  `">${t}</span>`;log.appendChild(p);log.scrollTop=1e9;}

  async function sendChat(msg){
    add(msg,'user');input.value='';
    const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:msg})}).then(r=>r.json()).catch(()=>({reply:'[error]'}));
    add(res.reply||'[no reply]','bot');

    /* reload shifts if bot says OK -------------------------------- */
    if((res.reply||'').trim().toUpperCase()==='OK'){
      try{shifts=await fetch('/api/shifts').then(r=>r.json());draw();}
      catch(e){console.error('reload failed',e);}
    }
  }
  box.querySelector('#chatSend').onclick=()=>{if(input.value.trim())sendChat(input.value.trim());};
  input.onkeydown=e=>e.key==='Enter'&&box.querySelector('#chatSend').click();
}
