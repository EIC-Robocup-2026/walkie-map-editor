// Canvas rendering: the pixel raster, grid/origin overlays, vector elements,
// brush cursor, and scale bar.
'use strict';

import { state, WAYPOINT_ARROW_PX, DOOR_DEFAULT_RADIUS_M, colorForLabel, fillForLabel } from './state.js';
import { $, canvas, ctx, off, offCtx, offOrig, offOrigCtx, offRef, offRefCtx, worldToPx, screenToPx } from './dom.js';
import { kindOf, isVisible } from './elements.js';
import { cursorPx } from './input.js';

export function renderPixels() {
  off.width = state.w; off.height = state.h;
  const id = offCtx.createImageData(state.w, state.h);
  for (let p = 0, j = 0; p < state.pixels.length; p++, j += 4) {
    const g = state.pixels[p];
    id.data[j] = g; id.data[j+1] = g; id.data[j+2] = g; id.data[j+3] = 255;
  }
  offCtx.putImageData(id, 0, 0);
}

// Render the 3D OctoMap reference ImageBitmap into its own buffer once per load.
export function renderRef() {
  if (!state.refImage || !state.refMeta) return;
  offRef.width = state.refMeta.width;
  offRef.height = state.refMeta.height;
  offRefCtx.clearRect(0, 0, offRef.width, offRef.height);
  offRefCtx.drawImage(state.refImage, 0, 0);
}

// Render the pristine _og.pgm into its own buffer once per load — it never
// mutates afterwards, so this isn't redrawn on every frame.
export function renderOriginal() {
  if (!state.original) return;
  offOrig.width = state.w; offOrig.height = state.h;
  const id = offOrigCtx.createImageData(state.w, state.h);
  for (let p = 0, j = 0; p < state.original.length; p++, j += 4) {
    const g = state.original[p];
    id.data[j] = g; id.data[j+1] = g; id.data[j+2] = g; id.data[j+3] = 255;
  }
  offOrigCtx.putImageData(id, 0, 0);
}

export function draw() {
  const W = canvas.width = canvas.clientWidth;
  const H = canvas.height = canvas.clientHeight;
  ctx.fillStyle = '#555'; ctx.fillRect(0, 0, W, H);
  if (!state.meta) { drawEmptyState(W, H); return; }

  ctx.save();
  ctx.translate(state.view.x, state.view.y);
  ctx.scale(state.view.s, state.view.s);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0);
  if (state.showOriginalOverlay && state.original) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.drawImage(offOrig, 0, 0);
    ctx.restore();
  }
  if (state.showRefOverlay && state.refMeta && offRef.width) {
    const rm = state.refMeta, mm = state.meta;
    const baseScale = rm.resolution / mm.resolution;
    const finalScale = baseScale * state.refUserScale;
    // Base top-left in map-pixel space (at baseScale, no user offset)
    const baseDx = (rm.origin[0] - mm.origin[0]) / mm.resolution;
    const baseDy = state.h - (rm.origin[1] - mm.origin[1]) / mm.resolution - rm.height * baseScale;
    // Scale from the overlay's center so the image grows/shrinks in place
    const cx = baseDx + rm.width * baseScale / 2;
    const cy = baseDy + rm.height * baseScale / 2;
    const finalDx = cx - rm.width * finalScale / 2 + state.refOffsetX;
    const finalDy = cy - rm.height * finalScale / 2 + state.refOffsetY;
    ctx.save();
    ctx.globalAlpha = state.refOpacity;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offRef, finalDx, finalDy, rm.width * finalScale, rm.height * finalScale);
    ctx.restore();
  }
  drawGrid();
  drawOrigin();
  drawElements();
  drawCursor();
  ctx.restore();

  drawScaleBar();
  $('#zoom-info').textContent = `${(state.view.s * 100).toFixed(0)}%`;
}

// Shown before any map is loaded (and as a drop target).
function drawEmptyState(W, H) {
  const active = state._dropActive;
  const cx = W / 2, cy = H / 2;
  ctx.save();
  ctx.strokeStyle = active ? '#3b82f6' : '#777';
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2;
  const bw = Math.min(520, W - 80), bh = Math.min(220, H - 80);
  ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
  ctx.setLineDash([]);
  ctx.fillStyle = active ? '#bcd' : '#aaa';
  ctx.textAlign = 'center';
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.fillText(active ? 'Drop to load this map folder' : 'Drop a map folder here', cx, cy - 10);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#888';
  ctx.fillText('or click “Load folder” · needs a .pgm + .yaml', cx, cy + 16);
  ctx.fillText('press Ctrl/Cmd+K or F1 for the command palette', cx, cy + 38);
  ctx.restore();
  ctx.textAlign = 'left';
}

