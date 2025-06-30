const tblBody  = document.querySelector('#tbl tbody');
const dlg      = document.getElementById('dlg');
const frm      = document.getElementById('frm');
const newBtn   = document.getElementById('new-btn');

const ptoDlg   = document.getElementById('ptoDlg');
const ptoName  = document.getElementById('ptoName');
const ptoList  = document.getElementById('ptoList');
const ptoDate  = document.getElementById('ptoDate');
const ptoAdd   = document.getElementById('ptoAdd');

let workers = [];
let abilities = [];

async function load() {
  [workers, abilities] = await Promise.all([
    fetch('/api/workers').then(r => r.json()),
    fetch('/api/abilities').then(r => r.json())
  ]);
  renderTable();
  fillSelects();
}
load();

/* ------------ UI helpers */
function fillSelects() {
  document.querySelectorAll('select').forEach(sel => {
    sel.innerHTML = abilities.map(a => `<option value="${a}">${a}</option>`).join('') +
                    '<option value="__new__">-- add new --</option>';
  });
}

function renderTable() {
  tblBody.innerHTML = '';
  workers.forEach((w, idx) => {
    const tr = document.createElement('tr');
    tr.className = idx % 2 ? 'bg-gray-100' : '';
    tr.innerHTML = `
      <td class="p-2">${w.Name}</td>
      <td class="p-2">${w['Primary Ability']}</td>
      <td class="p-2">${w['Secondary Ability']}</td>
      <td class="p-2">${w['Tertiary Ability']}</td>
      <td class="p-2 text-center">${w.PTO?.length || 0}</td>
      <td class="p-2 space-x-2">
        <button data-edit="${idx}" class="text-blue-600">edit</button>
        <button data-pto="${idx}"  class="text-amber-600">pto</button>
        <button data-del="${idx}"  class="text-red-600">delete</button>
      </td>`;
    tblBody.appendChild(tr);
  });
}

/* ------------ open editor */
function openEditor(mode, w = {}) {
  frm.__mode.value = mode;
  ['Name','Working Hours','Lunch Time',
   'Target Number of Time not on Dispatch or Reservations',
   'Primary Ability','Secondary Ability','Tertiary Ability']
   .forEach(k => frm[k] && (frm[k].value = w[k] ?? ''));
  dlg.showModal();
}

tblBody.addEventListener('click', e => {
  const idx = +e.target.dataset.edit;
  if (!isNaN(idx)) return openEditor('edit', workers[idx]);

  const pIdx = +e.target.dataset.pto;
  if (!isNaN(pIdx)) return openPto(workers[pIdx]);

  const dIdx = +e.target.dataset.del;
  if (!isNaN(dIdx)) return delWorker(workers[dIdx].Name);
});

newBtn.onclick = () => openEditor('new');

/* --------- add new ability on the fly */
frm.addEventListener('change', e => {
  if (e.target.tagName !== 'SELECT') return;
  if (e.target.value === '__new__') {
    const val = prompt('Enter new ability:');
    if (val) {
      abilities.push(val);
      fillSelects();
      e.target.value = val;
    } else e.target.value = '';
  }
});

/* ------------ save worker */
frm.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(frm).entries());
  delete data.__mode;

  const route = frm.__mode.value === 'new' ? '/api/workers/add' : '/api/workers/update';
  const res = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(data)
  });
  if (res.ok) {
    await load();
    dlg.close();
  } else {
    alert((await res.json()).error || 'Failed');
  }
});

/* ------------ delete */
async function delWorker(name) {
  if (!confirm(`Delete ${name}?`)) return;
  const res = await fetch(`/api/workers/${encodeURIComponent(name)}`, { method:'DELETE' });
  if (res.ok) load(); else alert('Delete failed.');
}

/* ------------ PTO modal */
function openPto(w) {
  ptoDlg.dataset.name = w.Name;
  ptoName.textContent = w.Name;
  listPto(w.PTO || []);
  ptoDlg.showModal();
}
function listPto(arr) {
  ptoList.innerHTML = arr.map(d => `<li>${d}</li>`).join('');
}
ptoAdd.onclick = async () => {
  const date = ptoDate.value;
  if (!date) return;
  const name = ptoDlg.dataset.name;
  const res = await fetch('/api/workers/pto', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name, date, action:'add' })
  });
  if (res.ok) listPto((await res.json()).PTO);
};
document.getElementById('ptoClose').onclick = () => ptoDlg.close();

/* close editor */
document.getElementById('close-btn').onclick = () => dlg.close();
