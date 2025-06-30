/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
const COLORS = {                                   // ability → colour
  Reservations : '#16a34a',
  Dispatch     : '#b91c1c',
  Security     : '#be185d',
  Network      : '#475569',
  'Journey Desk': '#65a30d',
  Marketing    : '#7c3aed',
  Sales        : '#d97706',
  'Badges/Projects':'#0ea5e9'
};

const hh  = h => `${String(h).padStart(2,'0')}:00`;
const pad = h => hh(h).slice(0,5);
const toH = t => +t.split(':')[0];
const safe = s => s.replace(/ /g,'\\ ');
const sameDay = (a,b)=>a.toDateString()===b.toDateString();
const today  = () => new Date();

/* ------------------------------------------------------------------ */
/* state & DOM refs                                                   */
/* ------------------------------------------------------------------ */
let workers=[], abilities=[], blocks=[];
let current = location.hash ? new Date(location.hash.slice(1)) : today();

const grid  = document.getElementById('grid');
const wrap  = document.getElementById('wrap');
const dateH = document.getElementById('date');

/* ------------------------------------------------------------------ */
/* init                                                               */
/* ------------------------------------------------------------------ */
(async()=>{
  [workers,abilities] = await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json())
  ]);
  draw();
})();

/* ------------------------------------------------------------------ */
/* rendering                                                          */
/* ------------------------------------------------------------------ */
function draw(){
  dateH.textContent = current.toDateString();
  location.hash     = current.toISOString().slice(0,10);

  grid.innerHTML = '';
  grid.style.gridTemplateRows = `30px repeat(${workers.length},30px)`;
  grid.style.minHeight        = `${30 + workers.length*30}px`;

  // header
  grid.appendChild(lbl(''));
  for(let h=0;h<24;h++){
    grid.appendChild(cell(hh(h),
      `grid-row:1;grid-column:${h+2}`,
      'bg-slate-800 text-white text-xs flex items-center justify-center'));
  }

  // rows
  workers.forEach((w,r)=>{
    grid.appendChild(lbl(w.Name,'',r+2));
    for(let h=0;h<24;h++){
      grid.appendChild(cell('',
        `grid-row:${r+2};grid-column:${h+2}`,
        'cell',{row:r,hour:h}));
    }
  });

  // blocks for the day
  blocks.filter(b=>sameDay(b.date,current)).forEach((b,i)=>makeBlock(b,i));

  wrap.scrollTop = 0;
}

function lbl(text,extra='',row=1){
  return Object.assign(document.createElement('div'),{
    className:`rowLabel ${extra}`,
    style:`grid-row:${row}`,
    textContent:text
  });
}
function cell(text,style,extra='',ds={}){
  const el = Object.assign(document.createElement('div'),
    {className:extra,textContent:text,style});
  Object.assign(el.dataset,ds); return el;
}
function makeBlock(b,idx){
  const row = workers.findIndex(w=>w.Name===b.name); if(row<0) return;
  const span = b.end - b.start;
  const colStart = b.start + 2;

  const el = cell(
    `${b.role} ${hh(b.start)}-${hh(b.end)}`,
    `grid-row:${row+2}; grid-column:${colStart} / span ${span};`
      + `background:${COLORS[b.role]||'#2563eb'}`,
    'block');
  el.ondblclick = () => openDialog('edit',idx);
  grid.appendChild(el);
}

/* ------------------------------------------------------------------ */
/* dragging create                                                    */
/* ------------------------------------------------------------------ */
let drag=null;
grid.onmousedown=e=>{
  if(!e.target.dataset.hour) return;
  drag = { row:+e.target.dataset.row, start:+e.target.dataset.hour,
           box:cell('', '', 'dragBox') };
  grid.appendChild(drag.box);
};
grid.onmousemove=e=>{
  if(!drag||!e.target.dataset.hour||+e.target.dataset.row!==drag.row) return;
  const span = Math.max(1, +e.target.dataset.hour + 1 - drag.start);
  drag.box.style =
    `grid-row:${drag.row+2};grid-column:${drag.start+2}/ span ${span}`;
};
grid.onmouseup=()=>{
  if(!drag) return;
  const span = parseInt(drag.box.style.gridColumn.split('span ')[1])||1;
  openDialog('new',null,{row:drag.row,start:drag.start,end:drag.start+span});
  drag.box.remove(); drag=null;
};

/* ------------------------------------------------------------------ */
/* dialog                                                             */
/* ------------------------------------------------------------------ */
const dlg   = document.getElementById('shiftDlg');
const form  = document.getElementById('shiftForm');
const role  = document.getElementById('roleSel');
const start = document.getElementById('start');
const end   = document.getElementById('end');
const notes = document.getElementById('notes');
const del   = document.getElementById('del');
const cancel= document.getElementById('cancel');

role.onchange = ()=>{
  if(role.value!=='__new__') return;
  const v=prompt('New ability:'); if(v){abilities.push(v);fillRoles(v);}else role.selectedIndex=0;
};
function fillRoles(sel=''){
  role.innerHTML = abilities
    .map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
    +'<option value="__new__">Other…</option>';
}
function openDialog(mode,idx,preset){
  fillRoles();
  if(mode==='edit'){
    const b=blocks[idx];
    form.index.value=idx;
    role.value=b.role; start.value=pad(b.start); end.value=pad(b.end);
    notes.value=b.notes||''; del.classList.remove('hidden');
  }else{
    form.index.value='';
    form.dataset.row=preset.row;
    role.selectedIndex=0; start.value=pad(preset.start); end.value=pad(preset.end);
    notes.value=''; del.classList.add('hidden');
  }
  dlg.showModal();
}
form.onsubmit=e=>{
  e.preventDefault();
  const data={role:role.value,start:toH(start.value),end:toH(end.value),notes:notes.value};
  if(data.start>=data.end) return alert('End must be after start');
  if(form.index.value===''){
    blocks.push({...data,name:workers[+form.dataset.row].Name,date:new Date(current)});
  }else Object.assign(blocks[+form.index.value],data);
  dlg.close(); draw();
};
del.onclick = ()=>{blocks.splice(+form.index.value,1); dlg.close(); draw();};
cancel.onclick = ()=>dlg.close();

/* ------------------------------------------------------------------ */
/* date navigation                                                    */
/* ------------------------------------------------------------------ */
document.getElementById('prev').onclick=()=>{current=shift(current,-1);draw();};
document.getElementById('next').onclick=()=>{current=shift(current, 1);draw();};
const shift=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
