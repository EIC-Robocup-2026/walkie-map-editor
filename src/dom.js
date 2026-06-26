// DOM handles + coordinate transforms — the only layer that ties `state` to the
// canvas element. Module scripts are deferred, so the DOM is parsed before this
// runs and the queries below resolve.
'use strict';

import { state } from './state.js';

export const $ = (s) => document.querySelector(s);
export const canvas = $('#cv');
export const ctx = canvas.getContext('2d');
export const off = document.createElement('canvas');
export const offCtx = off.getContext('2d');
// Offscreen for the original-map overlay (rendered lazily by render.js).
export const offOrig = document.createElement('canvas');
export const offOrigCtx = offOrig.getContext('2d');

// worldToPx(wx, wy): px = (wx - ox)/res, py = H - (wy - oy)/res
export function worldToPx(wx, wy) {
  const [ox, oy] = state.meta.origin;
  const r = state.meta.resolution;
  return { px: (wx - ox) / r, py: state.h - (wy - oy) / r };
}
export function pxToWorld(px, py) {
  const [ox, oy] = state.meta.origin;
  const r = state.meta.resolution;
  return { wx: ox + px * r, wy: oy + (state.h - py) * r };
}
export function screenToPx(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  return { px: (sx - rect.left - state.view.x) / state.view.s, py: (sy - rect.top - state.view.y) / state.view.s };
}
export function screenToWorld(sx, sy) {
  const p = screenToPx(sx, sy);
  return pxToWorld(p.px, p.py);
}
