// Pointer + keyboard interaction: pixel painting, pan/zoom, shape drawing, and
// the canvas/window event listeners. Tool selection lives here too.
'use strict';

import { state, markDirty, FREE, OCC } from './state.js';
import { canvas, offCtx, screenToPx, screenToWorld, worldToPx } from './dom.js';
import { draw, brushRadius } from './render.js';
import { addElement, deleteElement, hitTest } from './elements.js';
import { pushUndo, undo, redoFn } from './history.js';
import { status, rebuildElemList, rebuildInspector, currentLabel } from './ui.js';
import { defaultWaypointFields } from './io.js';

// Live binding read by render.drawElements / render.drawCursor.
export let cursorPx = null;
let panning = null;
let painting = false;

function paintBrush(px, py) {
  const r = brushRadius();
  const cx = Math.round(px), cy = Math.round(py);
  let x0, x1, y0, y1, r2;
  if (state.brush <= 1) {
    x0 = x1 = cx; y0 = y1 = cy; r2 = -1; // sentinel: include center only
  } else {
    x0 = Math.max(0, Math.floor(px - r));
    x1 = Math.min(state.w - 1, Math.ceil(px + r));
    y0 = Math.max(0, Math.floor(py - r));
    y1 = Math.min(state.h - 1, Math.ceil(py + r));
    r2 = r * r;
  }
  if (x1 < x0 || y1 < y0) return;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (r2 < 0) {
        if (x !== cx || y !== cy) continue;
      } else {
        const dx = x + 0.5 - px, dy = y + 0.5 - py;
        if (dx*dx + dy*dy > r2) continue;
      }
      if (x < 0 || y < 0 || x >= state.w || y >= state.h) continue;
      const i = y * state.w + x;
      let v;
      if (state.tool === 'pen') v = OCC;
      else if (state.tool === 'eraser') v = FREE;
      else v = state.original[i];
      if (state.pixels[i] === v) continue;
      if (!state.currentStroke.has(i)) state.currentStroke.set(i, state.pixels[i]);
      state.pixels[i] = v;
    }
  }
  const xs = Math.max(0, x0), xe = Math.min(state.w - 1, x1);
  const ys = Math.max(0, y0), ye = Math.min(state.h - 1, y1);
  if (xs > xe || ys > ye) return;
  const id = offCtx.getImageData(xs, ys, xe - xs + 1, ye - ys + 1);
  for (let y = ys, k = 0; y <= ye; y++) {
    for (let x = xs; x <= xe; x++, k += 4) {
      const g = state.pixels[y * state.w + x];
      id.data[k] = g; id.data[k+1] = g; id.data[k+2] = g; id.data[k+3] = 255;
    }
  }
  offCtx.putImageData(id, xs, ys);
}

// Bresenham-like interpolation between consecutive mouse events.
function strokeTo(px, py) {
  if (state.prevPaintPt) {
    const [px0, py0] = state.prevPaintPt;
    const dist = Math.hypot(px - px0, py - py0);
    const steps = Math.max(1, Math.ceil(dist));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      paintBrush(px0 + (px - px0) * t, py0 + (py - py0) * t);
    }
  } else {
    paintBrush(px, py);
  }
  state.prevPaintPt = [px, py];
}

function isPanTrigger(ev) {
  return ev.button === 1 || (ev.button === 0 && (ev.altKey || ev.ctrlKey || ev.metaKey));
}

canvas.addEventListener('mousedown', (ev) => {
  if (!state.meta) return;
  if (isPanTrigger(ev)) {
    panning = { sx: ev.clientX, sy: ev.clientY, vx: state.view.x, vy: state.view.y };
    ev.preventDefault();
    return;
  }
  if (ev.button === 2) {
    if (state.drawing && (state.tool === 'polygon' || state.tool === 'nogo')) {
      finishPoly(false);
    }
    return;
  }
  if (ev.button !== 0) return;

  const w = screenToWorld(ev.clientX, ev.clientY);
  const p = screenToPx(ev.clientX, ev.clientY);

  if (state.tool === 'select') {
    const id = hitTest(w.wx, w.wy);
    state.selected = id;
    rebuildElemList();
    rebuildInspector();
    draw();
    return;
  }
  if (['pen', 'eraser', 'restore'].includes(state.tool)) {
    painting = true;
    state.currentStroke = new Map();
    state.prevPaintPt = null;
    strokeTo(p.px, p.py);
    draw();
  } else if (state.tool === 'waypoint') {
    state.drawing = { id: 'tmp', type: 'waypoint', label: 'waypoint',
      coords: [[w.wx, w.wy]], closed: false, asNogo: false, ...defaultWaypointFields() };
    draw();
  } else if (state.tool === 'point') {
    addElement({ type: 'point', label: currentLabel(), coords: [[w.wx, w.wy]], closed: false, asNogo: false });
  } else if (state.tool === 'rect') {
    state.drawing = { id: 'tmp', label: currentLabel(), type: 'rect', coords: [[w.wx, w.wy], [w.wx, w.wy]], closed: true, asNogo: false };
  } else if (state.tool === 'polygon' || state.tool === 'nogo') {
    if (!state.drawing) {
      const t = state.tool === 'nogo' ? 'nogo' : 'polygon';
      state.drawing = { id: 'tmp', label: state.tool === 'nogo' ? 'no-go' : currentLabel(), type: t, coords: [[w.wx, w.wy]], closed: false, asNogo: false };
    } else {
      const start = state.drawing.coords[0];
      const startPx = worldToPx(start[0], start[1]);
      const dist = Math.hypot(startPx.px - p.px, startPx.py - p.py);
      if (state.drawing.coords.length >= 3 && dist * state.view.s < 8) {
        finishPoly(true);
      } else {
        state.drawing.coords.push([w.wx, w.wy]);
      }
    }
    draw();
  }
});

