// Entry point. Importing the interaction modules registers their canvas/window
// listeners (side-effectful); this file then wires the toolbar controls and runs
// the init sequence in the right order. Loaded via <script type="module">, so the
// DOM is already parsed when it runs.
'use strict';

import { state, TOOL_ORDER, TOOL_SHORTCUT_KEYS } from './state.js';
import { $, canvas } from './dom.js';
import { draw } from './render.js';
import { loadFolder, exportAll, loadDroppedItems, loadOtFile, rebuildRefFromZRange } from './io.js';
import { undo, redoFn } from './history.js';
import { setTool } from './input.js';
import { clearAllElements } from './elements.js';
import {
  loadLabels, rebuildLabelSelect, rebuildVisibility, rebuildInspector,
  rebuildVocabUI, rebuildElemList, fitView, status, toggleSidebar, restoreSidebar,
} from './ui.js';
import { openPalette } from './palette.js';
import { openCheatsheet } from './cheatsheet.js';
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
$('#clear-elems').addEventListener('click', clearAllElements);
$('#toggle-ids').addEventListener('change', (ev) => { state.showIds = ev.target.checked; draw(); });
$('#toggle-orig').addEventListener('change', (ev) => { state.showOriginalOverlay = ev.target.checked; draw(); });
// Clicking the cube icon when no ref is loaded opens the .ot single-file picker
// instead of toggling, bypassing Firefox's webkitdirectory FileList bug.
$('#toggle-ref-wrap').addEventListener('click', (ev) => {
  if (!state.refImage) { ev.preventDefault(); $('#ot-input').click(); }
}, true);
$('#toggle-ref').addEventListener('change', (ev) => {
  if (!state.refImage) { ev.target.checked = false; return; }
  state.showRefOverlay = ev.target.checked;
  draw();
});
$('#ot-input').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (f) await loadOtFile(f);
});
$('#ref-zmin').addEventListener('change', (ev) => { state.refZMin = +ev.target.value; rebuildRefFromZRange(); });
$('#ref-zmax').addEventListener('change', (ev) => { state.refZMax = +ev.target.value; rebuildRefFromZRange(); });
$('#ref-opacity').addEventListener('input', (ev) => {
  state.refOpacity = +ev.target.value;
  const valSpan = $('#ref-opacity-val');
  if (valSpan) valSpan.textContent = `${Math.round(state.refOpacity * 100)}%`;
  draw();
});
$('#ref-scale').addEventListener('input', (ev) => {
  state.refUserScale = +ev.target.value;
  const valSpan = $('#ref-scale-val');
  if (valSpan) valSpan.textContent = `${state.refUserScale.toFixed(2)}×`;
  draw();
});
$('#ref-offset-x').addEventListener('input', (ev) => { state.refOffsetX = +ev.target.value; draw(); });
$('#ref-offset-y').addEventListener('input', (ev) => { state.refOffsetY = +ev.target.value; draw(); });
$('#ref-move-btn').addEventListener('click', () => {
  state.refMoveMode = !state.refMoveMode;
  $('#ref-move-btn').classList.toggle('active', state.refMoveMode);
  canvas.style.cursor = state.refMoveMode ? 'move' : 'default';
});
$('#ref-reset-btn').addEventListener('click', () => {
  state.refOffsetX = 0; state.refOffsetY = 0; state.refUserScale = 1.0;
  $('#ref-offset-x').value = 0; $('#ref-offset-y').value = 0;
  $('#ref-scale').value = 1; $('#ref-scale-val').textContent = '1.00×';
  draw();
});

// Command palette / cheat-sheet / sidebar controls
$('#cmd-search').addEventListener('click', openPalette);
$('#help-btn').addEventListener('click', openCheatsheet);
$('#sidebar-toggle').addEventListener('click', () => toggleSidebar());
$('#elem-search').addEventListener('input', (ev) => { state.elemFilter = ev.target.value; rebuildElemList(); });

// Drag-and-drop a map folder onto the canvas.
const dropZone = $('main') || canvas;
['dragenter', 'dragover'].forEach(t => dropZone.addEventListener(t, (ev) => {
  ev.preventDefault();
  if (!state.meta) { state._dropActive = true; draw(); }
}));
dropZone.addEventListener('dragleave', (ev) => {
  if (ev.target === dropZone) { state._dropActive = false; draw(); }
});
dropZone.addEventListener('drop', (ev) => {
  ev.preventDefault();
  state._dropActive = false;
  loadDroppedItems(ev.dataTransfer);
});

document.querySelectorAll('button[data-tool]').forEach(b => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
  // Append the Shift+key hint to each tool's tooltip.
  const i = TOOL_ORDER.indexOf(b.dataset.tool);
  if (i >= 0 && i < TOOL_SHORTCUT_KEYS.length) {
    b.title = `${b.title} (Shift+${TOOL_SHORTCUT_KEYS[i]})`;
  }
});

window.addEventListener('resize', () => draw());

// ───── Init sequence ────────────────────────────────────────────────

loadLabels();
restoreSidebar();
rebuildLabelSelect();
rebuildVisibility();
rebuildInspector();
rebuildVocabUI();
setTool('pen');
draw();
status('drag a map folder to begin · press Ctrl/Cmd+K or F1 for commands, ? for shortcuts');

// Self-check: window._test()
window._test = runSelfCheck;
