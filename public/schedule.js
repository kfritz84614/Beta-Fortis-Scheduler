// public/schedule.js — full working version with string‑based date compare

/* ---------- helpers & palette ------------------------------------ */
const COLORS = {
  Reservations    : '#16a34a',
  Dispatch        : '#b91c1c',
  Security        : '#be185d',
  Network         : '#475569',
  'Journey Desk'  : '#65a30d',
  Marketing       : '#7c3aed',
  Sales           : '#d97706',
  'Badges/Projects': '#0ea5e9'
};

const STEP = 15;                                      // minute snap for drag & resize
const hh   = h => `${String(h).padStart(2,'0')}:00`;
const fmt  = m => `${String(m/60|0).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const toMin = t => {                                  // accepts 0815 or 08:15
  if (!t.includes(':') && t.length === 4) t = t.slice(0,2)+':'+t.slice(2);
  const [h,m] = t.split(':').map(Number);
  return h*60 + m;
};

/* ---------- state & refs ----------------------------------------- */
let workers = [], abilities = [], shifts = [];
let day = location.hash ? new Date(location.hash.slice(1)) : new Date();

const grid  = document.getElementById('grid');
const wrap  = document.getElementById('wrap');
const dateH = document.getElementById('date');
const empIn = document.getElementById('empSel');
const empDl = document.getElementById('workerList');

/* ---------- initial load ----------------------------------------- */
(async () => {
  [workers, abilities, shifts] = await Promise.all([
    fetch('/api/workers').then(r => r.json()),
    fetch('/api/abilities').then(r => r.json()),
    fetch('/api/shifts').then(r => r.json())
  ]);
  empDl.innerHTML = workers.map(w => `<option value="${w.Name}">`).join('');
  draw();
})();

/* ---------- persistence helpers ---------------------------------- */
const saveShift = async s => {
  const { id } = await fetch('/api/shifts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s)
  }).then(r => r.json());
  if (!s.id) s.id = id;
};
const deleteShift = id => fetch(`/api/shifts/${id}`, { method:'DELETE' });

/* ---------- earliest start helper -------------------------------- */
const iso = d => d.toISOString().slice(0,10);
const firstStartToday = name => {
  const s = shifts.filter(x => x.name === name && x.date === iso(day))
                  .sort((a,b) => a.start - b.start)[0];
  return s ? s.start : 1441;
};

/* ---------- draw grid -------------------------------------------- */
function draw() {
  const sorted = [...workers].sort((a,b) => {
    const sa = firstStartToday(a.Name), sb = firstStartToday(b.Name);
    return sa !== sb ? sa - sb : a.Name.localeCompare(b.Name);
  });
  const rowByName = Object.fromEntries(sorted.map((w,i) => [w.Name,i]));

  dateH.textContent = day.toDateString();
  location.hash     = iso(day);

  grid.innerHTML = '';
  grid.style.gridTemplateRows = `30px repeat(${sorted.length},30px)`;
  grid.appendChild(lbl(''));
  for (let h=0; h<24; h++) grid.appendChild(lbl(hh(h),1,h+2));

  sorted.forEach((w,row) => {
    grid.appendChild(lbl(w.Name,row+2,1));
    for (let h=0; h<24; h++)
      grid.appendChild(cell('',`grid-row:${row+2};grid-column:${h+2}`,'cell',{row,hour:h}));
    const band = document.createElement('div');
    band.className = 'band';
    band.style.gridRow = row + 2;
    grid.appendChild(band);
  });

  shifts.filter(s => s.date === iso(day))
        .forEach((s,i) => placeBlock(s,i,rowByName[s.name]));

  wrap.scrollTop = 0;
}
const lbl  = (t,r=1,c=1) => { const d=document.createElement('div'); d.textContent=t; d.className='rowLabel'; d.style=`grid-row:${r};grid-column:${c}`; return d; };
const cell = (t,s,cls='',ds={}) => { const d=document.createElement('div'); d.textContent=t; d.className=cls; d.style=s; Object.assign(d.dataset,ds); return d; };

/* ---------- place one shift block -------------------------------- */
function placeBlock(s,idx,row) {
  const band = grid.querySelectorAll('.band')[row]; if(!band) return;
  const el   = document.createElement('div');
  el.className = 'block';
  el.style.cssText = `left:${s.start/1440*100}%;width:${(s.end-s.start)/1440*100}%;background:${COLORS[s.role]||'#2563eb'}`;
  el.textContent  = `${s.role} ${fmt(s.start)}-${fmt(s.end)}`;
  el.ondblclick   = () => openDlg('edit', idx);

  // resize handles
  ['l','r'].forEach(side => {
    const h = document.createElement('span');
    h.style = `position:absolute;${side==='l'?'left':'right'}:0;top:0;bottom:0;width:6px;cursor:ew-resize`;
    h.onmousedown = e => startResize(e,idx,side);
    el.appendChild(h);
  });

  // drag‑move
  el.onmousedown = e => { if(e.target.tagName==='SPAN') return; startMove(e,idx,row,el); };
  band.appendChild(el);
}

/* ---------- resize logic ---------------------------------------- */
let rs={};
function startResize(e,idx,side){ e.stopPropagation(); rs={idx,side,startX:e.clientX,orig:{...shifts[idx]}}; document.onmousemove=doResize; document.onmouseup=endResize; }
function doResize(e){ if(rs.idx==null) return; const px=grid.querySelector('.band').getBoundingClientRect().width/1440; const diff=Math.round((e.clientX-rs.startX)/px/STEP)*STEP; const s=shifts[rs.idx]; if(rs.side==='l') s.start=Math.max(0,Math.min(s.end-STEP,rs.orig.start+diff)); else s.end=Math.min(1440,Math.max(s.start+STEP,rs.orig.end+diff)); draw(); }
function endResize(){ if(rs.idx!=null) saveShift(shifts[rs.idx]); rs={}; document.onmousemove=document.onmouseup=null; }

/* ---------- move logic ------------------------------------------ */
let mv=null;
function startMove(e,idx,row,orig){ e.preventDefault(); mv={idx,row,startX:e.clientX,startY:e.clientY,moved:false,orig}; document.onmousemove=doMove; document.onmouseup=endMove; }
function doMove(e){ if(!mv) return; if(!mv.moved){ if(Math.abs(e.clientX-mv.startX)<4&&Math.abs(e.clientY-mv.startY)<4) return; mv.moved=true; mv.preview=mv.orig.cloneNode(true); mv.preview.style.opacity=.5; mv.preview.style.pointerEvents='none'; grid.appendChild(mv.preview);} const px=grid.querySelector('.band').getBoundingClientRect().width/1440; const diff=Math.round((e.clientX-mv.startX)/px/STEP)*STEP; const s=shifts[mv.idx]; let st=Math.max(0,Math.min(1440-STEP,s.start+diff)); let en=s.end+diff; if(en>1440){st-=en-1440; en=1440;} mv.preview.style.left=st/1440*100+'%'; mv.preview.style.width=(en-st)/1440*100+'%'; const diffRow=Math.round((e.clientY-mv.startY)/30); const newRow=Math.min(Math.max(0,mv.row+diffRow),workers.length-1); mv.preview.style.gridRow=newRow+2; }
async function endMove(e){ document.onmousemove=document.onmouseup=null; if(!mv) return; if(!mv.moved){ openDlg('edit',mv.idx); mv=null; return; } const px=grid.querySelector('.band').getBoundingClientRect().width/1440; const diff=Math.round((e.clientX-mv.startX)/px/STEP)*STEP; const s=shifts[mv.idx]; s.start=Math.max(0,Math.min(1440-STEP,s.start+diff)); s.end=Math.min(1440,Math.max(s.start+STEP,s.end+diff)); const diffRow=Math.round((e.clientY-mv.startY)/30); const newRow=Math.min(Math.max(0,mv.row+diffRow),workers.length-1); s.name=workers[newRow].Name; mv.preview.remove(); mv=null; await saveShift(s); draw(); }

/* ---------- drag‑create blank area ------------------------------- */
let dc=null;
grid.onmousedown=e=>{ if(!e.target.dataset.hour) return; dc={row:+e.target.dataset.row,start:+e.target.dataset.hour*60,box:Object.assign(document.createElement('div'),{className:'dragBox'})}; grid.querySelectorAll('.band')[dc.row].appendChild(dc.box); };
grid.onmousemove=e=>{ if(!dc||+e.target.dataset.row!==dc.row||!e.target.dataset.hour) return; const end=(+e.target.dataset.hour+
