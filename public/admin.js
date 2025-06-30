// ---------- DOM handles ----------
const tblBody  = document.querySelector('#tbl tbody');
const dlg      = document.getElementById('dlg');
const frm      = document.getElementById('frm');
const newBtn   = document.getElementById('new-btn');
const ptoDlg   = document.getElementById('ptoDlg');
const ptoName  = document.getElementById('ptoName');

// inline calendar instance (Flatpickr)
const fp       = flatpickr('#ptoCalendar', {
  inline: true,
  mode  : 'single',
  onChange(selected) {
    if (!selected.length) return;
    const date = selected[0].toISOString().slice(0, 10);
    togglePto(ptoDlg.dataset.name, date);
  }
});

let workers   = [];
let abilities = [];

// ---------- initial load ----------
async function load() {
  [workers, abilities] = await Promise.all([
    fetch('/api/workers').then(r => r.json()),
    fetch('/api/abilities').then(r => r.json())
  ]);
  renderTable();
  fillAbilitySelects();
}
load();

// ---------- helpers ----------
function fillAbilitySelects() {
  const opts = abilities
    .map(a => `<option value="${a}">${a}</option>`)
    .join('') + '<option value="__new__">-- add new --</option>';

  document
    .querySelectorAll('select[name$="Ability"]')
    .forEach(sel => (sel.innerHTML = opts));
}

function renderTable() {
  tblBody.innerHTML = '';
  workers.forEach((w, idx) => {
    const tr = document.createElement('tr');
    tr.className = idx % 2 ? 'bg-gray-100' : '';
    tr.innerHTML = `
      <td class="p-2">${w.Name}</td>
      <td class="p-2">${w['Primary Ability'] ?? ''}</td>
      <td class="p-2">${w['Secondary Ability'] ?? ''}</td>
      <td class="p-2">${w['Tertiary Ability'] ?? ''}</td>
      <td class="p-2 text-center">${w.PTO?.length || 0}</td>
      <td class="p-2 space-x-2">
        <button data-edit="${idx}" class="text-blue-600 hover:underline">edit</button>
        <button data-pto="${idx}"  class="text-amber-600 hover:underline">pto</button>
        <button data-del="${idx}"  class="text-red-600 hover:underline">delete</button>
      </td>`;
    tblBody.appendChild(tr);
  });
}

// ---------- open editor ----------
function openEditor(mode, w = {}) {
  frm.__mode.value = mode;               // 'new' or 'edit'

  ['Name', 'Working Hours', 'Lunch Time',
   'Target Number of Time not on Dispatch or Reservations',
   'Primary Ability', 'Secondary Ability', 'Tertiary Ability']
    .forEach(k => { if (frm[k]) frm[k].value = w[k] ?? ''; });

  dlg.showModal();
}

newBtn.onclick = () => openEditor('new');

tblBody.addEventListener('click', e => {
  const idx = +e.target.dataset.edit;
  if (!Number.isNaN(idx)) return openEditor('edit', workers[idx]);

  const pIdx = +e.target.dataset.pto;
  if (!Number.isNaN(pIdx)) return openPto(workers[pIdx]);

  const dIdx = +e.target.dataset.del;
  if (!Number.isNaN(dIdx)) return delWorker(workers[dIdx].Name);
});

// dropdown “add new ability” hook
frm.addEventListener('change', e => {
  if (e.target.tagName !== 'SELECT') return;
  if (e.target.value === '__new__') {
    const val = prompt('Enter new ability:');
    if (val) {
      abilities.push(val);
      fillAbilitySelects();
      e.target.value = val;
    } else e.target.value = '';
  }
});

// save / add worker
frm.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(frm).entries());
  delete data.__mode;

  const endpoint = frm.__mode.value === 'new'
    ? '/api/workers/add'
    : '/api/workers/update';

  const res = await fetch(endpoint, {
    method : 'POST',
    headers: { 'Content-Type':'application/json' },
    body   : JSON.stringify(data)
  });

  if (res.ok) {
    await load();
    dlg.close();
  } else {
    alert((await res.json()).error || 'Failed');
  }
});

document.getElementById('close-btn').onclick = () => dlg.close();

// delete worker
async function delWorker(name) {
  if (!confirm(`Delete ${name}?`)) return;
  const res = await fetch(`/api/workers/${encodeURIComponent(name)}`,
                          { method:'DELETE' });
  res.ok ? load() : alert('Delete failed');
}

// ---------- PTO modal ----------
function openPto(w) {
  ptoDlg.dataset.name = w.Name;
  ptoName.textContent = w.Name;

  // highlight PTO days (amber disable array)
  fp.setDate(null);
  fp.set('disable', w.PTO || []);
  fp.redraw();

  ptoDlg.showModal();
}

document.getElementById('ptoClose').onclick = () => ptoDlg.close();

async function togglePto(name, date) {
  const action = fp.config.disable.includes(date) ? 'remove' : 'add';
  const res = await fetch('/api/workers/pto', {
    method : 'POST',
    headers: { 'Content-Type':'application/json' },
    body   : JSON.stringify({ name, date, action })
  });
  if (res.ok) {
    const { PTO } = await res.json();
    workers.find(w => w.Name === name).PTO = PTO;
    renderTable();
    openPto(workers.find(w => w.Name === name)); // refresh markings
  }
}
