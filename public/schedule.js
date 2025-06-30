/* --------------------------------------------------------------------
   CONFIG
---------------------------------------------------------------------*/
const DAYS   = ['Mon','Tue','Wed','Thu','Fri'];
const START  = 8;                      // grid begins 08:00
const END    = 17;                     // grid ends 17:00
const HOURS  = END - START;
const COL    = i => 2 + i;             // css-grid helper

/* --------------------------------------------------------------------
   STATE & DOM
---------------------------------------------------------------------*/
let workers   = [];
let abilities = [];
let blocks    = [];   // [{name,day,start,end,role,notes}]

const grid      = document.getElementById('grid');
const wrapper   = document.getElementById('gridWrapper');

const dlg       = document.getElementById('shiftDlg');
const form      = document.getElementById('shiftForm');
const roleSel   = document.getElementById('roleSel');
const startIn   = document.getElementById('startTime');
const endIn     = document.getElementById('endTime');
const notesIn   = document.getElementById('notes');
const delBtn    = document.getElementById('deleteBtn');
const cancelBtn = document.getElementById('cancelBtn');

/* --------------------------------------------------------------------
   GRID RENDER
---------------------------------------------------------------------*/
const hh = h => `${String(h).padStart(2,'0')}:00`;           // 24-h label
const safe = txt => txt.replace(/ /g,'\\ ');                 // css class safe

function renderGrid(){
  grid.innerHTML = '';
  grid.style.gridTemplateRows =
    `30px repeat(${workers.length},30px)`;
  grid.style.minHeight =
    `${30 + workers.length*30}px`;

  /* header row */
  grid.appendChild(label('', 'bg-slate-800 text-white font-bold'));
  DAYS.forEach((_,d)=>{ for(let h=0; h<HOURS; h++){
    grid.appendChild(cell(
      hh(START+h),
      `grid-row:1; grid-column:${COL(d*HOURS+h)}`,
      'bg-slate-800 text-white text-xs font-semibold flex items-center justify-center'
    ));
  }});

  /* body */
  workers.forEach((w,r)=>{
    grid.appendChild(label(w.Name,'',2+r));
    DAYS.forEach((_,d)=>{ for(let h=0; h<HOURS; h++){
      grid.appendChild(cell(
        '',
        `grid-row:${2+r}; grid-column:${COL(d*HOURS+h)}`,
        'cell',
        {row:r,day:d,hour:START+h}
      ));
    }});
  });

  blocks.forEach((b,i)=>addBlock(b,i));
  wrapper.scrollTop = 0;
}

function label(txt,extra='',row=1){
  return Object.assign(document.createElement('div'),{
    className:`rowLabel flex items-center ${extra}`,
    style:`grid-row:${row}`,
    textContent:txt
  });
}
function cell(txt,style,extra='',dataset={}){
  const e = Object.assign(document.createElement('div'),{
    className:extra,textContent:txt,style});
  Object.assign(e.dataset,dataset);
  return e;
}
function addBlock(b,idx){
  const row  = workers.findIndex(w=>w.Name===b.name);
  if(row<0) return;
  const col  = b.day*HOURS + (b.start-START);
  const span = b.end-b.start;
  const div  = cell(`${b.role} ${hh(b.start)}-${hh(b.end)}`,
                    `grid-row:${2+row}; grid-column:${COL(col)} / span ${span}`,
                    `block ${safe(b.role)}`);
  div.ondblclick = ()=>openDialog('edit',idx);
  grid.appendChild(div);
}

/* --------------------------------------------------------------------
   DRAG-SELECT
---------------------------------------------------------------------*/
let sel=null;
grid.addEventListener('mousedown',e=>{
  if(!e.target.dataset.hour) return;
  sel={row:+e.target.dataset.row,day:+e.target.dataset.day,
       start:+e.target.dataset.hour,temp:cell('','','dragBox')};
  grid.appendChild(sel.temp);
});
grid.addEventListener('mousemove',e=>{
  if(!sel||!e.target.dataset.hour) return;
  if(+e.target.dataset.row!==sel.row||+e.target.dataset.day!==sel.day)return;
  const span = Math.max(1, +e.target.dataset.hour+1-sel.start);
  sel.temp.style = `grid-row:${2+sel.row}; grid-column:${COL(sel.day*HOURS+(sel.start-START))} / span ${span}`;
});
grid.addEventListener('mouseup',()=>{
  if(!sel) return;
  const span = parseInt(sel.temp.style.gridColumn.split('span ')[1])||1;
  openDialog('new',null,{row:sel.row,day:sel.day,start:sel.start,end:sel.start+span});
  sel.temp.remove(); sel=null;
});

/* --------------------------------------------------------------------
   DIALOG
---------------------------------------------------------------------*/
function populateRoles(sel=''){
  roleSel.innerHTML =
    abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
    + '<option value="__new__">Other…</option>';
}

function openDialog(mode,idx,preset){
  populateRoles();
  if(mode==='edit'){
    const b=blocks[idx];
    form.index.value=idx;
    roleSel.value=b.role;
    startIn.value=pad(b.start);
    endIn.value  =pad(b.end);
    notesIn.value=b.notes||'';
    delBtn.classList.remove('hidden');
  }else{
    form.index.value='';
    form.dataset.row=preset.row;
    form.dataset.day=preset.day;
    roleSel.selectedIndex=0;
    startIn.value=pad(preset.start);
    endIn.value  =pad(preset.end);
    notesIn.value='';
    delBtn.classList.add('hidden');
  }
  dlg.showModal();
}

roleSel.addEventListener('change',()=>{
  if(roleSel.value!=='__new__') return;
  const val=prompt('New shift type:'); if(val){abilities.push(val);populateRoles(val);} else roleSel.selectedIndex=0;
});

form.addEventListener('submit',e=>{
  e.preventDefault();
  const data={
    role:roleSel.value,
    start:toInt(startIn.value),
    end:toInt(endIn.value),
    notes:notesIn.value.trim()
  };
  if(data.start>=data.end) return alert('End after start, please.');
  if(form.index.value===''){
    const w = workers[+form.dataset.row];
    blocks.push({name:w.Name,day:+form.dataset.day,...data});
  }else Object.assign(blocks[+form.index.value],data);
  dlg.close(); renderGrid();
});
delBtn.onclick=()=>{blocks.splice(+form.index.value,1);dlg.close();renderGrid();};
cancelBtn.onclick=()=>dlg.close();

const pad = h=>`${String(h).padStart(2,'0')}:00`;
const toInt = t=>parseInt(t.split(':')[0],10);

/* --------------------------------------------------------------------
   INIT
---------------------------------------------------------------------*/
(async()=>{
  workers   = await fetch('/api/workers').then(r=>r.json());
  abilities = await fetch('/api/abilities').then(r=>r.json());
  renderGrid();
})();
