// public/schedule.js – Enhanced with Advanced Scheduling Bot
// -----------------------------------------------------------------------------
// • Advanced chat interface with scheduling examples
// • Support for full day/week schedule generation
// • Coverage analysis and validation display
// • Smart scheduling suggestions
// • Robust error handling and data transformation
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
  Scheduling:       "#f97316",
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

/***** COVERAGE ANALYSIS *****/
const analyzeCoverage = (date) => {
  const dayShifts = shifts.filter(s => s.date === date);
  const analysis = {
    violations: [],
    warnings: [],
    summary: { reservations: 0, dispatch: 0, lunch: 0 }
  };
  
  // Check coverage for each hour
  for (let hour = 8; hour <= 20; hour++) {
    const timeStart = hour * 60;
    const timeEnd = timeStart + 60;
    
    const activeShifts = dayShifts.filter(s => 
      s.start < timeEnd && s.end > timeStart && s.role !== 'Lunch'
    );
    
    const reservations = activeShifts.filter(s => s.role === 'Reservations').length;
    const dispatch = activeShifts.filter(s => s.role === 'Dispatch').length;
    
    // Daytime coverage (08:00-17:00)
    if (hour >= 8 && hour < 17) {
      if (reservations !== 3) {
        analysis.violations.push(`${hour}:00 - Expected 3 Reservations, got ${reservations}`);
      }
      if (dispatch !== 1) {
        analysis.violations.push(`${hour}:00 - Expected 1 Dispatch, got ${dispatch}`);
      }
    }
    // Evening coverage (17:00+)
    else if (hour >= 17) {
      if (reservations < 2) {
        analysis.warnings.push(`${hour}:00 - Low Reservations coverage (${reservations})`);
      }
      if (dispatch < 1) {
        analysis.violations.push(`${hour}:00 - No Dispatch coverage`);
      }
    }
  }
  
  // Summary stats
  analysis.summary.reservations = Math.max(...dayShifts.filter(s => s.role === 'Reservations').map(s => 1)) || 0;
  analysis.summary.dispatch = Math.max(...dayShifts.filter(s => s.role === 'Dispatch').map(s => 1)) || 0;
  analysis.summary.lunch = dayShifts.filter(s => s.role === 'Lunch').length;
  
  return analysis;
};

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

