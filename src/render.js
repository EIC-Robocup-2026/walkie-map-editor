// Canvas rendering: the pixel raster, grid/origin overlays, vector elements,
// brush cursor, and scale bar.
'use strict';

import { state, WAYPOINT_ARROW_PX } from './state.js';
import { $, canvas, ctx, off, offCtx, worldToPx, screenToPx } from './dom.js';
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

export function draw() {
  const W = canvas.width = canvas.clientWidth;
  const H = canvas.height = canvas.clientHeight;
  ctx.fillStyle = '#555'; ctx.fillRect(0, 0, W, H);
  if (!state.meta) return;

  ctx.save();
  ctx.translate(state.view.x, state.view.y);
  ctx.scale(state.view.s, state.view.s);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0);
  drawGrid();
  drawOrigin();
  drawElements();
  drawCursor();
  ctx.restore();

  drawScaleBar();
  $('#zoom-info').textContent = `${(state.view.s * 100).toFixed(0)}%`;
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
  const wpCol = e.role === 'room' ? '#f59e0b' : e.role === 'location' ? '#34d399' : '#a78bfa';
  const col = selected ? '#ffeb3b' : nogoFill ? '#ff4444' : wp ? wpCol : '#22d3ee';
  ctx.lineWidth = (selected ? 2 : 1.5) / state.view.s;
  ctx.strokeStyle = col;
  ctx.fillStyle = nogoFill ? 'rgba(255,68,68,0.25)' : 'rgba(34,211,238,0.15)';
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
}

function drawCursor() {
  if (!cursorPx || !['pen','eraser','restore'].includes(state.tool)) return;
  ctx.strokeStyle = state.tool === 'pen' ? '#000' : state.tool === 'eraser' ? '#fff' : '#0f0';
  ctx.lineWidth = 1 / state.view.s;
  const r = brushRadius();
  ctx.beginPath();
  ctx.arc(cursorPx.px, cursorPx.py, Math.max(r, 0.5), 0, Math.PI * 2);
  ctx.stroke();
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
