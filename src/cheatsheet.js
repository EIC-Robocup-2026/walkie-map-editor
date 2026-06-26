// Shortcuts cheat-sheet overlay (press ?). Lists every keybound command from
// the registry, grouped by category, plus static mouse/viewport hints.
'use strict';

import { getCommands } from './commands.js';

let backdrop, open = false;

const MOUSE_HINTS = [
  ['Mouse wheel', 'zoom at cursor'],
  ['Middle / Alt / Ctrl + drag', 'pan'],
  ['Polygon / No-Go', 'click vertices, click near start to close'],
  ['Right-click', 'finish polygon'],
  ['Select + drag a node handle', 'move that vertex'],
  ['Double-click a list item', 'rename its label'],
  ['Drop a map folder on the canvas', 'load it'],
];

function ensureDom() {
  if (backdrop) return;
  backdrop = document.createElement('div');
  backdrop.className = 'ov-backdrop';
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeCheatsheet(); });
  document.body.appendChild(backdrop);
}

function row(label, keys) {
  return `<li><span class="cheat-desc">${label}</span>`
    + `<span class="cheat-keys">${keys.map(k => `<kbd>${k}</kbd>`).join(' ')}</span></li>`;
}

function build() {
  const cmds = getCommands().filter(c => c.keys && c.keys.length);
  const cats = [];
  const byCat = new Map();
  for (const c of cmds) {
    if (!byCat.has(c.category)) { byCat.set(c.category, []); cats.push(c.category); }
    byCat.get(c.category).push(c);
  }
  const groups = cats.map(cat => `
    <div class="cheat-group"><h3>${cat}</h3><ul>
      ${byCat.get(cat).map(c => row(c.title, c.keys)).join('')}
    </ul></div>`).join('');
  const mouse = `
    <div class="cheat-group"><h3>Mouse & viewport</h3><ul>
      ${MOUSE_HINTS.map(([d, k]) => `<li><span class="cheat-desc">${d}</span><span class="cheat-keys">${k}</span></li>`).join('')}
    </ul></div>`;
  backdrop.innerHTML = `
    <div class="cheat" role="dialog" aria-label="Keyboard shortcuts">
      <h2>Keyboard &amp; mouse shortcuts</h2>
      <div class="cheat-grid">${groups}${mouse}</div>
      <div class="cmdp-foot"><span>Esc to close</span><span>Ctrl/Cmd+K · F1 — command palette</span></div>
    </div>`;
}

function onKey(ev) {
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeCheatsheet(); }
}

export function openCheatsheet() {
  ensureDom();
  build();
  open = true;
  backdrop.classList.add('show');
  document.addEventListener('keydown', onKey, true);
}

export function closeCheatsheet() {
  if (!open) return;
  open = false;
  backdrop.classList.remove('show');
  document.removeEventListener('keydown', onKey, true);
}

export function isCheatsheetOpen() { return open; }
