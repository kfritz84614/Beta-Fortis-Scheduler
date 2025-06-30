/* ---------- helpers & palette ------------------------------------ */
const COLORS={Reservations:'#16a34a',Dispatch:'#b91c1c',Security:'#be185d',
  Network:'#475569','Journey Desk':'#65a30d',Marketing:'#7c3aed',
  Sales:'#d97706','Badges/Projects':'#0ea5e9'};
const STEP=15;
const hh=h=>`${String(h).padStart(2,'0')}:00`;
const fmt=m=>`${String(m/60|0).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const toMin=t=>{if(!t.includes(':')&&t.length===4)t=t.slice(0,2)+':'+t.slice(2);const[a,b]=t.split(':').map(Number);return a*60+b};
const sameDay=(a,b)=>a.toDateString()===b.toDateString();

/* ---------- state & DOM ------------------------------------------ */
let workers=[],abilities=[],blocks=[];
let day=location.hash?new Date(location.hash.slice(1)):new Date();

const grid=document.getElementById('grid'),wrap=document.getElementById('wrap'),dateH=document.getElementById('date');
const empInput=document.getElementById('empSel'),empList=document.getElementById('workerList');

/* ---------- fetch data ------------------------------------------- */
(async()=>{
  [workers,abilities]=await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json())
  ]);
  fillEmpList(); draw();
})();

/* ---------- populate datalist ------------------------------------ */
function fillEmpList(){
  empList.innerHTML = workers
    .map(w=>`<option value="${w.Name}"></option>`)
    .join('');
}

/* ---------- earliest start utility ------------------------------- */
function firstStartToday(name){
  const blk=blocks.filter(b=>b.name===name&&sameDay(b.date,day)).sort((a,b)=>a.start-b.start)[0];
  return blk?blk.start:1441;
}

/* ---------- draw -------------------------------------------------- */
function draw(){
  const sorted=[...workers].sort((a,b)=>{
    const sa=firstStartToday(a.Name), sb=firstStartToday(b.Name);
    return sa!==sb?sa-sb:a.Name.localeCompare(b.Name);
  });
  const rowByName=Object.fromEntries(sorted.map((w,i)=>[w.Name,i]));

  dateH.textContent=day.toDateString();
  location.hash=day.toISOString().slice(0,10);

  grid.innerHTML='';grid.style.gridTemplateRows=`30px repeat(${sorted.length},30px)`;
  grid.appendChild(label(''));for(let h=0;h<24;h++)grid.appendChild(label(hh(h),1,h+2));

  sorted.forEach((w,row)=>{
    grid.appendChild(label(w.Name,row+2,1));
    for(let h=0;h<24;h++)grid.appendChild(cell('',`grid-row:${row+2};grid-column:${h+2}`,'cell',{row,hour:h}));
    const band=document.createElement('div');band.className='band';band.style.gridRow=row+2;grid.appendChild(band);
  });

  blocks.filter(b=>sameDay(b.date,day)).forEach((b,i)=>place(b,i,rowByName[b.name]));
  wrap.scrollTop=0;
}
function label(t,r=1,c=1){const d=document.createElement('div');d.textContent=t;d.className='rowLabel';d.style.gridRow=r;d.style.gridColumn=c;return d;}
function cell(t,s,cls='',ds={}){const d=document.createElement('div');d.textContent=t;d.className=cls;d.style=s;Object.assign(d.dataset,ds);return d;}

/* ---------- place shift block ------------------------------------ */
function place(b,idx,row){
  if(row===undefined)return;
  const band=grid.querySelectorAll('.band')[row];
  const el=document.createElement('div');
  el.className='block';
  el.style=`left:${b.start/1440*100}%;width:${(b.end-b.start)/1440*100}%;background:${COLORS[b.role]||'#2563eb'}`;
  el.textContent=`${b.role} ${fmt(b.start)}-${fmt(b.end)}`;
  el.ondblclick=()=>openDlg('edit',idx);
  ['l','r'].forEach(side=>{
    const h=document.createElement('span');
    h.style=`position:absolute;${side==='l'?'left':'right'}:0;top:0;bottom:0;width:6px;cursor:ew-resize`;
    h.onmousedown=e=>startResize(e,idx,side);
    el.appendChild(h);
  });
  band.appendChild(el);
}

/* ---------- resize logic ----------------------------------------- */
let rs={};
function startResize(e,idx,side){
  e.stopPropagation();
  rs={idx,side,startX:e.clientX,orig:{...blocks[idx]},row:workers.findIndex(w=>w.Name===blocks[idx].name)};
  document.onmousemove=onRes; document.onmouseup=endRes;
}
function onRes(e){
  if(rs.idx===undefined)return;
  const band=grid.querySelectorAll('.band')[rs.row];
  const diff=Math.round((e.clientX-rs.startX)/(band.getBoundingClientRect().width/1440)/STEP)*STEP;
  const blk=blocks[rs.idx];
  if(rs.side==='l')blk.start=Math.max(0,Math.min(blk.end-STEP,rs.orig.start+diff));
  else blk.end=Math.min(1440,Math.max(blk.start+STEP,rs.orig.end+diff));
  draw();
}
function endRes(){rs={};document.onmousemove=document.onmouseup=null;}

/* ---------- drag-create ------------------------------------------ */
let drag=null;
grid.onmousedown=e=>{
  if(!e.target.dataset.hour)return;
  drag={row:+e.target.dataset.row,start:+e.target.dataset.hour*60,
        box:document.createElement('div')};
  drag.box.className='dragBox';
  grid.querySelectorAll('.band')[drag.row].appendChild(drag.box);};
grid.onmousemove=e=>{
  if(!drag||+e.target.dataset.row!==drag.row||!e.target.dataset.hour)return;
  const end=(+e.target.dataset.hour+1)*60;
  drag.box.style.left=drag.start/1440*100+'%';
  drag.box.style.width=Math.max(STEP,end-drag.start)/1440*100+'%';};
grid.onmouseup=()=>{
  if(!drag)return;
  const dur=parseFloat(drag.box.style.width)/100*1440;
  openDlg('new',null,{row:drag.row,start:drag.start,end:drag.start+Math.round(dur/STEP)*STEP});
  drag.box.remove();drag=null;};

/* ---------- dialog ------------------------------------------------ */
const dlg=document.getElementById('shiftDlg'),f=document.getElementById('shiftForm'),
      roleSel=document.getElementById('roleSel'),startI=document.getElementById('start'),
      endI=document.getElementById('end'),notes=document.getElementById('notes'),
      del=document.getElementById('del'),cancel=document.getElementById('cancel');

function fillRoles(sel=''){roleSel.innerHTML=abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')+'<option value="__new__">Other…</option>';}
roleSel.onchange=()=>{
  if(roleSel.value!=='__new__')return;
  const v=prompt('New ability:');if(v){abilities.push(v);fillRoles(v);}else roleSel.selectedIndex=0;
};

function openDlg(mode,idx,p){
  fillRoles();
  if(mode==='edit'){
    const b=blocks[idx];
    f.index.value=idx;empInput.value=b.name;roleSel.value=b.role;
    startI.value=fmt(b.start);endI.value=fmt(b.end);notes.value=b.notes||'';del.classList.remove('hidden');
  }else{
    f.index.value='';f.dataset.row=p.row;
    empInput.value=workers[p.row].Name;roleSel.selectedIndex=0;
    startI.value=fmt(p.start);endI.value=fmt(p.end);notes.value='';del.classList.add('hidden');
  }
  dlg.showModal();
}

f.onsubmit=e=>{
  e.preventDefault();
  const name=empInput.value.trim();
  if(!workers.some(w=>w.Name===name))return alert('Employee not in list');
  const b={name,role:roleSel.value,start:toMin(startI.value),end:toMin(endI.value),notes:notes.value.trim(),date:new Date(day)};
  if(b.start>=b.end)return alert('End must be after start');
  if(f.index.value==='')blocks.push(b);else Object.assign(blocks[+f.index.value],b);
  dlg.close();draw();
};
del.onclick   =()=>{blocks.splice(+f.index.value,1);dlg.close();draw();};
cancel.onclick=()=>dlg.close();

/* ---------- nav --------------------------------------------------- */
document.getElementById('prev').onclick   =()=>{day.setDate(day.getDate()-1);draw();};
document.getElementById('next').onclick   =()=>{day.setDate(day.getDate()+1);draw();};
document.getElementById('todayBtn').onclick=()=>{day=new Date();draw();};
