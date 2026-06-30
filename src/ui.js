// Sidebar DOM: element list, visibility filters, label select, waypoint
// inspector, arena-vocabulary editors, map info, status line, and fit-to-view.
'use strict';

import {
  state, markDirty, LABEL_TYPES, TYPE_COLORS, colorForLabel,
  SUGGEST_ROOM_NAMES, SUGGEST_LOCATION_NAMES, SUGGEST_CATEGORIES,
  SUGGEST_OBJECT_CATEGORIES, SUGGEST_GESTURES, SUGGEST_DOOR_NAMES, DOOR_DEFAULT_RADIUS_M,
} from './state.js';
import { $, canvas } from './dom.js';
import { canon, splitList } from './pure.js';
import { kindOf, isVisible, deleteElement, renameElement, toggleAsNogo, updateElementFields } from './elements.js';
import { draw, zoomToElement } from './render.js';

// ───── Element list ─────────────────────────────────────────────────

// Navigation grouping: a populated arena reads as Rooms / Locations / Doors /
// Waypoints / Shapes / No-go sections instead of one flat list.
function groupOf(e) {
  if (e.type === 'waypoint') {
    return e.role === 'room' ? 'Rooms' : e.role === 'location' ? 'Locations'
      : e.role === 'door' ? 'Doors' : 'Waypoints';
  }
  if (e.type === 'nogo' || e.asNogo) return 'No-go';
  return 'Shapes';
}
const GROUP_ORDER = ['Rooms', 'Locations', 'Doors', 'Waypoints', 'Shapes', 'No-go'];

// Build one element row (the <li>); extracted so the grouped list can stamp many.
function buildElemRow(e) {
  const li = document.createElement('li');
  if (state.selected === e.id) li.className = 'sel';
  if (!isVisible(e)) li.classList.add('hidden');
  li.onmouseenter = () => { state.hoverId = e.id; draw(); };
  li.onmouseleave = () => { if (state.hoverId === e.id) { state.hoverId = null; draw(); } };

  const main = document.createElement('span');
  main.className = 'main';
  if (e.semType) {
    const sw = document.createElement('span');
    sw.className = 'type-sw';
    sw.style.background = colorForLabel(e.semType, e.label);
    sw.title = `${e.semType}: ${e.label}`;
    main.appendChild(sw);
  }
  const idTag = document.createElement('code');
  idTag.className = 'eid';
  idTag.textContent = '#' + e.id;
  main.appendChild(idTag);
  const labelSpan = document.createElement('span');
  labelSpan.textContent = ' ' + e.label + ' ';
  main.appendChild(labelSpan);
  const em = document.createElement('em');
  em.textContent = kindOf(e) + (e.asNogo ? '+nogo' : '');
  main.appendChild(em);

  const actions = document.createElement('span');
  actions.className = 'acts';
  if (e.closed && e.type !== 'nogo') {
    const nogoBtn = document.createElement('button');
    nogoBtn.className = 'mini';
    nogoBtn.textContent = e.asNogo ? 'nogo✓' : 'nogo';
    nogoBtn.title = 'mask this shape into _keepout.pgm';
    nogoBtn.onclick = (ev) => { ev.stopPropagation(); toggleAsNogo(e.id); };
    actions.appendChild(nogoBtn);
  }
  const zoomBtn = document.createElement('button');
  zoomBtn.className = 'mini'; zoomBtn.textContent = '⌖'; zoomBtn.title = 'zoom to element';
  zoomBtn.onclick = (ev) => { ev.stopPropagation(); state.selected = e.id; rebuildElemList(); rebuildInspector(); zoomToElement(e); };
  actions.appendChild(zoomBtn);
  const x = document.createElement('span');
  x.className = 'x'; x.textContent = '×';
  actions.appendChild(x);

  li.appendChild(main); li.appendChild(actions);
  li.onclick = (ev) => { if (ev.target.closest('.acts')) return; state.selected = e.id; rebuildElemList(); rebuildInspector(); draw(); };
  // Waypoints are renamed via the inspector (their label mirrors `name`), so the
  // dblclick label-editor is wired only for the drawing kinds it actually owns —
  // otherwise its blur would no-op in renameElement and strand the input in the DOM.
  if (e.type !== 'waypoint') li.ondblclick = (ev) => {
    if (ev.target.closest('.acts')) return;
    const input = document.createElement('input');
    input.value = e.label; input.size = 12;
    input.onclick = (e2) => e2.stopPropagation();
    input.onkeydown = (e2) => { if (e2.key === 'Enter') input.blur(); if (e2.key === 'Escape') { input.value = e.label; input.blur(); } };
    input.onblur = () => renameElement(e.id, input.value.trim());
    li.replaceChild(input, main);
    input.focus(); input.select();
  };
  x.onclick = (ev) => { ev.stopPropagation(); deleteElement(e.id); };
  return li;
}

