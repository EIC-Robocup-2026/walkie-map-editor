// Undo / redo stack. Steps are { kind: 'pixel' | 'elem-add' | 'elem-del' |
// 'elem-mod', ... } applied forward/inverse.
'use strict';

import { state, markDirty } from './state.js';
import { renderPixels, draw } from './render.js';
import { rebuildElemList, rebuildVisibility, rebuildInspector } from './ui.js';

export function pushUndo(act) { state.undo.push(act); state.redo.length = 0; if (state.undo.length > 100) state.undo.shift(); }
export function undo() { const a = state.undo.pop(); if (a) { applyInverse(a); state.redo.push(a); markDirty(); rebuildElemList(); rebuildVisibility(); rebuildInspector(); draw(); } }
export function redoFn() { const a = state.redo.pop(); if (a) { applyForward(a); state.undo.push(a); markDirty(); rebuildElemList(); rebuildVisibility(); rebuildInspector(); draw(); } }

function applyInverse(a) {
  if (a.kind === 'pixel') {
    for (const [i, oldV] of a.diffs) state.pixels[i] = oldV;
    renderPixels();
  } else if (a.kind === 'elem-add') {
    state.elements = state.elements.filter(e => e.id !== a.el.id);
  } else if (a.kind === 'elem-del') {
    state.elements.push(a.el);
  } else if (a.kind === 'elem-mod') {
    Object.assign(a.el, a.before);
  }
}
function applyForward(a) {
  if (a.kind === 'pixel') {
    for (const [i] of a.diffs) state.pixels[i] = a.newV.get(i);
    renderPixels();
  } else if (a.kind === 'elem-add') {
    state.elements.push(a.el);
  } else if (a.kind === 'elem-del') {
    state.elements = state.elements.filter(e => e.id !== a.el.id);
  } else if (a.kind === 'elem-mod') {
    Object.assign(a.el, a.after);
  }
}
