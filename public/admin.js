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
const ptoClose = document.getElementById('ptoClose');
let   ptoCal   = null;                 // flatpickr instance

/* -------------- initial load ----------------------------------- */
(async () => {
  [workers, abilities] = await Promise.all([
    fetch('/api/workers').then(r => r.json()),
    fetch('/api/abilities').then(r => r.json())
  ]);
  if (!abilities.includes('Lunch')) abilities.push('Lunch');
  renderTable();
})();

/* -------------- render workers table --------------------------- */
function renderTable () {
  tblBody.innerHTML = '';
  workers.forEach((w, i) => {
    const tr = document.createElement('tr');
    tr.className = i % 2 ? 'bg-gray-100' : '';
    tr.innerHTML = `
      <td class="p-2">${w.Name}</td>
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

function openWorkerDlg (mode, idx = -1) {
  frm.reset();
  frm.__mode.value = mode;
  if (mode === 'edit') {
    const w = workers[idx];
    for (const k in w) if (frm[k]) frm[k].value = w[k];
    frm.dataset.idx = idx;
  }
  fillAbilitySelects(frm, workers[idx] || {});
  dlg.showModal();
}

/* ----- save / cancel ------------------------------------------ */
frm.onsubmit = async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(frm));
  const mode = data.__mode;
  delete data.__mode;
  data['PTO'] = data['PTO'] || [];

  if (mode === 'edit') workers[frm.dataset.idx] = data;
  else                 workers.push(data);

  /* decide the right endpoint: new → /add   |  edit → /update */
const url = mode === 'new'
          ? '/api/workers/add'
          : '/api/workers/update';

await fetch(url, {
  method : 'POST',
  headers: { 'Content-Type': 'application/json' },
  body   : JSON.stringify(data)
});


  dlg.close(); renderTable();
};
document.getElementById('close-btn').onclick = () => dlg.close();

/* -------------- delete worker ---------------------------------- */
async function delWorker (idx) {
  if (!confirm(`Delete ${workers[idx].Name}?`)) return;
  await fetch(`/api/workers/${encodeURIComponent(workers[idx].Name)}`, {
  method: 'DELETE'
});

  workers.splice(idx,1);
  renderTable();
}

/* -------------- PTO dialog ------------------------------------- */
function openPtoDlg (idx) {
  const w = workers[idx];
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

  ptoClose.onclick = async () => {
    await fetch('/api/workers/pto', {
      method : 'POST',
      headers: {'Content-Type':'application/json'},
      body   : JSON.stringify({ name:w.Name, pto:w.PTO })
    });
    ptoDlg.close(); renderTable();
  };

  ptoDlg.showModal();
}

/* -------------- nav link (top left) ----------------------------- */
// (links supplied directly in the HTML nav bar, no extra JS needed)
