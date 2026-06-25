// Walkie map editor - static SPA. vanilla canvas 2D.
// PGM coord convention: image row 0 = top; world Y axis = up.
// worldToPx(wx, wy): px = (wx - ox)/res, py = H - (wy - oy)/res
'use strict';

const DEFAULT_LABELS = ['table', 'shelf', 'chair', 'sofa', 'tv', 'food', 'drink'];
const FREE = 254, OCC = 0;
const KIND_LABELS = { point: 'point', rect: 'rect', polygon: 'polygon', nogo: 'no-go', waypoint: 'waypoint' };
// Default heading-arrow length on screen (px); world direction, y-flipped to canvas.
const WAYPOINT_ARROW_PX = 26;

// Inspector combo-box suggestions. The name/category inputs stay FREE TEXT (GPSR
// names arbitrary arena places), but these surface the load-bearing challenge-
// contract names (docs/MAP_LOCATIONS.md) so they're picked, not mistyped.
const SUGGEST_ROOM_NAMES = ['kitchen', 'living_room', 'bedroom', 'office', 'dining_room', 'hallway', 'bathroom'];
const SUGGEST_LOCATION_NAMES = ['dining_table', 'kitchen_bar', 'dishwasher', 'cabinet', 'trash_bin',
  'breakfast_surface', 'extra_surface', 'laundry_area', 'laundry_basket', 'folding_table',
  'washing_machine', 'entrance_door'];
const SUGGEST_CATEGORIES = ['table', 'shelf', 'cabinet', 'counter', 'bin', 'sofa', 'chair', 'bed', 'sink', 'door', 'appliance', 'rack'];

const state = {
  meta: null,
  w: 0, h: 0,
  pixels: null,
  original: null,
  prefix: 'map',
  elements: [],
  labels: DEFAULT_LABELS.slice(),
  // Non-spatial arena vocabulary for walkie-agent-v2's GPSR world.toml.
  vocab: { object_categories: {}, names: [], gestures: {} },
  selected: null,
  tool: 'pen',
  brush: 3,
  view: { x: 0, y: 0, s: 1 },
  undo: [],
  redo: [],
  drawing: null,
  currentStroke: null,
  prevPaintPt: null,
  dirty: false,
  hiddenLabels: new Set(),
  hiddenKinds: new Set(),
  showIds: true,
};

function markDirty() { state.dirty = true; }

const $ = (s) => document.querySelector(s);
const canvas = $('#cv');
const ctx = canvas.getContext('2d');
const off = document.createElement('canvas');
const offCtx = off.getContext('2d');

// ───── File I/O ─────────────────────────────────────────────────────

function parsePGM(buf) {
  const u8 = new Uint8Array(buf);
  let i = 0;
  const tok = () => {
    while (i < u8.length) {
      const c = u8[i];
      if (c === 0x23) { while (i < u8.length && u8[i] !== 0x0a) i++; }
      else if (c <= 0x20) i++;
      else break;
    }
    const s = i;
    while (i < u8.length && u8[i] > 0x20) i++;
    return new TextDecoder().decode(u8.slice(s, i));
  };
  const magic = tok();
  if (magic !== 'P5') throw new Error('not P5 PGM: ' + magic);
  const w = parseInt(tok()), h = parseInt(tok()), max = parseInt(tok());
  i++;
  const pixels = new Uint8Array(u8.buffer, u8.byteOffset + i, w * h).slice();
  return { w, h, max, pixels };
}

