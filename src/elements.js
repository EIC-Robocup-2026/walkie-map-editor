// Element model: classification (kindOf/isVisible), CRUD with undo, field
// patching, and canvas hit-testing.
'use strict';

import { state, markDirty } from './state.js';
import { pointInPoly, distToSeg } from './pure.js';
import { pushUndo } from './history.js';
import { draw } from './render.js';
import { rebuildElemList, rebuildVisibility, rebuildInspector, rebuildLabelSelect } from './ui.js';

export function kindOf(e) {
  if (e.type === 'nogo') return 'nogo';
  if (e.type === 'rect') return 'rect';
  if (e.type === 'point') return 'point';
  if (e.type === 'waypoint') return 'waypoint';
  return 'polygon';
}

export function isVisible(e) {
  return !state.hiddenLabels.has(e.label) && !state.hiddenKinds.has(kindOf(e));
}

export function addElement(el) {
  el.id = `e${state.nextId++}`;
  state.elements.push(el);
  pushUndo({ kind: 'elem-add', el });
  markDirty();
  rebuildElemList();
  rebuildVisibility();
  draw();
}
export function deleteElement(id) {
  const idx = state.elements.findIndex(e => e.id === id);
  if (idx < 0) return;
  const el = state.elements.splice(idx, 1)[0];
  if (state.selected === id) state.selected = null;
  pushUndo({ kind: 'elem-del', el });
  markDirty();
  rebuildElemList();
  rebuildVisibility();
  rebuildInspector();
  draw();
}
export function renameElement(id, label) {
  const el = state.elements.find(e => e.id === id);
  if (!el || el.type === 'waypoint') return;  // waypoints are named via the inspector
  if (!label || el.label === label) return;
  const before = { label: el.label };
  el.label = label;
  if (!state.labels.includes(label)) { state.labels.push(label); rebuildLabelSelect(); }
  pushUndo({ kind: 'elem-mod', el, before, after: { label } });
  markDirty();
  rebuildElemList();
  rebuildVisibility();
  draw();
}
export function toggleAsNogo(id) {
  const el = state.elements.find(e => e.id === id);
  if (!el || !el.closed || el.type === 'nogo') return;
  const before = { asNogo: el.asNogo };
  el.asNogo = !el.asNogo;
  pushUndo({ kind: 'elem-mod', el, before, after: { asNogo: el.asNogo } });
  markDirty();
  rebuildElemList();
  draw();
}

// Delete every element (confirm first). Shared by the toolbar Clear button and
// the "Clear elements" palette command.
export function clearAllElements() {
  if (!state.elements.length) return;
  if (!confirm(`delete all ${state.elements.length} elements?`)) return;
  for (const e of [...state.elements]) deleteElement(e.id);
}

// Apply a patch of fields to an element as one undoable elem-mod step.
export function updateElementFields(id, patch) {
  const el = state.elements.find(e => e.id === id);
  if (!el) return;
  const before = {}, after = {};
  let changed = false;
  for (const k of Object.keys(patch)) {
    if (JSON.stringify(el[k]) === JSON.stringify(patch[k])) continue;
    before[k] = el[k]; after[k] = patch[k]; el[k] = patch[k]; changed = true;
  }
  if (!changed) return;
  pushUndo({ kind: 'elem-mod', el, before, after });
  markDirty();
}

export function hitTest(wx, wy) {
  const tol = 6 / state.view.s * state.meta.resolution;
  for (let i = state.elements.length - 1; i >= 0; i--) {
    const e = state.elements[i];
    if (!isVisible(e)) continue;
    const pts = e.coords;
    if (e.type === 'point' || e.type === 'waypoint') {
      const [x, y] = pts[0];
      if (Math.hypot(x - wx, y - wy) < tol) return e.id;
    } else if (e.closed && pts.length >= 3) {
      if (pointInPoly(wx, wy, pts)) return e.id;
    } else if (pts.length >= 2) {
      for (let k = 0; k < pts.length - 1; k++) {
        if (distToSeg(wx, wy, pts[k], pts[k + 1]) < tol) return e.id;
      }
    }
  }
  return null;
}
