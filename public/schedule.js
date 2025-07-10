// public/schedule.js – 2025‑07‑07  ✅  FIXED DATA MAPPING
// -----------------------------------------------------------------------------
// • Fixed data transformation between frontend and Google Sheets
// • Proper field mapping: name↔Worker, start/end↔Start/End, etc.
// • Consistent data format handling throughout
// -----------------------------------------------------------------------------

/***** CONFIG *****/
const STEP   = 15;                  // drag‑create snap (minutes)
const COLORS = {
  Reservations:     "#16a34a",
  Dispatch:         "#b91c1c",
  Security:         "#be185d",
  Network:          "#475569",
  "Journey Desk":   "#65a30d",
  Marketing:        "#7c3aed",
  Sales:            "#d97706",
  "Badges/Projects":"#0ea5e9",
  Lunch:            "#8b5a2b"
};

/***** HELPERS *****/
const hh    = h => `${String(h).padStart(2, "0")}:00`;
const fmt   = m => `${String((m/60)|0).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const toMin = t => { if(!t) return 0; const d=t.replace(/[^0-9]/g,"").padStart(4,"0"); return +d.slice(0,2)*60+ +d.slice(2); };
const iso   = d => d.toISOString().slice(0,10);

const hasPTO = (name,dateISO) => { const w=workers.find(w=>w.Name===name); return w?.PTO?.includes(dateISO); };

/* ===== DATA TRANSFORMATION FUNCTIONS ===== */

/**
 * Transform Google Sheets shift format to frontend format
 * Sheets: {Date, Role, Start, End, Worker, Notes}
 * Frontend: {id, name, role, start, end, date, notes}
 */
const sheetsToFrontend = (sheetShift, index) => ({
  id: `shift-${index}-${sheetShift.Date}-${sheetShift.Worker}`, // Generate consistent ID
  name: sheetShift.Worker || "",
  role: sheetShift.Role || "",
  start: typeof sheetShift.Start === 'number' ? sheetShift.Start : toMin(sheetShift.Start),
  end: typeof sheetShift.End === 'number' ? sheetShift.End : toMin(sheetShift.End),
  date: sheetShift.Date || "",
  notes: sheetShift.Notes || ""
});

/**
 * Transform frontend shift format to Google Sheets format
 * Frontend: {id, name, role, start, end, date, notes}
 * Sheets: {Date, Role, Start, End, Worker, Notes}
 */
const frontendToSheets = (frontendShift) => ({
  Date: frontendShift.date || "",
  Role: frontendShift.role || "",
  Start: frontendShift.start || 0,
  End: frontendShift.end || 0,
  Worker: frontendShift.name || "",
  Notes: frontendShift.notes || ""
});

/***** STATE *****/
let workers=[], abilities=[], shifts=[];
let day = location.hash ? new Date(location.hash.slice(1)) : new Date();

/***** DOM *****/
const grid     = document.getElementById("grid");
const wrap     = document.getElementById("wrap");
const dateH    = document.getElementById("date");
const prevBtn  = document.getElementById("prev");
const nextBtn  = document.getElementById("next");
const todayBtn = document.getElementById("todayBtn");
const empDl    = document.getElementById("workerList");

/***** INIT *****/
(async()=>{
  try {
    [workers, abilities] = await Promise.all([
      fetch("/api/workers").then(r => r.json()),
      fetch("/api/abilities").then(r => r.json())
    ]);

    // ✅ FIXED: Transform shifts from Google Sheets format to frontend format
    const rawShifts = await fetch("/api/shifts").then(r => r.json());
    shifts = rawShifts.map((shift, index) => sheetsToFrontend(shift, index));
    
    console.log(`✅ Loaded ${workers.length} workers, ${shifts.length} shifts`);
    
    empDl.innerHTML = workers.map(w => `<option value="${w.Name}">`).join("");
    draw();
    initChat();
  } catch (error) {
    console.error("❌ Failed to load initial data:", error);
    alert("Failed to load scheduling data. Please refresh and try again.");
  }
})();

/***** PERSIST (Google Sheets) *****/
const persist = async () => {
  try {
    // ✅ FIXED: Transform shifts from frontend format to Google Sheets format
    const sheetsFormat = shifts.map(frontendToSheets);
    
    console.log(`💾 Saving ${sheetsFormat.length} shifts to Google Sheets...`);
    
    const response = await fetch("/api/shifts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shifts: sheetsFormat })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ Successfully saved ${sheetsFormat.length} shifts to Google Sheets`);
    return result;
  } catch (error) {
    console.error("❌ Failed to save shifts to Google Sheets:", error);
    alert("Failed to save changes to Google Sheets. Please try again.");
    throw error;
  }
};

