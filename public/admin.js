/* -------------- helpers & state -------------------------------- */
let workers = [];
let abilities = [];
const PTO_COLOR = '#fbbf24';           // amber for PTO dots

/* -------------- DOM refs --------------------------------------- */
const tblBody  = document.querySelector('#tbl tbody');
const dlg      = document.getElementById('dlg');
const frm      = document.getElementById('frm');
const ptoDlg   = document.getElementById('ptoDlg');
const ptoName  = document.getElementById('ptoName');
const ptoSave  = document.getElementById('ptoSave');   // ← ADDED: Get save button ref
const ptoClose = document.getElementById('ptoClose');
let   ptoCal   = null;                 // flatpickr instance
let   currentWorker = null;            // ← ADDED: Track current worker being edited

/* -------------- initial load ----------------------------------- */
(async () => {
  [workers, abilities] = await Promise.all([
    fetch('/api/workers' ).then(r => r.json()),
    fetch('/api/abilities').then(r => r.json())
  ]);

  /* ↓ If backend ever returns {workers:[…]}, unwrap it */
  if (!Array.isArray(workers) && workers.workers) workers = workers.workers;
  if (!abilities.includes('Lunch')) abilities.push('Lunch');
  renderTable();
})();

/* -------------- helper functions for time display ------------- */
function formatWorkHours(worker) {
  // Try new format first
  if (worker.WorkStartTime && worker.WorkEndTime) {
    return `${worker.WorkStartTime} - ${worker.WorkEndTime}`;
  }
  
  // Fallback to old format
  if (worker["Working Hours"]) {
    const workHours = worker["Working Hours"];
    if (workHours.includes('-')) {
      const [start, end] = workHours.split('-');
      // Convert HHMM to HH:MM format for display
      const formatTime = (timeStr) => {
        if (!timeStr) return '';
        const cleaned = timeStr.replace(/[^\d]/g, '').padStart(4, '0');
        return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
      };
      return `${formatTime(start)} - ${formatTime(end)}`;
    }
  }
  
  return 'Not set';
}

function formatLunchHours(worker) {
  // Try new format first
  if (worker.LunchStartTime && worker.LunchEndTime) {
    return `${worker.LunchStartTime} - ${worker.LunchEndTime}`;
  }
  
  // Fallback to old format
  if (worker["Lunch Time"] && worker["Lunch Time"] !== "None") {
    const lunchTime = worker["Lunch Time"];
    if (lunchTime.includes('-')) {
      const [start, end] = lunchTime.split('-');
      // Convert HHMM to HH:MM format for display
      const formatTime = (timeStr) => {
        if (!timeStr) return '';
        const cleaned = timeStr.replace(/[^\d]/g, '').padStart(4, '0');
        return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
      };
      return `${formatTime(start)} - ${formatTime(end)}`;
    }
  }
  
  return 'Not set';
}

/* -------------- render workers table --------------------------- */
function renderTable () {
  tblBody.innerHTML = '';
  workers.forEach((w, i) => {
    const tr = document.createElement('tr');
    tr.className = i % 2 ? 'bg-gray-100' : '';
    tr.innerHTML = `
      <td class="p-2">${w.Name}</td>
      <td class="p-2">${formatWorkHours(w)}</td>
      <td class="p-2">${formatLunchHours(w)}</td>
      <td class="p-2">${w['Primary Ability']??''}</td>
      <td class="p-2">${w['Secondary Ability']??''}</td>
      <td class="p-2">${w['Tertiary Ability']??''}</td>
      <td class="p-2 text-center">${(w.PTO||[]).length}</td>
      <td class="p-2 space-x-2">
        <a class="text-blue-600 cursor-pointer" data-act="edit" data-idx="${i}">edit</a>
        <a class="text-amber-600 cursor-pointer" data-act="pto"  data-idx="${i}">pto</a>
        <a class="text-red-600 cursor-pointer"   data-act="del"  data-idx="${i}">delete</a>
      </td>`;
    tblBody.appendChild(tr);
  });
}

/* -------------- table action clicks ---------------------------- */
tblBody.onclick = e => {
  const a = e.target.closest('a[data-act]'); if (!a) return;
  const idx = +a.dataset.idx;
  if (a.dataset.act === 'edit')  openWorkerDlg('edit', idx);
  if (a.dataset.act === 'del')   delWorker(idx);
  if (a.dataset.act === 'pto')   openPtoDlg(idx);
};

