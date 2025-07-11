// public/schedule.js – FIXED: Day View Display & Week Layout
// -----------------------------------------------------------------------------
// • Fixed day view not displaying shifts
// • Improved week view spacing and readability
// • Better shift block positioning and sizing
// • Enhanced error handling and debugging
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
const toMin = t => { 
  if(!t) return 0; 
  // Handle both "HH:MM" and "HHMM" formats
  if (typeof t === 'string' && t.includes(':')) {
    const [hours, minutes] = t.split(':').map(Number);
    return hours * 60 + minutes;
  }
  const d = t.toString().replace(/[^0-9]/g,"").padStart(4,"0"); 
  return +d.slice(0,2)*60+ +d.slice(2); 
};

// 🔧 FIXED: Consistent date handling to prevent day shifting
const iso = d => {
  // Ensure we're working with local date, not UTC
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper to parse date strings consistently
const parseDate = (dateStr) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day); // month is 0-indexed
};

const hasPTO = (name,dateISO) => { 
  const w=workers.find(w=>w.Name===name); 
  return w?.PTO?.includes(dateISO); 
};

/* ===== DATA TRANSFORMATION FUNCTIONS ===== */

/**
 * Transform Google Sheets shift format to frontend format
 * Sheets: {Date, Role, Start, End, Worker, Notes}
 * Frontend: {id, name, role, start, end, date, notes}
 */
const sheetsToFrontend = (sheetShift, index) => ({
  id: `shift-${index}-${sheetShift.Date}-${sheetShift.Worker}`, 
  name: sheetShift.Worker || "",
  role: sheetShift.Role || "",
  start: typeof sheetShift.Start === 'number' ? sheetShift.Start : toMin(sheetShift.Start),
  end: typeof sheetShift.End === 'number' ? sheetShift.End : toMin(sheetShift.End),
  date: sheetShift.Date || "",
  notes: sheetShift.Notes || ""
});

/**
 * Transform frontend shift format to Google Sheets format
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
  
  return analysis;
};

/***** STATE *****/
let workers=[], abilities=[], shifts=[];
let day = location.hash ? parseDate(location.hash.slice(1)) : new Date();
let currentView = 'day'; // 'day' or 'week'
let weekStart = new Date(); // Monday of current week

/***** DOM *****/
const dayView    = document.getElementById("dayView");
const weekView   = document.getElementById("weekView");
const wrap       = document.getElementById("wrap");
const dateH      = document.getElementById("dateH");
const prevBtn    = document.getElementById("prevBtn");
const nextBtn    = document.getElementById("nextBtn");
const todayBtn   = document.getElementById("todayBtn");
const dayViewBtn = document.getElementById("dayBtn");
const weekViewBtn= document.getElementById("weekBtn");
const empDl      = document.getElementById("workerList");

/***** VIEW TOGGLE *****/
const setView = (view) => {
  currentView = view;
  
  if (view === 'day') {
    dayView.classList.remove('hidden');
    weekView.classList.add('hidden');
    dayViewBtn.classList.remove('bg-gray-200');
    dayViewBtn.classList.add('bg-blue-600', 'text-white');
    weekViewBtn.classList.remove('bg-blue-600', 'text-white');
    weekViewBtn.classList.add('bg-gray-200');
    draw();
  } else {
    dayView.classList.add('hidden');
    weekView.classList.remove('hidden');
    dayViewBtn.classList.remove('bg-blue-600', 'text-white');
    dayViewBtn.classList.add('bg-gray-200');
    weekViewBtn.classList.remove('bg-gray-200');
    weekViewBtn.classList.add('bg-blue-600', 'text-white');
    drawWeek();
  }
};

dayViewBtn.onclick = () => setView('day');
weekViewBtn.onclick = () => setView('week');

/***** WEEK NAVIGATION HELPERS *****/
const getMonday = (date) => {
  const d = new Date(date);
  const dayOfWeek = d.getDay();
  const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
};