/* upsert a shift in the local array, then flush the whole array */
const saveShift = async (shift) => {
  if (!shift.id) {
    // Generate a consistent ID for new shifts
    shift.id = `shift-${Date.now()}-${shift.name}-${shift.role}`;
  }
  
  const index = shifts.findIndex(s => s.id === shift.id);
  if (index === -1) {
    shifts.push(shift);
  } else {
    shifts[index] = shift;
  }
  
  return await persist();
};

/* remove from the array, then flush */
const deleteShift = async (id) => {
  const index = shifts.findIndex(s => s.id === id);
  if (index !== -1) {
    shifts.splice(index, 1);
    console.log(`🗑️ Deleting shift ${id}, ${shifts.length} shifts remaining`);
    return await persist();
  } else {
    console.warn(`⚠️ Shift ${id} not found for deletion`);
  }
};

/***** GRID RENDER *****/
function firstStart(n){ const f=shifts.filter(s=>s.name===n&&s.date===iso(day)).sort((a,b)=>a.start-b.start)[0]; return f?f.start:1441; }
function draw(){
  const sorted=[...workers].sort((a,b)=>{ const sa=firstStart(a.Name), sb=firstStart(b.Name); return sa!==sb?sa-sb:a.Name.localeCompare(b.Name); });
  const rowOf=Object.fromEntries(sorted.map((w,i)=>[w.Name,i]));
  grid.innerHTML="";
  grid.style.gridTemplateRows=`30px repeat(${sorted.length},30px)`;

  grid.appendChild(lbl(""));
  for(let h=0;h<24;h++) grid.appendChild(lbl(hh(h),1,h+2));

  sorted.forEach((w,r)=>{
    const pto=hasPTO(w.Name,iso(day));
    const label=lbl(w.Name,r+2,1); if(pto) label.style.background="#e5e7eb"; grid.appendChild(label);
    for(let h=0;h<24;h++){ const c=cell(r+2,h+2,{row:r,hour:h}); if(pto) c.style.background="#f9fafb"; grid.appendChild(c);}   
    const band=document.createElement("div"); band.className="band"; band.style.gridRow=r+2; if(pto) band.style.background="rgba(0,0,0,.05)"; grid.appendChild(band);
  });

  // ✅ FIXED: Filter shifts for current day and place blocks
  const todayShifts = shifts.filter(s => s.date === iso(day));
  todayShifts.forEach(shift => {
    const shiftIndex = shifts.findIndex(s => s.id === shift.id);
    const rowIndex = rowOf[shift.name];
    if (rowIndex !== undefined) {
      placeBlock(shift, shiftIndex, rowIndex);
    }
  });

  dateH.textContent=day.toDateString(); 
  location.hash=iso(day);
}

const lbl=(t,r=1,c=1)=>{ const d=document.createElement("div"); d.className="rowLabel"; d.textContent=t; d.style.gridRow=r; d.style.gridColumn=c; return d; };
const cell=(r,c,ds={})=>{ const d=document.createElement("div"); d.className="cell"; d.style.gridRow=r; d.style.gridColumn=c; Object.assign(d.dataset,ds); return d; };