export function rebuildElemList() {
  const ul = $('#elem-list');
  while (ul.firstChild) ul.removeChild(ul.firstChild);
  const q = (state.elemFilter || '').toLowerCase().trim();
  const matches = state.elements.filter(e =>
    !q || (`#${e.id} ${e.label} ${e.name || ''} ${kindOf(e)} ${groupOf(e)}`).toLowerCase().includes(q));

  // Bucket into groups, preserving element order within each.
  const groups = new Map();
  for (const e of matches) {
    const g = groupOf(e);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }
  for (const g of GROUP_ORDER) {
    const items = groups.get(g);
    if (!items || !items.length) continue;
    const collapsed = state.collapsedGroups.has(g);
    const head = document.createElement('li');
    head.className = 'elem-group' + (collapsed ? ' collapsed' : '');
    const caret = document.createElement('span'); caret.className = 'eg-caret'; caret.textContent = collapsed ? '▸' : '▾';
    const name = document.createElement('span'); name.className = 'eg-name'; name.textContent = g;
    const cnt = document.createElement('span'); cnt.className = 'eg-count'; cnt.textContent = items.length;
    head.appendChild(caret); head.appendChild(name); head.appendChild(cnt);
    head.onclick = () => {
      if (collapsed) state.collapsedGroups.delete(g); else state.collapsedGroups.add(g);
      rebuildElemList();
    };
    ul.appendChild(head);
    if (collapsed) continue;
    for (const e of items) ul.appendChild(buildElemRow(e));
  }

  $('#elem-count').textContent = q ? `${matches.length}/${state.elements.length}` : state.elements.length;
  renderElemSummary();
  // Keep the selected row in view as selection moves (e.g. keyboard cycling).
  const sel = ul.querySelector('li.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

// Compact counts breakdown under the Elements header, e.g. "3 rooms · 5 locations".
function renderElemSummary() {
  const root = $('#elem-summary');
  if (!root) return;
  const counts = new Map();
  for (const e of state.elements) { const g = groupOf(e); counts.set(g, (counts.get(g) || 0) + 1); }
  const parts = GROUP_ORDER.filter(g => counts.get(g)).map(g => `${counts.get(g)} ${g.toLowerCase()}`);
  root.textContent = parts.join(' · ');
  root.style.display = parts.length ? '' : 'none';
}

// ───── Visibility (label + kind filters) ────────────────────────────

export function rebuildVisibility() {
  const labels = [...new Set(state.elements.map(e => e.label))].sort();
  const kinds = [...new Set(state.elements.map(kindOf))].sort();
  fillFilter('#filter-labels', labels, state.hiddenLabels);
  fillFilter('#filter-kinds', kinds, state.hiddenKinds);
}

function fillFilter(sel, items, hiddenSet) {
  const root = $(sel);
  while (root.firstChild) root.removeChild(root.firstChild);
  if (!items.length) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = '(empty)';
    root.appendChild(span);
    return;
  }
  for (const it of items) {
    const id = `${sel.slice(1)}-${it}`;
    const row = document.createElement('label');
    row.className = 'filter-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !hiddenSet.has(it);
    cb.onchange = () => {
      if (cb.checked) hiddenSet.delete(it); else hiddenSet.add(it);
      rebuildElemList();
      draw();
    };
    row.appendChild(cb);
    const name = document.createElement('span');
    name.textContent = ' ' + it;
    row.appendChild(name);
    root.appendChild(row);
  }
}

// ───── Structured draw model: type → label ──────────────────────────

export function currentType() { return state.activeType; }
export function currentLabel() {
  const set = state.labelSets[state.activeType] || [];
  return state.activeLabel[state.activeType] || set[0] || 'unknown';
}
export function colorForType(t) { return TYPE_COLORS[t] || '#22d3ee'; }

export function setActiveType(t) {
  if (!state.labelSets[t]) return;
  state.activeType = t;
  rebuildLabelSelect();
  draw();
}
export function setActiveLabel(l) {
  state.activeLabel[state.activeType] = l;
  rebuildLabelSelect();
}
export function addLabelToType(type, name) {
  const t = (name || '').trim();
  const set = state.labelSets[type];
  if (!t || !set || set.includes(t)) return false;
  set.push(t);
  state.activeType = type;
  state.activeLabel[type] = t;
  rebuildLabelSelect();
  return true;
}
export function removeLabelFromType(type, name) {
  const set = state.labelSets[type];
  const i = set ? set.indexOf(name) : -1;
  if (i < 0) return;
  set.splice(i, 1);
  if (state.activeLabel[type] === name) state.activeLabel[type] = set[0] || '';
  rebuildLabelSelect();
}

// Toolbar: paint the Area/Object toggle + fill the label <select> for the active
// type. Also refreshes the sidebar Draw settings panel (single source of truth).
export function rebuildLabelSelect() {
  for (const t of LABEL_TYPES) {
    const btn = $('#type-' + t);
    if (btn) { btn.classList.toggle('active', state.activeType === t); btn.style.setProperty('--type-col', TYPE_COLORS[t]); }
  }
  const sel = $('#label-select');
  if (sel) {
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    for (const l of state.labelSets[state.activeType] || []) {
      const o = document.createElement('option'); o.value = l; o.textContent = l;
      sel.appendChild(o);
    }
    sel.value = currentLabel();
  }
  saveLabels();
  rebuildDrawSettings();
}

// Sidebar Draw panel: per-type label chips (click to select, × to remove) + an
// add-label input. The active type/label are highlighted.
export function rebuildDrawSettings() {
  const root = $('#draw-settings');
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  for (const type of LABEL_TYPES) {
    const sec = document.createElement('div');
    sec.className = 'draw-type' + (state.activeType === type ? ' active' : '');
    sec.style.setProperty('--type-col', TYPE_COLORS[type]);

    const head = document.createElement('button');
    head.type = 'button'; head.className = 'draw-type-head';
    head.title = `Draw ${type} — exports to [${type === 'area' ? 'rooms' : 'locations'}]`;
    const dot = document.createElement('span'); dot.className = 'type-dot'; head.appendChild(dot);
    const nm = document.createElement('span'); nm.className = 'draw-type-name'; nm.textContent = type; head.appendChild(nm);
    const role = document.createElement('em'); role.className = 'muted'; role.textContent = type === 'area' ? '→ rooms' : '→ locations'; head.appendChild(role);
    head.onclick = () => setActiveType(type);
    sec.appendChild(head);

    const chips = document.createElement('div'); chips.className = 'chip-list';
    for (const label of state.labelSets[type]) {
      const chip = document.createElement('span');
      const isSel = state.activeType === type && currentLabel() === label;
      const lblCol = colorForLabel(type, label);
      chip.className = 'chip' + (isSel ? ' sel' : '');
      // Per-label colour accent (border when selected, dot always).
      chip.style.setProperty('--label-col', lblCol);
      const dot = document.createElement('span'); dot.className = 'chip-dot'; dot.style.background = lblCol;
      chip.appendChild(dot);
      const t = document.createElement('span'); t.className = 'chip-t'; t.textContent = label;
      t.onclick = () => { state.activeType = type; setActiveLabel(label); };
      chip.appendChild(t);
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'chip-x'; x.textContent = '×'; x.title = 'remove label';
      x.onclick = (ev) => { ev.stopPropagation(); removeLabelFromType(type, label); };
      chip.appendChild(x);
      chips.appendChild(chip);
    }
    sec.appendChild(chips);

    const addRow = document.createElement('div'); addRow.className = 'chip-add';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.placeholder = `add ${type} label…`;
    inp.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); if (addLabelToType(type, inp.value)) inp.value = ''; } };
    addRow.appendChild(inp);
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'mini'; add.textContent = '+'; add.title = `add a ${type} label`;
    add.onclick = () => { if (addLabelToType(type, inp.value)) inp.value = ''; };
    addRow.appendChild(add);
    sec.appendChild(addRow);

    root.appendChild(sec);
  }

  // Forced-waypoint behaviour: areas always create a room waypoint at the shape's
  // centre; objects do so only when this is ticked (else they stay a plain footprint).
  const wpRow = document.createElement('label');
  wpRow.className = 'draw-wp-row';
  wpRow.title = 'Areas always get a room waypoint at the shape centre. Tick to also place a location waypoint when drawing objects.';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = !!state.objectWaypoint;
  cb.onchange = () => { state.objectWaypoint = cb.checked; };
  wpRow.appendChild(cb);
  const txt = document.createElement('span');
  txt.textContent = ' Place a waypoint for objects (areas always do)';
  wpRow.appendChild(txt);
  root.appendChild(wpRow);
}