// Center the view on an element and zoom to fit its bounds (mirrors fitView).
export function zoomToElement(el) {
  if (!state.meta || !el || !el.coords || !el.coords.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [wx, wy] of el.coords) {
    const p = worldToPx(wx, wy);
    if (p.px < minX) minX = p.px; if (p.px > maxX) maxX = p.px;
    if (p.py < minY) minY = p.py; if (p.py > maxY) maxY = p.py;
  }
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1);
  // fit the bbox into ~60% of the viewport, but never zoom out past current scale
  const s = Math.min(Math.max(state.view.s, Math.min(W / bw, H / bh) * 0.6), 80);
  state.view.s = s;
  const ccx = (minX + maxX) / 2, ccy = (minY + maxY) / 2;
  state.view.x = W / 2 - ccx * s;
  state.view.y = H / 2 - ccy * s;
  draw();
}

function drawGrid() {
  const r = state.meta.resolution;
  const pxPerMeter = 1 / r;
  const target = 80 / state.view.s;
  const targetM = target * r;
  const nice = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
  let stepM = nice.find(n => n >= targetM) || 100;
  const stepPx = stepM * pxPerMeter;

  ctx.lineWidth = 1 / state.view.s;
  ctx.strokeStyle = 'rgba(0, 150, 255, 0.25)';
  ctx.beginPath();
  const tl = screenToPx(0, 0);
  const br = screenToPx(canvas.width, canvas.height);
  const o0 = worldToPx(0, 0);
  const startX = Math.floor((tl.px - o0.px) / stepPx) * stepPx + o0.px;
  const startY = Math.floor((tl.py - o0.py) / stepPx) * stepPx + o0.py;
  for (let x = startX; x <= br.px; x += stepPx) {
    ctx.moveTo(x, tl.py); ctx.lineTo(x, br.py);
  }
  for (let y = startY; y <= br.py; y += stepPx) {
    ctx.moveTo(tl.px, y); ctx.lineTo(br.px, y);
  }
  ctx.stroke();
  state._gridStepM = stepM;
}

function drawOrigin() {
  const o = worldToPx(0, 0);
  const r = 8 / state.view.s;
  ctx.lineWidth = 2 / state.view.s;
  ctx.strokeStyle = '#ff3b3b';
  ctx.beginPath(); ctx.moveTo(o.px - r, o.py); ctx.lineTo(o.px + r, o.py); ctx.stroke();
  ctx.strokeStyle = '#3bff3b';
  ctx.beginPath(); ctx.moveTo(o.px, o.py - r); ctx.lineTo(o.px, o.py + r); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `${10 / state.view.s}px sans-serif`;
  ctx.fillText('(0,0)', o.px + r, o.py - r);
}

