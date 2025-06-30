/* ---------- helpers & palette ------------------------------------ */
const COLORS = {
  Reservations:'#16a34a',Dispatch:'#b91c1c',Security:'#be185d',
  Network:'#475569','Journey Desk':'#65a30d',Marketing:'#7c3aed',
  Sales:'#d97706','Badges/Projects':'#0ea5e9'
};
const STEP   = 15;                                    // snap (minutes)
const hh     = h => `${String(h).padStart(2,'0')}:00`;
const fmt    = m => `${String(m/60|0).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const toMin  = t => {                                 // accept 0815 or 08:15
  if (!t.includes(':') && t.length === 4) t = t.slice(0,2)+':'+t.slice(2);
  const [h,m] = t.split(':').map(Number);
  return h*60 + m;
};
const sameDay = (a,b)=>a.toDateString()===b.toDateString();

/* ---------- state & DOM refs ------------------------------------- */
let workers=[], abilities=[], blocks=[];
let day = location.hash ? new Date(location.hash.slice(1)) : new Date();

const grid  = document.getElementById('grid'),
      wrap  = document.getElementById('wrap'),
      dateH = document.getElementById('date'),
      empIn = document.getElementById('empSel'),
      empDl = document.getElementById('workerList');

/* ---------- initial fetch ---------------------------------------- */
(async()=>{
  [workers,abilities] = await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json())
  ]);
  empDl.innerHTML = workers.map(w=>`<option value="${w.Name}">`).join('');
  draw();
})();

/* ---------- earliest start helper -------------------------------- */
const firstStartToday = name => {
  const b = blocks.filter(x=>x.name===name&&sameDay(x.date,day))
                  .sort((a,b)=>a.start-b.start)[0];
  return b ? b.start : 1441;            // none = bottom
};

/* ---------- render ------------------------------------------------ */
function draw(){
  const sorted = [...workers].sort((a,b)=>{
    const sa=firstStartToday(a.Name), sb=firstStartToday(b.Name);
    return sa!==sb ? sa-sb : a.Name.localeCompare(b.Name);
  });
  const rowByName = Object.fromEntries(sorted.map((w,i)=>[w.Name,i]));

  dateH.textContent = day.toDateString();
  location.hash     = day.toISOString().slice(0,10);

  grid.innerHTML='';
  grid.style.gridTemplateRows = `30px repeat(${sorted.length},30px)`;

  grid.appendChild(label(''));
  for(let h=0;h<24;h++) grid.appendChild(label(hh(h),1,h+2));

  sorted.forEach((w,row)=>{
    grid.appendChild(label(w.Name,row+2,1));

    for(let h=0;h<24;h++)
      grid.appendChild(cell('',`grid-row:${row+2};grid-column:${h+2}`,'cell',{row,hour:h}));

    const band=document.createElement('div');
    band.className='band';
    band.style.gridRow=row+2;
    grid.appendChild(band);
  });

  blocks.filter(b=>sameDay(b.date,day))
        .forEach((b,i)=>placeBlock(b,i,rowByName[b.name]));

  wrap.scrollTop = 0;
}
const label=(t,r=1,c=1)=>{const d=document.createElement('div');d.textContent=t;d.className='rowLabel';d.style.gridRow=r;d.style.gridColumn=c;return d;};
const cell =(t,s,cls='',ds={})=>{const d=document.createElement('div');d.textContent=t;d.className=cls;d.style=s;Object.assign(d.dataset,ds);return d;};

/* ---------- place a shift block ---------------------------------- */
function placeBlock(b,idx,row){
  const band = grid.querySelectorAll('.band')[row]; if(!band) return;

  const el = document.createElement('div');
  el.className = 'block';
  el.style.cssText =
    `left:${b.start/1440*100}%;width:${(b.end-b.start)/1440*100}%;background:${COLORS[b.role]||'#2563eb'}`;
  el.textContent = `${b.role} ${fmt(b.start)}-${fmt(b.end)}`;
  el.ondblclick  = () => openDlg('edit',idx);

  /* resize handles */
  ['l','r'].forEach(side=>{
    const h=document.createElement('span');
    h.style=`position:absolute;${side==='l'?'left':'right'}:0;top:0;bottom:0;width:6px;cursor:ew-resize`;
    h.onmousedown=e=>startResize(e,idx,side);
    el.appendChild(h);
  });

  /* drag-move start */
  el.onmousedown = e => {
    if(e.target.tagName==='SPAN') return;   // ignore handles
    startMove(e,idx,row);
  };

  band.appendChild(el);
}

/* ---------- edge-resize ------------------------------------------ */
let rs={};
function startResize(e,idx,side){
  e.stopPropagation();
  rs={idx,side,startX:e.clientX,orig:{...blocks[idx]}};
  document.onmousemove=resMove;
  document.onmouseup  =resEnd;
}
function resMove(e){
  if(rs.idx==null) return;
  const pxPerMin = grid.querySelector('.band').getBoundingClientRect().width / 1440;
  const diff = Math.round((e.clientX-rs.startX)/pxPerMin/STEP)*STEP;
  const blk = blocks[rs.idx];
  if(rs.side==='l')
    blk.start = Math.max(0, Math.min(blk.end-STEP, rs.orig.start+diff));
  else
    blk.end   = Math.min(1440, Math.max(blk.start+STEP, rs.orig.end+diff));
  draw();
}
function resEnd(){ rs={}; document.onmousemove=document.onmouseup=null; }

/* ---------- full block drag -------------------------------------- */
let mv=null;
function startMove(e,idx,row){
  e.preventDefault();
  mv={ idx, startX:e.clientX, startY:e.clientY, row, moved:false };

  document.onmousemove = moveDrag;
  document.onmouseup   = endMove;
}

function moveDrag(e){
  if(!mv) return;

  // threshold – treat tiny motion as click
  if(!mv.moved){
    if(Math.abs(e.clientX-mv.startX)<4 && Math.abs(e.clientY-mv.startY)<4) return;
    mv.moved=true;

    // create ghost
    const blkEl = e.currentTarget.cloneNode(true);
    blkEl.style.opacity=.5; blkEl.style.pointerEvents='none';
    mv.preview = blkEl;
    grid.appendChild(blkEl);
  }

  const pxPerMin = grid.querySelector('.band').getBoundingClientRect().width / 1440;
  const diffMin  = Math.round((e.clientX-mv.startX)/pxPerMin/STEP)*STEP;
  const blk      = blocks[mv.idx];
  let start      = Math.max(0, Math.min(1440-STEP, blk.start+diffMin));
  let end        = blk.end + diffMin;
  if(end>1440){ start -= end-1440; end=1440; }

  mv.preview.style.left  = start/1440*100+'%';
  mv.preview.style.width = (end-start)/1440*100+'%';

  const diffRow = Math.round((e.clientY-mv.startY)/30);
  const newRow  = Math.min(Math.max(0, mv.row+diffRow), workers.length-1);
  mv.preview.style.gridRow = newRow+2;
}

function endMove(e){
  document.onmousemove=document.onmouseup=null;

  // click → open dialog
  if(mv && !mv.moved){
    openDlg('edit',mv.idx);
    mv=null; return;
  }

  if(!mv) return;
  const pxPerMin = grid.querySelector('.band').getBoundingClientRect().width / 1440;
  const diffMin  = Math.round((e.clientX-mv.startX)/pxPerMin/STEP)*STEP;
  const blk      = blocks[mv.idx];
  blk.start = Math.max(0, Math.min(1440-STEP, blk.start+diffMin));
  blk.end   = Math.min(1440, Math.max(blk.start+STEP, blk.end+diffMin));

  const diffRow = Math.round((e.clientY-mv.startY)/30);
  const newRow  = Math.min(Math.max(0, mv.row+diffRow), workers.length-1);
  blk.name = workers[newRow].Name;

  mv.preview.remove(); mv=null;
  draw();
}

/* ---------- drag-create ------------------------------------------ */
let dr=null;
grid.onmousedown=e=>{
  if(!e.target.dataset.hour) return;
  dr={ row:+e.target.dataset.row, start:+e.target.dataset.hour*60,
       box:Object.assign(document.createElement('div'),{className:'dragBox'}) };
  grid.querySelectorAll('.band')[dr.row].appendChild(dr.box);
};
grid.onmousemove=e=>{
  if(!dr||+e.target.dataset.row!==dr.row||!e.target.dataset.hour) return;
  const end=(+e.target.dataset.hour+1)*60;
  dr.box.style.left  = dr.start/1440*100+'%';
  dr.box.style.width = Math.max(STEP,end-dr.start)/1440*100+'%';
};
grid.onmouseup=()=>{
  if(!dr) return;
  const dur = parseFloat(dr.box.style.width)/100*1440;
  openDlg('new',null,{row:dr.row,start:dr.start,end:dr.start+Math.round(dur/STEP)*STEP});
  dr.box.remove(); dr=null;
};

/* ---------- dialog ------------------------------------------------ */
const dlg=document.getElementById('shiftDlg'),f=document.getElementById('shiftForm'),
      roleSel=document.getElementById('roleSel'),startI=document.getElementById('start'),
      endI=document.getElementById('end'),notes=document.getElementById('notes'),
      del=document.getElementById('del'),cancel=document.getElementById('cancel');

function fillRoles(sel=''){
  roleSel.innerHTML = abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
                   + '<option value="__new__">Other…</option>';
}
roleSel.onchange=()=>{
  if(roleSel.value!=='__new__')return;
  const v=prompt('New ability:');
  if(v){ abilities.push(v); fillRoles(v); } else roleSel.selectedIndex=0;
};

function openDlg(mode,idx,preset){
  fillRoles();
  if(mode==='edit'){
    const b=blocks[idx];
    f.index.value=idx;
    empIn.value  = b.name;
    roleSel.value= b.role;
    startI.value = fmt(b.start);
    endI.value   = fmt(b.end);
    notes.value  = b.notes||'';
    del.classList.remove('hidden');
  }else{
    f.index.value='';
    f.dataset.row=preset.row;
    empIn.value  = workers[preset.row].Name;
    roleSel.selectedIndex=0;
    startI.value = fmt(preset.start);
    endI.value   = fmt(preset.end);
    notes.value  = '';
    del.classList.add('hidden');
  }
  dlg.showModal();
}

f.onsubmit=e=>{
  e.preventDefault();
  const name=empIn.value.trim();
  if(!workers.some(w=>w.Name===name)) return alert('Employee not found');
  const b={name,role:roleSel.value,start:toMin(startI.value),end:toMin(endI.value),
           notes:notes.value.trim(),date:new Date(day)};
  if(b.start>=b.end) return alert('End must be after start');
  if(f.index.value==='') blocks.push(b); else Object.assign(blocks[+f.index.value],b);
  dlg.close(); draw();
};
del.onclick   =()=>{blocks.splice(+f.index.value,1); dlg.close(); draw();};
cancel.onclick=()=>dlg.close();

/* ---------- navigation ------------------------------------------- */
document.getElementById('prev')   .onclick = ()=>{ day.setDate(day.getDate()-1); draw(); };
document.getElementById('next')   .onclick = ()=>{ day.setDate(day.getDate()+1); draw(); };
document.getElementById('todayBtn').onclick = ()=>{ day = new Date(); draw(); };