export function saveLabels() {
  try {
    localStorage.setItem('walkie-label-sets', JSON.stringify({
      sets: state.labelSets, active: state.activeType, labels: state.activeLabel,
    }));
  } catch {}
}
export function loadLabels() {
  try {
    const s = JSON.parse(localStorage.getItem('walkie-label-sets') || 'null');
    if (!s || !s.sets) return;
    for (const t of LABEL_TYPES) if (Array.isArray(s.sets[t])) state.labelSets[t] = s.sets[t].slice();
    if (LABEL_TYPES.includes(s.active)) state.activeType = s.active;
    if (s.labels) for (const t of LABEL_TYPES) if (typeof s.labels[t] === 'string') state.activeLabel[t] = s.labels[t];
  } catch {}
}

// ───── Waypoint inspector ───────────────────────────────────────────

function roomWaypointNames() {
  return [...new Set(state.elements
    .filter(e => e.type === 'waypoint' && e.role === 'room' && canon(e.name))
    .map(e => canon(e.name)))].sort();
}

// Populate a <datalist> (combo-box suggestions) — dedup, preserve order.
function fillDatalist(id, values) {
  const dl = $('#' + id);
  if (!dl) return;
  while (dl.firstChild) dl.removeChild(dl.firstChild);
  for (const v of [...new Set(values)]) {
    const o = document.createElement('option'); o.value = v; dl.appendChild(o);
  }
}

