/* ---------- helpers & palette ------------------------------------ */
const COLORS = {
  Reservations     : '#16a34a',
  Dispatch         : '#b91c1c',
  Security         : '#be185d',
  Network          : '#475569',      // ← added “#”
  'Journey Desk'   : '#65a30d',      // ← added “#”
  Marketing        : '#7c3aed',
  Sales            : '#d97706',
  'Badges/Projects': '#0ea5e9'
};

const hh   = h => `${String(h).padStart(2,'0')}:00`;
const toMin= t => +t.split(':')[0]*60 + (+t.split(':')[1]||0);
const fmt  = m => `${String(m/60|0).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const sameDay=(a,b)=>a.toDateString()===b.toDateString();

/* ---------- state ------------------------------------------------- */
let workers=[], abilities=[], blocks=[];
let day = location.hash ? new Date(location.hash.slice(1)) : new Date();

const grid  = document.getElementById('grid');
const wrap  = document.getElementById('wrap');
const dateH = document.getElementById('date');

/* ---------- fetch data & draw ------------------------------------ */
(async()=>{
  [workers,abilities] = await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json())
  ]);
  draw();
})();

/* ---------- draw the grid ---------------------------------------- */
function draw(){
  dateH.textContent = day.toDateString();
  location.hash     = day.toISOString().slice(0,10);

  grid.innerHTML    = '';
  grid.style.gridTemplateRows = `30px repeat(${workers.length},30px)`;

  // header
  grid.appendChild(header(''));
  for(let h=0;h<24;h++) grid.appendChild(header(hh(h), 1, h+2));

  // rows
  workers.forEach((w,row)=>{
    grid.appendChild(header(w.Name, row+2, 1));          // names at col-1

    // hour cells
    for(let h=0;h<24;h++)
      grid.appendChild(cell('',`grid-row:${row+2};grid-column:${h+2}`,'cell',{row,hour:h}));

    // overlay band
    const band = document.createElement('div');
    band.className='band';
    band.style.gridRow = row+2;
    grid.appendChild(band);
  });

  // blocks
  blocks.filter(b=>sameDay(b.date,day)).forEach((b,i)=>placeBlock(b,i));
  wrap.scrollTop = 0;
}

function header(txt,row=1,col=1){
  const d=document.createElement('div');
  d.textContent=txt;
  d.className='rowLabel';
  d.style.gridRow    = row;
  d.style.gridColumn = col;
  return d;
}
function cell(text,style,cls='',ds={}){
  const d=document.createElement('div');
  d.textContent=text;
  d.className = cls;
  d.style     = style;
  Object.assign(d.dataset,ds);
  return d;
}

/* ---------- shift blocks ----------------------------------------- */
function placeBlock(b,idx){
  const row = workers.findIndex(w=>w.Name===b.name); if(row<0) return;
  const band = grid.querySelectorAll('.band')[row];

  const leftPct = b.start / 1440 * 100;
  const widPct  = (b.end - b.start) / 1440 * 100;

  const el = document.createElement('div');
  el.className = 'block';
  el.style.cssText = `left:${leftPct}%;width:${widPct}%;background:${COLORS[b.role]||'#2563eb'}`;
  el.textContent   = `${b.role} ${fmt(b.start)}-${fmt(b.end)}`;
  el.ondblclick    = () => openDlg('edit', idx);
  band.appendChild(el);
}

/* ---------- drag-add --------------------------------------------- */
let drag=null;
grid.onmousedown=e=>{
  if(!e.target.dataset.hour) return;
  drag={row:+e.target.dataset.row,start:+e.target.dataset.hour*60,
        box:document.createElement('div')};
  drag.box.className='dragBox';
  grid.querySelectorAll('.band')[drag.row].appendChild(drag.box);
};
grid.onmousemove=e=>{
  if(!drag||+e.target.dataset.row!==drag.row||!e.target.dataset.hour) return;
  const end=(+e.target.dataset.hour+1)*60;
  drag.box.style.left  = drag.start/1440*100+'%';
  drag.box.style.width = Math.max(60,end-drag.start)/1440*100+'%';
};
grid.onmouseup=()=>{
  if(!drag) return;
  const dur = parseFloat(drag.box.style.width)/100*1440;
  openDlg('new', null, {row:drag.row, start:drag.start, end:drag.start+Math.round(dur)});
  drag.box.remove(); drag=null;
};

/* ---------- dialog ----------------------------------------------- */
const dlg=document.getElementById('shiftDlg'),f=document.getElementById('shiftForm'),
      roleSel=document.getElementById('roleSel'),start=document.getElementById('start'),
      end=document.getElementById('end'),notes=document.getElementById('notes'),
      del=document.getElementById('del'),cancel=document.getElementById('cancel');

roleSel.onchange = ()=>{
  if(roleSel.value!=='__new__') return;
  const v=prompt('New ability:'); if(v){abilities.push(v);fillRoles(v);} else roleSel.selectedIndex=0;
};
function fillRoles(sel=''){
  roleSel.innerHTML = abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
                   + '<option value="__new__">Other…</option>';
}
function openDlg(mode,idx,preset){
  fillRoles();
  if(mode==='edit'){
    const b=blocks[idx];
    f.index.value=idx;
    roleSel.value=b.role;
    start.value=fmt(b.start); end.value=fmt(b.end);
    notes.value=b.notes||''; del.classList.remove('hidden');
  }else{
    f.index.value=''; f.dataset.row=preset.row;
    roleSel.selectedIndex=0;
    start.value=fmt(preset.start); end.value=fmt(preset.end);
    notes.value=''; del.classList.add('hidden');
  }
  dlg.showModal();
}
f.onsubmit=e=>{
  e.preventDefault();
  const b={role:roleSel.value,start:toMin(start.value),end:toMin(end.value),notes:notes.value.trim()};
  if(b.start>=b.end) return alert('End after start');
  if(f.index.value===''){
    blocks.push({...b,name:workers[+f.dataset.row].Name,date:new Date(day)});
  }else Object.assign(blocks[+f.index.value],b);
  dlg.close(); draw();
};
del.onclick   = ()=>{blocks.splice(+f.index.value,1);dlg.close();draw();};
cancel.onclick= ()=>dlg.close();

/* ---------- day navigation --------------------------------------- */
document.getElementById('prev').onclick = ()=>{day.setDate(day.getDate()-1); draw();};
document.getElementById('next').onclick = ()=>{day.setDate(day.getDate()+1); draw();};
function toMin(t){return +t.split(':')[0]*60 + (+t.split(':')[1]||0);}
