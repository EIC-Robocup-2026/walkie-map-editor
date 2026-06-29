// Pointer + keyboard interaction: pixel painting, pan/zoom, shape drawing, and
// the canvas/window event listeners. Tool selection lives here too.
'use strict';

import { state, markDirty, FREE, OCC, TOOL_ORDER, TOOL_SHORTCUT_CODES } from './state.js';
import { canvas, offCtx, screenToPx, screenToWorld, worldToPx } from './dom.js';
import { draw, brushRadius } from './render.js';
import { addElement, deleteElement, hitTest, updateElementFields, kindOf, isVisible } from './elements.js';
import { pushUndo, undo, redoFn } from './history.js';
import { status, rebuildElemList, rebuildInspector, currentLabel, toggleSidebar } from './ui.js';
import { defaultWaypointFields } from './io.js';
import { openPalette, isPaletteOpen } from './palette.js';
import { openCheatsheet, isCheatsheetOpen } from './cheatsheet.js';

// Live binding read by render.drawElements / render.drawCursor.
export let cursorPx = null;
let panning = null;
let painting = false;
// Active vertex drag: { id, index, before } where `before` is a deep copy of the
// element's coords at grab time, so the whole move commits as one undo step.
let nodeDrag = null;
// Active body drag: translate the whole element (point/line/area). `before` is the
// coords at grab time; `moved` gates committing an undo step (vs. a plain click).
let bodyDrag = null;