/* -------------- add worker button ------------------------------ */
document.getElementById('new-btn')
        .onclick = () => openWorkerDlg('new');

/* -------------- worker editor dialog --------------------------- */
function fillAbilitySelects (root, w = {}) {
  ['Primary Ability','Secondary Ability','Tertiary Ability']
    .forEach(name => {
      const sel = root.querySelector(`select[name="${name}"]`);
      sel.innerHTML = ['','Lunch',...abilities]
        .map(a => `<option ${a===w[name]?'selected':''}>${a}</option>`).join('');
    });
}

function convertTimeFormat(timeStr) {
  if (!timeStr) return '';
  
  // If already in HH:MM format, return as-is
  if (timeStr.includes(':')) return timeStr;
  
  // Convert HHMM to HH:MM
  const cleaned = timeStr.replace(/[^\d]/g, '').padStart(4, '0');
  return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
}

function openWorkerDlg (mode, idx = -1) {
  frm.reset();
  frm.__mode.value = mode;
  
  if (mode === 'edit') {
    const w = workers[idx];
    frm.dataset.idx = idx;
    
    // Set basic fields
    if (frm.Name) frm.Name.value = w.Name || '';
    if (frm.Email) frm.Email.value = w.Email || '';
    if (frm.TotalHoursWeek) frm.TotalHoursWeek.value = w.TotalHoursWeek || '';
    if (frm.TargetNumber) frm.TargetNumber.value = w.TargetNumber || w["Target Number of Time not on Dispatch or Reservations"] || '';
    if (frm.BackFillOrder) frm.BackFillOrder.value = w.BackFillOrder || '';
    
    // Handle time fields with backward compatibility
    if (frm.WorkStartTime) {
      if (w.WorkStartTime) {
        frm.WorkStartTime.value = convertTimeFormat(w.WorkStartTime);
      } else if (w["Working Hours"] && w["Working Hours"].includes('-')) {
        const [start] = w["Working Hours"].split('-');
        frm.WorkStartTime.value = convertTimeFormat(start);
      }
    }
    
    if (frm.WorkEndTime) {
      if (w.WorkEndTime) {
        frm.WorkEndTime.value = convertTimeFormat(w.WorkEndTime);
      } else if (w["Working Hours"] && w["Working Hours"].includes('-')) {
        const [, end] = w["Working Hours"].split('-');
        frm.WorkEndTime.value = convertTimeFormat(end);
      }
    }
    
    if (frm.LunchStartTime) {
      if (w.LunchStartTime) {
        frm.LunchStartTime.value = convertTimeFormat(w.LunchStartTime);
      } else if (w["Lunch Time"] && w["Lunch Time"] !== "None" && w["Lunch Time"].includes('-')) {
        const [start] = w["Lunch Time"].split('-');
        frm.LunchStartTime.value = convertTimeFormat(start);
      }
    }
    
    if (frm.LunchEndTime) {
      if (w.LunchEndTime) {
        frm.LunchEndTime.value = convertTimeFormat(w.LunchEndTime);
      } else if (w["Lunch Time"] && w["Lunch Time"] !== "None" && w["Lunch Time"].includes('-')) {
        const [, end] = w["Lunch Time"].split('-');
        frm.LunchEndTime.value = convertTimeFormat(end);
      }
    }
  }
  
  fillAbilitySelects(frm, workers[idx] || {});
  dlg.showModal();
}

