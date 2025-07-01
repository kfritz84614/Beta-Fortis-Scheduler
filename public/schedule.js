/*  public/schedule.js  ───────────────────────────────────────────
    Single-day Gantt with create / move / resize / delete.
    ‣ Re-added the missing “new” branch in openDlg()
    ‣ Added dlg.showModal() so the dialog actually opens
    ‣ Keeps Lunch colour + nav buttons + all existing logic        */
/* ---------- helpers & palette --------------------------------- */
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

const STEP = 15;
const hh   = h => `${String(h).padStart(2,'0')}:00`;
const fmt  = m => `${String(m/60|0).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const toMin = t => {                        // 0815 | 08:15 → minutes
  if (!t.includes(':') && t.length === 4) t = t.slice(0,2)+':'+t.slice(2);
  const [h,m] = t.split(':').map(Number);
  return h*60 + m;
};
const iso = d => d.toISOString().slice(0,10);

/* ---------- state --------------------------------------------- */
let workers=[], abilities=[], shifts=[];
let day = location.hash ? new Date(location.hash.slice(1)) : new Date();

/* ---------- DOM ------------------------------------------------ */
const grid  = document.getElementById('grid');
const wrap  = document.getElementById('wrap');
const dateH = document.getElementById('date');
const empIn = document.getElementById('empSel');
const empDl = document.getElementById('workerList');

/* ---------- initial load -------------------------------------- */
(async ()=>{
  [workers,abilities,shifts] = await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json()),
    fetch('/api/shifts').then(r=>r.json())
  ]);
  if (!abilities.includes('Lunch')) abilities.push('Lunch');
  empDl.innerHTML = workers.map(w=>`<option value="${w.Name}">`).join('');
  draw();
})();

/* ---------- persistence helpers ------------------------------- */
const saveShift = async s=>{
  const {id}=await fetch('/api/shifts',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(s)
  }).then(r=>r.json());
  if(!s.id) s.id=id;
};
const deleteShift = id => fetch(`/api/shifts/${id}`,{method:'DELETE'});

/* ---------- misc helpers -------------------------------------- */
const firstStart = name=>{
  const x = shifts.filter(s=>s.name===name && s.date===iso(day))
                  .sort((a,b)=>a.start-b.start)[0];
  return x?x.start:1441;
};
const label = (t,r=1,c=1)=>{
  const d=document.createElement('div');
  d.className='rowLabel'; d.textContent=t;
  d.style=`grid-row:${r};grid-column:${c}`; return d;
};
const cell = (r,c,ds={})=>{
  const d=document.createElement('div');
  d.className='cell'; d.style=`grid-row:${r};grid-column:${c}`;
  Object.assign(d.dataset,ds); return d;
};

/* ---------- draw ---------------------------------------------- */
function draw(){
  const sorted=[...workers].sort((a,b)=>{
    const sa=firstStart(a.Name), sb=firstStart(b.Name);
    return sa!==sb?sa-sb:a.Name.localeCompare(b.Name);
  });
  const rowOf=Object.fromEntries(sorted.map((w,i)=>[w.Name,i]));

  grid.innerHTML='';
  grid.style.gridTemplateRows = `30px repeat(${sorted.length},30px)`;
  grid.appendChild(label(''));
  for(let h=0;h<24;h++) grid.appendChild(label(hh(h),1,h+2));

  sorted.forEach((w,r)=>{
    grid.appendChild(label(w.Name,r+2,1));
    for(let h=0;h<24;h++) grid.appendChild(cell(r+2,h+2,{row:r,hour:h}));
    const band=document.createElement('div');
    band.className='band'; band.style.gridRow=r+2; grid.appendChild(band);
  });

  shifts.filter(s=>s.date===iso(day))
        .forEach((s,i)=>placeBlock(s,i,rowOf[s.name]));

  dateH.textContent = day.toDateString();
  location.hash = iso(day);
}

/* ---------- add one block ------------------------------------- */
function placeBlock(s,idx,row){
  const band=grid.querySelectorAll('.band')[row]; if(!band) return;
  const el=document.createElement('div');
  el.className='block';
  el.style.cssText=
    `left:${s.start/1440*100}%;width:${(s.end-s.start)/1440*100}%;
     background:${COLORS[s.role]||'#2563eb'}`;
  el.textContent=`${s.role} ${fmt(s.start)}-${fmt(s.end)}`;
  el.ondblclick = ()=>openDlg('edit',idx);

  ['l','r'].forEach(side=>{
    const h=document.createElement('span');
    h.style=`position:absolute;${side==='l'?'left':'right'}:0;top:0;bottom:0;
             width:6px;cursor:ew-resize`;
    h.onmousedown=e=>startResize(e,idx,side);
    el.appendChild(h);
  });
  el.onmousedown=e=>{
    if(e.target.tagName==='SPAN') return;
    startMove(e,idx,row,el);
  };
  band.appendChild(el);
}

/* ---------- resize / move / drag-create code (unchanged) ------ */
/*  … keep your existing startResize / doResize / endResize,
    startMove / doMove / endMove and dc-drag sections …          */

/* ---------- dialog -------------------------------------------- */
const dlg     = document.getElementById('shiftDlg');
const f       = document.getElementById('shiftForm');
const roleSel = document.getElementById('roleSel');
const startI  = document.getElementById('start');
const endI    = document.getElementById('end');
const notesI  = document.getElementById('notes');
const delBtn  = document.getElementById('del');

function fillRoles(sel=''){
  roleSel.innerHTML = abilities
    .map(a=>`<option ${a===sel?'selected':''}>${a}</option>`)
    .join('') + '<option value="__new__">Other…</option>';
}
roleSel.onchange = ()=>{
  if(roleSel.value!=='__new__') return;
  const v = prompt('New ability name');
  if(v){ abilities.push(v); fillRoles(v); }
  else  roleSel.selectedIndex = 0;
};

function openDlg(mode, idx, seed){
  fillRoles();
  if(mode==='edit'){
    const s = shifts[idx];
    f.index.value = idx;
    empIn.value   = s.name;
    roleSel.value = s.role;
    startI.value  = fmt(s.start);
    endI.value    = fmt(s.end);
    notesI.value  = s.notes || '';
    delBtn.classList.remove('hidden');
  }else{                              // NEW branch was truncated before
    f.index.value = '';
    empIn.value   = workers[seed.row].Name;
    roleSel.selectedIndex = 0;
    startI.value  = fmt(seed.start);
    endI.value    = fmt(seed.end);
    notesI.value  = '';
    delBtn.classList.add('hidden');
  }
  dlg.showModal();                    // makes the dialog appear
}

/* ---------- submit / delete / cancel (unchanged) -------------- */
/*  … keep your existing f.onsubmit, delBtn.onclick, cancel …     */

/* ---------- navigation ---------------------------------------- */
prev.onclick     = ()=>{ day.setDate(day.getDate()-1); draw(); };
next.onclick     = ()=>{ day.setDate(day.getDate()+1); draw(); };
todayBtn.onclick = ()=>{ day = new Date(); draw(); };