/***** BLOCKS *****/
function placeBlock(s,idx,row){
  const band=grid.querySelectorAll(".band")[row]; if(!band) return;
  const el=document.createElement("div"); el.className="block";
  el.style.left = `${s.start/1440*100}%`;
  el.style.width= `${(s.end-s.start)/1440*100}%`;
  el.style.background=COLORS[s.role]||"#2563eb";
  el.textContent=`${s.role} ${fmt(s.start)}-${fmt(s.end)}`;
  el.ondblclick=()=>openDlg("edit",idx);

  ["l","r"].forEach(side=>{ const h=document.createElement("span"); h.style.cssText=`position:absolute;top:0;bottom:0;width:6px;cursor:ew-resize;${side==="l"?"left:0;":"right:0;"}`; h.onmousedown=e=>startResize(e,idx,side); el.appendChild(h); });
  el.onmousedown=e=>{ if(e.target.tagName==="SPAN") return; startMove(e,idx,row,el); };
  band.appendChild(el);
}

/* ==========================================================================
   RESIZE HANDLERS
   ========================================================================== */
let rs = null; // {idx, side, startX, orig}
function startResize(e, idx, side) {
  e.stopPropagation();
  rs = { idx, side, startX: e.clientX, orig: { ...shifts[idx] } };
  document.onmousemove = doResize;
  document.onmouseup = endResize;
}
function doResize(e) {
  if (!rs) return;
  const px = grid.querySelector(".band").getBoundingClientRect().width / 1440;
  const diff = Math.round((e.clientX - rs.startX) / px / STEP) * STEP;
  const s = shifts[rs.idx];
  if (rs.side === "l") s.start = Math.max(0, Math.min(s.end - STEP, rs.orig.start + diff));
  else s.end = Math.min(1440, Math.max(s.start + STEP, rs.orig.end + diff));
  draw();
}
function endResize() {
  if (rs) saveShift(shifts[rs.idx]);
  rs = null;
  document.onmousemove = document.onmouseup = null;
}

/* ==========================================================================
   MOVE HANDLERS
   ========================================================================== */
let mv = null; // {idx,row,startX,startY,moved,preview,origEl}
function startMove(e, idx, row, origEl) {
  e.preventDefault();
  mv = { idx, row, startX: e.clientX, startY: e.clientY, moved: false, origEl };
  document.onmousemove = doMove;
  document.onmouseup = endMove;
}
function doMove(e) {
  if (!mv) return;
  if (!mv.moved) {
    if (Math.abs(e.clientX - mv.startX) < 4 && Math.abs(e.clientY - mv.startY) < 4) return;
    mv.moved = true;
    mv.preview = mv.origEl.cloneNode(true);
    mv.preview.style.opacity = 0.5;
    mv.preview.style.pointerEvents = "none";
    grid.appendChild(mv.preview);
  }
  const px = grid.querySelector(".band").getBoundingClientRect().width / 1440;
  const diff = Math.round((e.clientX - mv.startX) / px / STEP) * STEP;
  let st = shifts[mv.idx].start + diff;
  let en = shifts[mv.idx].end + diff;
  if (st < 0) {
    en -= st;
    st = 0;
  }
  if (en > 1440) {
    st -= en - 1440;
    en = 1440;
  }
  mv.preview.style.left = `${(st / 1440) * 100}%`;
  mv.preview.style.width = `${((en - st) / 1440) * 100}%`;
  const diffRow = Math.round((e.clientY - mv.startY) / 30);
  const newRow = Math.max(0, Math.min(workers.length - 1, mv.row + diffRow));
  mv.preview.style.gridRow = newRow + 2;
}
function endMove(e) {
  document.onmousemove = document.onmouseup = null;
  if (!mv) return;
  if (!mv.moved) {
    openDlg("edit", mv.idx);
    mv = null;
    return;
  }

  const bandW = grid.querySelector(".band").getBoundingClientRect().width;
  const px = bandW / 1440;
  const diff = Math.round((e.clientX - mv.startX) / px / STEP) * STEP;
  const s = shifts[mv.idx];
  s.start = Math.max(0, Math.min(1440 - STEP, s.start + diff));
  s.end = Math.min(1440, Math.max(s.start + STEP, s.end + diff));
  const diffRow = Math.round((e.clientY - mv.startY) / 30);
  s.name = workers[Math.max(0, Math.min(workers.length - 1, mv.row + diffRow))].Name;

  mv.preview.remove();
  mv = null;
  saveShift(s).then(draw);
}

