// VSCode-style command palette. Fuzzy-search every command from the registry
// (tools, actions, view toggles, go-to-element, set-label), see its keybind,
// run with Enter. Triggers: Ctrl/Cmd+K, F1, and best-effort Ctrl/Cmd+Shift+P.
'use strict';

import { getCommands } from './commands.js';

let backdrop, inputEl, listEl;
let rows = [];          // [{ cmd, el }]
let active = 0;
let open = false;

function ensureDom() {
  if (backdrop) return;
  backdrop = document.createElement('div');
  backdrop.className = 'ov-backdrop';
  backdrop.innerHTML = `
    <div class="cmdp" role="dialog" aria-label="Command palette">
      <input class="cmdp-input" type="text" autocomplete="off" spellcheck="false"
             placeholder="Run a command, switch tool, jump to an element or label…">
      <ul class="cmdp-list"></ul>
      <div class="cmdp-foot"><span>↑↓ navigate · ↵ run · Esc close</span>
        <span>Ctrl/Cmd+K · F1 · (Ctrl+Shift+P)</span></div>
    </div>`;
  inputEl = backdrop.querySelector('.cmdp-input');
  listEl = backdrop.querySelector('.cmdp-list');

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closePalette(); });
  inputEl.addEventListener('input', () => refilter());
  inputEl.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
}

// subsequence fuzzy score; contiguous substring ranks highest; -1 = no match.
function score(hay, q) {
  hay = hay.toLowerCase();
  if (!q) return 0;
  const idx = hay.indexOf(q);
  if (idx >= 0) return 1000 - idx;
  let hi = 0, qi = 0, s = 0, last = -1;
  while (hi < hay.length && qi < q.length) {
    if (hay[hi] === q[qi]) { s += (last >= 0 && hi === last + 1) ? 3 : 1; last = hi; qi++; }
    hi++;
  }
  return qi === q.length ? s : -1;
}

function kbd(keys) {
  return keys.map(k => `<kbd>${k}</kbd>`).join('');
}

function refilter() {
  const q = inputEl.value.toLowerCase().trim();
  const all = getCommands();
  const scored = [];
  for (const cmd of all) {
    const s = score(cmd.title + ' ' + cmd.category, q);
    if (s >= 0) scored.push({ cmd, s });
  }
  // stable-ish: keep registry order when query empty, else by score desc
  if (q) scored.sort((a, b) => b.s - a.s);
  listEl.replaceChildren();
  rows = scored.map(({ cmd }, i) => {
    const li = document.createElement('li');
    li.className = 'cmdp-row';
    li.innerHTML = `<span class="cmdp-cat">${cmd.category}</span>`
      + `<span class="cmdp-title"></span>`
      + `<span class="cmdp-keys">${kbd(cmd.keys)}</span>`;
    li.querySelector('.cmdp-title').textContent = cmd.title;
    li.addEventListener('mousemove', () => setActive(i));
    li.addEventListener('click', () => run(i));
    listEl.appendChild(li);
    return { cmd, el: li };
  });
  setActive(0);
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'cmdp-empty'; empty.textContent = 'No matching commands';
    listEl.appendChild(empty);
  }
}

function setActive(i) {
  if (!rows.length) { active = 0; return; }
  active = Math.max(0, Math.min(i, rows.length - 1));
  rows.forEach((r, idx) => r.el.classList.toggle('active', idx === active));
  rows[active].el.scrollIntoView({ block: 'nearest' });
}

function run(i) {
  const r = rows[i];
  if (!r) return;
  closePalette();
  try { r.cmd.run(); } catch (e) { console.warn('command failed', r.cmd.id, e); }
}

function onKey(ev) {
  if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(active + 1); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(active - 1); }
  else if (ev.key === 'Enter') { ev.preventDefault(); run(active); }
  else if (ev.key === 'Escape') { ev.preventDefault(); closePalette(); }
}

export function openPalette() {
  ensureDom();
  open = true;
  backdrop.classList.add('show');
  inputEl.value = '';
  refilter();
  inputEl.focus();
}

export function closePalette() {
  if (!open) return;
  open = false;
  backdrop.classList.remove('show');
}

export function isPaletteOpen() { return open; }
