/* ---------- helpers ---------------------------------------------- */
const COLORS={
  Reservations:'#16a34a',Dispatch:'#b91c1c',Security:'#be185d',
  Network:'#475569','Journey Desk':'65a30d',Marketing:'#7c3aed',
  Sales:'#d97706','Badges/Projects':'#0ea5e9'
};
const hh      = h => String(h).padStart(2,'0')+':00';
const toMin   = t => +t.split(':')[0]*60 + (+t.split(':')[1]||0);
const fmtMin  = m => `${String(m/60|0).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const sameDay = (a,b)=>a.toDateString()===b.toDateString();

/* ---------- data -------------------------------------------------- */
let workers=[], abilities=[], blocks=[];
let day = location.hash ? new Date(location.hash.slice(1)) : new Date();

const grid=document.getElementById('grid'), wrap=document.getElementById('wrap'), dateH=document.getElementById('date');

/* ---------- init -------------------------------------------------- */
(async()=>{
  [workers,abilities]=await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json())
  ]);
  render();
})();

/* ---------- render ------------------------------------------------ */
function render(){
  dateH.textContent=day.toDateString();
  location.hash=day.toISOString().slice(0,10);
  grid.innerHTML='';
  grid.style.gridTemplateRows=`30px repeat(${workers.length},30px)`;

  // header cells
  grid.appendChild(header(''));
  for(let h=0;h<24;h++) grid.appendChild(header(hh(h),'',h+2));

  // worker rows
  workers.forEach((w,row)=>{
    grid.appendChild(header(w.Name,'',row+2));

    // hour cells for drag capture
    for(let h=0;h<24;h++)
      grid.appendChild(cell('',`grid-row:${row+2};grid-column:${h+2}`,'cell',{row,hour:h}));

    // overlay band to hold blocks
    const band=document.createElement('div');
    band.className='band'; band.style.gridRow=row+2;
    grid.appendChild(band);
  });

  // blocks for this day
  blocks.filter(b=>sameDay(b.date,day)).forEach((b,i)=>placeBlock(b,i));

  wrap.scrollTop=0;
}
function header(txt,cls='',col){const d=document.createElement('div');d.textContent=txt;d.className=`rowLabel ${cls}`;if(col)d.style.gridColumn=col;return d;}
function cell(t,style,cls='',ds={}){const d=document.createElement('div');d.textContent=t;d.className=cls;d.style=style;Object.assign(d.dataset,ds);return d;}
function placeBlock(b,idx){
  const row = workers.findIndex(w=>w.Name===b.name); if(row<0) return;
  const band=grid.querySelectorAll('.band')[row];

  const pctStart = b.start/1440*100;
  const pctWidth = (b.end-b.start)/1440*100;

  const bl=document.createElement('div');
  bl.className='block';
  bl.style.cssText=`left:${pctStart}%;width:${pctWidth}%;background:${COLORS[b.role]||'#2563eb'}`;
  bl.textContent=`${b.role} ${fmtMin(b.start)}-${fmtMin(b.end)}`;
  bl.ondblclick=()=>openDlg('edit',idx);
  band.appendChild(bl);
}

/* ---------- drag create ------------------------------------------ */
let drag=null;
grid.onmousedown=e=>{
  if(!e.target.dataset.hour)return;
  drag={row:+e.target.dataset.row,start:+e.target.dataset.hour*60,
        box:document.createElement('div')};
  drag.box.className='dragBox';
  const band=grid.querySelectorAll('.band')[drag.row];
  band.appendChild(drag.box);
};
grid.onmousemove=e=>{
  if(!drag||!e.target.dataset.hour||+e.target.dataset.row!==drag.row)return;
  const end=(+e.target.dataset.hour+1)*60;
  drag.box.style.left = drag.start/1440*100+'%';
  drag.box.style.width= Math.max(60,end-drag.start)/1440*100+'%';
};
grid.onmouseup=()=>{
  if(!drag)return;
  const width = parseFloat(drag.box.style.width);
  const dur   = Math.round(width/100*1440);
  openDlg('new',null,{row:drag.row,start:drag.start,end:drag.start+dur});
  drag.box.remove(); drag=null;
};

/* ---------- dialog ----------------------------------------------- */
const dlg=document.getElementById('shiftDlg'),f=document.getElementById('shiftForm'),
      role=document.getElementById('roleSel'),start=document.getElementById('start'),
      end=document.getElementById('end'),notes=document.getElementById('notes'),
      del=document.getElementById('del'),cancel=document.getElementById('cancel');

function fillRoles(sel=''){role.innerHTML=
  abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')
  +'<option value="__new__">Other…</option>'; }

role.onchange=()=>{if(role.value!=='__new__')return;const v=prompt('New ability:');if(v){abilities.push(v);fillRoles(v);}else role.selectedIndex=0;};

function openDlg(mode,idx,p){
  fillRoles();
  if(mode==='edit'){
    const b=blocks[idx];f.index.value=idx;role.value=b.role;
    start.value=fmtMin(b.start);end.value=fmtMin(b.end);
    notes.value=b.notes||'';del.classList.remove('hidden');
  }else{
    f.index.value='';f.dataset.row=p.row;role.selectedIndex=0;
    start.value=fmtMin(p.start);end.value=fmtMin(p.end);
    notes.value='';del.classList.add('hidden');
  }
  dlg.showModal();
}
f.onsubmit=e=>{
  e.preventDefault();
  const b={role:role.value,start:toMin(start.value),end:toMin(end.value),notes:notes.value.trim()};
  if(b.start>=b.end)return alert('End after start');
  if(f.index.value===''){blocks.push({...b,name:workers[+f.dataset.row].Name,date:new Date(day)});}
  else Object.assign(blocks[+f.index.value],b);
  dlg.close();render();
};
del.onclick = ()=>{blocks.splice(+f.index.value,1);dlg.close();render();};
cancel.onclick=()=>dlg.close();

/* ---------- date nav --------------------------------------------- */
document.getElementById('prev').onclick=(()=>day.setDate(day.getDate()-1),render());
document.getElementById('next').onclick=(()=>day.setDate(day.getDate()+1),render());