/***** INIT WITH ROBUST ERROR HANDLING *****/
(async()=>{
  console.log("🚀 Initializing Fortis Scheduler...");
  
  try {
    // Test basic connectivity first
    console.log("1️⃣ Testing API health...");
    const healthResponse = await fetch("/api/health");
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.status} ${healthResponse.statusText}`);
    }
    const health = await healthResponse.json();
    console.log("✅ API Health:", health.status);
    
    // Load data with individual error handling
    console.log("2️⃣ Loading workers...");
    let workersResponse;
    try {
      workersResponse = await fetch("/api/workers");
      if (!workersResponse.ok) {
        throw new Error(`Workers API failed: ${workersResponse.status} ${workersResponse.statusText}`);
      }
      workers = await workersResponse.json();
      
      // Handle wrapped response format
      if (!Array.isArray(workers) && workers.workers) {
        workers = workers.workers;
      }
      if (!Array.isArray(workers)) {
        throw new Error("Workers data is not an array");
      }
      console.log(`✅ Loaded ${workers.length} workers`);
    } catch (error) {
      console.error("❌ Workers loading failed:", error);
      workers = []; // Fallback to empty array
      alert(`Workers loading failed: ${error.message}. Using empty worker list.`);
    }

    console.log("3️⃣ Loading abilities...");
    try {
      const abilitiesResponse = await fetch("/api/abilities");
      if (!abilitiesResponse.ok) {
        throw new Error(`Abilities API failed: ${abilitiesResponse.status} ${abilitiesResponse.statusText}`);
      }
      abilities = await abilitiesResponse.json();
      
      if (!Array.isArray(abilities)) {
        throw new Error("Abilities data is not an array");
      }
      console.log(`✅ Loaded ${abilities.length} abilities`);
    } catch (error) {
      console.error("❌ Abilities loading failed:", error);
      abilities = ["Reservations", "Dispatch", "Lunch"]; // Fallback
      alert(`Abilities loading failed: ${error.message}. Using default abilities.`);
    }

    console.log("4️⃣ Loading shifts...");
    try {
      const shiftsResponse = await fetch("/api/shifts");
      if (!shiftsResponse.ok) {
        throw new Error(`Shifts API failed: ${shiftsResponse.status} ${shiftsResponse.statusText}`);
      }
      const rawShifts = await shiftsResponse.json();
      
      if (!Array.isArray(rawShifts)) {
        throw new Error("Shifts data is not an array");
      }
      
      // Transform shifts with error handling
      shifts = [];
      rawShifts.forEach((shift, index) => {
        try {
          const transformed = sheetsToFrontend(shift, index);
          shifts.push(transformed);
        } catch (transformError) {
          console.warn(`⚠️ Failed to transform shift ${index}:`, transformError, shift);
        }
      });
      
      console.log(`✅ Loaded and transformed ${shifts.length} shifts`);
    } catch (error) {
      console.error("❌ Shifts loading failed:", error);
      shifts = []; // Fallback to empty array
      alert(`Shifts loading failed: ${error.message}. Using empty schedule.`);
    }

    console.log("5️⃣ Setting up UI...");
    
    // Populate worker dropdown
    if (empDl && workers.length > 0) {
      empDl.innerHTML = workers.map(w => `<option value="${w.Name}">`).join("");
      console.log("✅ Worker dropdown populated");
    } else {
      console.warn("⚠️ Worker dropdown not populated");
    }
    
    // Draw the schedule
    if (typeof draw === 'function') {
      draw();
      console.log("✅ Schedule drawn");
    } else {
      console.error("❌ Draw function not available");
    }
    
    // Initialize chat
    console.log("6️⃣ Initializing chat...");
    if (typeof initChat === 'function') {
      try {
        initChat();
        console.log("✅ Chat initialized");
      } catch (chatError) {
        console.error("❌ Chat initialization failed:", chatError);
        alert(`Chat initialization failed: ${chatError.message}. Manual scheduling still available.`);
      }
    } else {
      console.error("❌ initChat function not available");
    }
    
    console.log("🎉 Fortis Scheduler initialization complete!");
    
  } catch (error) {
    console.error("💥 Critical initialization error:", error);
    alert(`Critical error during initialization: ${error.message}\n\nPlease check:\n1. Google Sheets permissions\n2. Environment variables\n3. Browser console for details`);
    
    // Try to at least show the UI
    if (typeof draw === 'function') {
      try {
        draw();
      } catch (drawError) {
        console.error("Even basic UI drawing failed:", drawError);
      }
    }
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
  
  // Update coverage analysis
  updateCoverageDisplay();
}

const lbl=(t,r=1,c=1)=>{ const d=document.createElement("div"); d.className="rowLabel"; d.textContent=t; d.style.gridRow=r; d.style.gridColumn=c; return d; };
const cell=(r,c,ds={})=>{ const d=document.createElement("div"); d.className="cell"; d.style.gridRow=r; d.style.gridColumn=c; Object.assign(d.dataset,ds); return d; };

// Update coverage display
const updateCoverageDisplay = () => {
  const currentDate = iso(day);
  const analysis = analyzeCoverage(currentDate);
  
  // Update date header with coverage status
  let statusIcon = "✅";
  if (analysis.violations.length > 0) statusIcon = "❌";
  else if (analysis.warnings.length > 0) statusIcon = "⚠️";
  
  dateH.innerHTML = `${day.toDateString()} ${statusIcon}`;
  dateH.title = analysis.violations.length > 0 
    ? `Coverage violations: ${analysis.violations.length}` 
    : analysis.warnings.length > 0 
    ? `Coverage warnings: ${analysis.warnings.length}`
    : "Coverage requirements met";
};

/***** BLOCKS *****/
function placeBlock(s,idx,row){
  const band=grid.querySelectorAll(".band")[row]; 
  if(!band) return;
  
  // Clear any existing blocks for this worker at this time to prevent overlaps
  const existingBlocks = band.querySelectorAll('.block');
  existingBlocks.forEach(block => {
    const blockLeft = parseFloat(block.style.left);
    const blockWidth = parseFloat(block.style.width);
    const blockRight = blockLeft + blockWidth;
    
    const shiftLeft = (s.start/1440*100);
    const shiftWidth = ((s.end-s.start)/1440*100);
    const shiftRight = shiftLeft + shiftWidth;
    
    // Check for overlap
    if (!(shiftRight <= blockLeft || shiftLeft >= blockRight)) {
      // There's an overlap - remove the existing block
      block.remove();
    }
  });
  
  const el=document.createElement("div"); 
  el.className="block";
  el.style.left = `${s.start/1440*100}%`;
  el.style.width= `${(s.end-s.start)/1440*100}%`;
  el.style.background=COLORS[s.role]||"#2563eb";
  el.style.zIndex = s.role === 'Lunch' ? '10' : '5'; // Lunch on top
  
  // Improve text display for small blocks
  const duration = s.end - s.start;
  let displayText;
  
  if (duration < 60) {
    // Very short shift - just show role
    displayText = s.role;
  } else if (duration < 120) {
    // Short shift - role + time
    displayText = `${s.role} ${fmt(s.start)}-${fmt(s.end)}`;
  } else {
    // Normal shift - full display
    displayText = `${s.role} ${fmt(s.start)}-${fmt(s.end)}`;
  }
  
  el.textContent = displayText;
  el.title = `${s.name}: ${s.role} ${fmt(s.start)}-${fmt(s.end)}${s.notes ? ' - ' + s.notes : ''}`;
  el.ondblclick=()=>openDlg("edit",idx);

  // Only add resize handles for blocks wider than 60 minutes
  if (duration >= 60) {
    ["l","r"].forEach(side=>{ 
      const h=document.createElement("span"); 
      h.style.cssText=`position:absolute;top:0;bottom:0;width:6px;cursor:ew-resize;${side==="l"?"left:0;":"right:0;"}background:rgba(0,0,0,0.1);`; 
      h.onmousedown=e=>startResize(e,idx,side); 
      el.appendChild(h); 
    });
  }
  
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
   ENHANCED CHAT WIDGET  
   ========================================================================== */
function initChat() {
  const host = document.getElementById("chatBox");
  if (!host) {
    console.error("❌ chatBox element not found");
    return;
  }
  
  host.innerHTML = `
    <div class="bg-white rounded shadow flex flex-col h-96 border">
      <div class="px-3 py-2 font-semibold border-b bg-blue-50 flex justify-between items-center">
        <span>🤖 Advanced Scheduler Bot</span>
        <button id="chatHelp" class="text-blue-600 text-sm">Examples</button>
      </div>
      <div id="chatLog" class="flex-1 overflow-y-auto space-y-2 p-3 text-sm bg-gray-50"></div>
      <div class="border-t p-3 bg-white">
        <div class="flex gap-2 mb-2">
          <input id="chatInput" type="text"
                 class="flex-1 border rounded px-3 py-2 text-sm"
                 placeholder="Ask me to build schedules..." autocomplete="off" />
          <button id="chatSend" class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Send</button>
        </div>
        <div class="flex gap-1 flex-wrap">
          <button class="quick-btn text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300" 
                  data-msg="Build schedule for today">📅 Today</button>
          <button class="quick-btn text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300" 
                  data-msg="Build schedule for tomorrow">📅 Tomorrow</button>
          <button class="quick-btn text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300" 
                  data-msg="Build full week schedule starting Monday">📅 Week</button>
          <button class="quick-btn text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300" 
                  data-msg="Analyze coverage for today">📊 Coverage</button>
        </div>
      </div>
    </div>`;

  const log   = host.querySelector("#chatLog");
  const input = host.querySelector("#chatInput");
  const send  = host.querySelector("#chatSend");
  const help  = host.querySelector("#chatHelp");

  // Show welcome message
  addMsg("👋 I'm your advanced scheduling assistant! I can build complete schedules, analyze coverage, and handle complex scheduling rules. Try asking me to build a schedule!", "bot");

  /* ---- Helper to add chat bubbles ---- */
  function addMsg(txt, who) {
    const el = document.createElement("div");
    el.className = who === "user" ? "text-right" : "";
    
    const isLongMessage = txt.length > 100;
    const bgClass = who === "user" ? "bg-blue-500 text-white" : "bg-white border";
    
    el.innerHTML = `<div class="inline-block px-3 py-2 rounded-lg max-w-xs ${bgClass} ${isLongMessage ? 'text-left' : ''}">
                     ${txt.replace(/\n/g, '<br>')}</div>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  /* ---- Quick action buttons ---- */
  host.addEventListener('click', (e) => {
    if (e.target.classList.contains('quick-btn')) {
      const message = e.target.dataset.msg;
      input.value = message;
      send.click();
    }
  });

  /* ---- Help/Examples dialog ---- */
  help.onclick = () => {
    const examples = `
🚀 **Advanced Scheduling Commands:**

**Full Schedules:**
• "Build schedule for today"
• "Build schedule for tomorrow" 
• "Build full week schedule starting Monday"
• "Generate schedule for July 15th"

**Individual Shifts:**
• "Schedule Adam for dispatch today 8am to 5pm"
• "Add PTO for Sarah on July 20th"
• "Move Elliott's shift to start at 9am"

**Analysis:**
• "Analyze coverage for today"
• "Check if we have enough dispatch coverage"
• "Show me lunch schedule conflicts"

**Bulk Operations:**
• "Replace all shifts for this week"
• "Optimize specialist time allocation"
• "Fix coverage violations for today"

💡 **Smart Features:**
✅ Maintains exactly 3 Reservations + 1 Dispatch
✅ Schedules lunches in proper windows
✅ Allocates specialist time automatically  
✅ Follows all PTO and availability rules
✅ Validates coverage requirements
    `.trim();
    
    addMsg(examples, "bot");
  };

  /* ---- Send message to /api/chat ---- */
  async function sendChat(msg) {
    addMsg(msg, "user");
    input.value = "";
    
    // Show typing indicator
    const typingEl = document.createElement("div");
    typingEl.innerHTML = `<div class="inline-block px-3 py-2 rounded-lg bg-gray-200">
                           <span class="animate-pulse">🤖 Building schedule...</span></div>`;
    log.appendChild(typingEl);
    log.scrollTop = log.scrollHeight;

    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: msg })
      }).then(r => r.json());

      typingEl.remove();
      addMsg(res.reply || "[no reply]", "bot");

      /* ✅ FIXED: Update shifts with proper data transformation */
      if (res.shifts && Array.isArray(res.shifts)) {
        // Transform shifts from Google Sheets format to frontend format
        shifts = res.shifts.map((shift, index) => sheetsToFrontend(shift, index));
        
        if (res.workers) {
          workers = res.workers;
          empDl.innerHTML = workers.map(w => `<option value="${w.Name}">`).join("");
        }
        
        draw(); // Refresh the display
        
        // Show coverage analysis if it was a schedule build
        if (msg.toLowerCase().includes('build') || msg.toLowerCase().includes('schedule')) {
          const analysis = analyzeCoverage(iso(day));
          if (analysis.violations.length > 0) {
            addMsg(`⚠️ Coverage Issues Found:\n${analysis.violations.slice(0, 3).join('\n')}`, "bot");
          } else {
            addMsg("✅ Schedule meets all coverage requirements!", "bot");
          }
        }
      }
    } catch (err) {
      typingEl.remove();
      console.error("❌ Chat error:", err);
      addMsg("❌ Sorry, I encountered an error. Please try again.", "bot");
    }
  }

  send.onclick    = () => input.value.trim() && sendChat(input.value.trim());
  input.onkeydown = e => { if (e.key === "Enter") send.click(); };
  input.focus();
  
  console.log("✅ Chat initialized successfully!");
}