canvas.addEventListener('mousemove', (ev) => {
  if (!state.meta) return;
  if (panning) {
    state.view.x = panning.vx + (ev.clientX - panning.sx);
    state.view.y = panning.vy + (ev.clientY - panning.sy);
    draw();
    return;
  }
  const p = screenToPx(ev.clientX, ev.clientY);
  const w = screenToWorld(ev.clientX, ev.clientY);
  cursorPx = p;
  status(`world (${w.wx.toFixed(3)}, ${w.wy.toFixed(3)}) m   px (${Math.floor(p.px)}, ${Math.floor(p.py)})   tool: ${state.tool}`);

  if (painting) {
    strokeTo(p.px, p.py);
  } else if (state.drawing) {
    if (state.drawing.type === 'rect') {
      state.drawing.coords[1] = [w.wx, w.wy];
    } else if (state.drawing.type === 'waypoint') {
      const [ax, ay] = state.drawing.coords[0];
      const dx = w.wx - ax, dy = w.wy - ay;
      if (Math.hypot(dx, dy) > 2 * state.meta.resolution) state.drawing.heading = Math.atan2(dy, dx);
    }
  }
  draw();
});

canvas.addEventListener('mouseup', (ev) => {
  if (panning) { panning = null; return; }
  if (painting) {
    painting = false;
    state.prevPaintPt = null;
    if (state.currentStroke && state.currentStroke.size) {
      const newV = new Map();
      for (const [i] of state.currentStroke) newV.set(i, state.pixels[i]);
      pushUndo({ kind: 'pixel', diffs: state.currentStroke, newV });
      markDirty();
    }
    state.currentStroke = null;
  }
  if (state.tool === 'rect' && state.drawing) {
    const c = state.drawing.coords;
    const el = { type: 'rect', label: currentLabel(), asNogo: false,
      coords: [[c[0][0], c[0][1]], [c[1][0], c[0][1]], [c[1][0], c[1][1]], [c[0][0], c[1][1]]], closed: true };
    state.drawing = null;
    addElement(el);
  }
  if (state.tool === 'waypoint' && state.drawing && state.drawing.type === 'waypoint') {
    const wp = state.drawing;
    state.drawing = null;
    addElement(wp);            // assigns wp.id
    state.selected = wp.id;    // select it so the inspector opens for naming
    rebuildElemList();
    rebuildInspector();
    draw();
  }
});

canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

canvas.addEventListener('wheel', (ev) => {
  if (!state.meta) return;
  ev.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
  const ns = Math.max(0.05, Math.min(80, state.view.s * factor));
  state.view.x = mx - (mx - state.view.x) * (ns / state.view.s);
  state.view.y = my - (my - state.view.y) * (ns / state.view.s);
  state.view.s = ns;
  draw();
}, { passive: false });

window.addEventListener('keydown', (ev) => {
  // Don't hijack keys (Backspace/Delete -> deleteElement, Ctrl+Z -> undo) while
  // the user is typing in any form control — incl. the vocab <textarea>s and the
  // inspector role/room <select>s, not just <input>.
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName) || ev.target.isContentEditable) return;
  if (ev.key === 'Escape') {
    if (state.drawing) {
      if (state.drawing.type === 'rect' || state.drawing.type === 'waypoint') { state.drawing = null; draw(); }
      else finishPoly(false);
    }
  } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
    if (state.selected) deleteElement(state.selected);
  } else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); undo(); }
  else if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'y' || (ev.shiftKey && ev.key === 'Z'))) { ev.preventDefault(); redoFn(); }
});

window.addEventListener('beforeunload', (ev) => {
  if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; }
});

function finishPoly(closed) {
  if (!state.drawing) return;
  const minPts = closed ? 3 : 2;
  if (state.drawing.coords.length < minPts) { state.drawing = null; draw(); return; }
  const el = { type: state.drawing.type, label: state.drawing.label, asNogo: false,
    coords: state.drawing.coords, closed };
  state.drawing = null;
  addElement(el);
}

export function setTool(t) {
  state.tool = t;
  state.drawing = null;
  document.querySelectorAll('button[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  canvas.style.cursor = ({ select: 'pointer', point: 'crosshair', rect: 'crosshair',
    polygon: 'crosshair', nogo: 'crosshair', pen: 'none', eraser: 'none', restore: 'none' }[t]) || 'crosshair';
  draw();
}