export function rebuildInspector() {
  const root = $('#inspector');
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  const el = state.selected && state.elements.find(e => e.id === state.selected);
  if (!el) {
    const m = document.createElement('div');
    m.className = 'muted';
    m.textContent = 'Select an element to edit its properties.';
    root.appendChild(m);
    return;
  }

  const field = (labelText, control) => {
    const row = document.createElement('label');
    row.className = 'insp-row';
    const span = document.createElement('span');
    span.className = 'insp-lbl'; span.textContent = labelText;
    row.appendChild(span); row.appendChild(control);
    root.appendChild(row);
  };
  const commit = (patch) => {
    updateElementFields(el.id, patch);
    // `name`/`role` mutate the list + which fields render → full rebuild. `label`
    // touches the list + filters. Everything else just redraws (keeps field focus).
    if ('name' in patch || 'role' in patch) { rebuildElemList(); rebuildVisibility(); rebuildInspector(); }
    else if ('label' in patch) { rebuildElemList(); rebuildVisibility(); }
    draw();
  };

  // Non-waypoint shapes: edit the label; show kind + extent. (Waypoints below get
  // the full place editor.)
  if (el.type !== 'waypoint') {
    const labelIn = document.createElement('input');
    labelIn.type = 'text'; labelIn.value = el.label || ''; labelIn.placeholder = 'label';
    labelIn.onchange = () => { const v = labelIn.value.trim(); if (v) commit({ label: v }); };
    field('label', labelIn);
    const info = document.createElement('div');
    info.className = 'muted';
    const c0 = el.coords[0] || [0, 0];
    info.textContent = `${kindOf(el)}${el.asNogo ? ' +nogo' : ''} · ${el.coords.length} pt${el.coords.length === 1 ? '' : 's'} · first (${(+c0[0]).toFixed(2)}, ${(+c0[1]).toFixed(2)}) m`;
    root.appendChild(info);
    return;
  }

  const roleSel = document.createElement('select');
  for (const [v, t] of [['', '(not exported)'], ['room', 'room'], ['location', 'location'], ['door', 'door']]) {
    const o = document.createElement('option'); o.value = v; o.textContent = t; roleSel.appendChild(o);
  }
  roleSel.value = el.role || '';
  roleSel.onchange = () => commit({ role: roleSel.value });
  field('role', roleSel);

  const nameIn = document.createElement('input');
  nameIn.type = 'text'; nameIn.value = el.name || ''; nameIn.placeholder = 'kitchen_table';
  nameIn.setAttribute('list', 'wp-name-options');  // combo: suggest contract names, still free text
  fillDatalist('wp-name-options',
    el.role === 'room' ? SUGGEST_ROOM_NAMES
      : el.role === 'location' ? SUGGEST_LOCATION_NAMES
      : el.role === 'door' ? SUGGEST_DOOR_NAMES
      : [...SUGGEST_ROOM_NAMES, ...SUGGEST_LOCATION_NAMES]);
  nameIn.onchange = () => { const nm = canon(nameIn.value); commit({ name: nm, label: nm || 'waypoint' }); };
  field('name', nameIn);

  // Position X/Y (m) — the pose's map-frame coordinates (editable; also movable on
  // the canvas by dragging the handle).
  const c = el.coords[0] || [0, 0];
  const posRow = document.createElement('div'); posRow.className = 'insp-row';
  const posLbl = document.createElement('span'); posLbl.className = 'insp-lbl'; posLbl.textContent = 'position';
  posRow.appendChild(posLbl);
  const xIn = document.createElement('input'); xIn.type = 'number'; xIn.step = '0.05'; xIn.value = (+c[0]).toFixed(3); xIn.title = 'x (m)';
  const yIn = document.createElement('input'); yIn.type = 'number'; yIn.step = '0.05'; yIn.value = (+c[1]).toFixed(3); yIn.title = 'y (m)';
  function commitXY() {
    let x = parseFloat(xIn.value), y = parseFloat(yIn.value);
    if (!Number.isFinite(x)) x = c[0];
    if (!Number.isFinite(y)) y = c[1];
    commit({ coords: [[x, y]] });
  }
  xIn.onchange = commitXY; yIn.onchange = commitXY;
  posRow.appendChild(xIn); posRow.appendChild(yIn);
  const mu = document.createElement('span'); mu.className = 'muted'; mu.textContent = 'm';
  posRow.appendChild(mu);
  root.appendChild(posRow);

  if (el.role === 'location') {
    const roomSel = document.createElement('select');
    const blank = document.createElement('option'); blank.value = ''; blank.textContent = '(none)';
    roomSel.appendChild(blank);
    for (const r of roomWaypointNames()) {
      const o = document.createElement('option'); o.value = r; o.textContent = r; roomSel.appendChild(o);
    }
    roomSel.value = canon(el.room) || '';
    roomSel.onchange = () => commit({ room: roomSel.value });
    field('room', roomSel);

    const catIn = document.createElement('input');
    catIn.type = 'text'; catIn.value = el.category || ''; catIn.placeholder = 'table';
    catIn.setAttribute('list', 'wp-cat-options');
    fillDatalist('wp-cat-options', [...new Set([...SUGGEST_CATEGORIES, ...state.labels])]);
    catIn.onchange = () => commit({ category: canon(catIn.value) });
    field('category', catIn);

    const placeCb = document.createElement('input');
    placeCb.type = 'checkbox'; placeCb.checked = !!el.placement;
    placeCb.onchange = () => commit({ placement: placeCb.checked });
    field('placement', placeCb);

    // Optional Z height (m) of the object's surface — exported as `z` when set.
    const zIn = document.createElement('input');
    zIn.type = 'number'; zIn.step = '0.01'; zIn.min = '0';
    zIn.value = el.z == null ? '' : el.z;
    zIn.placeholder = 'optional';
    zIn.onchange = () => { const v = zIn.value.trim(); commit({ z: v === '' ? null : (Number.isFinite(+v) ? +v : null) }); };
    field('Z height m', zIn);
  }

  const headIn = document.createElement('input');
  headIn.type = 'number'; headIn.step = '1';
  headIn.value = Math.round((el.heading || 0) * 180 / Math.PI);
  headIn.onchange = () => {
    let deg = parseFloat(headIn.value); if (!Number.isFinite(deg)) deg = 0;
    commit({ heading: deg * Math.PI / 180 });
  };
  field(el.role === 'door' ? 'passage °' : 'heading °', headIn);

  if (el.role === 'door') {
    // Proximity-trigger radius (m): blank -> the robot's global default. The dashed
    // ring on the canvas previews this; the robot asks for this door inside it.
    const radIn = document.createElement('input');
    radIn.type = 'number'; radIn.step = '0.1'; radIn.min = '0';
    radIn.value = el.radius == null ? '' : el.radius;
    radIn.placeholder = `default ${DOOR_DEFAULT_RADIUS_M}`;
    radIn.onchange = () => {
      const v = radIn.value.trim();
      commit({ radius: v === '' ? null : (Number.isFinite(+v) && +v > 0 ? +v : null) });
    };
    field('radius m', radIn);
  } else {
    const aliasIn = document.createElement('input');
    aliasIn.type = 'text'; aliasIn.value = (el.aliases || []).join(', '); aliasIn.placeholder = 'comma, separated';
    aliasIn.onchange = () => commit({ aliases: aliasIn.value.split(',').map(s => s.trim()).filter(Boolean) });
    field('aliases', aliasIn);

    const barCb = document.createElement('input');
    barCb.type = 'checkbox'; barCb.checked = !!el.barrier;
    barCb.onchange = () => commit({ barrier: barCb.checked });
    field('barrier', barCb);
  }

  const presCb = document.createElement('input');
  presCb.type = 'checkbox'; presCb.checked = el.present !== false;
  presCb.onchange = () => commit({ present: presCb.checked });
  field('present', presCb);

  const hint = document.createElement('div');
  hint.className = 'muted';
  hint.textContent = 'right-click to aim heading · drag the handle to move · or edit fields above';
  root.appendChild(hint);
}