// Add global error handler
window.addEventListener('error', (event) => {
  console.error('🚨 Global JavaScript Error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error
  });
});

// Add unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  console.error('🚨 Unhandled Promise Rejection:', event.reason);
  event.preventDefault(); // Prevent default browser error handling
});

// Fallback initialization function
window.manualInit = async function() {
  console.log("🔧 Running manual initialization...");
  
  // Set fallback data if needed
  if (typeof workers === 'undefined') workers = [];
  if (typeof abilities === 'undefined') abilities = ["Reservations", "Dispatch", "Lunch"];
  if (typeof shifts === 'undefined') shifts = [];
  
  // Try to initialize chat manually
  if (typeof initChat === 'function') {
    try {
      initChat();
      console.log("✅ Manual chat initialization successful");
    } catch (error) {
      console.error("❌ Manual chat initialization failed:", error);
    }
  }
  
  // Try to draw the grid
  if (typeof draw === 'function') {
    try {
      draw();
      console.log("✅ Manual draw successful");
    } catch (error) {
      console.error("❌ Manual draw failed:", error);
    }
  }
};

/* ==========================================================================
   NAVIGATION BUTTONS
   ========================================================================== */
prevBtn.onclick  = () => { day.setDate(day.getDate() - 1); draw(); };
nextBtn.onclick  = () => { day.setDate(day.getDate() + 1); draw(); };
todayBtn.onclick = () => { day = new Date(); draw(); };
