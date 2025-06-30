/* utilities ---------------------------------------------------------*/
const hh   = n => `${String(n).padStart(2,'0')}:00`;
const pad  = n => hh(n).slice(0,5);
const toInt= t => +t.split(':')[0];
const safe = s => s.replace(/ /g,'\\ ');
const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()
                  &&a.getMonth()===b.getMonth()
                  &&a.getDate()===b.getDate();

/* state -------------------------------------------------------------*/
let workers=[], abilities=[], blocks=[];
let current = readHash() || new Date();

const grid  = document.getElementById('grid');
const wrap  = document.getElementById('wrap');
const dateH = document.getElementById('date');

/* INIT --------------------------------------------------------------*/
(async()=>{
  [workers,abilities]=await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json())
  ]);
  render();
})();

/* render grid -------------------------------------------------------*/
function render(){
  dateH.textContent = current.toDateString(); writeHash();
  grid.innerHTML='';
  grid.style.gridTemplateRows = `30px repeat(${workers.length},30px)`;
  grid.style.minHeight = `${30+workers.length*30}px`;

  // header
  grid.appendChild(label(''));
  for(let h=0;h<24;h++){
    grid.appendChild(cell(hh(h),`grid-row:1;grid-column:${h+2}`,
      'bg-slate-800 text-white text-xs flex items-center justify-center'));
  }

  // rows + selection cells
  workers.forEach((w,r)=>{
    grid.appendChild(label(w.Name,'',r+2));
    for(let h=0;h<24;h++){
      grid.appendChild(cell('',`grid-row:${r+2};grid-column:${h+2}`,
        'cell',{row:r,hour:h}));
    }
  });

  blocks.filter(b=>sameDay(b.date,current)).forEach((b,i)=>addBlock(b,i));
  wrap.scrollTop=0;
}

function label(txt,extra='',row=1){
  return Object.assign(document.createElement('div'),{
    className:`rowLabel ${extra}`,style:`grid-row:${row}`,textContent:txt});
}
function cell(txt,style,extra='',ds={}){
  const d=Object.assign(document.createElement('div'),
    {className:extra,textContent:txt,style});Object.assign(d.dataset,ds);return d;
}
function addBlock(b,idx){
  const r=workers.findIndex(w=>w.Name===b.name); if(r<0) return;
  const span=b.end-b.start, colStart=b.start+2;
  grid.appendChild(cell(
    `${b.role} ${hh(b.start)}-${hh(b.end)}`,
    `grid-row:${r+2}; grid-column:${colStart} / span ${span}`,
    `block ${safe(b.role)}`,{})).ondblclick=()=>dlgOpen('edit',idx);
}

/* drag-select -------------------------------------------------------*/
let drag=null;
grid.addEventListener('mousedown',e=>{
  if(!e.target.dataset.hour)return;
  drag={row:+e.target.dataset.row,start:+e.target.dataset.hour,
        tmp:cell('','','dragBox')};grid.appendChild(drag.tmp);
});
grid.addEventListener('mousemove',e=>{
  if(!drag||!e.target.dataset.hour)return;
  if(+e.target.dataset.row!==drag.row)return;
  const span=Math.max(1,+e.target.dataset.hour+1-drag.start);
  drag.tmp.style=`grid-row:${drag.row+2};grid-column:${drag.start+2}/ span ${span}`;
});
grid.addEventListener('mouseup',()=>{
  if(!drag)return;
  const span=parseInt(drag.tmp.style.gridColumn.split('span ')[1])||1;
  dlgOpen('new',null,{row:drag.row,start:drag.start,end:drag.start+span});
  drag.tmp.remove();drag=null;
});

/* dialog ------------------------------------------------------------*/
const dlg=document.getElementById('shiftDlg'),
      form=document.getElementById('shiftForm'),
      role=document.getElementById('roleSel'),
      start=document.getElementById('start'),
      end  =document.getElementById('end'),
      notes=document.getElementById('notes'),
      del  =document.getElementById('del');

function fillRoles(sel=''){
  role.innerHTML=abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
              +'<option value="__new__">Other…</option>';
}
role.addEventListener('change',()=>{
  if(role.value!=='__new__')return;
  const v=prompt('New shift type:'); if(v){abilities.push(v);fillRoles(v);}else role.selectedIndex=0;
});

function dlgOpen(mode,idx,preset){
  fillRoles();
  if(mode==='edit'){
    const b=blocks[idx];
    form.index.value=idx;
    role.value=b.role;start.value=pad(b.start);end.value=pad(b.end);
    notes.value=b.notes||'';del.classList.remove('hidden');
  }else{
    form.index.value='';form.dataset.row=preset.row;
    role.selectedIndex=0;start.value=pad(preset.start);end.value=pad(preset.end);
    notes.value='';del.classList.add('hidden');
  }
  dlg.showModal();
}
form.onsubmit=e=>{
  e.preventDefault();
  const data={role:role.value,start:toInt(start.value),end:toInt(end.value),notes:notes.value.trim()};
  if(data.start>=data.end)return alert('End after start');
  if(form.index.value===''){
    blocks.push({...data,name:workers[+form.dataset.row].Name,date:new Date(current)});
  }else Object.assign(blocks[+form.index.value],data);
  dlg.close();render();
};
del.onclick=()=>{blocks.splice(+form.index.value,1);dlg.close();render();}
document.getElementById('cancel').onclick=()=>dlg.close();

/* date nav ----------------------------------------------------------*/
document.getElementById('prev').onclick=()=>{current=move(current,-1);render();};
document.getElementById('next').onclick=()=>{current=move(current, 1);render();};
const move=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};

/* url hash ----------------------------------------------------------*/
function readHash(){if(location.hash){const d=new Date(location.hash.slice(1));return !isNaN(d)?d:null}}
function writeHash(){location.hash=current.toISOString().slice(0,10);}
