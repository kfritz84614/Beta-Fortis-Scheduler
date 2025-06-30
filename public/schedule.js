/* -------------------------------------------------------------------
   CONFIG
--------------------------------------------------------------------*/
const DAYS   = ['Mon','Tue','Wed','Thu','Fri'];
const START  = 8;
const END    = 17;
const HOURS  = END - START;
const COL    = c => 2 + c;      // css grid column helper

/* -------------------------------------------------------------------
   STATE
--------------------------------------------------------------------*/
let workers = [];
let abilities = [];
let blocks  = [];  // [{name, day, start, end, role, notes}]

/* -------------------------------------------------------------------
   DOM refs
--------------------------------------------------------------------*/
const grid      = document.getElementById('grid');
const dlg       = document.getElementById('shiftDlg');
const form      = document.getElementById('shiftForm');
const roleSel   = document.getElementById('roleSel');
const startIn   = document.getElementById('startTime');
const endIn     = document.getElementById('endTime');
const notesIn   = document.getElementById('notes');
const delBtn    = document.getElementById('deleteBtn');
const cancelBtn = document.getElementById('cancelBtn');

/* -------------------------------------------------------------------
   GRID RENDER
--------------------------------------------------------------------*/
function hourLabel(h){return `${String(h).padStart(2,'0')}:00`}
function classSafe(str){return str.replace(/ /g,'\\ ')}

function renderGrid(){
  grid.style.gridTemplateRows = `30px repeat(${workers.length},30px)`;
  grid.innerHTML='';

  // header row
  grid.appendChild(el('div','rowLabel font-bold flex items-center justify-center bg-slate-800 text-white'));
  DAYS.forEach((_,d)=>{for(let h=0;h<HOURS;h++){
    grid.appendChild(el('div','cell flex items-center justify-center text-xs font-semibold bg-slate-800 text-white',{
      textContent:hourLabel(START+h),
      style:`grid-row:1; grid-column:${COL(d*HOURS+h)}`
    }));
  }});

  // rows
  workers.forEach((w,r)=>{
    grid.appendChild(el('div','rowLabel flex items-center',{
      textContent:w.Name, style:`grid-row:${2+r}`
    }));
    DAYS.forEach((_,d)=>{for(let h=0;h<HOURS;h++){
      grid.appendChild(el('div','cell',{
        dataset:{row:r,day:d,hour:START+h},
        style:`grid-row:${2+r}; grid-column:${COL(d*HOURS+h)}`
      }));
    }});
  });

  blocks.forEach(renderBlock);
}

function renderBlock(b,idx){
  const row  = workers.findIndex(w=>w.Name===b.name);
  if(row<0) return;
  const col  = b.day*HOURS + (b.start-START);
  const span = b.end - b.start;
  grid.appendChild(el('div',`block ${classSafe(b.role)}`,{
    textContent:`${b.role} ${b.start}-${b.end}`,
    style:`grid-row:${2+row}; grid-column:${COL(col)} / span ${span}`,
    ondblclick:()=>openDialog('edit',idx)
  }));
}

function el(tag,cls,opts={}){
  const e=Object.assign(document.createElement(tag),opts);
  if(cls) e.className=cls;
  return e;
}

/* -------------------------------------------------------------------
   MOUSE SELECT → OPEN DIALOG
--------------------------------------------------------------------*/
let drag=null;
grid.addEventListener('mousedown',e=>{
  if(!e.target.classList.contains('cell'))return;
  drag={row:+e.target.dataset.row,day:+e.target.dataset.day,
        start:+e.target.dataset.hour, box:el('div','dragBox')};
  grid.appendChild(drag.box);
});
grid.addEventListener('mousemove',e=>{
  if(!drag||!e.target.classList.contains('cell'))return;
  if(+e.target.dataset.row!==drag.row||+e.target.dataset.day!==drag.day)return;
  const hourNow=+e.target.dataset.hour+1;
  const span=Math.max(1,hourNow-drag.start);
  const col=drag.day*HOURS+(drag.start-START);
  drag.box.style=`grid-row:${2+drag.row}; grid-column:${COL(col)} / span ${span}`;
});
grid.addEventListener('mouseup',()=>{
  if(!drag)return;
  const span=parseInt(drag.box.style.gridColumn.split('span ')[1]||1);
  openDialog('new',null,{
    row:drag.row,day:drag.day,
    start:drag.start,end:drag.start+span
  });
  drag.box.remove(); drag=null;
});

/* -------------------------------------------------------------------
   SHIFT DIALOG
--------------------------------------------------------------------*/
function populateRoleSelect(selected=''){
  roleSel.innerHTML = abilities
    .map(a=>`<option ${a===selected?'selected':''}>${a}</option>`)
    .join('') + '<option __new>Other…</option>';
}

function openDialog(mode,index,preset){
  populateRoleSelect();
  if(mode==='edit'){
    const b=blocks[index];
    form.index.value=index;
    roleSel.value=b.role;
    startIn.value=toTime(b.start);
    endIn.value  =toTime(b.end);
    notesIn.value=b.notes||'';
    delBtn.classList.remove('hidden');
  }else{
    form.index.value='';
    roleSel.selectedIndex=0;
    startIn.value=toTime(preset.start);
    endIn.value  =toTime(preset.end);
    notesIn.value='';
    delBtn.classList.add('hidden');
    form.dataset.row=preset.row;
    form.dataset.day=preset.day;
  }
  dlg.showModal();
}

function toTime(h){return `${String(h).padStart(2,'0')}:00`}
function fromTime(t){return parseInt(t.split(':')[0],10)}

roleSel.addEventListener('change',()=>{
  if(roleSel.options[roleSel.selectedIndex].hasAttribute('__new')){
    const val=prompt('New shift type:');
    if(val){abilities.push(val);populateRoleSelect(val);}
    else roleSel.selectedIndex=0;
  }
});

form.addEventListener('submit',e=>{
  e.preventDefault();
  const role=roleSel.value;
  const start=fromTime(startIn.value);
  const end  =fromTime(endIn.value);
  const notes=notesIn.value.trim();

  if(start>=end)return alert('End must be after start');
  const idx=form.index.value;

  if(idx===''){ // new
    blocks.push({
      name:workers[+form.dataset.row].Name,
      day:+form.dataset.day,start,end,role,notes
    });
  }else{ // edit
    Object.assign(blocks[idx],{role,start,end,notes});
  }
  dlg.close(); renderGrid();
});
delBtn.onclick=()=>{
  const idx=form.index.value;
  if(idx!==''){blocks.splice(idx,1);renderGrid();}
  dlg.close();
};
cancelBtn.onclick=()=>dlg.close();

/* -------------------------------------------------------------------
   INIT
--------------------------------------------------------------------*/
(async()=>{
  workers   = await fetch('/api/workers').then(r=>r.json());
  abilities = await fetch('/api/abilities').then(r=>r.json());
  renderGrid();
})();