const getWeekDates = (mondayDate) => {
  const dates = [];
  for (let i = 0; i < 5; i++) { // Monday to Friday
    const date = new Date(mondayDate);
    date.setDate(mondayDate.getDate() + i);
    dates.push(date);
  }
  return dates;
};

/***** INIT WITH ROBUST ERROR HANDLING *****/
(async()=>{
  console.log("🚀 Initializing Fortis Scheduler...");
  
  try {
    // Load data with individual error handling
    console.log("📊 Loading data...");
    
    try {
      workers = await fetch("/api/workers").then(r => r.json());
      if (!Array.isArray(workers) && workers.workers) workers = workers.workers;
      if (!Array.isArray(workers)) workers = [];
      console.log(`✅ Loaded ${workers.length} workers`);
    } catch (error) {
      console.error("❌ Workers loading failed:", error);
      workers = [];
    }

    try {
      abilities = await fetch("/api/abilities").then(r => r.json());
      if (!Array.isArray(abilities)) abilities = ["Reservations", "Dispatch", "Lunch"];
      console.log(`✅ Loaded ${abilities.length} abilities`);
    } catch (error) {
      console.error("❌ Abilities loading failed:", error);
      abilities = ["Reservations", "Dispatch", "Lunch"];
    }

    try {
      const rawShifts = await fetch("/api/shifts").then(r => r.json());
      if (!Array.isArray(rawShifts)) {
        shifts = [];
      } else {
        shifts = rawShifts.map((shift, index) => sheetsToFrontend(shift, index));
      }
      console.log(`✅ Loaded and transformed ${shifts.length} shifts`);
    } catch (error) {
      console.error("❌ Shifts loading failed:", error);
      shifts = [];
    }

    // Setup UI
    if (empDl && workers.length > 0) {
      empDl.innerHTML = workers.map(w => `<option value="${w.Name}">`).join("");
    }
    
    weekStart = getMonday(day);
    setView('day'); // Start with day view
    
    // Initialize chat
    if (typeof initChat === 'function') {
      try {
        initChat();
      } catch (chatError) {
        console.error("❌ Chat initialization failed:", chatError);
      }
    }
    
    console.log("🎉 Fortis Scheduler initialization complete!");
    
  } catch (error) {
    console.error("💥 Critical initialization error:", error);
    setView('day'); // Try to show something
  }
})();

/***** PERSIST (Google Sheets) *****/
const persist = async () => {
  try {
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
    console.log(`✅ Successfully saved ${sheetsFormat.length} shifts`);
    return result;
  } catch (error) {
    console.error("❌ Failed to save shifts:", error);
    alert("Failed to save changes. Please try again.");
    throw error;
  }
};

