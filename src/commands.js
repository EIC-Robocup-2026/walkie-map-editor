// Single source of truth for runnable commands. The command palette, the
// shortcuts cheat-sheet, and (indirectly) the keybinds all read from here so
// nothing drifts. Rebuilt on demand so dynamic entries (elements, labels)
// reflect current state.
'use strict';

import { state, TOOL_ORDER, TOOL_SHORTCUT_KEYS } from './state.js';
import { $ } from './dom.js';
import { setTool } from './input.js';
import { undo, redoFn } from './history.js';
import { fitView, toggleSidebar, rebuildElemList, rebuildInspector } from './ui.js';
import { exportAll } from './io.js';
import { clearAllElements, deleteElement, kindOf } from './elements.js';
import { draw, zoomToElement } from './render.js';

const TOOL_TITLES = {
  pen: 'Pen (paint occupied)', eraser: 'Eraser (paint free)', restore: 'Restore (revert to _og)',
  select: 'Select', point: 'Point', rect: 'Rect', polygon: 'Polygon', nogo: 'No-Go', waypoint: 'Waypoint',
};

// Returns [{ id, category, title, keys: string[], run }].
export function getCommands() {
  const cmds = [];

  // ── Tools ──
  TOOL_ORDER.forEach((t, i) => {
    cmds.push({
      id: 'tool.' + t, category: 'Tools', title: TOOL_TITLES[t] || t,
      keys: TOOL_SHORTCUT_KEYS[i] ? ['Shift+' + TOOL_SHORTCUT_KEYS[i]] : [],
      run: () => setTool(t),
    });
  });

  // ── Actions ──
  cmds.push(
    { id: 'act.undo', category: 'Actions', title: 'Undo', keys: ['Ctrl+Z'], run: undo },
    { id: 'act.redo', category: 'Actions', title: 'Redo', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], run: redoFn },
    { id: 'act.fit', category: 'Actions', title: 'Fit map to viewport', keys: [], run: fitView },
    { id: 'act.export', category: 'Actions', title: 'Export map bundle', keys: [], run: exportAll },
    { id: 'act.load', category: 'Actions', title: 'Load folder…', keys: [], run: () => $('#folder-input').click() },
    { id: 'act.clear', category: 'Actions', title: 'Clear all elements', keys: [], run: clearAllElements },
  );
  if (state.selected) {
    cmds.push({ id: 'act.del', category: 'Actions', title: 'Delete selected element',
      keys: ['Del'], run: () => deleteElement(state.selected) });
  }

  // ── View toggles ── (flip state, sync the matching checkbox, redraw)
  const toggle = (sel, prop) => { state[prop] = !state[prop]; const cb = $(sel); if (cb) cb.checked = state[prop]; draw(); };
  cmds.push(
    { id: 'view.ids', category: 'View', title: `${state.showIds ? 'Hide' : 'Show'} #id tags`, keys: [],
      run: () => toggle('#toggle-ids', 'showIds') },
    { id: 'view.orig', category: 'View', title: `${state.showOriginalOverlay ? 'Hide' : 'Show'} original-map overlay`, keys: [],
      run: () => toggle('#toggle-orig', 'showOriginalOverlay') },
    { id: 'view.sidebar', category: 'View', title: `${state.sidebarCollapsed ? 'Show' : 'Hide'} sidebar`, keys: ['Ctrl+B'],
      run: toggleSidebar },
  );

  // ── Go to element ── (select + zoom)
  for (const e of state.elements) {
    cmds.push({ id: 'goto.' + e.id, category: 'Go to element', title: `#${e.id} ${e.label} (${kindOf(e)})`, keys: [],
      run: () => { state.selected = e.id; rebuildElemList(); rebuildInspector(); zoomToElement(e); } });
  }

  // ── Set active label (for the next shape) ──
  for (const l of state.labels) {
    cmds.push({ id: 'label.' + l, category: 'Set label', title: `Label: ${l}`, keys: [],
      run: () => { const sel = $('#label-select'); if (sel) sel.value = l; } });
  }

  return cmds;
}