/* ----- save / cancel ------------------------------------------ */
frm.onsubmit = async e => {
  e.preventDefault();
  const formData = new FormData(frm);
  const data = Object.fromEntries(formData);
  const mode = data.__mode;
  delete data.__mode;
  
  // Ensure PTO field exists
  data['PTO'] = data['PTO'] || [];
  
  // Handle backward compatibility - create old format fields for compatibility
  if (data.WorkStartTime && data.WorkEndTime) {
    const startFormatted = data.WorkStartTime.replace(':', '');
    const endFormatted = data.WorkEndTime.replace(':', '');
    data["Working Hours"] = `${startFormatted}-${endFormatted}`;
  }
  
  if (data.LunchStartTime && data.LunchEndTime) {
    const startFormatted = data.LunchStartTime.replace(':', '');
    const endFormatted = data.LunchEndTime.replace(':', '');
    data["Lunch Time"] = `${startFormatted}-${endFormatted}`;
  } else {
    data["Lunch Time"] = "None";
  }

  if (mode === 'edit') {
    // Update existing worker
    const idx = parseInt(frm.dataset.idx);
    workers[idx] = { ...workers[idx], ...data };
  } else {
    // Add new worker
    workers.push(data);
  }

  /* choose endpoint: new → /add   |  edit → /update */
  const url = mode === 'new'
            ? '/api/workers/add'
            : '/api/workers/update';

  try {
    const response = await fetch(url, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Worker saved successfully:', result);
    
    dlg.close(); 
    renderTable();
  } catch (error) {
    console.error('❌ Error saving worker:', error);
    alert(`Failed to save worker: ${error.message}`);
  }
};

document.getElementById('close-btn').onclick = () => dlg.close();

/* -------------- delete worker ---------------------------------- */
async function delWorker (idx) {
  if (!confirm(`Delete ${workers[idx].Name}?`)) return;
  
  try {
    const response = await fetch(`/api/workers/${encodeURIComponent(workers[idx].Name)}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    workers.splice(idx,1);
    renderTable();
    console.log('✅ Worker deleted successfully');
  } catch (error) {
    console.error('❌ Error deleting worker:', error);
    alert(`Failed to delete worker: ${error.message}`);
  }
}

/* -------------- PTO dialog ------------------------------------- */
function openPtoDlg (idx) {
  const w = workers[idx];
  currentWorker = w;  // ← ADDED: Store reference to current worker
  ptoName.textContent = w.Name;
  if (ptoCal) ptoCal.destroy();

  ptoCal = flatpickr('#ptoCalendar', {
    inline : true,
    defaultDate: w.PTO,
    enableTime: false,
    onDayCreate (dObj, dStr, fp, dayElem) {
      const iso = dayElem.dateObj.toISOString().slice(0,10);
      if (w.PTO?.includes(iso)) dayElem.style.background = PTO_COLOR;
    },
    onChange (selected, _str, fp) {
      const isoDate = selected[0].toISOString().slice(0,10);
      if (!w.PTO) w.PTO = [];
      if (w.PTO.includes(isoDate))
        w.PTO = w.PTO.filter(x => x !== isoDate);
      else
        w.PTO.push(isoDate);

      fp.redraw();
    }
  });

  ptoDlg.showModal();
}

/* ✅ FIXED: PTO Save Button Implementation */
ptoSave.onclick = async () => {
  if (!currentWorker) {
    console.error('No current worker selected');
    return;
  }

  try {
    const response = await fetch('/api/workers/pto', {
      method : 'POST',
      headers: {'Content-Type':'application/json'},
      body   : JSON.stringify({ 
        name: currentWorker.Name, 
        pto: currentWorker.PTO || [] 
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.success) {
      // Update the local workers array with the saved PTO data
      const workerIndex = workers.findIndex(w => w.Name === currentWorker.Name);
      if (workerIndex !== -1) {
        workers[workerIndex].PTO = result.PTO || currentWorker.PTO;
      }
      
      // Close dialog and refresh table
      ptoDlg.close();
      renderTable();
      
      // Optional: Show success message
      console.log(`✅ PTO saved for ${currentWorker.Name}`);
    } else {
      throw new Error('Save failed: ' + (result.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error saving PTO:', error);
    alert(`Failed to save PTO: ${error.message}`);
  }
};

/* ✅ FIXED: PTO Close Button (just closes, no save) */
ptoClose.onclick = () => {
  if (confirm('Close without saving PTO changes?')) {
    ptoDlg.close();
    currentWorker = null;  // Clear the reference
  }
};

/* ✅ ADDED: Clean up when dialog closes */
ptoDlg.addEventListener('close', () => {
  currentWorker = null;
  if (ptoCal) {
    ptoCal.destroy();
    ptoCal = null;
  }
});

/* -------------- nav link (top left) ----------------------------- */
// (links supplied directly in the HTML nav bar, no extra JS needed)