const saveShift = async (shift) => {
  if (!shift.id) {
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

const deleteShift = async (id) => {
  const index = shifts.findIndex(s => s.id === id);
  if (index !== -1) {
    shifts.splice(index, 1);
    console.log(`🗑️ Deleting shift ${id}, ${shifts.length} shifts remaining`);
    return await persist();
  }
};

/***** 🔧 FIXED: DAY VIEW RENDER *****/
function firstStart(n){ 
  const f=shifts.filter(s=>s.name===n&&s.date===iso(day)).sort((a,b)=>a.start-b.start)[0]; 
  return f?f.start:1441; 
}

function draw(){
  if (currentView !== 'day') return;
  
  console.log(`🎨 Drawing day view for ${iso(day)}`);
  
  const sorted=[...workers].sort((a,b)=>{ 
    const sa=firstStart(a.Name), sb=firstStart(b.Name); 
    return sa!==sb?sa-sb:a.Name.localeCompare(b.Name); 
  });
  const rowOf=Object.fromEntries(sorted.map((w,i)=>[w.Name,i]));
  
  dayView.innerHTML="";
  dayView.className = "day-grid";
  dayView.style.gridTemplateRows=`30px repeat(${sorted.length},40px)`; // Increased row height

  // Header row
  dayView.appendChild(lbl(""));
  for(let h=0;h<24;h++) dayView.appendChild(lbl(hh(h),1,h+2));

  // Worker rows
  sorted.forEach((w,r)=>{
    const pto=hasPTO(w.Name,iso(day));
    const label=lbl(w.Name,r+2,1); 
    if(pto) label.style.background="#e5e7eb"; 
    dayView.appendChild(label);
    
    for(let h=0;h<24;h++){ 
      const c=cell(r+2,h+2,{row:r,hour:h}); 
      if(pto) c.style.background="#f9fafb"; 
      dayView.appendChild(c);
    }   
    
    const band=document.createElement("div"); 
    band.className="band day-band"; 
    band.style.gridRow=r+2; 
    band.style.gridColumn="2 / -1"; // Span all hour columns
    if(pto) band.style.background="rgba(0,0,0,.05)"; 
    dayView.appendChild(band);
  });

  // 🔧 FIXED: Filter and place shifts for current day
  const currentDate = iso(day);
  const todayShifts = shifts.filter(s => s.date === currentDate);
  console.log(`📅 Found ${todayShifts.length} shifts for ${currentDate}`);
  
  if (todayShifts.length === 0) {
    console.log("⚠️ No shifts found for today");
  }
  
  todayShifts.forEach((shift, index) => {
    const rowIndex = rowOf[shift.name];
    if (rowIndex !== undefined) {
      console.log(`🔧 Placing shift: ${shift.name} - ${shift.role} (${fmt(shift.start)}-${fmt(shift.end)})`);
      placeBlock(shift, shifts.findIndex(s => s.id === shift.id), rowIndex, dayView);
    } else {
      console.warn(`⚠️ Worker ${shift.name} not found in current worker list`);
    }
  });

  updateCoverageDisplay();
}

/***** 🔧 FIXED: WEEK VIEW RENDER WITH BETTER SPACING *****/
function drawWeek() {
  if (currentView !== 'week') return;
  
  const weekDates = getWeekDates(weekStart);
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  
  console.log(`🗓️ Drawing week view for ${weekDates.map(d => iso(d)).join(', ')}`);
  
  // Update week headers
  weekDates.forEach((date, index) => {
    const headerEl = document.getElementById(`weekDay${index}`);
    
    if (headerEl) {
      const analysis = analyzeCoverage(iso(date));
      let statusIcon = "✅";
      if (analysis.violations.length > 0) statusIcon = "❌";
      else if (analysis.warnings.length > 0) statusIcon = "⚠️";
      
      headerEl.innerHTML = `${dayNames[index]}<br><small>${date.getMonth() + 1}/${date.getDate()} ${statusIcon}</small>`;
    }
  });
  
  // Clear and rebuild worker rows
  const existingWorkerRows = weekView.querySelectorAll('.week-worker-row');
  existingWorkerRows.forEach(row => row.remove());
  
  // Sort workers
  const sorted = [...workers].sort((a, b) => {
    const weekShiftsA = shifts.filter(s => 
      weekDates.some(d => iso(d) === s.date) && s.name === a.Name
    );
    const weekShiftsB = shifts.filter(s => 
      weekDates.some(d => iso(d) === s.date) && s.name === b.Name
    );
    
    const firstA = weekShiftsA.length > 0 ? Math.min(...weekShiftsA.map(s => s.start)) : 1441;
    const firstB = weekShiftsB.length > 0 ? Math.min(...weekShiftsB.map(s => s.start)) : 1441;
    
    return firstA !== firstB ? firstA - firstB : a.Name.localeCompare(b.Name);
  });
  
  // Add worker rows with improved spacing
  sorted.forEach((worker, rowIndex) => {
    // Worker name label
    const workerLabel = document.createElement('div');
    workerLabel.className = 'rowLabel week-worker-row';
    workerLabel.style.gridRow = rowIndex + 2;
    workerLabel.style.gridColumn = '1';
    workerLabel.textContent = worker.Name;
    
    const hasPTOThisWeek = weekDates.some(date => hasPTO(worker.Name, iso(date)));
    if (hasPTOThisWeek) {
      workerLabel.style.background = '#e5e7eb';
    }
    
    weekView.appendChild(workerLabel);
    
    // Day columns for this worker with better spacing
    weekDates.forEach((date, dayIndex) => {
      const dayColumn = document.createElement('div');
      dayColumn.className = 'week-day-cell week-worker-row';
      dayColumn.style.gridRow = rowIndex + 2;
      dayColumn.style.gridColumn = dayIndex + 2;
      dayColumn.style.borderRight = '1px solid #e5e7eb';
      dayColumn.style.borderBottom = '1px solid #e5e7eb';
      dayColumn.style.minHeight = '80px'; // Increased height for better spacing
      dayColumn.style.position = 'relative';
      dayColumn.style.padding = '4px';
      dayColumn.style.overflow = 'hidden';
      
      if (hasPTO(worker.Name, iso(date))) {
        dayColumn.style.background = '#f9fafb';
        const ptoLabel = document.createElement('div');
        ptoLabel.textContent = 'PTO';
        ptoLabel.style.cssText = 'font-size: 0.75rem; color: #6b7280; text-align: center; padding: 8px;';
        dayColumn.appendChild(ptoLabel);
      } else {
        // Add shifts with better layout
        const dayShifts = shifts.filter(s => s.date === iso(date) && s.name === worker.Name);
        
        dayShifts.forEach((shift, shiftIndex) => {
          const shiftBlock = document.createElement('div');
          shiftBlock.className = 'week-block';
          shiftBlock.style.background = COLORS[shift.role] || '#2563eb';
          shiftBlock.style.height = '16px'; // Fixed height
          shiftBlock.style.marginBottom = '2px'; // Spacing between shifts
          shiftBlock.style.display = 'block';
          shiftBlock.style.position = 'relative';
          
          // Better text formatting for readability
          const duration = shift.end - shift.start;
          let displayText;
          if (duration < 120) { // Less than 2 hours
            displayText = shift.role;
          } else {
            displayText = `${shift.role} ${fmt(shift.start)}-${fmt(shift.end)}`;
          }
          
          shiftBlock.textContent = displayText;
          shiftBlock.title = `${shift.name}: ${shift.role} ${fmt(shift.start)}-${fmt(shift.end)}${shift.notes ? ' - ' + shift.notes : ''}`;
          
          // Make clickable to edit
          shiftBlock.onclick = () => {
            const shiftIndex = shifts.findIndex(s => s.id === shift.id);
            if (shiftIndex !== -1) {
              day = new Date(date);
              setView('day');
              openDlg('edit', shiftIndex);
            }
          };
          
          dayColumn.appendChild(shiftBlock);
        });
      }
      
      weekView.appendChild(dayColumn);
    });
  });
  
  // Update date header
  const startDate = weekStart.toLocaleDateString();
  const endDate = weekDates[4].toLocaleDateString();
  dateH.textContent = `Week of ${startDate} - ${endDate}`;
  location.hash = iso(weekStart);
}

const lbl=(t,r=1,c=1)=>{ 
  const d=document.createElement("div"); 
  d.className="rowLabel"; 
  d.textContent=t; 
  d.style.gridRow=r; 
  d.style.gridColumn=c; 
  return d; 
};

const cell=(r,c,ds={})=>{ 
  const d=document.createElement("div"); 
  d.className="cell"; 
  d.style.gridRow=r; 
  d.style.gridColumn=c; 
  Object.assign(d.dataset,ds); 
  return d; 
};

// Update coverage display
const updateCoverageDisplay = () => {
  if (currentView !== 'day') return;
  
  const currentDate = iso(day);
  const analysis = analyzeCoverage(currentDate);
  
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

/***** 🔧 FIXED: BLOCKS WITH BETTER POSITIONING *****/
function placeBlock(s,idx,row,container){
  const bands = container.querySelectorAll(".band");
  const band = bands[row]; 
  if(!band) {
    console.error(`❌ Band not found for row ${row}, available bands: ${bands.length}`);
    return;
  }
  
  // Better overlap handling
  const existingBlocks = band.querySelectorAll('.block');
  const overlapCount = existingBlocks.length;
  
  const el=document.createElement("div"); 
  el.className="block";
  el.style.left = `${s.start/1440*100}%`;
  el.style.width= `${Math.max(1, (s.end-s.start)/1440*100)}%`; // Minimum 1% width
  el.style.background=COLORS[s.role]||"#2563eb";
  el.style.zIndex = s.role === 'Lunch' ? '10' : '5';
  el.style.top    = `${4 + overlapCount * 18}px`; // Better vertical spacing
  el.style.height = '16px'; // Consistent height
  
  // Better text display
  const duration = s.end - s.start;
  let displayText;
  
  if (duration < 60) {
    displayText = s.role.substring(0, 3); // Abbreviate for very short shifts
  } else if (duration < 120) {
    displayText = s.role;
  } else {
    displayText = `${s.role} ${fmt(s.start)}-${fmt(s.end)}`;
  }
  
  el.textContent = displayText;
  el.title = `${s.name}: ${s.role} ${fmt(s.start)}-${fmt(s.end)}${s.notes ? ' - ' + s.notes : ''}`;
  el.ondblclick=()=>openDlg("edit",idx);

  // Add resize handles for larger blocks
  if (duration >= 60) {
    ["l","r"].forEach(side=>{ 
      const h=document.createElement("span"); 
      h.style.cssText=`position:absolute;top:0;bottom:0;width:6px;cursor:ew-resize;${side==="l"?"left:0;":"right:0;"}background:rgba(0,0,0,0.2);`; 
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
let rs = null;
function startResize(e, idx, side) {
  e.stopPropagation();
  rs = { idx, side, startX: e.clientX, orig: { ...shifts[idx] } };
  document.onmousemove = doResize;
  document.onmouseup = endResize;
}
function doResize(e) {
  if (!rs) return;
  const px = dayView.querySelector(".band").getBoundingClientRect().width / 1440;
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
let mv = null;
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
    dayView.appendChild(mv.preview);
  }
  const px = dayView.querySelector(".band").getBoundingClientRect().width / 1440;
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
  const diffRow = Math.round((e.clientY - mv.startY) / 40); // Updated for new row height
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

  const bandW = dayView.querySelector(".band").getBoundingClientRect().width;
  const px = bandW / 1440;
  const diff = Math.round((e.clientX - mv.startX) / px / STEP) * STEP;
  const s = shifts[mv.idx];
  s.start = Math.max(0, Math.min(1440 - STEP, s.start + diff));
  s.end = Math.min(1440, Math.max(s.start + STEP, s.end + diff));
  const diffRow = Math.round((e.clientY - mv.startY) / 40);
  s.name = workers[Math.max(0, Math.min(workers.length - 1, mv.row + diffRow))].Name;

  mv.preview.remove();
  mv = null;
  saveShift(s).then(() => {
    if (currentView === 'day') draw();
  });
}

/* ==========================================================================
   DRAG‑CREATE (Day View Only)
   ========================================================================== */
let dc = null;

const setupDayViewEvents = () => {
  dayView.onmousedown = e => {
    if (!e.target.dataset.hour) return;
    dc = { row: +e.target.dataset.row, start: +e.target.dataset.hour * 60 };
    dc.box = document.createElement("div");
    dc.box.className = "dragBox";
    const bands = dayView.querySelectorAll(".band");
    if (bands[dc.row]) {
      bands[dc.row].appendChild(dc.box);
    }
  };
  
  dayView.onmousemove = e => {
    if (!dc || +e.target.dataset.row !== dc.row || !e.target.dataset.hour) return;
    const end = (+e.target.dataset.hour + 1) * 60;
    dc.box.style.left = `${(dc.start / 1440) * 100}%`;
    dc.box.style.width = `${(Math.max(STEP, end - dc.start) / 1440) * 100}%`;
  };
  
  dayView.onmouseup = () => {
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
};

/* ==========================================================================
   SHIFT DIALOG - FIXED
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
  if (!roleSel) return;
  roleSel.innerHTML = abilities
    .map(a => `<option value="${a}"${a === selected ? " selected" : ""}>${a}</option>`) 
    .join("");
}

function openDlg(mode, idx = null, tpl = {}) {
  if (!dlg || !form) {
    console.error("❌ Dialog elements not found");
    return;
  }

  form.reset();
  fillRoles();
  
  if (delBtn) delBtn.classList.toggle("hidden", mode === "new");

  if (mode === "edit" && idx !== null && shifts[idx]) {
    const s = shifts[idx];
    form.index.value = idx;
    if (empIn) empIn.value = s.name;
    fillRoles(s.role);
    if (startI) startI.value = fmt(s.start);
    if (endI) endI.value = fmt(s.end);
    if (notesI) notesI.value = s.notes || "";
  } else {
    form.index.value = "";
    if (empIn) empIn.value = workers[tpl.row]?.Name || "";
    if (startI) startI.value = fmt(tpl.start);
    if (endI) endI.value = fmt(tpl.end);
  }

  dlg.showModal();
  if (empIn) empIn.focus();
}

/* ----- SAVE / UPDATE ----- */
if (form) {
  form.onsubmit = async e => {
    e.preventDefault();
    
    try {
      const idx = form.index.value ? +form.index.value : null;
      const targetDate = iso(day);
      
      const shift = {
        id: idx != null ? shifts[idx].id : undefined,
        name: empIn?.value.trim() || "",
        role: roleSel?.value || "",
        start: toMin(startI?.value || "08:00"),
        end: toMin(endI?.value || "17:00"),
        date: targetDate,
        notes: notesI?.value.trim() || ""
      };

      if (idx != null) {
        shifts[idx] = shift;
      } else {
        shifts.push(shift);
      }

      await saveShift(shift);
      dlg.close();
      
      if (currentView === 'day') {
        draw();
      } else {
        drawWeek();
      }
    } catch (error) {
      console.error("❌ Failed to save shift:", error);
    }
  };
}

/* ----- DELETE ----- */
if (delBtn) {
  delBtn.onclick = async () => {
    try {
      const idx = +form.index.value;
      if (Number.isNaN(idx)) return;
      
      if (!confirm('Delete this shift?')) return;
      
      const shiftToDelete = shifts[idx];
      if (!shiftToDelete) return;
      
      await deleteShift(shiftToDelete.id);
      dlg.close();
      
      if (currentView === 'day') {
        draw();
      } else {
        drawWeek();
      }
    } catch (error) {
      console.error("❌ Failed to delete shift:", error);
    }
  };
}

/* ----- CANCEL ----- */
if (cancelBtn) cancelBtn.onclick = () => dlg.close();
if (dlg) {
  dlg.oncancel = () => dlg.close();
  dlg.addEventListener("close", () => form?.reset());
}

/* ==========================================================================
   CHAT WIDGET  
   ========================================================================== */
function initChat() {
  const host = document.getElementById("chatBox");
  if (!host) return;
  
  host.innerHTML = `
    <div class="bg-white rounded shadow flex flex-col h-96 border">
      <div class="px-3 py-2 font-semibold border-b bg-blue-50 flex justify-between items-center">
        <span>🤖 Advanced Scheduler Bot</span>
        <div class="flex gap-2">
          <button id="quickActions" class="text-blue-600 text-sm">Quick</button>
          <button id="chatHelp" class="text-blue-600 text-sm">Help</button>
        </div>
      </div>
      <div id="chatLog" class="flex-1 overflow-y-auto space-y-2 p-3 text-sm bg-gray-50"></div>
      <div class="border-t p-3 bg-white">
        <div class="flex gap-2 mb-2">
          <input id="chatInput" type="text"
                 class="flex-1 border rounded px-3 py-2 text-sm"
                 placeholder="Ask me to build schedules..." autocomplete="off" />
          <button id="chatSend" class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Send</button>
        </div>
        <div id="quickButtons" class="flex gap-1 flex-wrap">
          <button class="quick-btn text-xs bg-green-100 text-green-800 px-2 py-1 rounded hover:bg-green-200" 
                  data-msg="Build complete schedule for today">🏗️ Build Today</button>
          <button class="quick-btn text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded hover:bg-blue-200" 
                  data-msg="Build complete schedule for tomorrow">📅 Tomorrow</button>
          <button class="quick-btn text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded hover:bg-purple-200" 
                  data-msg="Build full week schedule starting Monday">📊 Week</button>
          <button class="quick-btn text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded hover:bg-orange-200" 
                  data-msg="Fix all coverage violations for today">🔧 Fix Issues</button>
        </div>
      </div>
    </div>`;

  const log = host.querySelector("#chatLog");
  const input = host.querySelector("#chatInput");
  const send = host.querySelector("#chatSend");

  function addMsg(txt, who) {
    const el = document.createElement("div");
    el.className = who === "user" ? "text-right" : "";
    
    const bgClass = who === "user" ? "bg-blue-500 text-white" : "bg-white border";
    el.innerHTML = `<div class="inline-block px-3 py-2 rounded-lg max-w-xs ${bgClass}">
                     ${txt.replace(/\n/g, '<br>')}</div>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  addMsg("👋 I'm your scheduling assistant! I can build schedules and fix coverage issues.", "bot");

  // Quick buttons
  host.addEventListener('click', function(e) {
    if (e.target.classList.contains('quick-btn')) {
      input.value = e.target.dataset.msg;
      send.click();
    }
  });

  async function sendChat(msg) {
    addMsg(msg, "user");
    input.value = "";
    
    const typingEl = document.createElement("div");
    typingEl.innerHTML = `<div class="inline-block px-3 py-2 rounded-lg bg-gray-200">
                           <span class="animate-pulse">🤖 Working...</span></div>`;
    log.appendChild(typingEl);
    log.scrollTop = log.scrollHeight;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: msg,
          context: {
            currentDate: iso(day),
            currentView: currentView
          }
        })
      });
      
      const data = await res.json();
      
      typingEl.remove();
      addMsg(data.reply || "[no reply]", "bot");

      // Update shifts if returned
      if (data.shifts && Array.isArray(data.shifts)) {
        shifts = data.shifts.map((shift, index) => sheetsToFrontend(shift, index));
        
        if (data.workers) {
          workers = data.workers;
          if (empDl) {
            empDl.innerHTML = workers.map(w => `<option value="${w.Name}">`).join("");
          }
        }
        
        if (currentView === 'day') {
          draw();
        } else {
          drawWeek();
        }
      }
    } catch (err) {
      typingEl.remove();
      console.error("❌ Chat error:", err);
      addMsg("❌ I'm having trouble right now. Please try again.", "bot");
    }
  }

  send.onclick = () => {
    if (input.value.trim()) {
      sendChat(input.value.trim());
    }
  };
  
  input.onkeydown = e => {
    if (e.key === "Enter") {
      send.click();
    }
  };
  
  input.focus();
}

/* ==========================================================================
   NAVIGATION BUTTONS
   ========================================================================== */
if (prevBtn) {
  prevBtn.onclick = () => {
    if (currentView === 'day') {
      day.setDate(day.getDate() - 1);
      draw();
    } else {
      weekStart.setDate(weekStart.getDate() - 7);
      drawWeek();
    }
  };
}

if (nextBtn) {
  nextBtn.onclick = () => {
    if (currentView === 'day') {
      day.setDate(day.getDate() + 1);
      draw();
    } else {
      weekStart.setDate(weekStart.getDate() + 7);
      drawWeek();
    }
  };
}

if (todayBtn) {
  todayBtn.onclick = () => {
    day = new Date();
    weekStart = getMonday(day);
    if (currentView === 'day') {
      draw();
    } else {
      drawWeek();
    }
  };
}

// Set up day view events after everything is loaded
setTimeout(setupDayViewEvents, 100);