// ───── Arena vocabulary panel (structured row editor) ───────────────

// One editor row: text inputs + a × remove button. fields = [{value, placeholder,
// cls, list?, onChange}].
function _vocabRow(fields, onRemove) {
  const row = document.createElement('div');
  row.className = 'vrow';
  for (const f of fields) {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = f.value || ''; inp.placeholder = f.placeholder || '';
    if (f.cls) inp.className = f.cls;
    if (f.list) inp.setAttribute('list', f.list);
    inp.onchange = () => f.onChange(inp.value);
    row.appendChild(inp);
  }
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'vx mini'; x.textContent = '×'; x.title = 'remove';
  x.onclick = onRemove;
  row.appendChild(x);
  return row;
}
function _addBtn(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'vadd mini'; b.textContent = text; b.onclick = onClick;
  return b;
}

// keyed editor: { key: [values] } as rows of [key | comma-list | ×]. Field edits
// mutate a working array + recommit on each field edit (no re-render, so focus
// stays); rows are added/removed in place (a freshly added empty row must persist
// for typing — re-deriving from state would drop it before it has a key).
function _renderKeyed(id, get, set, keyPh, valPh, addText, keyList) {
  const root = $('#' + id);
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  const rows = Object.entries(get()).map(([k, v]) => [k, (v || []).join(', ')]);
  const commit = () => {
    const out = {};
    for (const [k, t] of rows) { const kk = k.trim(); if (kk) out[kk] = splitList(t); }
    set(out); markDirty();
  };
  const addBtn = _addBtn(addText, null);
  const addRow = (pair) => {
    const rowEl = _vocabRow([
      { value: pair[0], placeholder: keyPh, cls: 'vk', list: keyList, onChange: v => { pair[0] = v; commit(); } },
      { value: pair[1], placeholder: valPh, cls: 'vv', onChange: v => { pair[1] = v; commit(); } },
    ], () => { rows.splice(rows.indexOf(pair), 1); root.removeChild(rowEl); commit(); });
    root.insertBefore(rowEl, addBtn);
    return rowEl;
  };
  for (const pair of rows) addRow(pair);
  root.appendChild(addBtn);
  addBtn.onclick = () => { const pair = ['', '']; rows.push(pair); const r = addRow(pair); focusFirst(r); };
}

