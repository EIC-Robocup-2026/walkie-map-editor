// Pointer + keyboard interaction: pixel painting, pan/zoom, shape drawing, and
// the canvas/window event listeners. Tool selection lives here too.
'use strict';

import { state, markDirty, FREE, OCC, TOOL_ORDER, TOOL_SHORTCUT_CODES, roleForType, DOOR_DEFAULT_RADIUS_M } from './state.js';
import { canon, polygonCentroid, pointInPoly } from './pure.js';
import { canvas, offCtx, screenToPx, screenToWorld, worldToPx } from './dom.js';
import { draw, brushRadius, zoomToElement } from './render.js';
import { addElement, deleteElement, hitTest, updateElementFields, kindOf, isVisible } from './elements.js';
import { pushUndo, undo, redoFn } from './history.js';
import { status, rebuildElemList, rebuildInspector, currentLabel, currentType, toggleSidebar } from './ui.js';
import { defaultWaypointFields } from './io.js';
import { openPalette, isPaletteOpen } from './palette.js';
import { openCheatsheet, isCheatsheetOpen } from './cheatsheet.js';

// Live binding read by render.drawElements / render.drawCursor.
export let cursorPx = null;
let panning = null;
let painting = false;
// Drag state for the 3D ref overlay move mode.
let refDrag = null;
// Active vertex drag: { id, index, before } where `before` is a deep copy of the
// element's coords at grab time, so the whole move commits as one undo step.
let nodeDrag = null;
// Active body drag: translate the whole element (point/line/area). `before` is the
// coords at grab time; `moved` gates committing an undo step (vs. a plain click).
let bodyDrag = null;
// Heading-aim mode: right-click a waypoint to rotate its heading with the cursor.
// `before` is the heading at grab time (for cancel + a clean undo diff).
let aiming = null;
// Dragging a door's dashed radius ring to resize its trigger radius.
let radiusDrag = null;
// Measure tool: true while dragging out the measurement line.
let measuring = false;

// Is the screen-space point `p` near the dashed trigger-ring of door `el`?
function nearDoorRing(el, p) {
  if (!el || el.role !== 'door' || !el.coords[0]) return false;
  const c = worldToPx(el.coords[0][0], el.coords[0][1]);
  const rM = Number.isFinite(+el.radius) && +el.radius > 0 ? +el.radius : DOOR_DEFAULT_RADIUS_M;
  const rpx = rM / state.meta.resolution;
  return Math.abs(Math.hypot(p.px - c.px, p.py - c.py) - rpx) < 8 / state.view.s;
}

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

// ───── Unified shape + waypoint (area always, object optional) ───────