function writePGM(w, h, pixels) {
  const header = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`);
  const out = new Uint8Array(header.length + pixels.length);
  out.set(header); out.set(pixels, header.length);
  return out;
}

function parseYAML(text) {
  const r = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([a-z_]+)\s*:\s*(.+?)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('[')) {
      v = v.slice(1, v.lastIndexOf(']')).split(',').map(s => parseFloat(s));
    } else if (!isNaN(parseFloat(v)) && v.match(/^-?\d/)) v = parseFloat(v);
    r[m[1]] = v;
  }
  return r;
}

function writeYAML(m) {
  return `image: ${m.image}\nmode: ${m.mode}\nresolution: ${m.resolution}\norigin: [${m.origin.join(', ')}]\nnegate: ${m.negate}\noccupied_thresh: ${m.occupied_thresh}\nfree_thresh: ${m.free_thresh}\n`;
}

async function loadFolder(files) {
  let pgm = null, og = null, yaml = null, elemJson = null;
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (n.endsWith('_og.pgm')) og = f;
    else if (n.endsWith('.pgm') && !n.endsWith('_keepout.pgm')) pgm = pgm || f;
    else if (n.endsWith('.yaml') || n.endsWith('.yml')) yaml = f;
    else if (n.endsWith('_element.json') || n.endsWith('_elements.json')) elemJson = f;
  }
  if (!pgm) { status('error: no .pgm in folder'); return; }
  if (!yaml) { status('error: no .yaml in folder'); return; }

  const parsed = parsePGM(await pgm.arrayBuffer());
  const meta = parseYAML(await yaml.text());

  state.meta = meta;
  state.w = parsed.w; state.h = parsed.h;
  state.pixels = parsed.pixels;
  let ogNote = '';
  if (og) {
    const ogP = parsePGM(await og.arrayBuffer());
    if (ogP.w === parsed.w && ogP.h === parsed.h) state.original = ogP.pixels;
    else { state.original = parsed.pixels.slice(); ogNote = ' (og dims mismatch)'; }
  } else {
    state.original = parsed.pixels.slice();
    ogNote = ' (no _og.pgm; Restore = as-loaded)';
  }
  state.prefix = pgm.name.replace(/_og\.pgm$|\.pgm$/i, '') || 'map';
  $('#prefix-input').value = state.prefix;

  state.elements = [];
  state.hiddenLabels.clear();
  state.hiddenKinds.clear();
  state.vocab = { object_categories: {}, names: [], gestures: {} };
  state.selected = null;
  let loadedCount = 0;
  if (elemJson) {
    try {
      const j = JSON.parse(await elemJson.text());
      state.elements = (j.elements || []).map(normalizeElement);
      loadedCount = state.elements.length;
      if (Array.isArray(j.labels)) {
        for (const l of j.labels) if (typeof l === 'string' && !state.labels.includes(l)) state.labels.push(l);
      }
      if (j.vocab) state.vocab = normalizeVocab(j.vocab);  // preserve hand-entered GPSR vocab on round-trip
    } catch (e) { console.warn('bad element json', e); }
  }
  // advance nextId past any loaded ids
  let maxId = 0;
  for (const e of state.elements) {
    const m = String(e.id || '').match(/^e(\d+)/);
    if (m) maxId = Math.max(maxId, +m[1]);
  }
  nextId = maxId + 1;

  rebuildLabelSelect();
  rebuildElemList();
  rebuildVisibility();
  rebuildInspector();
  rebuildVocabUI();
  renderPixels();
  fitView();
  updateInfo();
  $('#export-btn').disabled = false;
  state.dirty = false;
  status(`loaded ${pgm.name} ${parsed.w}×${parsed.h}${ogNote}; elements: ${loadedCount}`);
}

function normalizeElement(e) {
  const base = {
    id: e.id || `e${nextId++}`,
    label: e.label || 'unknown',
    type: e.type || 'polygon',
    closed: !!e.closed,
    asNogo: !!e.asNogo,
    coords: Array.isArray(e.coords) ? e.coords.map(c => [+c[0], +c[1]]) : [],
  };
  if (base.type === 'waypoint') Object.assign(base, defaultWaypointFields(e));
  return base;
}

// Semantic fields a waypoint carries on top of its position, for world.toml.
// role '' = not exported; 'room'/'location' map to [rooms.*]/[locations.*].
function defaultWaypointFields(e = {}) {
  return {
    heading: Number.isFinite(+e.heading) ? +e.heading : 0,   // radians, map frame
    role: e.role === 'room' || e.role === 'location' ? e.role : '',
    name: typeof e.name === 'string' ? e.name : '',
    room: typeof e.room === 'string' ? e.room : '',           // location -> its room (canonical)
    category: typeof e.category === 'string' ? e.category : '',
    aliases: Array.isArray(e.aliases) ? e.aliases.map(String) : [],
    placement: !!e.placement,
    barrier: !!e.barrier,
    present: e.present === undefined ? true : !!e.present,
  };
}

// Canonical key matching walkie's tasks.skills.locations._norm:
// lowercase, runs of space/hyphen -> single underscore, drop non-word chars.
// The strip uses Unicode \w (\p{L}\p{N}_) like Python's re, so non-ASCII names
// ("Café") survive identically on both sides instead of diverging to "caf".
function canon(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[\s\-]+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '');
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function buildExportFiles(prefix) {
  const meta = { ...state.meta, image: `${prefix}.pgm` };
  const enc = new TextEncoder();
  return [
    [`${prefix}_og.pgm`, writePGM(state.w, state.h, state.original)],
    [`${prefix}.pgm`, writePGM(state.w, state.h, state.pixels)],
    [`${prefix}.yaml`, enc.encode(writeYAML(meta))],
    [`${prefix}_element.json`,
      enc.encode(JSON.stringify({ labels: state.labels, elements: state.elements, vocab: state.vocab }, null, 2))],
    [`${prefix}_keepout.pgm`, writePGM(state.w, state.h, buildKeepout())],
    [`${prefix}_world.toml`, enc.encode(buildWorldToml())],
  ];
}

async function exportAll() {
  if (!state.meta) return;
  const { errors, warnings } = validateWorld();
  if (errors.length) {  // fatal: the file wouldn't parse at all — block, don't offer "anyway"
    alert(`Can't export — world.toml would be invalid and the robot would load NO map:\n\n`
      + errors.map(s => '• ' + s).join('\n') + `\n\nRename the colliding entries and export again.`);
    status(`export blocked — ${errors.length} fatal world.toml issue(s)`);
    return;
  }
  if (warnings.length && !confirm(
    `world.toml has ${warnings.length} warning(s) — affected places may be dropped on the robot:\n\n`
    + warnings.map(s => '• ' + s).join('\n') + '\n\nExport anyway?')) {
    status(`export cancelled — ${warnings.length} world.toml warning(s)`);
    return;
  }
  const prefix = ($('#prefix-input').value || 'map').replace(/[^\w\-]/g, '_');
  const folderName = `${prefix}_${dateStamp()}`;
  const files = buildExportFiles(prefix);

  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const subDir = await dirHandle.getDirectoryHandle(folderName, { create: true });
      for (const [name, bytes] of files) {
        const fh = await subDir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
      }
      state.dirty = false;
      status(`exported → ${folderName}/`);
      return;
    } catch (e) {
      if (e.name === 'AbortError') { status('export cancelled'); return; }
      console.warn('folder picker failed, falling back to downloads', e);
    }
  }
  // Fallback: individual downloads, name-prefixed so user can group manually
  for (const [name, bytes] of files) {
    const type = name.endsWith('.json') ? 'application/json'
      : name.endsWith('.yaml') ? 'text/yaml'
      : name.endsWith('.toml') ? 'text/plain' : 'application/octet-stream';
    download(`${folderName}__${name}`, bytes, type);
  }
  state.dirty = false;
  status(`exported ${files.length} files (prefixed ${folderName}__)`);
}