function drawElements() {
  for (const e of state.elements) {
    if (!isVisible(e)) continue;
    drawElement(e, state.selected === e.id);
  }
  if (state.drawing) {
    drawElement(state.drawing, true, true);
    if (cursorPx && state.drawing.type !== 'rect' && state.drawing.type !== 'waypoint' && state.drawing.coords.length) {
      const last = state.drawing.coords[state.drawing.coords.length - 1];
      const lp = worldToPx(last[0], last[1]);
      ctx.save();
      ctx.setLineDash([4 / state.view.s, 4 / state.view.s]);
      ctx.strokeStyle = state.drawing.type === 'nogo' ? '#ff4444' : '#ffeb3b';
      ctx.lineWidth = 1 / state.view.s;
      ctx.beginPath();
      ctx.moveTo(lp.px, lp.py);
      ctx.lineTo(cursorPx.px, cursorPx.py);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawElement(e, selected, preview = false) {
  const nogoFill = e.type === 'nogo' || (e.asNogo && e.closed);
  const wp = e.type === 'waypoint';
  const hovered = !selected && state.hoverId === e.id;   // list↔canvas hover link
  const wpCol = e.role === 'room' ? '#f59e0b'
    : e.role === 'location' ? '#34d399'
    : e.role === 'door' ? '#f472b6'
    : '#a78bfa';
  // Drawn shapes get a per-label colour within their type's family; legacy/untyped
  // shapes stay cyan.
  const labelCol = e.semType ? colorForLabel(e.semType, e.label) : '#22d3ee';
  const col = selected ? '#ffeb3b' : hovered ? '#ffffff' : nogoFill ? '#ff4444' : wp ? wpCol : labelCol;
  ctx.lineWidth = (selected ? 2 : hovered ? 2.5 : 1.5) / state.view.s;
  ctx.strokeStyle = col;
  ctx.fillStyle = nogoFill ? 'rgba(255,68,68,0.25)' : (e.semType ? fillForLabel(e.semType, e.label) : 'rgba(34,211,238,0.15)');
  const pts = e.coords.map(([wx, wy]) => worldToPx(wx, wy));
  if (wp) {
    const p = pts[0];
    const L = WAYPOINT_ARROW_PX / state.view.s, r = 4 / state.view.s;
    const ex = p.px + L * Math.cos(e.heading || 0);
    const ey = p.py - L * Math.sin(e.heading || 0);   // world Y-up -> canvas Y-down
    ctx.fillStyle = col;
    ctx.lineWidth = (selected ? 2.5 : 1.8) / state.view.s;
    ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(ex, ey); ctx.stroke();
    const a = Math.atan2(ey - p.py, ex - p.px), ah = 7 / state.view.s;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ah * Math.cos(a - 0.4), ey - ah * Math.sin(a - 0.4));
    ctx.lineTo(ex - ah * Math.cos(a + 0.4), ey - ah * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2); ctx.fill();
    // Door: dashed ring at the proximity-trigger radius — where the robot's
    // door-opening skill engages (per-door radius, else the global default).
    if (e.role === 'door') {
      const rm = Number.isFinite(+e.radius) && +e.radius > 0 ? +e.radius : DOOR_DEFAULT_RADIUS_M;
      const rpx = rm / state.meta.resolution;
      ctx.save();
      ctx.setLineDash([5 / state.view.s, 4 / state.view.s]);
      ctx.lineWidth = 1.2 / state.view.s;
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(p.px, p.py, rpx, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  } else if (e.type === 'point') {
    const p = pts[0];
    const r = 5 / state.view.s;
    ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].px, pts[0].py);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].px, pts[i].py);
    if (e.closed) { ctx.closePath(); ctx.fill(); }
    ctx.stroke();
    if (preview) {
      for (const p of pts) {
        ctx.beginPath(); ctx.arc(p.px, p.py, 3 / state.view.s, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  if (!preview && pts.length) {
    ctx.fillStyle = col;
    ctx.font = `${11 / state.view.s}px sans-serif`;
    const tag = state.showIds ? `#${e.id} ${e.label}` : e.label;
    ctx.fillText(tag, pts[0].px + 5 / state.view.s, pts[0].py - 5 / state.view.s);
  }
  // Draggable node handles — drawn when this element is selected under the
  // Select tool, so the user can see and grab each vertex to move it.
  if (!preview && selected && state.tool === 'select') {
    const hs = 4 / state.view.s;
    ctx.lineWidth = 1.5 / state.view.s;
    ctx.fillStyle = '#ffeb3b';
    ctx.strokeStyle = '#000';
    for (const p of pts) {
      ctx.fillRect(p.px - hs, p.py - hs, hs * 2, hs * 2);
      ctx.strokeRect(p.px - hs, p.py - hs, hs * 2, hs * 2);
    }
  }
}

function drawCursor() {
  if (!cursorPx || !['pen','eraser','restore'].includes(state.tool)) return;
  const r = Math.max(brushRadius(), 0.5);
  // 'difference' with white inverts whatever's underneath, so the brush outline
  // stays visible over both the white free-space and the black occupied pixels
  // (a plain white ring vanished against the white map).
  ctx.save();
  ctx.globalCompositeOperation = 'difference';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1 / state.view.s;
  ctx.beginPath();
  ctx.arc(cursorPx.px, cursorPx.py, r, 0, Math.PI * 2);
  ctx.stroke();
  // small center crosshair for precise placement
  const ch = Math.max(r * 0.6, 2 / state.view.s);
  ctx.beginPath();
  ctx.moveTo(cursorPx.px - ch, cursorPx.py); ctx.lineTo(cursorPx.px + ch, cursorPx.py);
  ctx.moveTo(cursorPx.px, cursorPx.py - ch); ctx.lineTo(cursorPx.px, cursorPx.py + ch);
  ctx.stroke();
  ctx.restore();
}

function drawScaleBar() {
  if (!state.meta) return;
  const stepM = state._gridStepM || 1;
  const pxLen = stepM / state.meta.resolution * state.view.s;
  const x = 12, y = canvas.height - 18;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 4, y - 12, pxLen + 8, 22);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + pxLen, y);
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
  ctx.moveTo(x + pxLen, y - 4); ctx.lineTo(x + pxLen, y + 4);
  ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
  const lbl = stepM >= 1 ? `${stepM} m` : `${(stepM * 100).toFixed(0)} cm`;
  ctx.fillText(lbl, x + pxLen / 2 - 12, y - 6);
}

// brush "size" semantics: size=1 → exactly 1 pixel. size=N → disk of width N.
export function brushRadius() { return state.brush / 2; }
