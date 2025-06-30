/* ---------- helpers & palette ------------------------------------ */
const COLORS={Reservations:'#16a34a',Dispatch:'#b91c1c',Security:'#be185d',
Network:'#475569','Journey Desk':'#65a30d',Marketing:'#7c3aed',Sales:'#d97706','Badges/Projects':'#0ea5e9'};
const STEP=15;
const hh=h=>`${String(h).padStart(2,'0')}:00`;
const fmt=m=>`${String(m/60|0).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const toMin=t=>{if(!t.includes(':')&&t.length===4)t=t.slice(0,2)+':'+t.slice(2);const[a,b]=t.split(':').map(Number);return a*60+b};
const sameDay=(a,b)=>a.toDateString()===b.toDateString();

/* ---------- state & refs ----------------------------------------- */
let workers=[],abilities=[],shifts=[];
let day=location.hash?new Date(location.hash.slice(1)):new Date();

const grid=document.getElementById('grid'),
      wrap=document.getElementById('wrap'),
      dateH=document.getElementById('date'),
      empIn=document.getElementById('empSel'),
      empDl=document.getElementById('workerList');

/* ---------- load -------------------------------------------------- */
(async()=>{
  [workers,abilities,shifts]=await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json()),
    fetch('/api/shifts').then(r=>r.json())
  ]);
  empDl.innerHTML=workers.map(w=>`<option value="${w.Name}">`).join('');
  draw();
})();

/* ---------- persistence helpers ---------------------------------- */
const saveShift=async s=>{
  const {id}=await fetch('/api/shifts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}).then(r=>r.json());
  if(!s.id)s.id=id;
};
const deleteShift=id=>fetch(`/api/shifts/${id}`,{method:'DELETE'});

/* ---------- earliest start helper -------------------------------- */
const firstStartToday=name=>{
  const s=shifts.filter(x=>x.name===name&&sameDay(new Date(x.date),day)).sort((a,b)=>a.start-b.start)[0];
  return s?s.start:1441;
};

/* ---------- draw grid -------------------------------------------- */
function draw(){
  const sorted=[...workers].sort((a,b)=>{const sa=firstStartToday(a.Name),sb=firstStartToday(b.Name);return sa!==sb?sa-sb:a.Name.localeCompare(b.Name)});
  const rowByName=Object.fromEntries(sorted.map((w,i)=>[w.Name,i]));
  dateH.textContent=day.toDateString();
  location.hash=day.toISOString().slice(0,10);
  grid.innerHTML='';
  grid.style.gridTemplateRows=`30px repeat(${sorted.length},30px)`;
  grid.appendChild(lbl(''));
  for(let h=0;h<24;h++)grid.appendChild(lbl(hh(h),1,h+2));
  sorted.forEach((w,row)=>{
    grid.appendChild(lbl(w.Name,row+2,1));
    for(let h=0;h<24;h++)grid.appendChild(cell('',`grid-row:${row+2};grid-column:${h+2}`,'cell',{row,hour:h}));
    const band=document.createElement('div');band.className='band';band.style.gridRow=row+2;grid.appendChild(band);
  });
  shifts.filter(s=>sameDay(new Date(s.date),day)).forEach((s,i)=>placeBlock(s,i,rowByName[s.name]));
  wrap.scrollTop=0;
}
const lbl=(t,r=1,c=1)=>{const d=document.createElement('div');d.textContent=t;d.className='rowLabel';d.style=`grid-row:${r};grid-column:${c}`;return d};
const cell=(t,s,cls='',ds={})=>{const d=document.createElement('div');d.textContent=t;d.className=cls;d.style=s;Object.assign(d.dataset,ds);return d};

/* ---------- place block ------------------------------------------ */
function placeBlock(s,idx,row){
  const band=grid.querySelectorAll('.band')[row];if(!band)return;
  const el=document.createElement('div');
  el.className='block';
  el.style.cssText=`left:${s.start/1440*100}%;width:${(s.end-s.start)/1440*100}%;background:${COLORS[s.role]||'#2563eb'}`;
  el.textContent=`${s.role} ${fmt(s.start)}-${fmt(s.end)}`;
  el.ondblclick=()=>openDlg('edit',idx);
  ['l','r'].forEach(side=>{
    const h=document.createElement('span');
    h.style=`position:absolute;${side==='l'?'left':'right'}:0;top:0;bottom:0;width:6px;cursor:ew-resize`;
    h.onmousedown=e=>startResize(e,idx,side);
    el.appendChild(h);
  });
  el.onmousedown=e=>{if(e.target.tagName==='SPAN')return;startMove(e,idx,row,el);};
  band.appendChild(el);
}

/* ---------- resize ------------------------------------------------ */
let rs={};
function startResize(e,idx,side){e.stopPropagation();rs={idx,side,startX:e.clientX,orig:{...shifts[idx]}};document.onmousemove=doResize;document.onmouseup=endResize;}
function doResize(e){if(rs.idx==null)return;const px=grid.querySelector('.band').getBoundingClientRect().width/1440;const diff=Math.round((e.clientX-rs.startX)/px/STEP)*STEP;const s=shifts[rs.idx];if(rs.side==='l')s.start=Math.max(0,Math.min(s.end-STEP,rs.orig.start+diff));else s.end=Math.min(1440,Math.max(s.start+STEP,rs.orig.end+diff));draw();}
function endResize(){if(rs.idx!=null)saveShift(shifts[rs.idx]);rs={};document.onmousemove=document.onmouseup=null;}

/* ---------- move -------------------------------------------------- */
let mv=null;
function startMove(e,idx,row,origEl){e.preventDefault();mv={idx,row,startX:e.clientX,startY:e.clientY,moved:false,origEl};document.onmousemove=doMove;document.onmouseup=endMove;}
function doMove(e){if(!mv)return;if(!mv.moved){if(Math.abs(e.clientX-mv.startX)<4&&Math.abs(e.clientY-mv.startY)<4)return;mv.moved=true;mv.preview=mv.origEl.cloneNode(true);mv.preview.style.opacity=.5;mv.preview.style.pointerEvents='none';grid.appendChild(mv.preview);}const px=grid.querySelector('.band').getBoundingClientRect().width/1440;const diff=Math.round((e.clientX-mv.startX)/px/STEP)*STEP;const s=shifts[mv.idx];let st=Math.max(0,Math.min(1440-STEP,s.start+diff));let en=s.end+diff;if(en>1440){st-=en-1440;en=1440;}mv.preview.style.left=st/1440*100+'%';mv.preview.style.width=(en-st)/1440*100+'%';const diffRow=Math.round((e.clientY-mv.startY)/30);const newRow=Math.min(Math.max(0,mv.row+diffRow),workers.length-1);mv.preview.style.gridRow=newRow+2;}
async function endMove(e){document.onmousemove=document.onmouseup=null;if(!mv)return;if(!mv.moved){openDlg('edit',mv.idx);mv=null;return;}const px=grid.querySelector('.band').getBoundingClientRect().width/1440;const diff=Math.round((e.clientX-mv.startX)/px/STEP)*STEP;const s=shifts[mv.idx];s.start=Math.max(0,Math.min(1440-STEP,s.start+diff));s.end=Math.min(1440,Math.max(s.start+STEP,s.end+diff));const diffRow=Math.round((e.clientY-mv.startY)/30);const newRow=Math.min(Math.max(0,mv.row+diffRow),workers.length-1);s.name=workers[newRow].Name;mv.preview.remove();mv=null;await saveShift(s);draw();}

/* ---------- drag-create ------------------------------------------ */
let dc=null;
grid.onmousedown=e=>{if(!e.target.dataset.hour)return;dc={row:+e.target.dataset.row,start:+e.target.dataset.hour*60,box:Object.assign(document.createElement('div'),{className:'dragBox'})};grid.querySelectorAll('.band')[dc.row].appendChild(dc.box);};
grid.onmousemove=e=>{if(!dc||+e.target.dataset.row!==dc.row||!e.target.dataset.hour)return;const end=(+e.target.dataset.hour+1)*60;dc.box.style.left=dc.start/1440*100+'%';dc.box.style.width=Math.max(STEP,end-dc.start)/1440*100+'%';};
grid.onmouseup=()=>{if(!dc)return;const dur=parseFloat(dc.box.style.width)/100*1440;openDlg('new',null,{row:dc.row,start:dc.start,end:dc.start+Math.round(dur/STEP)*STEP});dc.box.remove();dc=null;};

/* ---------- dialog ------------------------------------------------ */
const dlg=document.getElementById('shiftDlg'),f=document.getElementById('shiftForm'),roleSel=document.getElementById('roleSel'),startI=document.getElementById('start'),endI=document.getElementById('end'),notes=document.getElementById('notes'),del=document.getElementById('del'),cancel=document.getElementById('cancel');

function fillRoles(sel=''){roleSel.innerHTML=abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')+'<option value="__new__">Other…</option>'; }
roleSel.onchange=()=>{if(roleSel.value!=='__new__')return;const v=prompt('New ability:');if(v){abilities.push(v);fillRoles(v);}else roleSel.selectedIndex=0;};

function openDlg(mode,idx,p){
  fillRoles();
  if(mode==='edit'){const s=shifts[idx];f.index.value=idx;empIn.value=s.name;roleSel.value=s.role;startI.value=fmt(s.start);endI.value=fmt(s.end);notes.value=s.notes||'';del.classList.remove('hidden');}
  else{f.index.value='';f.dataset.row=p.row;empIn.value=workers[p.row].Name;roleSel.selectedIndex=0;startI.value=fmt(p.start);endI.value=fmt(p.end);notes.value='';del.classList.add('hidden');}
  dlg.showModal();
}

/* ---------- dialog submit / delete / cancel ---------------------- */
f.onsubmit=async e=>{
  e.preventDefault();
  const name=empIn.value.trim();
  if(!workers.some(w=>w.Name===name))return alert('Unknown employee');
  const s={name,role:roleSel.value,start:toMin(startI.value),end:toMin(endI.value),notes:notes.value.trim(),date:day.toISOString().slice(0,10)};
  if(s.start>=s.end)return alert('End must be after start');
  if(f.index.value==='')shifts.push(s);else{s.id=shifts[+f.index.value].id;shifts[+f.index.value]=s;}
  await saveShift(s);dlg.close();draw();
};
del.onclick=async()=>{const i=+f.index.value;await deleteShift(shifts[i].id);shifts.splice(i,1);dlg.close();draw();};
cancel.onclick=()=>dlg.close();

/* ---------- nav buttons ------------------------------------------ */
document.getElementById('prev').onclick   =()=>{day.setDate(day.getDate()-1);draw();};
document.getElementById('next').onclick   =()=>{day.setDate(day.getDate()+1);draw();};
document.getElementById('todayBtn').onclick=()=>{day=new Date();draw();};
