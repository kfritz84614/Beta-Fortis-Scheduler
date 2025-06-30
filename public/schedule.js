/* CONFIG ---------------------------------------------------------------- */
const DAYS   = ['Mon','Tue','Wed','Thu','Fri'];   // 5 days
const START  = 8;                                 // 08:00
const END    = 17;                                // 17:00
const HOURS  = END - START;                       // 9 hrs
const GRID_COL = idx => 2 + idx;                  // col 1 = names

/* STATE ------------------------------------------------------------------*/
let workers = [];         // loaded from /api/workers
let blocks  = [];         // [{name, day, hourFrom, hourTo, role}]
let current = null;       // dragging selection {row,day,startHour,div}

/* DOM helpers ------------------------------------------------------------*/
const grid = document.getElementById('grid');

function hourLabel(h) { return String(h).padStart(2,'0') + ':00'; }
function roleColor(role) {
  return role.replace(/ /g,'\\ '); // match class names in CSS (Journey\ Desk etc.)
}

function renderGrid() {
  /* header row ------------------------------------*/
  grid.style.gridTemplateRows = `30px repeat(${workers.length}, 30px)`;
  grid.innerHTML = '';

  // top-left empty cell
  grid.appendChild(Object.assign(document.createElement('div'),{
    className:'rowLabel font-bold flex items-center justify-center bg-slate-800 text-white',
    textContent:''
  }));

  // hour headers
  DAYS.forEach((_,dIdx) => {
    for (let h=0; h<HOURS; h++) {
      const col = dIdx*HOURS + h;
      const cell = Object.assign(document.createElement('div'),{
        className:'cell flex items-center justify-center text-xs font-semibold bg-slate-800 text-white',
        textContent: hourLabel(START+h)
      });
      cell.style.gridRow = 1;
      cell.style.gridColumn = GRID_COL(col);
      grid.appendChild(cell);
    }
  });

  /* worker rows -----------------------------------*/
  workers.forEach((w,rowIdx) => {
    // row label
    grid.appendChild(Object.assign(document.createElement('div'),{
      className:'rowLabel flex items-center',
      style:`grid-row:${2+rowIdx}`,
      textContent:w.Name
    }));
    // cells for mouse selection
    DAYS.forEach((_,dIdx) => {
      for (let h=0; h<HOURS; h++) {
        const col = dIdx*HOURS + h;
        const cell = Object.assign(document.createElement('div'),{
          className:'cell',
          style:`grid-row:${2+rowIdx}; grid-column:${GRID_COL(col)}`
        });
        cell.dataset.row  = rowIdx;
        cell.dataset.day  = dIdx;
        cell.dataset.hour = START + h;
        grid.appendChild(cell);
      }
    });
  });

  // existing blocks
  blocks.forEach(addBlockDiv);
}

function addBlockDiv(b) {
  const row   = workers.findIndex(w => w.Name === b.name);
  if (row===-1) return;
  const col   = b.day*HOURS + (b.hourFrom - START);
  const span  = b.hourTo - b.hourFrom;

  const div = Object.assign(document.createElement('div'),{
    className:`block ${roleColor(b.role)}`,
    style:`grid-row:${2+row}; grid-column:${GRID_COL(col)} / span ${span}`,
    textContent:`${b.role} ${b.hourFrom}-${b.hourTo}`
  });
  // delete on double-click
  div.ondblclick = () => {
    blocks = blocks.filter(x => x!==b);
    renderGrid();
  };
  grid.appendChild(div);
}

/* DRAG-TO-SELECT ---------------------------------------------------------*/
grid.addEventListener('mousedown', e => {
  if (!e.target.classList.contains('cell')) return;
  const row  = +e.target.dataset.row;
  const day  = +e.target.dataset.day;
  const hour = +e.target.dataset.hour;
  const div  = Object.assign(document.createElement('div'),{
    className:'dragBox'
  });
  grid.appendChild(div);
  current = { row, day, startHour:hour, div };
});

grid.addEventListener('mousemove', e => {
  if (!current) return;
  if (!e.target.classList.contains('cell')) return;
  if (+e.target.dataset.row !== current.row ||
      +e.target.dataset.day !== current.day) return;

  const hourNow = +e.target.dataset.hour + 1; // inclusive
  const span    = Math.max(1, hourNow - current.startHour);
  const col     = current.day*HOURS + (current.startHour - START);

  current.div.style.gridRow    = 2+current.row;
  current.div.style.gridColumn = `${GRID_COL(col)} / span ${span}`;
});

grid.addEventListener('mouseup', async () => {
  if (!current) return;
  current.div.remove();         // remove helper box

  const hourTo = current.startHour +
                 (+current.div.style.gridColumn.split('span ')[1] || 1);

  const role = prompt('Role for block? (Dispatch, Reservations, etc.)');
  if (role) {
    blocks.push({
      name: workers[current.row].Name,
      day : current.day,
      hourFrom: current.startHour,
      hourTo,
      role
    });
    renderGrid();
  }
  current = null;
});

/* INIT ------------------------------------------------------------------*/
(async () => {
  workers = await fetch('/api/workers').then(r => r.json());
  renderGrid();                 // blank slate
})();
