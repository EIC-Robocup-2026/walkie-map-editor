// File I/O: load a map folder, normalize its elements/vocab, and export the
// Nav2 + world.toml bundle (directory-picker, or per-file download fallback).
'use strict';

import { state, FREE, OCC } from './state.js';
import { $, worldToPx } from './dom.js';
import {
  parsePGM, writePGM, parseYAML, writeYAML, rasterPoly,
  buildWorldTomlFrom, worldIssuesFrom, normalizeVocab,
} from './pure.js';
import { renderPixels, renderOriginal } from './render.js';
import { makeZip } from './zip.js';
import {
  rebuildLabelSelect, rebuildElemList, rebuildVisibility, rebuildInspector,
  rebuildVocabUI, updateInfo, status, fitView,
} from './ui.js';

export async function loadFolder(files) {
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

  // The imported folder's own name is the most meaningful map name — maps are
  // often named "map.pgm" inside an arena-named folder, so deriving the prefix
  // from the .pgm filename alone always yielded "map". webkitRelativePath is
  // "<folder>/<file>" for a directory pick.
  let folderName = '';
  for (const f of files) {
    if (f.webkitRelativePath) { folderName = f.webkitRelativePath.split('/')[0]; break; }
  }
  // Re-importing an export folder (<name>_export_YYYYMMDD_HHMMSS, or the older
  // _HHMM form) should recover the original <name>, not stack another suffix.
  folderName = folderName.replace(/_export_\d{8}_\d{4,6}$/, '');

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
  state.prefix = folderName || pgm.name.replace(/_og\.pgm$|\.pgm$/i, '') || 'map';
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
  state.nextId = maxId + 1;

  rebuildLabelSelect();
  rebuildElemList();
  rebuildVisibility();
  rebuildInspector();
  rebuildVocabUI();
  renderPixels();
  renderOriginal();   // populate the overlay buffer (original never mutates after load)
  fitView();
  updateInfo();
  $('#export-btn').disabled = false;
  state.dirty = false;
  status(`loaded ${pgm.name} ${parsed.w}×${parsed.h}${ogNote}; elements: ${loadedCount}`);
}

// Load a drag-and-dropped folder. Uses the webkitGetAsEntry directory API to
// gather the folder's files, tagging each with a synthetic webkitRelativePath
// (<dir>/<file>) so loadFolder's name-derivation works exactly as for the
// folder picker. Falls back to a flat file list if the entry API is missing.
export async function loadDroppedItems(dataTransfer) {
  const items = dataTransfer && dataTransfer.items;
  const getEntry = items && items.length && items[0].webkitGetAsEntry;
  if (!getEntry) {
    if (dataTransfer && dataTransfer.files && dataTransfer.files.length) {
      await loadFolder([...dataTransfer.files]);
    } else { status('drop a folder containing map.pgm + map.yaml'); }
    return;
  }
  const entries = [];
  for (const it of items) { const e = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (e) entries.push(e); }

  const files = [];
  const fileOf = (entry) => new Promise((res) => entry.file(
    (f) => { try { Object.defineProperty(f, 'webkitRelativePath', { value: entry.fullPath.replace(/^\//, '') }); } catch {} res(f); },
    () => res(null)));
  const readDir = (dirEntry) => new Promise((res) => {
    const reader = dirEntry.createReader();
    const acc = [];
    const step = () => reader.readEntries((batch) => {
      if (!batch.length) return res(acc);
      acc.push(...batch); step();   // readEntries returns in chunks; drain until empty
    }, () => res(acc));
    step();
  });

  for (const entry of entries) {
    if (entry.isFile) { const f = await fileOf(entry); if (f) files.push(f); }
    else if (entry.isDirectory) {
      for (const child of await readDir(entry)) {
        if (child.isFile) { const f = await fileOf(child); if (f) files.push(f); }
      }
    }
  }
  if (!files.length) { status('drop a folder containing map.pgm + map.yaml'); return; }
  await loadFolder(files);
}

export function normalizeElement(e) {
  const base = {
    id: e.id || `e${state.nextId++}`,
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
export function defaultWaypointFields(e = {}) {
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

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function buildExportFiles(prefix) {
  const meta = { ...state.meta, image: `${prefix}.pgm` };
  // Keepout layer's own Nav2 metadata: identical to the map yaml, only `image`
  // points at the keepout PGM (so it can be loaded as a separate costmap layer).
  const keepoutMeta = { ...state.meta, image: `${prefix}_keepout.pgm` };
  const enc = new TextEncoder();
  return [
    [`${prefix}_og.pgm`, writePGM(state.w, state.h, state.original)],
    [`${prefix}.pgm`, writePGM(state.w, state.h, state.pixels)],
    [`${prefix}.yaml`, enc.encode(writeYAML(meta))],
    [`${prefix}_element.json`,
      enc.encode(JSON.stringify({ labels: state.labels, elements: state.elements, vocab: state.vocab }, null, 2))],
    [`${prefix}_keepout.pgm`, writePGM(state.w, state.h, buildKeepout())],
    [`${prefix}_keepout.yaml`, enc.encode(writeYAML(keepoutMeta))],
    [`${prefix}_world.toml`, enc.encode(buildWorldToml())],
  ];
}

export async function exportAll() {
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
  const folderName = `${prefix}_export_${dateStamp()}`;
  const files = buildExportFiles(prefix);

  if (window.showDirectoryPicker) {
    try {
      // User picks the parent directory (e.g. ~/map_download); we create the
      // dated subfolder <prefix>_export_<DateTime>/ inside it and write all files there.
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
  // Fallback (Firefox / Safari — no showDirectoryPicker, so the OS folder can't
  // be chosen from JS): bundle everything into ONE .zip that unzips into the
  // <prefix>_export_<datetime>/ folder. Enable Firefox's "Always ask you where
  // to save files" to get a Save-As location prompt for this single download.
  const zip = makeZip(files.map(([name, bytes]) => [`${folderName}/${name}`, bytes]));
  download(`${folderName}.zip`, zip, 'application/zip');
  state.dirty = false;
  status(`browser can't pick a folder — saved all ${files.length} files as ${folderName}.zip (unzip to get the folder)`);
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

function buildWorldToml() { return buildWorldTomlFrom(state.elements, state.vocab); }
function validateWorld() { return worldIssuesFrom(state.elements, state.vocab); }