function buildKeepout() {
  const px = new Uint8Array(state.w * state.h).fill(FREE);
  for (const e of state.elements) {
    const usesAsNogo = e.type === 'nogo' || (e.asNogo && e.closed);
    if (!usesAsNogo) continue;
    if (e.coords.length < 3) continue;
    const poly = e.coords.map(([wx, wy]) => {
      const p = worldToPx(wx, wy);
      return [p.px, p.py];
    });
    rasterPoly(px, state.w, state.h, poly, OCC);
  }
  return px;
}

function download(name, bytes, type) {
  const blob = new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ───── world.toml export (walkie-agent-v2 contract) ─────────────────
// Serializes named waypoints -> [rooms.*]/[locations.*] and the arena
// vocabulary -> [object_categories]/names/[gestures], matching the schema
// parsed by walkie-agent-v2 (tasks/skills/locations.py + tasks/GPSR/world.py).

function fmtNum(n) {
  const v = +n;
  if (!Number.isFinite(v)) return '0.0';
  // up to 4 decimals, trailing zeros trimmed, kept as a float-looking literal
  return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
}
const _TOML_CTRL = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };
const _TOML_CTRL_RE = /[\u0000-\u001f\u007f]/g;
function tomlStr(s) {
  // TOML basic string: escape \ and ", plus every control char (a raw newline
  // is an "Illegal character" that makes the whole file unparsable).
  return '"' + String(s)
    .replace(/[\\"]/g, c => '\\' + c)
    .replace(_TOML_CTRL_RE, c => _TOML_CTRL[c]
      || '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase())
    + '"';
}
function tomlKey(s) { return /^[A-Za-z0-9_-]+$/.test(s) ? s : tomlStr(s); }
function tomlStrArray(arr) { return '[' + arr.map(tomlStr).join(', ') + ']'; }

function poseOf(e) {
  const c = (e.coords && e.coords[0]) || [0, 0];
  return [c[0], c[1], e.heading || 0];
}

// Pure (DOM-free, so window._test can exercise it): build world.toml text
// from waypoint elements + a vocab object.
function buildWorldTomlFrom(elements, vocab) {
  const lines = [
    '# Generated by walkie-map-editor — arena map for walkie-agent-v2.',
    '# Use as GPSR_WORLD_FILE (covers all challenges) or drop in as tasks/GPSR/world.toml.',
  ];

  // Top-level keys (the `names` array) MUST precede every [table] header — in TOML
  // a bare key after `[object_categories]` would bind under that table instead.
  const names = ((vocab && vocab.names) || []).map(s => String(s).trim()).filter(Boolean);
  if (names.length) lines.push('', `names = ${tomlStrArray(names)}`);

  const rooms = elements.filter(e => e.type === 'waypoint' && e.role === 'room');
  const locs = elements.filter(e => e.type === 'waypoint' && e.role === 'location');

  for (const e of rooms) {
    const name = canon(e.name);
    if (!name) continue;
    lines.push('', `[rooms.${tomlKey(name)}]`);
    lines.push(`pose = [${poseOf(e).map(fmtNum).join(', ')}]`);
    if (e.aliases && e.aliases.length) lines.push(`aliases = ${tomlStrArray(e.aliases)}`);
    if (e.barrier) lines.push('barrier = true');
    if (!e.present) lines.push('present = false');
  }
  for (const e of locs) {
    const name = canon(e.name);
    if (!name) continue;
    lines.push('', `[locations.${tomlKey(name)}]`);
    if (canon(e.room)) lines.push(`room = ${tomlStr(canon(e.room))}`);
    lines.push(`pose = [${poseOf(e).map(fmtNum).join(', ')}]`);
    if (e.placement) lines.push('placement = true');
    if (canon(e.category)) lines.push(`category = ${tomlStr(canon(e.category))}`);
    if (e.aliases && e.aliases.length) lines.push(`aliases = ${tomlStrArray(e.aliases)}`);
    if (e.barrier) lines.push('barrier = true');
    if (!e.present) lines.push('present = false');
  }

  const cats = (vocab && vocab.object_categories) || {};
  const catKeys = Object.keys(cats).filter(k => canon(k));
  if (catKeys.length) {
    lines.push('', '[object_categories]');
    for (const k of catKeys) {
      const objs = (cats[k] || []).map(canon).filter(Boolean);
      lines.push(`${tomlKey(canon(k))} = ${tomlStrArray(objs)}`);
    }
  }

  const gestures = (vocab && vocab.gestures) || {};
  for (const g of Object.keys(gestures).filter(k => canon(k))) {
    lines.push('', `[gestures.${tomlKey(canon(g))}]`);
    lines.push(`aliases = ${tomlStrArray((gestures[g] || []).map(String))}`);
  }
  return lines.join('\n') + '\n';
}

function buildWorldToml() { return buildWorldTomlFrom(state.elements, state.vocab); }

function validateWorld() { return worldIssuesFrom(state.elements, state.vocab); }

// Pre-export checks (pure, so window._test can exercise it). Splits issues into:
//   errors   — make the TOML unparsable (duplicate table/key from canon-collision);
//              export MUST block, since a half-written file loses the WHOLE arena.
//   warnings — droppable/advisory (location -> absent room, no name, shadowing,
//              non-finite pose); export may proceed after a confirm.
function worldIssuesFrom(elements, vocab) {
  const errors = [], warnings = [];
  const rooms = elements.filter(e => e.type === 'waypoint' && e.role === 'room');
  const locs = elements.filter(e => e.type === 'waypoint' && e.role === 'location');

  // canon-collision within a namespace => duplicate [rooms.x]/[locations.x] header.
  const keysOf = (items, what) => {
    const seen = new Map();
    for (const e of items) {
      const nm = canon(e.name);
      if (!nm) { warnings.push(`a ${e.role} (#${e.id}) has no name — it won't be exported`); continue; }
      if (seen.has(nm)) errors.push(`two ${what} normalize to "${nm}" (#${seen.get(nm)} + #${e.id}) — duplicate [${what}.${nm}] makes world.toml unparsable; rename one`);
      else seen.set(nm, e.id);
    }
    return seen;
  };
  const roomKeys = keysOf(rooms, 'rooms');
  const locKeys = keysOf(locs, 'locations');

  // vocab canon-collisions => duplicate key / [gestures.x] header.
  const dupVocab = (table, what) => {
    const seen = new Map();
    for (const raw of Object.keys(table || {})) {
      const k = canon(raw);
      if (!k) continue;
      if (seen.has(k)) errors.push(`${what} "${seen.get(k)}" and "${raw}" normalize to "${k}" — duplicate key makes world.toml unparsable; rename one`);
      else seen.set(k, raw);
    }
  };
  dupVocab(vocab && vocab.object_categories, 'object categories');
  dupVocab(vocab && vocab.gestures, 'gestures');

  // warnings: a location pointing at a room that won't exist on the robot.
  // roomNames excludes present=false rooms (walkie drops them, then cascade-drops
  // any location referencing them).
  const presentRooms = new Set(rooms.filter(e => e.present !== false && canon(e.name)).map(e => canon(e.name)));
  for (const e of locs) {
    const nm = canon(e.name);
    if (nm && canon(e.room) && !presentRooms.has(canon(e.room)))
      warnings.push(`location "${nm}" points at room "${canon(e.room)}", which isn't a present room — the robot will drop it`);
  }
  // a name used by both a room and a location: valid TOML (separate tables), but
  // the robot resolves location-first, so the room becomes unreachable by name.
  for (const nm of locKeys.keys())
    if (roomKeys.has(nm)) warnings.push(`"${nm}" is both a room and a location — the location will shadow the room when the robot resolves that name`);

  // a non-finite pose would be silently written as 0 by fmtNum — surface it.
  for (const e of [...rooms, ...locs]) {
    if (!poseOf(e).every(Number.isFinite))
      warnings.push(`${e.role} "${canon(e.name) || ('#' + e.id)}" has a non-finite pose — it will export as 0`);
  }
  return { errors, warnings };
}

// ───── arena vocabulary (parse/serialize the textarea blocks) ───────

function normalizeVocab(v) {
  const out = { object_categories: {}, names: [], gestures: {} };
  const oc = (v && v.object_categories) || {};
  for (const k of Object.keys(oc)) out.object_categories[k] = (oc[k] || []).map(String);
  out.names = Array.isArray(v && v.names) ? v.names.map(String) : [];
  const g = (v && v.gestures) || {};
  for (const k of Object.keys(g)) out.gestures[k] = (g[k] || []).map(String);
  return out;
}
// "category: a, b, c" per line -> { category: [a, b, c] }
function parseCategories(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (!m || !m[1].trim()) continue;
    out[m[1].trim()] = m[2].split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}
function categoriesToText(cats) {
  return Object.keys(cats).map(k => `${k}: ${(cats[k] || []).join(', ')}`).join('\n');
}
function parseNames(text) { return text.split(/[\n,]/).map(s => s.trim()).filter(Boolean); }
function namesToText(names) { return (names || []).join(', '); }
// "gesture: alias1, alias2" per line; a bare "gesture" line = no aliases
function parseGestures(text) {
  const out = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const idx = line.indexOf(':');
    const key = (idx < 0 ? line : line.slice(0, idx)).trim();
    if (!key) continue;
    out[key] = idx < 0 ? [] : line.slice(idx + 1).split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}
function gesturesToText(g) {
  return Object.keys(g).map(k => (g[k] && g[k].length) ? `${k}: ${g[k].join(', ')}` : k).join('\n');
}

// ───── Coord helpers ────────────────────────────────────────────────

function worldToPx(wx, wy) {
  const [ox, oy] = state.meta.origin;
  const r = state.meta.resolution;
  return { px: (wx - ox) / r, py: state.h - (wy - oy) / r };
}
function pxToWorld(px, py) {
  const [ox, oy] = state.meta.origin;
  const r = state.meta.resolution;
  return { wx: ox + px * r, wy: oy + (state.h - py) * r };
}
function screenToPx(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  return { px: (sx - rect.left - state.view.x) / state.view.s, py: (sy - rect.top - state.view.y) / state.view.s };
}
function screenToWorld(sx, sy) {
  const p = screenToPx(sx, sy);
  return pxToWorld(p.px, p.py);
}

// ───── Render ───────────────────────────────────────────────────────

function renderPixels() {
  off.width = state.w; off.height = state.h;
  const id = offCtx.createImageData(state.w, state.h);
  for (let p = 0, j = 0; p < state.pixels.length; p++, j += 4) {
    const g = state.pixels[p];
    id.data[j] = g; id.data[j+1] = g; id.data[j+2] = g; id.data[j+3] = 255;
  }
  offCtx.putImageData(id, 0, 0);
}

function draw() {
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

function kindOf(e) {
  if (e.type === 'nogo') return 'nogo';
  if (e.type === 'rect') return 'rect';
  if (e.type === 'point') return 'point';
  if (e.type === 'waypoint') return 'waypoint';
  return 'polygon';
}

function isVisible(e) {
  return !state.hiddenLabels.has(e.label) && !state.hiddenKinds.has(kindOf(e));
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

// ───── Pixel tools ──────────────────────────────────────────────────

// brush "size" semantics: size=1 → exactly 1 pixel. size=N → disk of width N.
function brushRadius() { return state.brush / 2; }

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

// ───── Polygon raster (even-odd scanline) ───────────────────────────

function rasterPoly(out, w, h, poly, val) {
  let minY = h, maxY = 0;
  for (const [, y] of poly) {
    if (y < minY) minY = Math.floor(y);
    if (y > maxY) maxY = Math.ceil(y);
  }
  minY = Math.max(0, minY); maxY = Math.min(h - 1, maxY);
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    const yy = y + 0.5;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if ((y1 <= yy && y2 > yy) || (y2 <= yy && y1 > yy)) {
        xs.push(x1 + (yy - y1) / (y2 - y1) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.max(0, Math.ceil(xs[i]));
      const b = Math.min(w - 1, Math.floor(xs[i + 1]));
      for (let x = a; x <= b; x++) out[y * w + x] = val;
    }
  }
}

// ───── Undo / redo ──────────────────────────────────────────────────

function pushUndo(act) { state.undo.push(act); state.redo.length = 0; if (state.undo.length > 100) state.undo.shift(); }
function undo() { const a = state.undo.pop(); if (a) { applyInverse(a); state.redo.push(a); markDirty(); rebuildElemList(); rebuildVisibility(); rebuildInspector(); draw(); } }
function redoFn() { const a = state.redo.pop(); if (a) { applyForward(a); state.undo.push(a); markDirty(); rebuildElemList(); rebuildVisibility(); rebuildInspector(); draw(); } }

function applyInverse(a) {
  if (a.kind === 'pixel') {
    for (const [i, oldV] of a.diffs) state.pixels[i] = oldV;
    renderPixels();
  } else if (a.kind === 'elem-add') {
    state.elements = state.elements.filter(e => e.id !== a.el.id);
  } else if (a.kind === 'elem-del') {
    state.elements.push(a.el);
  } else if (a.kind === 'elem-mod') {
    Object.assign(a.el, a.before);
  }
}
function applyForward(a) {
  if (a.kind === 'pixel') {
    for (const [i] of a.diffs) state.pixels[i] = a.newV.get(i);
    renderPixels();
  } else if (a.kind === 'elem-add') {
    state.elements.push(a.el);
  } else if (a.kind === 'elem-del') {
    state.elements = state.elements.filter(e => e.id !== a.el.id);
  } else if (a.kind === 'elem-mod') {
    Object.assign(a.el, a.after);
  }
}

// ───── Input handling ───────────────────────────────────────────────

let cursorPx = null;
let panning = null;
let painting = false;

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

// ───── Element list / hit-test ──────────────────────────────────────

let nextId = 1;
function addElement(el) {
  el.id = `e${nextId++}`;
  state.elements.push(el);
  pushUndo({ kind: 'elem-add', el });
  markDirty();
  rebuildElemList();
  rebuildVisibility();
  draw();
}
function deleteElement(id) {
  const idx = state.elements.findIndex(e => e.id === id);
  if (idx < 0) return;
  const el = state.elements.splice(idx, 1)[0];
  if (state.selected === id) state.selected = null;
  pushUndo({ kind: 'elem-del', el });
  markDirty();
  rebuildElemList();
  rebuildVisibility();
  rebuildInspector();
  draw();
}
function renameElement(id, label) {
  const el = state.elements.find(e => e.id === id);
  if (!el || el.type === 'waypoint') return;  // waypoints are named via the inspector
  if (!label || el.label === label) return;
  const before = { label: el.label };
  el.label = label;
  if (!state.labels.includes(label)) { state.labels.push(label); rebuildLabelSelect(); }
  pushUndo({ kind: 'elem-mod', el, before, after: { label } });
  markDirty();
  rebuildElemList();
  rebuildVisibility();
  draw();
}
function toggleAsNogo(id) {
  const el = state.elements.find(e => e.id === id);
  if (!el || !el.closed || el.type === 'nogo') return;
  const before = { asNogo: el.asNogo };
  el.asNogo = !el.asNogo;
  pushUndo({ kind: 'elem-mod', el, before, after: { asNogo: el.asNogo } });
  markDirty();
  rebuildElemList();
  draw();
}

function hitTest(wx, wy) {
  const tol = 6 / state.view.s * state.meta.resolution;
  for (let i = state.elements.length - 1; i >= 0; i--) {
    const e = state.elements[i];
    if (!isVisible(e)) continue;
    const pts = e.coords;
    if (e.type === 'point' || e.type === 'waypoint') {
      const [x, y] = pts[0];
      if (Math.hypot(x - wx, y - wy) < tol) return e.id;
    } else if (e.closed && pts.length >= 3) {
      if (pointInPoly(wx, wy, pts)) return e.id;
    } else if (pts.length >= 2) {
      for (let k = 0; k < pts.length - 1; k++) {
        if (distToSeg(wx, wy, pts[k], pts[k + 1]) < tol) return e.id;
      }
    }
  }
  return null;
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distToSeg(x, y, a, b) {
  const [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(x - ax, y - ay);
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function rebuildElemList() {
  const ul = $('#elem-list');
  while (ul.firstChild) ul.removeChild(ul.firstChild);
  for (const e of state.elements) {
    const li = document.createElement('li');
    if (state.selected === e.id) li.className = 'sel';
    if (!isVisible(e)) li.classList.add('hidden');

    const main = document.createElement('span');
    main.className = 'main';
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
    ul.appendChild(li);
  }
  $('#elem-count').textContent = state.elements.length;
}

// ───── Visibility (label + kind filters) ────────────────────────────

function rebuildVisibility() {
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

// ───── Labels ───────────────────────────────────────────────────────

function rebuildLabelSelect() {
  const sel = $('#label-select');
  const cur = sel.value;
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  for (const l of state.labels) {
    const o = document.createElement('option'); o.value = l; o.textContent = l;
    sel.appendChild(o);
  }
  if (state.labels.includes(cur)) sel.value = cur;
  saveLabels();
}
function currentLabel() { return $('#label-select').value || state.labels[0] || 'unknown'; }
function saveLabels() { try { localStorage.setItem('walkie-labels', JSON.stringify(state.labels)); } catch {} }
function loadLabels() {
  try {
    const s = JSON.parse(localStorage.getItem('walkie-labels') || '[]');
    for (const l of s) if (!state.labels.includes(l)) state.labels.push(l);
  } catch {}
}

// ───── Waypoint inspector ───────────────────────────────────────────

// Apply a patch of fields to an element as one undoable elem-mod step.
function updateElementFields(id, patch) {
  const el = state.elements.find(e => e.id === id);
  if (!el) return;
  const before = {}, after = {};
  let changed = false;
  for (const k of Object.keys(patch)) {
    if (JSON.stringify(el[k]) === JSON.stringify(patch[k])) continue;
    before[k] = el[k]; after[k] = patch[k]; el[k] = patch[k]; changed = true;
  }
  if (!changed) return;
  pushUndo({ kind: 'elem-mod', el, before, after });
  markDirty();
}

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

function rebuildInspector() {
  const root = $('#inspector');
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  const el = state.selected && state.elements.find(e => e.id === state.selected);
  if (!el || el.type !== 'waypoint') {
    const m = document.createElement('div');
    m.className = 'muted';
    m.textContent = el ? 'Selected element is not a waypoint.'
      : 'Select a waypoint to edit its place + heading.';
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
    // Only `name` (mutates the list label + filter sets) and `role` (changes which
    // fields render) need a full rebuild; other fields just redraw — which also
    // keeps focus in the field being edited instead of tearing down the DOM.
    if ('name' in patch || 'role' in patch) { rebuildElemList(); rebuildVisibility(); rebuildInspector(); }
    draw();
  };

  const roleSel = document.createElement('select');
  for (const [v, t] of [['', '(not exported)'], ['room', 'room'], ['location', 'location']]) {
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
      : [...SUGGEST_ROOM_NAMES, ...SUGGEST_LOCATION_NAMES]);
  nameIn.onchange = () => { const nm = canon(nameIn.value); commit({ name: nm, label: nm || 'waypoint' }); };
  field('name', nameIn);

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
  }

  const headIn = document.createElement('input');
  headIn.type = 'number'; headIn.step = '1';
  headIn.value = Math.round((el.heading || 0) * 180 / Math.PI);
  headIn.onchange = () => {
    let deg = parseFloat(headIn.value); if (!Number.isFinite(deg)) deg = 0;
    commit({ heading: deg * Math.PI / 180 });
  };
  field('heading °', headIn);

  const aliasIn = document.createElement('input');
  aliasIn.type = 'text'; aliasIn.value = (el.aliases || []).join(', '); aliasIn.placeholder = 'comma, separated';
  aliasIn.onchange = () => commit({ aliases: aliasIn.value.split(',').map(s => s.trim()).filter(Boolean) });
  field('aliases', aliasIn);

  const barCb = document.createElement('input');
  barCb.type = 'checkbox'; barCb.checked = !!el.barrier;
  barCb.onchange = () => commit({ barrier: barCb.checked });
  field('barrier', barCb);

  const presCb = document.createElement('input');
  presCb.type = 'checkbox'; presCb.checked = el.present !== false;
  presCb.onchange = () => commit({ present: presCb.checked });
  field('present', presCb);

  const pos = document.createElement('div');
  pos.className = 'muted';
  const c = el.coords[0] || [0, 0];
  pos.textContent = `pos: ${(+c[0]).toFixed(3)}, ${(+c[1]).toFixed(3)} m · re-aim by re-drawing with the Waypoint tool`;
  root.appendChild(pos);
}

// ───── Arena vocabulary panel ───────────────────────────────────────

function rebuildVocabUI() {
  const c = $('#vocab-categories'), n = $('#vocab-names'), g = $('#vocab-gestures');
  if (c) c.value = categoriesToText(state.vocab.object_categories);
  if (n) n.value = namesToText(state.vocab.names);
  if (g) g.value = gesturesToText(state.vocab.gestures);
}
function wireVocab() {
  const c = $('#vocab-categories'), n = $('#vocab-names'), g = $('#vocab-gestures');
  if (c) c.addEventListener('change', () => { state.vocab.object_categories = parseCategories(c.value); markDirty(); });
  if (n) n.addEventListener('change', () => { state.vocab.names = parseNames(n.value); markDirty(); });
  if (g) g.addEventListener('change', () => { state.vocab.gestures = parseGestures(g.value); markDirty(); });
}

// ───── UI wiring ────────────────────────────────────────────────────

$('#folder-input').addEventListener('change', (ev) => loadFolder(ev.target.files));
$('#export-btn').addEventListener('click', exportAll);
$('#brush').addEventListener('input', (ev) => { state.brush = +ev.target.value; $('#brush-val').textContent = ev.target.value; draw(); });
$('#add-label').addEventListener('click', () => {
  const v = prompt('new label:');
  if (!v) return;
  const t = v.trim();
  if (!t || state.labels.includes(t)) return;
  state.labels.push(t);
  rebuildLabelSelect();
  $('#label-select').value = t;
});
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redoFn);
$('#fit').addEventListener('click', fitView);
$('#clear-elems').addEventListener('click', () => {
  if (!state.elements.length) return;
  if (!confirm(`delete all ${state.elements.length} elements?`)) return;
  for (const e of [...state.elements]) deleteElement(e.id);
});
$('#toggle-ids').addEventListener('change', (ev) => { state.showIds = ev.target.checked; draw(); });

document.querySelectorAll('button[data-tool]').forEach(b => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});
function setTool(t) {
  state.tool = t;
  state.drawing = null;
  document.querySelectorAll('button[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  canvas.style.cursor = ({ select: 'pointer', point: 'crosshair', rect: 'crosshair',
    polygon: 'crosshair', nogo: 'crosshair', pen: 'none', eraser: 'none', restore: 'none' }[t]) || 'crosshair';
  draw();
}

function fitView() {
  if (!state.meta) return;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const s = Math.min(W / state.w, H / state.h) * 0.95;
  state.view.s = s;
  state.view.x = (W - state.w * s) / 2;
  state.view.y = (H - state.h * s) / 2;
  draw();
}

function updateInfo() {
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
}

function status(t) { $('#status').textContent = t; }

window.addEventListener('resize', () => draw());

loadLabels();
rebuildLabelSelect();
rebuildVisibility();
rebuildInspector();
wireVocab();
setTool('pen');
draw();
status('drag a map folder to begin');

// Self-check: window._test()
window._test = function () {
  const w = 4, h = 3;
  const px = new Uint8Array([0,128,255,0, 50,100,150,200, 10,20,30,40]);
  const buf = writePGM(w, h, px);
  const back = parsePGM(buf.buffer);
  console.assert(back.w === w && back.h === h, 'pgm dims');
  for (let i = 0; i < px.length; i++) console.assert(back.pixels[i] === px[i], 'pgm bytes ' + i);

  const yaml = 'image: map.pgm\nmode: trinary\nresolution: 0.05\norigin: [-1.5, -2.0, 0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196\n';
  const m = parseYAML(yaml);
  console.assert(m.resolution === 0.05 && m.origin[0] === -1.5, 'yaml parse');

  const out = new Uint8Array(16).fill(254);
  rasterPoly(out, 4, 4, [[1,1],[3,1],[3,3],[1,3]], 0);
  let blackCount = 0;
  for (const v of out) if (v === 0) blackCount++;
  console.assert(blackCount >= 4, 'raster filled, got ' + blackCount);

  // world.toml builder (pure)
  const wpRoom = { type: 'waypoint', role: 'room', name: 'Kitchen', heading: Math.PI / 2,
    coords: [[1.2, 3.4]], aliases: ['the kitchen'], barrier: true, present: true };
  const wpLoc = { type: 'waypoint', role: 'location', name: 'kitchen table', room: 'kitchen',
    heading: 0, coords: [[1.0, 2.0]], category: 'table', placement: true, aliases: [], present: true };
  const wpAbsent = { type: 'waypoint', role: 'room', name: 'hall', heading: 0, coords: [[0, 0]], present: false };
  const vocab = { object_categories: { drinks: ['Cola', 'water'] }, names: ['Charlie'],
    gestures: { waving: ['waving person'] } };
  const toml = buildWorldTomlFrom([wpRoom, wpLoc, wpAbsent], vocab);
  console.assert(/\[rooms\.kitchen\]/.test(toml), 'room table');
  console.assert(/\[locations\.kitchen_table\]/.test(toml), 'location table snake_cased');
  console.assert(/room = "kitchen"/.test(toml), 'location->room link');
  console.assert(/pose = \[1\.2, 3\.4, 1\.5708\]/.test(toml), 'room pose w/ heading, got:\n' + toml);
  console.assert(/barrier = true/.test(toml), 'barrier flag');
  console.assert(/present = false/.test(toml), 'absent room marked present=false');
  console.assert(/\[object_categories\]/.test(toml) && /drinks = \["cola", "water"\]/.test(toml), 'object categories lowercased');
  console.assert(/names = \["Charlie"\]/.test(toml), 'names keep casing');
  console.assert(/\[gestures\.waving\]/.test(toml), 'gestures table');
  console.assert(canon('the Kitchen Table') === 'the_kitchen_table', 'canon');

  // vocab parse round-trips
  const cats = parseCategories('drinks: cola, water\nsnacks: chips');
  console.assert(cats.drinks.length === 2 && cats.snacks[0] === 'chips', 'parseCategories');
  console.assert(parseNames('Charlie, Alex\nRobin').length === 3, 'parseNames');
  const gs = parseGestures('waving: a, b\npointing');
  console.assert(gs.waving.length === 2 && gs.pointing.length === 0, 'parseGestures');

  // canon parity with Python _norm: Unicode letters survive
  console.assert(canon('Café') === 'café', 'canon keeps unicode letters, got ' + canon('Café'));
  // tomlStr escapes a control char rather than emitting it raw
  console.assert(tomlStr('a\nb') === '"a\\nb"', 'tomlStr escapes newline, got ' + tomlStr('a\nb'));

  // validation: clean world has no fatal errors; canon-collisions are errors
  console.assert(worldIssuesFrom([wpRoom, wpLoc], vocab).errors.length === 0, 'clean world: no errors');
  console.assert(worldIssuesFrom([], { object_categories: { Drinks: ['a'], drinks: ['b'] }, names: [], gestures: {} }).errors.length === 1, 'colliding categories -> error');
  const dupRooms = [
    { type: 'waypoint', role: 'room', name: 'Kitchen', coords: [[0, 0]], heading: 0, present: true },
    { type: 'waypoint', role: 'room', name: 'kitchen', coords: [[1, 1]], heading: 0, present: true }];
  console.assert(worldIssuesFrom(dupRooms, {}).errors.length === 1, 'colliding room names -> error');
  // location -> present=false room is a warning (cascade-dropped on the robot)
  const absentRoomCase = [
    { type: 'waypoint', role: 'room', name: 'pantry', coords: [[0, 0]], heading: 0, present: false },
    { type: 'waypoint', role: 'location', name: 'pantry_shelf', room: 'pantry', coords: [[1, 1]], heading: 0, present: true }];
  console.assert(worldIssuesFrom(absentRoomCase, {}).warnings.some(w => /pantry_shelf/.test(w)), 'location->absent room warned');

  console.log('self-check ok');
};
