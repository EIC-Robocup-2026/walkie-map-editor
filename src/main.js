// Entry point. Importing the interaction modules registers their canvas/window
// listeners (side-effectful); this file then wires the toolbar controls and runs
// the init sequence in the right order. Loaded via <script type="module">, so the
// DOM is already parsed when it runs.
'use strict';

import { state } from './state.js';
import { $ } from './dom.js';
import { draw } from './render.js';
import { loadFolder, exportAll } from './io.js';
import { undo, redoFn } from './history.js';
import { setTool } from './input.js';
import { deleteElement } from './elements.js';
import {
  loadLabels, rebuildLabelSelect, rebuildVisibility, rebuildInspector,
  rebuildVocabUI, fitView, status,
} from './ui.js';
import { runSelfCheck } from './tests.js';

// ───── Toolbar / control wiring ─────────────────────────────────────

$('#folder-input').addEventListener('change', (ev) => loadFolder(ev.target.files));
$('#export-btn').addEventListener('click', exportAll);
$('#brush').addEventListener('input', (ev) => { state.brush = +ev.target.value; $('#brush-val').textContent = ev.target.value; draw(); });
$('#add-label').addEventListener('click', () => {
  const v = prompt('new label:');
  if (!v) return;
  const t = v.trim();
  if (!t || state.labels.includes(t)) return;
  state.labels.push(t);
  rebuildLabelSelect();
  $('#label-select').value = t;
});
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redoFn);
$('#fit').addEventListener('click', fitView);
$('#clear-elems').addEventListener('click', () => {
  if (!state.elements.length) return;
  if (!confirm(`delete all ${state.elements.length} elements?`)) return;
  for (const e of [...state.elements]) deleteElement(e.id);
});
$('#toggle-ids').addEventListener('change', (ev) => { state.showIds = ev.target.checked; draw(); });

document.querySelectorAll('button[data-tool]').forEach(b => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});

window.addEventListener('resize', () => draw());

// ───── Init sequence ────────────────────────────────────────────────

loadLabels();
rebuildLabelSelect();
rebuildVisibility();
rebuildInspector();
rebuildVocabUI();
setTool('pen');
draw();
status('drag a map folder to begin');

// Self-check: window._test()
window._test = runSelfCheck;