/* ==========================================================================
   DRAG‑CREATE
   ========================================================================== */
let dc = null; // {row,start,box}
grid.onmousedown = e => {
  if (!e.target.dataset.hour) return;
  dc = { row: +e.target.dataset.row, start: +e.target.dataset.hour * 60 };
  dc.box = document.createElement("div");
  dc.box.className = "dragBox";
  grid.querySelectorAll(".band")[dc.row].appendChild(dc.box);
};
grid.onmousemove = e => {
  if (!dc || +e.target.dataset.row !== dc.row || !e.target.dataset.hour) return;
  const end = (+e.target.dataset.hour + 1) * 60;
  dc.box.style.left = `${(dc.start / 1440) * 100}%`;
  dc.box.style.width = `${(Math.max(STEP, end - dc.start) / 1440) * 100}%`;
};
grid.onmouseup = () => {
  if (!dc) return;
  const duration = (parseFloat(dc.box.style.width) / 100) * 1440;
  openDlg("new", null, {
    row: dc.row,
    start: dc.start,
    end: dc.start + Math.round(duration / STEP) * STEP
  });
  dc.box.remove();
  dc = null;
};

/* ==========================================================================
   SHIFT DIALOG
   ========================================================================== */
const dlg       = document.getElementById("shiftDlg");
const form      = document.getElementById("shiftForm");
const empIn     = document.getElementById("empSel");
const roleSel   = document.getElementById("roleSel");
const startI    = document.getElementById("start");
const endI      = document.getElementById("end");
const notesI    = document.getElementById("notes");
const delBtn    = document.getElementById("del");
const cancelBtn = document.getElementById("cancel");

function fillRoles(selected = "") {
  roleSel.innerHTML = abilities
    .map(a => `<option value="${a}"${a === selected ? " selected" : ""}>${a}</option>`) 
    .join("");
}

function openDlg(mode, idx = null, tpl = {}) {
  form.reset();
  fillRoles();
  delBtn.classList.toggle("hidden", mode === "new");

  if (mode === "edit") {
    const s = shifts[idx];
    form.index.value = idx;
    empIn.value  = s.name;
    fillRoles(s.role);
    startI.value = fmt(s.start);
    endI.value   = fmt(s.end);
    notesI.value = s.notes || "";
  } else {
    form.index.value = "";
    empIn.value  = workers[tpl.row]?.Name || "";
    startI.value = fmt(tpl.start);
    endI.value   = fmt(tpl.end);
  }

  dlg.showModal();
  empIn.focus();
}

/* ----- SAVE / UPDATE ----- */
form.onsubmit = async e => {
  e.preventDefault();
  
  try {
    const idx = form.index.value ? +form.index.value : null;
    const shift = {
      id: idx != null ? shifts[idx].id : undefined,
      name: empIn.value.trim(),
      role: roleSel.value,
      start: toMin(startI.value),
      end: toMin(endI.value),
      date: iso(day),
      notes: notesI.value.trim()
    };

    if (idx != null) {
      shifts[idx] = shift;
    } else {
      shifts.push(shift);
    }

    await saveShift(shift);
    dlg.close();
    draw();
  } catch (error) {
    console.error("❌ Failed to save shift:", error);
    // Don't close dialog so user can try again
  }
};