// Index of the selected element's vertex under cursor (screen-space px), or -1.
function nodeAt(el, p) {
  const tol = 8 / state.view.s;
  let best = -1, bestD = tol;
  for (let i = 0; i < el.coords.length; i++) {
    const np = worldToPx(el.coords[i][0], el.coords[i][1]);
    const d = Math.hypot(np.px - p.px, np.py - p.py);
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
}

// Bottom-of-screen readout for the selected element + (optionally) the node
// being dragged. Lists every vertex's world coords; the active one is marked ●.
function selReadout(el, active) {
  const pts = el.coords
    .map((c, i) => `${i === active ? '●' : '○'}${i}:(${(+c[0]).toFixed(2)}, ${(+c[1]).toFixed(2)})`)
    .join('  ');
  return `selected #${el.id} ${el.label} [${kindOf(el)}] — drag a handle to move a vertex, or the body to move the whole shape · ${pts}`;
}

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
    // Grabbing a handle of the already-selected element starts a vertex move
    // (takes priority over re-selecting whatever is underneath).
    const sel = state.selected && state.elements.find(e => e.id === state.selected);
    if (sel && isVisible(sel)) {
      const idx = nodeAt(sel, p);
      if (idx >= 0) {
        nodeDrag = { id: sel.id, index: idx, before: sel.coords.map(c => [...c]) };
        return;
      }
    }
    const id = hitTest(w.wx, w.wy);
    state.selected = id;
    rebuildElemList();
    rebuildInspector();
    draw();
    // Pressing on an element's body arms a whole-element move; if the mouse then
    // moves, we translate every vertex. A press with no move is just a select.
    if (id) {
      const el = state.elements.find(e => e.id === id);
      bodyDrag = { id, startWx: w.wx, startWy: w.wy, before: el.coords.map(c => [...c]), moved: false };
    }
    return;
  }
  if (['pen', 'eraser', 'restore'].includes(state.tool)) {
    painting = true;
    state.currentStroke = new Map();
    state.prevPaintPt = null;
    strokeTo(p.px, p.py);
    draw();
  } else if (state.tool === 'waypoint' || state.tool === 'door') {
    // A door is a waypoint with role pre-set to 'door' (reuses click-place +
    // drag-to-aim); the Waypoint tool leaves role unset for the inspector.
    const role = state.tool === 'door' ? 'door' : '';
    state.drawing = { id: 'tmp', type: 'waypoint', label: role || 'waypoint',
      coords: [[w.wx, w.wy]], closed: false, asNogo: false, ...defaultWaypointFields({ role }) };
    draw();
  } else if (state.tool === 'point') {
    addElement({ type: 'point', label: currentLabel(), coords: [[w.wx, w.wy]], closed: false, asNogo: false });
  } else if (state.tool === 'rect') {
    // Store the fixed start corner; coords carries all 4 bbox corners so the
    // preview renders as a rectangle (closed poly) rather than a diagonal line.
    state.drawing = { id: 'tmp', label: currentLabel(), type: 'rect', start: [w.wx, w.wy],
      coords: [[w.wx, w.wy], [w.wx, w.wy], [w.wx, w.wy], [w.wx, w.wy]], closed: true, asNogo: false };
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

  // Dragging a vertex: move it live and show its world coords in the readout.
  if (nodeDrag) {
    const el = state.elements.find(e => e.id === nodeDrag.id);
    if (el) { el.coords[nodeDrag.index] = [w.wx, w.wy]; status(selReadout(el, nodeDrag.index)); }
    canvas.style.cursor = 'grabbing';
    draw();
    return;
  }

  // Dragging the body: translate the whole element by the cursor delta.
  if (bodyDrag) {
    const el = state.elements.find(e => e.id === bodyDrag.id);
    if (el) {
      const dx = w.wx - bodyDrag.startWx, dy = w.wy - bodyDrag.startWy;
      if (Math.hypot(dx, dy) > state.meta.resolution * 0.5) bodyDrag.moved = true;
      el.coords = bodyDrag.before.map(([cx, cy]) => [cx + dx, cy + dy]);
      status(selReadout(el, -1));
    }
    canvas.style.cursor = 'grabbing';
    draw();
    return;
  }

  // Readout: when a shape is selected for editing, show its node coords (bottom
  // text box); otherwise the usual cursor world/pixel position.
  const selEl = state.tool === 'select' && state.selected && state.elements.find(e => e.id === state.selected);
  if (selEl) status(selReadout(selEl, nodeAt(selEl, p)));
  else status(`world (${w.wx.toFixed(3)}, ${w.wy.toFixed(3)}) m   px (${Math.floor(p.px)}, ${Math.floor(p.py)})   tool: ${state.tool}`);

  // Cursor affordance hint (Select tool): grab over a node handle of the selected
  // element, move over any element body, plain arrow otherwise.
  if (state.tool === 'select') {
    canvas.style.cursor = (selEl && nodeAt(selEl, p) >= 0) ? 'grab'
      : hitTest(w.wx, w.wy) ? 'move' : 'default';
  }

  if (painting) {
    strokeTo(p.px, p.py);
  } else if (state.drawing) {
    if (state.drawing.type === 'rect') {
      const [ax, ay] = state.drawing.start;
      state.drawing.coords = [[ax, ay], [w.wx, ay], [w.wx, w.wy], [ax, w.wy]];
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
  if (nodeDrag) {
    const el = state.elements.find(e => e.id === nodeDrag.id);
    if (el) {
      const finalCoords = el.coords.map(c => [...c]);
      el.coords = nodeDrag.before;                       // restore so the diff is clean
      updateElementFields(el.id, { coords: finalCoords }); // one undoable elem-mod
      rebuildInspector();                                  // refresh waypoint pos display
    }
    nodeDrag = null;
    draw();
    return;
  }
  if (bodyDrag) {
    const el = state.elements.find(e => e.id === bodyDrag.id);
    if (el) {
      if (bodyDrag.moved) {
        const finalCoords = el.coords.map(c => [...c]);
        el.coords = bodyDrag.before;                       // restore for a clean undo diff
        updateElementFields(el.id, { coords: finalCoords }); // one undoable elem-mod
        rebuildInspector();
      } else {
        el.coords = bodyDrag.before;                       // sub-threshold jitter: revert, it was a click
      }
    }
    bodyDrag = null;
    draw();
    return;
  }
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
    const el = { type: 'rect', label: currentLabel(), asNogo: false,
      coords: state.drawing.coords.map(c => [...c]), closed: true };  // already 4 bbox corners
    state.drawing = null;
    addElement(el);
  }
  if ((state.tool === 'waypoint' || state.tool === 'door') && state.drawing && state.drawing.type === 'waypoint') {
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
  // Overlays own their own keys while open.
  if (isPaletteOpen() || isCheatsheetOpen()) return;
  // Global triggers — must work even while a sidebar field has focus, so these
  // come BEFORE the typing-guard. Ctrl/Cmd+K and F1 are reliable; Ctrl/Cmd+Shift+P
  // is best-effort (Firefox usually steals it for a private window).
  const mod = ev.ctrlKey || ev.metaKey;
  if ((mod && (ev.key === 'k' || ev.key === 'K')) || ev.key === 'F1'
      || (mod && ev.shiftKey && ev.code === 'KeyP')) { ev.preventDefault(); openPalette(); return; }
  if (mod && (ev.key === 'b' || ev.key === 'B')) { ev.preventDefault(); toggleSidebar(); return; }

  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName) || ev.target.isContentEditable) return;
  // ? opens the shortcuts cheat-sheet (after the guard, so it types normally in fields).
  if (ev.key === '?') { ev.preventDefault(); openCheatsheet(); return; }
  // Shift+1…9/0/-/= quick-selects a tool (by .code, so it's keyboard-layout
  // independent). Plain Shift only — Ctrl/Cmd+Shift+Z stays redo.
  if (ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    const idx = TOOL_SHORTCUT_CODES.indexOf(ev.code);
    if (idx >= 0 && idx < TOOL_ORDER.length) { ev.preventDefault(); setTool(TOOL_ORDER[idx]); return; }
  }
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
