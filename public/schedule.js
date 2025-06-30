/* ---------- helpers & palette ------------------------------------ */
const COLORS={
  Reservations:'#16a34a',Dispatch:'#b91c1c',Security:'#be185d',
  Network:'#475569','Journey Desk':'#65a30d',Marketing:'#7c3aed',
  Sales:'#d97706','Badges/Projects':'#0ea5e9'
};
const hh=n=>String(n).padStart(2,'0')+':00';
const toHM = t=>{const [h,m]=t.split(':').map(Number);return h*60+m;};
const fmt  = m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

const sameDay=(a,b)=>a.toDateString()===b.toDateString();

/* ---------- state ------------------------------------------------- */
let workers=[], abilities=[], blocks=[];
let cur=location.hash?new Date(location.hash.slice(1)):new Date;

const grid=document.getElementById('grid'),wrap=document.getElementById('wrap'),dateH=document.getElementById('date');

/* ---------- init -------------------------------------------------- */
(async()=>{
  [workers,abilities]=await Promise.all([
    fetch('/api/workers').then(r=>r.json()),
    fetch('/api/abilities').then(r=>r.json())
  ]);
  draw();
})();

/* ---------- render grid ------------------------------------------- */
function draw(){
  dateH.textContent=cur.toDateString(); location.hash=cur.toISOString().slice(0,10);
  grid.innerHTML=''; grid.style.gridTemplateRows=`30px repeat(${workers.length},30px)`;

  grid.appendChild(hdr(''));                       // TL empty
  for(let h=0;h<24;h++) grid.appendChild(hdr(hh(h),'',h+2));

  workers.forEach((w,r)=>{
    grid.appendChild(hdr(w.Name,'',r+2));

    // row band for absolute shift placement
    const band=document.createElement('div');
    band.className='band'; band.style.gridRow=`${r+2}`; grid.appendChild(band);
  });

  blocks.filter(b=>sameDay(b.date,cur)).forEach((b,i)=>makeBlock(b,i));
  wrap.scrollTop=0;
}
function hdr(txt,cls='',col){const d=document.createElement('div');d.textContent=txt;d.className='rowLabel '+cls;if(col)d.style.gridColumn=col;return d;}

/* ---------- shift block ------------------------------------------- */
function makeBlock(b,idx){
  const row=workers.findIndex(w=>w.Name===b.name); if(row<0)return;
  const band=grid.querySelectorAll('.band')[row];

  const dur=b.end-b.start;               // minutes
  const left= b.start/1440*100;          // %
  const width= dur/1440*100;             // %

  const el=document.createElement('div');
  el.className='block'; el.style.cssText=
    `left:${left}%;width:${width}%;background:${COLORS[b.role]||'#2563eb'}`;
  el.textContent=`${b.role} ${fmt(b.start)}-${fmt(b.end)}`;
  el.ondblclick=()=>popup('edit',idx);
  band.appendChild(el);
}

/* ---------- dragging create --------------------------------------- */
let sel=null;
grid.addEventListener('mousedown',e=>{
  if(!e.target.classList.contains('cell'))return;
  sel={row:[...grid.querySelectorAll('.cell')].indexOf(e.target)%24 ? +e.target.dataset.row : +e.target.parentNode.dataset.row,
       start:+e.target.dataset.hour*60,
       tmp:document.createElement('div')};
  sel.tmp.className='dragBox';
  const band=grid.querySelectorAll('.band')[sel.row]; band.appendChild(sel.tmp);
});
grid.addEventListener('mousemove',e=>{
  if(!sel||!e.target.classList.contains('cell')||+e.target.dataset.row!==sel.row)return;
  const end=(+e.target.dataset.hour+1)*60;
  const left= sel.start/1440*100;
  const width= Math.max(60,end-sel.start)/1440*100;
  sel.tmp.style.cssText=`left:${left}%;width:${width}%;`;
});
grid.addEventListener('mouseup',()=>{
  if(!sel)return;
  const widthPct=parseFloat(sel.tmp.style.width);
  const dur=Math.round(widthPct/100*1440);
  popup('new',null,{row:sel.row,start:sel.start,end:sel.start+dur});
  sel.tmp.remove(); sel=null;
});

/* ---------- dialog ------------------------------------------------ */
const dlg=document.getElementById('shiftDlg'),f=document.getElementById('shiftForm'),
      roleSel=document.getElementById('roleSel'),startIn=document.getElementById('start'),
      endIn=document.getElementById('end'),notes=document.getElementById('notes'),
      del=document.getElementById('del'),cancel=document.getElementById('cancel');

roleSel.onchange=()=>{if(roleSel.value!=='__new__')return;const v=prompt('New ability:');if(v){abilities.push(v);fillRoles(v);}else roleSel.selectedIndex=0;};
function fillRoles(sel=''){roleSel.innerHTML=abilities.map(a=>`<option ${a===sel?'selected':''}>${a}</option>`).join('')+'<option value="__new__">Other…</option>';}

function popup(mode,idx,p){ fillRoles();
  if(mode==='edit'){
    const b=blocks[idx];f.index.value=idx;roleSel.value=b.role;
    startIn.value=fmt(b.start);endIn.value=fmt(b.end);
    notes.value=b.notes||'';del.classList.remove('hidden');
  }else{
    f.index.value='';f.dataset.row=p.row;roleSel.selectedIndex=0;
    startIn.value=fmt(p.start);endIn.value=fmt(p.end);
    notes.value='';del.classList.add('hidden');
  }
  dlg.showModal();
}
f.onsubmit=e=>{
  e.preventDefault();
  const b={role:roleSel.value,start:toHM(startIn.value),end:toHM(endIn.value),notes:notes.value};
  if(b.start>=b.end)return alert('End after start');
  if(f.index.value===''){blocks.push({...b,name:workers[+f.dataset.row].Name,date:new Date(cur)});}
  else Object.assign(blocks[+f.index.value],b);
  dlg.close();draw();
};
del.onclick=()=>{blocks.splice(+f.index.value,1);dlg.close();draw();};
cancel.onclick=()=>dlg.close();

/* ---------- prev / next day nav ---------------------------------- */
document.getElementById('prev').onclick=()=>{cur.setDate(cur.getDate()-1);draw();};
document.getElementById('next').onclick=()=>{cur.setDate(cur.getDate()+1);draw();};