/* ----- DELETE ----- */
delBtn.onclick = async () => {
  try {
    const idx = +form.index.value;
    if (Number.isNaN(idx)) return;
    
    if (!confirm('Delete this shift?')) return;
    
    const shiftToDelete = shifts[idx];
    if (!shiftToDelete) {
      console.error('Shift not found at index', idx);
      return;
    }
    
    console.log(`🗑️ Deleting shift: ${shiftToDelete.name} - ${shiftToDelete.role}`);
    
    // Call deleteShift which handles array removal AND Google Sheets sync
    await deleteShift(shiftToDelete.id);
    
    dlg.close();
    draw();
  } catch (error) {
    console.error("❌ Failed to delete shift:", error);
    alert("Failed to delete shift. Please try again.");
  }
};

/* ----- CANCEL ----- */
cancelBtn.onclick = () => dlg.close();
dlg.oncancel = () => dlg.close();
dlg.addEventListener("close", () => form.reset());

/* ==========================================================================
   CHAT WIDGET
   ========================================================================== */
function initChat() {
  const host = document.getElementById("chatBox");
  host.innerHTML = `
    <div class="bg-white rounded shadow flex flex-col h-72">
      <div class="px-3 py-1 font-semibold border-b">SydPo Bot</div>
      <div id="chatLog" class="flex-1 overflow-y-auto space-y-1 p-2 text-sm"></div>
      <div class="border-t p-2 flex gap-2">
        <input id="chatInput" type="text"
               class="flex-1 border rounded px-2 py-1 text-sm"
               placeholder="Ask me…" autocomplete="off" />
        <button id="chatSend" class="text-blue-600 text-xl">&#x27A4;</button>
      </div>
    </div>`;

  const log   = host.querySelector("#chatLog");
  const input = host.querySelector("#chatInput");
  const send  = host.querySelector("#chatSend");

  /* ---- tiny helper to push bubbles ---- */
  const addMsg = (txt, who) => {
    const el = document.createElement("div");
    el.className = who === "user" ? "text-right" : "";
    el.innerHTML = `<span class="inline-block px-2 py-1 rounded
                     ${who === "user" ? "bg-blue-200" : "bg-gray-200"}">
                     ${txt}</span>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  };

  /* ---- send message to /api/chat ---- */
  async function sendChat(msg) {
    addMsg(msg, "user");
    input.value = "";

    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: msg })
      }).then(r => r.json());

      addMsg(res.reply || "[no reply]", "bot");

      /* ✅ FIXED: Update shifts with proper data transformation */
      if ((res.reply || "").trim().toUpperCase() === "OK") {
        if (res.shifts) {
          // Transform shifts from Google Sheets format to frontend format
          shifts = res.shifts.map((shift, index) => sheetsToFrontend(shift, index));
          
          if (res.workers) {
            workers = res.workers;
            empDl.innerHTML = workers.map(w => `<option value="${w.Name}">`).join("");
          }
        } else {
          // Fallback: re-fetch and transform
          const [newWorkers, rawShifts] = await Promise.all([
            fetch("/api/workers").then(r => r.json()),
            fetch("/api/shifts").then(r => r.json())
          ]);
          workers = newWorkers;
          shifts = rawShifts.map((shift, index) => sheetsToFrontend(shift, index));
          empDl.innerHTML = workers.map(w => `<option value="${w.Name}">`).join("");
        }
        draw();
      }
    } catch (err) {
      console.error("❌ Chat error:", err);
      addMsg("[error]", "bot");
    }
  }

  send.onclick    = () => input.value.trim() && sendChat(input.value.trim());
  input.onkeydown = e => { if (e.key === "Enter") send.click(); };
  input.focus();
}

/* ==========================================================================
   NAVIGATION BUTTONS
   ========================================================================== */
prevBtn.onclick  = () => { day.setDate(day.getDate() - 1); draw(); };
nextBtn.onclick  = () => { day.setDate(day.getDate() + 1); draw(); };
todayBtn.onclick = () => { day = new Date(); draw(); };