// flat list editor: [string] as rows of [value | ×]. Items are wrapped in {v} so
// splice-by-identity is stable across edits.
function _renderList(id, get, set, valPh, addText) {
  const root = $('#' + id);
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  const rows = (get() || []).map(s => ({ v: s }));
  const commit = () => { set(rows.map(r => r.v.trim()).filter(Boolean)); markDirty(); };
  const addBtn = _addBtn(addText, null);
  const addRow = (item) => {
    const rowEl = _vocabRow(
      [{ value: item.v, placeholder: valPh, cls: 'vv', onChange: v => { item.v = v; commit(); } }],
      () => { rows.splice(rows.indexOf(item), 1); root.removeChild(rowEl); commit(); });
    root.insertBefore(rowEl, addBtn);
    return rowEl;
  };
  for (const item of rows) addRow(item);
  root.appendChild(addBtn);
  addBtn.onclick = () => { const item = { v: '' }; rows.push(item); const r = addRow(item); focusFirst(r); };
}

function focusFirst(rowEl) {
  const inp = rowEl && rowEl.children && rowEl.children[0];
  if (inp && inp.focus) inp.focus();
}

export function rebuildVocabUI() {
  fillDatalist('wp-objcat-options', SUGGEST_OBJECT_CATEGORIES);
  fillDatalist('wp-gesture-options', SUGGEST_GESTURES);
  _renderKeyed('vocab-categories', () => state.vocab.object_categories,
    o => state.vocab.object_categories = o, 'category', 'objects (comma)', '+ category', 'wp-objcat-options');
  _renderList('vocab-names', () => state.vocab.names, a => state.vocab.names = a, 'name', '+ name');
  _renderKeyed('vocab-gestures', () => state.vocab.gestures,
    o => state.vocab.gestures = o, 'gesture', 'aliases (comma)', '+ gesture', 'wp-gesture-options');
}

