// ---------- DOM handles ----------
const tblBody  = document.querySelector('#tbl tbody');
const dlg      = document.getElementById('dlg');
const frm      = document.getElementById('frm');
const newBtn   = document.getElementById('new-btn');
const ptoDlg   = document.getElementById('ptoDlg');
const ptoName  = document.getElementById('ptoName');

// ---------- inline calendar w/ MULTI-select ----------
let workers   = [];
let abilities = [];

// keep previous selection so we can diff
let prevDates = [];

const fp = flatpickr('#ptoCalendar', {
  inline : true,
  mode   : 'multiple',      // <- multi-day selection
  onOpen : (_, dates) => {  // store starting selection
    prevDates = dates.map(d => d.toISOString().slice(0,10));
  },
  onClose : async (_, dates) => {
    const newDates = dates.map(d => d.toISOString().slice(0,10));
    const name     = ptoDlg.dataset.name;

    // find additions and removals
    const add    = newDates.filter(d => !prevDates.includes(d));
    const remove = prevDates.filter(d => !newDates.includes(d));

    // call API once per delta date
    await Promise.all([
      ...add.map(d  => postPTO(name, d, 'add')),
      ...remove.map(d => postPTO(name, d, 'remove'))
    ]);

    await reloadWorkers();         // refresh local data + table
    openPtoModal(name);            // reopen to redraw
  }
});

// ---------- initial load ----------
async function reloadWorkers() {
  workers   = await fetch('/api/workers').then(r => r.json());
  abilities = await fetch('/api/abilities').then(r => r.json());
  renderTable();  fillAbilitySelects();
}
reloadWorkers();

// ---------- helpers ----------
function fillAbilitySelects() {
  const opts = abilities.map(a => `<option value="${a}">${a}</option>`).join('')
             + '<option value="__new__">-- add new --</option>';
  document.querySelectorAll('select[name$="Ability"]').forEach(sel => sel.innerHTML = opts);
}

function renderTable() {
  tblBody.innerHTML = workers.map((w, i) => `
    <tr class="${i%2?'bg-gray-100':''}">
      <td class="p-2">${w.Name}</td>
      <td class="p-2">${w['Primary Ability']||''}</td>
      <td class="p-2">${w['Secondary Ability']||''}</td>
      <td class="p-2">${w['Tertiary Ability']||''}</td>
      <td class="p-2 text-center">${w.PTO?.length||0}</td>
      <td class="p-2 space-x-2">
        <button data-edit="${i}" class="text-blue-600 hover:underline">edit</button>
        <button data-pto="${i}"  class="text-amber-600 hover:underline">pto</button>
        <button data-del="${i}"  class="text-red-600 hover:underline">delete</button>
      </td>
    </tr>`).join('');
}

// ---------- table actions ----------
tblBody.addEventListener('click', e => {
  const idx = +e.target.dataset.edit;
  if (!Number.isNaN(idx))   return openEditor('edit', workers[idx]);

  const pIdx = +e.target.dataset.pto;
  if (!Number.isNaN(pIdx))  return openPtoModal(workers[pIdx].Name);

  const dIdx = +e.target.dataset.del;
  if (!Number.isNaN(dIdx))  return deleteWorker(workers[dIdx].Name);
});

newBtn.onclick = () => openEditor('new');

/* ----- editor modal (unchanged except for ability “add new”) ----- */
function openEditor(mode, w={}) {
  frm.__mode.value = mode;
  ['Name','Working Hours','Lunch Time',
   'Target Number of Time not on Dispatch or Reservations',
   'Primary Ability','Secondary Ability','Tertiary Ability']
   .forEach(k => frm[k] && (frm[k].value = w[k] ?? ''));
  dlg.showModal();
}

frm.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(frm).entries());
  delete data.__mode;

  const url = frm.__mode.value==='new' ? '/api/workers/add' : '/api/workers/update';
  const ok  = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  ok.ok ? (dlg.close(), reloadWorkers()) : alert('Save failed');
});

document.getElementById('close-btn').onclick = () => dlg.close();

// “add new ability” dropdown
frm.addEventListener('change', e => {
  if (e.target.tagName!=='SELECT' || e.target.value!=='__new__') return;
  const val = prompt('Enter new ability:');  if (!val) { e.target.value=''; return; }
  abilities.push(val); fillAbilitySelects(); e.target.value = val;
});

/* ----- delete worker ----- */
async function deleteWorker(name) {
  if (!confirm(`Delete ${name}?`)) return;
  const res = await fetch('/api/workers/'+encodeURIComponent(name), {method:'DELETE'});
  res.ok ? reloadWorkers() : alert('Delete failed');
}

/* ---------- PTO modal ---------- */
function openPtoModal(name) {
  const w = workers.find(x => x.Name===name);
  ptoDlg.dataset.name = name;
  ptoName.textContent = name;

  fp.setDate(w.PTO||[]);
  prevDates = [...(w.PTO||[])];   // copy current PTO for diffing
  ptoDlg.showModal();
}

document.getElementById('ptoClose').onclick = () => ptoDlg.close();

async function postPTO(name, date, action) {
  return fetch('/api/workers/pto', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name, date, action })
  });
}
