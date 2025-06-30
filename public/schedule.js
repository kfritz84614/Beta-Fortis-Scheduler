/* helpers -----------------------------------------------------------*/
const hh = n => String(n).padStart(2,'0')+':00';
const toInt = t=>+t.split(':')[0];
const safe = s=>s.replace(/ /g,'\\ ');

/* state -------------------------------------------------------------*/
let workers=[], abilities=[], blocks=[];     // blocks kept in-memory
let currentDate = readHash() || new Date(); // hash YYYY-MM-DD

const grid   = document.getElementById('grid');
const wrap   = document.getElementById('wrap');
const dateH  = document.getElementById('date');

/* init --------------------------------------------------------------*/
(async()=>{
  [workers,abilities]=await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json())
  ]);
  render();
})();

/* render ------------------------------------------------------------*/
function render(){
  dateH.textContent = currentDate.toDateString();
  writeHash();

  grid.innerHTML='';
  grid.style.gridTemplateRows=`30px repeat(${workers.length},30px)`;
  grid.style.minHeight = `${30+workers.length*30}px`;

  // header
  grid.appendChild(label(''));
  for(let h=0;h<24;h++){
    grid.appendChild(cell(hh(h),
      `grid-row:1; grid-column:${h+2}`,
      'bg-slate-800 text-white text-xs flex items-center justify-center'));
  }
  // rows
  workers.forEach((w,r)=>{
    grid.appendChild(label(w.Name,'',r+2));
    for(let h=0;h<24;h++){
      grid.appendChild(cell('',`grid-row:${r+2}; grid-column:${h+2}`,
        'cell',{row:r,hour:h}));
    }
  });
  // blocks for this day only
  blocks.filter(b=>sameDay(b.date,currentDate))
        .forEach((b,i)=>addBlock(b,i));

  wrap.scrollTop=0;
}
function label(txt,extra='',row=1){
  return Object.assign(document.createElement('div'),{
    className:`rowLabel ${extra}`,style:`grid-row:${row}`,textContent:txt});
}
function cell(txt,style,extra='',ds={}){
  const d=Object.assign(document.createElement('div'),
    {className:extra,textContent:txt,style});
  Object.assign(d.dataset,ds);return d;
}
function addBlock(b,idx){
  const r = workers.findIndex(w=>w.Name===b.name); if(r<0) return;
  const span=b.end-b.start;
  const div=cell(`${b.role} ${hh(b.start)}-${hh(b.end)}`,
    `grid-row:${r+2}; grid-column:${b.start+2}/ span ${span}`,
    `block ${safe(b.role)}`);
  div.ondblclick=()=>openDlg('edit',idx);
  grid.appendChild(div);
}

/* drag select -------------------------------------------------------*/
let drag=null;
grid.addEventListener('mousedown',e=>{
  if(!e.target.dataset.hour) return;
  drag={row:+e.target.dataset.row,start:+e.target.dataset.hour,temp:cell('','','dragBox')};
  grid.appendChild(drag.temp);
});
grid.addEventListener('mousemove',e=>{
  if(!drag||!e.target.dataset.hour) return;
  if(+e.target.dataset.row!==drag.row) return;
  const span=Math.max(1,+e.target.dataset.hour+1-drag.start);
  drag.temp.style=`grid-row:${drag.row+2}; grid-column:${drag.start+2}/ span ${span}`;
});
grid.addEventListener('mouseup',()=>{
  if(!drag) return;
  const span=parseInt(drag.temp.style.gridColumn.split('span ')[1])||1;
  openDlg('new',null,{row:drag.row,start:drag.start,end:drag.start+span});
  drag.temp.remove();drag=null;
});

/* dialog ------------------------------------------------------------*/
const dlg=document.getElementById('shiftDlg'),
      form=document.getElementById('shiftForm'),
      roleSel=document.getElementById('roleSel'),
      startIn=document.getElementById('start'),
      endIn=document.getElementById('end'),
      notes=document.getElementById('notes'),
      del=document.getElementById('del');

function populateRoles(sel=''){
  roleSel.innerHTML=abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
    +'<option value="__new__">Other…</option>';
}
roleSel.addEventListener('change',()=>{
  if(roleSel.value!=='__new__') return;
  const v=prompt('New shift type:'); if(v){abilities.push(v);populateRoles(v);}else roleSel.selectedIndex=0;
});
function openDlg(mode,idx,preset){
  populateRoles();
  if(mode==='edit'){
    const b=blocks[idx];
    form.index.value=idx;
    roleSel.value=b.role;
    startIn.value=hh(b.start).slice(0,5);
    endIn.value  =hh(b.end).slice(0,5);
    notes.value=b.notes||'';
    del.classList.remove('hidden');
  }else{
    form.index.value='';
    form.dataset.row=preset.row;
    roleSel.selectedIndex=0;
    startIn.value=hh(preset.start).slice(0,5);
    endIn.value  =hh(preset.end).slice(0,5);
    notes.value='';
    del.classList.add('hidden');
  }
  dlg.showModal();
}

form.addEventListener('submit',e=>{
  e.preventDefault();
  const data={role:roleSel.value,start:toInt(startIn.value),end:toInt(endIn.value),notes:notes.value};
  if(data.start>=data.end) return alert('End after start');
  if(form.index.value===''){
    blocks.push({...data,name:workers[+form.dataset.row].Name,date:new Date(currentDate)});
  }else Object.assign(blocks[+form.index.value],data);
  dlg.close();render();
});
del.onclick=()=>{blocks.splice(+form.index.value,1);dlg.close();render();}
document.getElementById('cancel').onclick=()=>dlg.close();

/* date nav ----------------------------------------------------------*/
document.getElementById('prev').onclick=()=>{ currentDate=offset(currentDate,-1);render(); };
document.getElementById('next').onclick=()=>{ currentDate=offset(currentDate,1); render(); };

function offset(d,delta){const n=new Date(d);n.setDate(n.getDate()+delta);return n;}
function sameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}

/* hash helpers ------------------------------------------------------*/
function readHash(){if(location.hash){const d=new Date(location.hash.slice(1));return !isNaN(d)?d:null}}
function writeHash(){location.hash=currentDate.toISOString().slice(0,10);}
