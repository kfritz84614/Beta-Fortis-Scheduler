/* ---------- constants & helpers ------------------ */
const COLORS = {
  Reservations : '#16a34a',
  Dispatch     : '#b91c1c',
  Security     : '#be185d',
  Network      : '#475569',
  'Journey Desk': '#65a30d',
  Marketing    : '#7c3aed',
  Sales        : '#d97706',
  'Badges/Projects':'#0ea5e9'
};

const hh   = h => `${String(h).padStart(2,'0')}:00`;
const pad  = h => hh(h).slice(0,5);
const toInt= t => +t.split(':')[0];
const hash = () => location.hash.slice(1);
const dEq  = (a,b)=>a.toDateString()===b.toDateString();

/* ---------- state -------------------------------- */
let workers=[], abilities=[], blocks=[];
let current = hash()? new Date(hash()) : new Date();

const grid  = document.getElementById('grid');
const wrap  = document.getElementById('wrap');
const dateH = document.getElementById('date');

/* ---------- init --------------------------------- */
(async()=>{
  [workers,abilities] = await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json())
  ]);
  draw();
})();

/* ---------- draw grid ---------------------------- */
function draw(){
  dateH.textContent=current.toDateString();
  location.hash=current.toISOString().slice(0,10);

  grid.innerHTML='';
  grid.style.gridTemplateRows=`30px repeat(${workers.length},30px)`;
  grid.style.minHeight=`${30+workers.length*30}px`;

  grid.appendChild(lbl(''));               // empty TL
  for(let h=0;h<24;h++)
    grid.appendChild(cell(hh(h),`grid-row:1;grid-column:${h+2}`,
      'bg-slate-800 text-white text-xs flex items-center justify-center'));

  workers.forEach((w,r)=>{
    grid.appendChild(lbl(w.Name,'',r+2));
    for(let h=0;h<24;h++)
      grid.appendChild(cell('',`grid-row:${r+2};grid-column:${h+2}`,
        'cell',{row:r,hour:h}));
  });

  blocks.filter(b=>dEq(b.date,current)).forEach((b,i)=>blockDiv(b,i));
  wrap.scrollTop=0;
}

function lbl(t,e='',row=1){return Object.assign(div(e,t),{style:`grid-row:${row}`})}
function cell(t,sty,e='',ds={}){const d=div(e,t);d.style=sty;Object.assign(d.dataset,ds);return d;}
function div(c='',t=''){return Object.assign(document.createElement('div'),{className:c,textContent:t})}

/* ---------- block element ------------------------ */
function blockDiv(b,idx){
  const row=workers.findIndex(w=>w.Name===b.name); if(row<0)return;
  const startCol=b.start+2, span=b.end-b.start;
  const el=cell(`${b.role} ${hh(b.start)}-${hh(b.end)}`,
    `grid-row:${row+2}; grid-column:${startCol} / span ${span};
     background:${COLORS[b.role]||'#2563eb'}`,
    'block');
  el.ondblclick=()=>popup('edit',idx);
  grid.appendChild(el);
}

/* ---------- dragging select ---------------------- */
let sel=null;
grid.onmousedown=e=>{
  if(!e.target.dataset.hour)return;
  sel={row:+e.target.dataset.row,start:+e.target.dataset.hour,
       box:div('dragBox')};grid.appendChild(sel.box);
};
grid.onmousemove=e=>{
  if(!sel||!e.target.dataset.hour||+e.target.dataset.row!==sel.row)return;
  const span=Math.max(1,+e.target.dataset.hour+1-sel.start);
  sel.box.style=`grid-row:${sel.row+2};grid-column:${sel.start+2}/ span ${span}`;
};
grid.onmouseup=()=>{
  if(!sel)return;
  const span=parseInt(sel.box.style.gridColumn.split('span ')[1])||1;
  popup('new',null,{row:sel.row,start:sel.start,end:sel.start+span});
  sel.box.remove();sel=null;
};

/* ---------- dialog ------------------------------- */
const dlg=document.getElementById('shiftDlg');
const f   = document.getElementById('shiftForm');
const roleSel=document.getElementById('roleSel');
const startIn=document.getElementById('start');
const endIn  =document.getElementById('end');
const notes  =document.getElementById('notes');
const delBtn =document.getElementById('del');
const cancel =document.getElementById('cancel');

roleSel.onchange=()=>{
  if(roleSel.value!=='__new__')return;
  const v=prompt('New shift type:'); if(v){abilities.push(v);fillRoles(v);}else roleSel.selectedIndex=0;
};

function fillRoles(sel=''){
  roleSel.innerHTML=abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
    +'<option value="__new__">Other…</option>';
}

function popup(mode,idx,preset){
  fillRoles();
  if(mode==='edit'){
    const b=blocks[idx];
    f.index.value=idx;
    roleSel.value=b.role;startIn.value=pad(b.start);endIn.value=pad(b.end);
    notes.value=b.notes||'';delBtn.classList.remove('hidden');
  }else{
    f.index.value='';f.dataset.row=preset.row;
    roleSel.selectedIndex=0;startIn.value=pad(preset.start);endIn.value=pad(preset.end);
    notes.value='';delBtn.classList.add('hidden');
  }
  dlg.showModal();
}

f.onsubmit=e=>{
  e.preventDefault();
  const data={role:roleSel.value,start:toInt(startIn.value),end:toInt(endIn.value),notes:notes.value.trim()};
  if(data.start>=data.end)return alert('End after start');
  if(f.index.value===''){
    blocks.push({...data,name:workers[+f.dataset.row].Name,date:new Date(current)});
  }else Object.assign(blocks[+f.index.value],data);
  dlg.close();draw();
};
delBtn.onclick=()=>{blocks.splice(+f.index.value,1);dlg.close();draw();};
cancel.onclick =()=>dlg.close();

/* ---------- date navigation ---------------------- */
document.getElementById('prev').onclick=()=>{current=shift(current,-1);draw();};
document.getElementById('next').onclick=()=>{current=shift(current, 1);draw();};
const shift=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};

/* ---------- hash utils --------------------------- */
function readHash(){return location.hash?new Date(location.hash.slice(1)):null;}