// Make `base` unique among existing waypoint names of the same role, so drawing
// two "table" objects yields table / table_2 instead of a duplicate-key export error.
function uniqueWaypointName(base, role) {
  if (!base) return base;
  const taken = new Set(state.elements
    .filter(e => e.type === 'waypoint' && e.role === role && e.name && e.id !== undefined)
    .map(e => canon(e.name)));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
// The room whose boundary polygon contains `pt`, so a drawn object auto-links to
// the room it sits in. '' if none.
function roomContaining([x, y]) {
  for (const e of state.elements) {
    if (e.type === 'waypoint' && e.role === 'room' && Array.isArray(e.polygon)
        && e.polygon.length >= 3 && pointInPoly(x, y, e.polygon)) return canon(e.name);
  }
  return '';
}

// Turn a finished drawing into an element. A closed, typed shape becomes a UNIFIED
// waypoint (pose = polygon centroid, polygon = the drawn boundary, name = the label):
// forced for area (→ room), optional for object (→ location). Everything else stays
// a plain shape.
function buildDrawnElement({ type, coords, closed, label, semType }) {
  const wantWp = semType === 'area' || (semType === 'object' && state.objectWaypoint);
  if (wantWp && closed && coords.length >= 3) {
    const role = roleForType(semType);
    const name = uniqueWaypointName(canon(label), role);
    const centre = polygonCentroid(coords);
    return {
      type: 'waypoint', label: name || label, semType,
      coords: [centre], closed: false, asNogo: false,
      ...defaultWaypointFields({
        role, name, polygon: coords.map(p => [...p]), present: true,
        room: role === 'location' ? roomContaining(centre) : '',
      }),
    };
  }
  return { type, label, semType, coords, closed, asNogo: false };
}

// Add a freshly drawn element; if it's a waypoint, select it so the inspector
// opens for naming/refining (mirrors the Waypoint tool).
function commitDrawnElement(el) {
  addElement(el);
  if (el.type === 'waypoint') {
    state.selected = el.id;
    rebuildElemList();
    rebuildInspector();
    draw();
  }
}

// Heading-aim: start (right-click a waypoint), commit (any click), cancel (Esc).
function startAim(el) {
  aiming = { id: el.id, before: el.heading || 0 };
  state.selected = el.id;
  rebuildElemList(); rebuildInspector();
  canvas.style.cursor = 'crosshair';
  status('aiming heading — move the cursor, click to set, Esc to cancel');
  draw();
}
function commitAim() {
  const el = aiming && state.elements.find(e => e.id === aiming.id);
  if (el) {
    const finalHeading = el.heading || 0;
    el.heading = aiming.before;                          // restore for a clean undo diff
    updateElementFields(el.id, { heading: finalHeading });  // one undoable elem-mod
    rebuildInspector();
    status(`heading set to ${Math.round(finalHeading * 180 / Math.PI)}°`);
  }
  aiming = null;
  draw();
}
function cancelAim() {
  const el = aiming && state.elements.find(e => e.id === aiming.id);
  if (el) el.heading = aiming.before;
  aiming = null;
  rebuildInspector();
  draw();
}

canvas.addEventListener('mousedown', (ev) => {
  if (!state.meta) return;
  // While aiming a heading, any click commits it (and starts nothing else).
  if (aiming) { ev.preventDefault(); commitAim(); return; }
  if (isPanTrigger(ev)) {
    panning = { sx: ev.clientX, sy: ev.clientY, vx: state.view.x, vy: state.view.y };
    ev.preventDefault();
    return;
  }
  // Ref overlay drag mode: left-button drag moves the overlay.
  if (state.refMoveMode && state.showRefOverlay && ev.button === 0) {
    refDrag = { sx: ev.clientX, sy: ev.clientY, ox: state.refOffsetX, oy: state.refOffsetY };
    canvas.style.cursor = 'grabbing';
    ev.preventDefault();
    return;
  }
  if (ev.button === 2) {
    if (state.drawing && (state.tool === 'polygon' || state.tool === 'nogo')) {
      finishPoly(false);
      return;
    }
    // Right-click a waypoint to aim its heading with the cursor.
    const wr = screenToWorld(ev.clientX, ev.clientY);
    const id = hitTest(wr.wx, wr.wy);
    const el = id && state.elements.find(e => e.id === id);
    if (el && el.type === 'waypoint') startAim(el);
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
      // Grabbing the radius ring of the selected door resizes its trigger radius.
      if (sel.type === 'waypoint' && nearDoorRing(sel, p)) {
        radiusDrag = { id: sel.id, before: sel.radius == null ? null : sel.radius };
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
    addElement({ type: 'point', label: currentLabel(), semType: currentType(), coords: [[w.wx, w.wy]], closed: false, asNogo: false });
  } else if (state.tool === 'rect') {
    // Store the fixed start corner; coords carries all 4 bbox corners so the
    // preview renders as a rectangle (closed poly) rather than a diagonal line.
    state.drawing = { id: 'tmp', label: currentLabel(), semType: currentType(), type: 'rect', start: [w.wx, w.wy],
      coords: [[w.wx, w.wy], [w.wx, w.wy], [w.wx, w.wy], [w.wx, w.wy]], closed: true, asNogo: false };
  } else if (state.tool === 'polygon' || state.tool === 'nogo') {
    if (!state.drawing) {
      const t = state.tool === 'nogo' ? 'nogo' : 'polygon';
      // No-go zones aren't an area/object — they carry no semType.
      state.drawing = { id: 'tmp', label: state.tool === 'nogo' ? 'no-go' : currentLabel(),
        semType: state.tool === 'nogo' ? undefined : currentType(), type: t, coords: [[w.wx, w.wy]], closed: false, asNogo: false };
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
  } else if (state.tool === 'measure') {
    // Drag out a measurement line; length shown live (display-only, not exported).
    state.measure = { a: [w.wx, w.wy], b: [w.wx, w.wy] };
    measuring = true;
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
  if (refDrag) {
    state.refOffsetX = refDrag.ox + (ev.clientX - refDrag.sx) / state.view.s;
    state.refOffsetY = refDrag.oy + (ev.clientY - refDrag.sy) / state.view.s;
    const ix = document.querySelector('#ref-offset-x');
    const iy = document.querySelector('#ref-offset-y');
    if (ix) ix.value = Math.round(state.refOffsetX);
    if (iy) iy.value = Math.round(state.refOffsetY);
    draw();
    return;
  }
  const p = screenToPx(ev.clientX, ev.clientY);
  const w = screenToWorld(ev.clientX, ev.clientY);
  cursorPx = p;

  // Aiming a heading: point the waypoint's arrow from its pose toward the cursor.
  if (aiming) {
    const el = state.elements.find(e => e.id === aiming.id);
    if (el) {
      const pos = el.coords[0] || [0, 0];
      el.heading = Math.atan2(w.wy - pos[1], w.wx - pos[0]);   // world Y-up
      status(`heading ${Math.round(el.heading * 180 / Math.PI)}° — click to set, Esc to cancel`);
    }
    canvas.style.cursor = 'crosshair';
    draw();
    return;
  }

  // Dragging a door's radius ring: resize the trigger radius live.
  if (radiusDrag) {
    const el = state.elements.find(e => e.id === radiusDrag.id);
    if (el) {
      const c = el.coords[0];
      el.radius = +Math.max(0.1, Math.hypot(w.wx - c[0], w.wy - c[1])).toFixed(3);
      status(`door radius ${el.radius} m`);
    }
    canvas.style.cursor = 'ew-resize';
    draw();
    return;
  }

  // Measuring: track the line's far end and show its length.
  if (measuring && state.measure) {
    state.measure.b = [w.wx, w.wy];
    const L = Math.hypot(state.measure.b[0] - state.measure.a[0], state.measure.b[1] - state.measure.a[1]);
    status(`measure: ${L.toFixed(3)} m`);
    draw();
    return;
  }

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

  if (state.refMoveMode && state.showRefOverlay) {
    canvas.style.cursor = 'move';
    draw();
    return;
  }
  // Cursor affordance hint (Select tool): grab over a node handle of the selected
  // element, move over any element body, plain arrow otherwise.
  if (state.tool === 'select') {
    canvas.style.cursor = (selEl && nodeAt(selEl, p) >= 0) ? 'grab'
      : (selEl && nearDoorRing(selEl, p)) ? 'ew-resize'
      : hitTest(w.wx, w.wy) ? 'move' : 'default';
  }

  if (painting) {
    strokeTo(p.px, p.py);
  } else if (state.drawing) {
    if (state.drawing.type === 'rect') {
      const [ax, ay] = state.drawing.start;
      state.drawing.coords = [[ax, ay], [w.wx, ay], [w.wx, w.wy], [ax, w.wy]];
      status(`area: ${Math.abs(w.wx - ax).toFixed(2)} × ${Math.abs(w.wy - ay).toFixed(2)} m`);
    } else if (state.drawing.type === 'waypoint') {
      const [ax, ay] = state.drawing.coords[0];
      const dx = w.wx - ax, dy = w.wy - ay, dist = Math.hypot(dx, dy);
      if (dist > 2 * state.meta.resolution) {
        state.drawing.heading = Math.atan2(dy, dx);
        // For a door, the drag distance also sets the trigger radius (press-and-hold
        // to scale the ring while aiming the passage).
        if (state.drawing.role === 'door') {
          state.drawing.radius = +dist.toFixed(3);
          status(`door: ${Math.round(state.drawing.heading * 180 / Math.PI)}° · radius ${state.drawing.radius} m`);
        }
      }
    }
  }
  draw();
});

canvas.addEventListener('mouseup', (ev) => {
  if (panning) { panning = null; return; }
  if (refDrag) {
    refDrag = null;
    canvas.style.cursor = state.refMoveMode ? 'move' : 'default';
    return;
  }
  if (radiusDrag) {
    const el = state.elements.find(e => e.id === radiusDrag.id);
    if (el) {
      const final = el.radius;
      el.radius = radiusDrag.before;                         // restore for a clean undo diff
      updateElementFields(el.id, { radius: final });          // one undoable elem-mod
      rebuildInspector();
    }
    radiusDrag = null;
    draw();
    return;
  }
  if (measuring) { measuring = false; return; }   // keep the line shown until Esc / next measure
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
    const el = buildDrawnElement({ type: 'rect', coords: state.drawing.coords.map(c => [...c]),
      closed: true, label: state.drawing.label, semType: state.drawing.semType });  // already 4 bbox corners
    state.drawing = null;
    commitDrawnElement(el);
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
  // [ / ] — step selection to the previous / next visible element (and frame it),
  // so you can walk the arena without reaching for the mouse.
  if ((ev.key === '[' || ev.key === ']') && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault(); cycleSelection(ev.key === ']' ? 1 : -1); return;
  }
  if (ev.key === 'Escape') {
    if (aiming) { cancelAim(); return; }
    if (state.measure) { state.measure = null; measuring = false; draw(); return; }
    if (state.refMoveMode) {
      state.refMoveMode = false;
      const btn = document.querySelector('#ref-move-btn');
      if (btn) btn.classList.remove('active');
      canvas.style.cursor = 'default';
      return;
    }
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

// Move the selection to the next/prev visible element and frame it on the canvas.
function cycleSelection(dir) {
  const vis = state.elements.filter(isVisible);
  if (!vis.length) return;
  const cur = vis.findIndex(e => e.id === state.selected);
  const idx = cur < 0 ? (dir > 0 ? 0 : vis.length - 1) : (cur + dir + vis.length) % vis.length;
  const el = vis[idx];
  state.selected = el.id;
  rebuildElemList(); rebuildInspector(); zoomToElement(el);
}

function finishPoly(closed) {
  if (!state.drawing) return;
  const minPts = closed ? 3 : 2;
  if (state.drawing.coords.length < minPts) { state.drawing = null; draw(); return; }
  const el = buildDrawnElement({ type: state.drawing.type, coords: state.drawing.coords,
    closed, label: state.drawing.label, semType: state.drawing.semType });
  state.drawing = null;
  commitDrawnElement(el);
}

export function setTool(t) {
  state.tool = t;
  state.drawing = null;
  measuring = false;
  document.querySelectorAll('button[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  canvas.style.cursor = ({ select: 'pointer', point: 'crosshair', rect: 'crosshair',
    polygon: 'crosshair', nogo: 'crosshair', pen: 'none', eraser: 'none', restore: 'none' }[t]) || 'crosshair';
  draw();
}
