/* ---------- helpers & palette ------------------------------------ */
const COLORS = {
  Reservations:'#16a34a',Dispatch:'#b91c1c',Security:'#be185d',
  Network:'#475569','Journey Desk':'#65a30d',Marketing:'#7c3aed',
  Sales:'#d97706','Badges/Projects':'#0ea5e9'
};
const STEP  = 15;
const hh    = h => `${String(h).padStart(2,'0')}:00`;
const fmt   = m => `${String(m/60|0).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const toMin = t => { if(!t.includes(':')&&t.length===4) t=t.slice(0,2)+':'+t.slice(2); const [h,m]=t.split(':').map(Number); return h*60+m; };
const sameDay=(a,b)=>a.toDateString()===b.toDateString();

/* ---------- state & DOM refs ------------------------------------- */
let workers=[], abilities=[], blocks=[];
let day = location.hash ? new Date(location.hash.slice(1)) : new Date();

const grid  = document.getElementById('grid');
const wrap  = document.getElementById('wrap');
const dateH = document.getElementById('date');

/* ---------- load initial data ------------------------------------ */
(async()=>{
  [workers,abilities] = await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json())
  ]);
  draw();
})();

/* ---------- UTILITY: earliest start for a worker today ----------- */
function firstStartToday(name){
  const blk = blocks
    .filter(b=>b.name===name && sameDay(b.date,day))
    .sort((a,b)=>a.start-b.start)[0];
  return blk ? blk.start : 24*60+1;                  // no shift → sent to bottom
}

/* ---------- render ------------------------------------------------ */
function draw(){
  // 1) sort workers by earliest start then name
  const workersSorted = [...workers].sort((a,b)=>{
    const sa=firstStartToday(a.Name), sb=firstStartToday(b.Name);
    return sa!==sb ? sa-sb : a.Name.localeCompare(b.Name);
  });

  // helpful map for quick row lookup when placing blocks
  const rowByName = Object.fromEntries(workersSorted.map((w,i)=>[w.Name,i]));

  dateH.textContent = day.toDateString();
  location.hash     = day.toISOString().slice(0,10);

  /* -------- build grid skeleton --------------------------------- */
  grid.innerHTML='';
  grid.style.gridTemplateRows = `30px repeat(${workersSorted.length},30px)`;

  grid.appendChild(label(''));
  for(let h=0;h<24;h++) grid.appendChild(label(hh(h),1,h+2));

  workersSorted.forEach((w,row)=>{
    grid.appendChild(label(w.Name,row+2,1));

    for(let h=0;h<24;h++)
      grid.appendChild(cell('',`grid-row:${row+2};grid-column:${h+2}`,'cell',{row,hour:h}));

    const band=document.createElement('div');
    band.className='band';
    band.style.gridRow=row+2;
    grid.appendChild(band);
  });

  /* -------- place blocks ---------------------------------------- */
  blocks.filter(b=>sameDay(b.date,day)).forEach((b,idx)=>{
    placeBlock(b,idx,rowByName[b.name]);
  });

  wrap.scrollTop = 0;
}

/* ---------- small helpers ---------------------------------------- */
function label(txt,row=1,col=1){
  const d=document.createElement('div');
  d.textContent=txt; d.className='rowLabel';
  d.style.gridRow=row; d.style.gridColumn=col;
  return d;
}
function cell(t,sty,cls='',ds={}){
  const d=document.createElement('div');
  d.textContent=t; d.className=cls; d.style=sty;
  Object.assign(d.dataset,ds); return d;
}

/* ---------- place a single block (+resize handles) --------------- */
function placeBlock(b,idx,row){
  const bands = grid.querySelectorAll('.band');
  if(row===undefined||row>=bands.length) return;     // safety
  const band = bands[row];

  const left  = b.start/1440*100;
  const width = (b.end-b.start)/1440*100;

  const el=document.createElement('div');
  el.className='block';
  el.style.cssText=`left:${left}%;width:${width}%;background:${COLORS[b.role]||'#2563eb'}`;
  el.textContent=`${b.role} ${fmt(b.start)}-${fmt(b.end)}`;
  band.appendChild(el);

  ['l','r'].forEach(side=>{
    const h=document.createElement('span');
    h.style=`position:absolute;${side==='l'?'left':'right'}:0;top:0;bottom:0;width:6px;cursor:ew-resize`;
    h.onmousedown=e=>startResize(e,idx,side);
    el.appendChild(h);
  });
  el.ondblclick=()=>openDlg('edit',idx);
}

/* ---------- resize ------------------------------------------------ */
let res={};
function startResize(e,idx,side){
  e.stopPropagation();
  res={idx,side,startX:e.clientX,orig:{...blocks[idx]},row:workers.findIndex(w=>w.Name===blocks[idx].name)};
  document.onmousemove=onRes; document.onmouseup=endRes;
}
function onRes(e){
  if(res.idx===undefined)return;
  const band=grid.querySelectorAll('.band')[res.row];
  const pxPerMin=band.getBoundingClientRect().width/1440;
  const diff=Math.round((e.clientX-res.startX)/pxPerMin/STEP)*STEP;
  const blk=blocks[res.idx];
  if(res.side==='l') blk.start=Math.max(0,Math.min(blk.end-STEP,res.orig.start+diff));
  else blk.end=Math.min(1440,Math.max(blk.start+STEP,res.orig.end+diff));
  draw();
}
function endRes(){res={};document.onmousemove=null;document.onmouseup=null;}

/* ---------- drag-create ------------------------------------------ */
let drag=null;
grid.onmousedown=e=>{
  if(!e.target.dataset.hour)return;
  drag={row:+e.target.dataset.row,start:+e.target.dataset.hour*60,
        box:document.createElement('div')};
  drag.box.className='dragBox';
  grid.querySelectorAll('.band')[drag.row].appendChild(drag.box);
};
grid.onmousemove=e=>{
  if(!drag||+e.target.dataset.row!==drag.row||!e.target.dataset.hour)return;
  const end=(+e.target.dataset.hour+1)*60;
  drag.box.style.left = drag.start/1440*100+'%';
  drag.box.style.width= Math.max(STEP,end-drag.start)/1440*100+'%';
};
grid.onmouseup=()=>{
  if(!drag)return;
  const dur=parseFloat(drag.box.style.width)/100*1440;
  openDlg('new',null,{row:drag.row,start:drag.start,end:drag.start+Math.round(dur/STEP)*STEP});
  drag.box.remove(); drag=null;
};

/* ---------- dialog ------------------------------------------------ */
const dlg=document.getElementById('shiftDlg'),f=document.getElementById('shiftForm'),
      roleSel=document.getElementById('roleSel'),start=document.getElementById('start'),
      end=document.getElementById('end'),notes=document.getElementById('notes'),
      del=document.getElementById('del'),cancel=document.getElementById('cancel');

function fillRoles(sel=''){
  roleSel.innerHTML=abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
                   +'<option value="__new__">Other…</option>';
}
roleSel.onchange=()=>{
  if(roleSel.value!=='__new__')return;
  const v=prompt('New ability:'); if(v){abilities.push(v);fillRoles(v);} else roleSel.selectedIndex=0;
};

function openDlg(mode,idx,preset){
  fillRoles();
  if(mode==='edit'){
    const b=blocks[idx]; f.index.value=idx; roleSel.value=b.role;
    start.value=fmt(b.start); end.value=fmt(b.end);
    notes.value=b.notes||''; del.classList.remove('hidden');
  }else{
    f.index.value=''; f.dataset.row=preset.row; roleSel.selectedIndex=0;
    start.value=fmt(preset.start); end.value=fmt(preset.end);
    notes.value=''; del.classList.add('hidden');
  }
  dlg.showModal();
}
f.onsubmit=e=>{
  e.preventDefault();
  const b={role:roleSel.value,start:toMin(start.value),end:toMin(end.value),notes:notes.value.trim()};
  if(b.start>=b.end)return alert('End must be after start');
  if(f.index.value===''){
    blocks.push({...b,name:workers[+f.dataset.row].Name,date:new Date(day)});
  }else Object.assign(blocks[+f.index.value],b);
  dlg.close(); draw();
};
del.onclick   =()=>{blocks.splice(+f.index.value,1);dlg.close();draw();};
cancel.onclick=()=>dlg.close();

/* ---------- nav buttons ------------------------------------------ */
document.getElementById('prev').onclick   = () => { day.setDate(day.getDate()-1); draw(); };
document.getElementById('next').onclick   = () => { day.setDate(day.getDate()+1); draw(); };
document.getElementById('todayBtn').onclick = () => { day = new Date(); draw(); };