// ───── Map info / status / fit ──────────────────────────────────────

export function updateInfo() {
  const m = state.meta;
  const info = $('#map-info');
  while (info.firstChild) info.removeChild(info.firstChild);
  const rows = [
    ['dims', `${state.w} × ${state.h} px`],
    ['resolution', `${m.resolution} m/px`],
    ['size', `${(state.w * m.resolution).toFixed(2)} × ${(state.h * m.resolution).toFixed(2)} m`],
    ['origin', `[${m.origin.join(', ')}]`],
    ['occ/free', `${m.occupied_thresh} / ${m.free_thresh}`],
  ];
  for (const [k, v] of rows) {
    const d = document.createElement('div');
    d.textContent = `${k}: `;
    const b = document.createElement('b');
    b.textContent = v;
    d.appendChild(b);
    info.appendChild(d);
  }
  // Show 3D ref panel and dim the toggle when no ref is loaded
  const refPanel = $('#ref-panel');
  if (refPanel) {
    refPanel.style.display = state.refMeta ? '' : 'none';
    if (state.refMeta) {
      const rm = state.refMeta;
      const [z0, z1] = rm.z_range || [0, 0];
      $('#ref-info-text').textContent =
        `${rm.width}×${rm.height}px · ${rm.resolution}m/px · z:[${z0.toFixed(2)}, ${z1.toFixed(2)}]m`;
      const slider = $('#ref-opacity');
      if (slider) slider.value = state.refOpacity;
      const valSpan = $('#ref-opacity-val');
      if (valSpan) valSpan.textContent = `${Math.round(state.refOpacity * 100)}%`;
      const scaleEl = $('#ref-scale');
      if (scaleEl) scaleEl.value = state.refUserScale;
      const scaleVal = $('#ref-scale-val');
      if (scaleVal) scaleVal.textContent = `${state.refUserScale.toFixed(2)}×`;
      const ox = $('#ref-offset-x'), oy = $('#ref-offset-y');
      if (ox) ox.value = Math.round(state.refOffsetX);
      if (oy) oy.value = Math.round(state.refOffsetY);
      const zminEl = $('#ref-zmin'), zmaxEl = $('#ref-zmax');
      if (zminEl) zminEl.value = isFinite(state.refZMin) ? state.refZMin.toFixed(2) : '';
      if (zmaxEl) zmaxEl.value = isFinite(state.refZMax) ? state.refZMax.toFixed(2) : '';
    }
    const wrap = $('#toggle-ref-wrap');
    if (wrap) wrap.style.opacity = state.refImage ? '' : '0.4';
  }
}

export function status(t) { $('#status').textContent = t; }

// Collapse/expand the sidebar (toggles a body class the CSS keys off). Reading
// canvas.clientWidth in draw() forces the reflow, so the canvas resizes cleanly.
export function toggleSidebar(force) {
  state.sidebarCollapsed = (force === undefined) ? !state.sidebarCollapsed : !!force;
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  const btn = $('#sidebar-toggle'); if (btn) btn.classList.toggle('active', state.sidebarCollapsed);
  try { localStorage.setItem('walkie-sidebar', state.sidebarCollapsed ? '1' : '0'); } catch {}
  draw();
}

export function restoreSidebar() {
  let v = false;
  try { v = localStorage.getItem('walkie-sidebar') === '1'; } catch {}
  state.sidebarCollapsed = v;
  document.body.classList.toggle('sidebar-collapsed', v);
  const btn = $('#sidebar-toggle'); if (btn) btn.classList.toggle('active', v);
}

export function fitView() {
  if (!state.meta) return;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const s = Math.min(W / state.w, H / state.h) * 0.95;
  state.view.s = s;
  state.view.x = (W - state.w * s) / 2;
  state.view.y = (H - state.h * s) / 2;
  draw();
}
