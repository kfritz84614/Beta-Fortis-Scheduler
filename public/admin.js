/* global fetch, alert */
const tableBody = document.querySelector('#workers-table tbody');
const editor    = document.getElementById('editor');
const form      = document.getElementById('worker-form');
const cancelBtn = document.getElementById('cancel-btn');

let workers = [];

/* ---------- helpers ---------- */
function renderTable() {
  tableBody.innerHTML = '';
  workers.forEach((w, idx) => {
    const tr = document.createElement('tr');
    tr.className = idx % 2 ? 'bg-gray-100' : '';
    tr.innerHTML = `
      <td class="p-2">${w.Name}</td>
      <td class="p-2">${w['Primary Ability']}</td>
      <td class="p-2">${w['Secondary Ability']}</td>
      <td class="p-2">${w['Tertiary Ability']}</td>
      <td class="p-2">
        <button class="text-blue-600 hover:underline" data-edit="${idx}">edit</button>
        |
        <button class="text-red-600 hover:underline" data-pto="${idx}">add PTO</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

/* load list */
async function loadWorkers() {
  const res = await fetch('/api/workers');
  workers = await res.json();
  renderTable();
}
loadWorkers();

/* open editor */
tableBody.addEventListener('click', e => {
  if (e.target.dataset.edit) {
    const idx = +e.target.dataset.edit;
    const w   = workers[idx];
    editor.classList.remove('hidden');
    Object.entries(w).forEach(([k, v]) => {
      if (form[k]) form[k].value = v;
    });
    form.idx.value = idx;
  } else if (e.target.dataset.pto) {
    const idx = +e.target.dataset.pto;
    const date = prompt('Enter PTO date (YYYY-MM-DD):');
    if (date) updatePTO(workers[idx].Name, date, 'add');
  }
});

/* save worker */
form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  delete data.idx;

  const res = await fetch('/api/workers/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (res.ok) {
    alert('Saved!');
    editor.classList.add('hidden');
    loadWorkers();
  } else {
    alert('Error saving.');
  }
});

cancelBtn.onclick = () => editor.classList.add('hidden');

/* PTO */
async function updatePTO(name, date, action) {
  const ok = await fetch('/api/workers/pto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, date, action })
  });
  if (ok.ok) alert('PTO updated!'); else alert('Failed.');
}
