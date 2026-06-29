// File I/O: load a map folder, normalize its elements/vocab, and export the
// Nav2 + world.toml bundle (directory-picker, or per-file download fallback).
'use strict';

import { state, FREE, OCC } from './state.js';
import { $, worldToPx } from './dom.js';
import {
  parsePGM, writePGM, parseYAML, writeYAML, rasterPoly,
  buildWorldTomlFrom, worldIssuesFrom, normalizeVocab, parseOctomap,
} from './pure.js';
import { renderPixels, renderOriginal, renderRef, draw } from './render.js';
import { makeZip } from './zip.js';
import {
  rebuildLabelSelect, rebuildElemList, rebuildVisibility, rebuildInspector,
  rebuildVocabUI, updateInfo, status, fitView,
} from './ui.js';

// Convert { resolution, xs, ys, zs } from parseOctomap() into an ImageData heatmap.
// The image is built at the OctoMap's own voxel resolution (one pixel per voxel),
// then drawn in render.js at scale = ot_res / map_res so it aligns with the map.
// A clip rect in render.js confines it to the map boundary.
// Returns null if the voxel arrays are empty.
function buildRefFromVoxels({ resolution, xs, ys, zs }, zFilterMin = -Infinity, zFilterMax = Infinity) {
  if (!xs.length) return null;

  // First pass: XY bbox + Z range using only voxels within the Z filter.
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (zs[i] < zFilterMin || zs[i] > zFilterMax) continue;
    if (xs[i] < xMin) xMin = xs[i]; if (xs[i] > xMax) xMax = xs[i];
    if (ys[i] < yMin) yMin = ys[i]; if (ys[i] > yMax) yMax = ys[i];
    if (zs[i] < zMin) zMin = zs[i]; if (zs[i] > zMax) zMax = zs[i];
  }
  if (!isFinite(xMin)) return null; // no voxels survive the filter

  const originX = Math.floor(xMin / resolution) * resolution;
  const originY = Math.floor(yMin / resolution) * resolution;
  const MAX_DIM = 2048;
  const width  = Math.min(MAX_DIM, Math.max(1, Math.ceil((xMax - originX) / resolution) + 1));
  const height = Math.min(MAX_DIM, Math.max(1, Math.ceil((yMax - originY) / resolution) + 1));

  // Accumulate max-Z per 2D cell (Y-flipped: row 0 = highest world-Y)
  const zMaxGrid = new Float32Array(width * height).fill(-1e9);
  for (let i = 0; i < xs.length; i++) {
    if (zs[i] < zFilterMin || zs[i] > zFilterMax) continue;
    const col = Math.round((xs[i] - originX) / resolution);
    const row = height - 1 - Math.round((ys[i] - originY) / resolution);
    if (col < 0 || col >= width || row < 0 || row >= height) continue;
    const idx = row * width + col;
    if (zs[i] > zMaxGrid[idx]) zMaxGrid[idx] = zs[i];
  }

  // RGBA heatmap: green (floor of filter range) → yellow (mid) → red (ceiling)
  const zRange = Math.max(zMax - zMin, 1e-6);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const z = zMaxGrid[i];
    if (z <= -1e8) continue;
    const t = (z - zMin) / zRange;
    const j = i * 4;
    pixels[j]     = t < 0.5 ? Math.round(t * 2 * 255) : 255;
    pixels[j + 1] = t < 0.5 ? 255 : Math.round((1 - (t - 0.5) * 2) * 255);
    pixels[j + 2] = 0;
    pixels[j + 3] = 200;
  }

  return {
    imageData: new ImageData(pixels, width, height),
    meta: { origin: [originX, originY], resolution, width, height, z_range: [zMin, zMax] },
  };
}

// Rebuild the ref image from stored raw voxels after a Z-filter change.
export async function rebuildRefFromZRange() {
  if (!state.refVoxels) return;
  const ref = buildRefFromVoxels(state.refVoxels, state.refZMin, state.refZMax);
  if (!ref) { status(`no voxels in Z range [${state.refZMin.toFixed(2)}, ${state.refZMax.toFixed(2)}] m`); return; }
  state.refImage = await createImageBitmap(ref.imageData);
  state.refMeta  = ref.meta;
  renderRef();
  draw();
  updateInfo();
  status(`3D ref filtered: z [${state.refZMin.toFixed(2)}, ${state.refZMax.toFixed(2)}] m — ${ref.meta.width}×${ref.meta.height}px`);
}

export async function loadFolder(files) {
  let pgm = null, og = null, yaml = null, elemJson = null,
      refPng = null, refJson = null, otFile = null;
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (n.endsWith('_og.pgm')) og = f;
    else if (n.endsWith('_3dref.png')) refPng = f;
    else if (n.endsWith('_3dref.json')) refJson = f;
    else if (n.endsWith('.ot') || n.endsWith('.bt')) otFile = otFile || f;
    else if (n.endsWith('.pgm') && !n.endsWith('_keepout.pgm')) pgm = pgm || f;
    else if (n.endsWith('.yaml') || n.endsWith('.yml')) yaml = f;
    else if (n.endsWith('_element.json') || n.endsWith('_elements.json')) elemJson = f;
  }
  console.log('[load] files:', Array.from(files).map(f => f.name));
  console.log('[load] pgm:', pgm?.name, '  yaml:', yaml?.name, '  ot:', otFile?.name, '  refPng:', refPng?.name);
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
  state.refImage = null;
  state.refMeta = null;
  state.showRefOverlay = false;
  state.refOffsetX = 0; state.refOffsetY = 0; state.refUserScale = 1.0; state.refMoveMode = false;
  state.refVoxels = null; state.refZMin = -Infinity; state.refZMax = Infinity;
  const refToggle = $('#toggle-ref');
  if (refToggle) refToggle.checked = false;
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

  // Load 3D reference overlay — prefer pre-generated PNG pair, fall back to .ot/.bt
  let refNote = '';
  if (refPng && refJson) {
    try {
      const rm = JSON.parse(await refJson.text());
      if (Array.isArray(rm.origin) && rm.origin.length === 2
          && typeof rm.resolution === 'number'
          && typeof rm.width === 'number' && typeof rm.height === 'number') {
        const blob = new Blob([await refPng.arrayBuffer()], { type: 'image/png' });
        state.refImage = await createImageBitmap(blob);
        state.refMeta = rm;
        state.showRefOverlay = true;
        const refTogglePng = $('#toggle-ref');
        if (refTogglePng) refTogglePng.checked = true;
        const resDiff = Math.abs(rm.resolution - meta.resolution) / meta.resolution;
        refNote = resDiff > 0.01
          ? `; ⚠ 3D ref res ${rm.resolution}m ≠ map ${meta.resolution}m`
          : `; 3D ref ${rm.width}×${rm.height}px`;
      } else {
        console.warn('3D ref JSON missing required fields', rm);
        refNote = '; 3D ref JSON invalid (see console)';
      }
    } catch (e) {
      console.warn('3D ref PNG load failed', e);
      refNote = '; 3D ref load failed (see console)';
    }
  } else if (refPng && !refJson) {
    refNote = '; _3dref.png found but no _3dref.json — skipped';
  } else if (refJson && !refPng) {
    refNote = '; _3dref.json found but no _3dref.png — skipped';
  } else if (otFile) {
    // Direct in-browser OctoMap parsing — no Python or conversion tools needed.
    const OT_MAX_BYTES = 150 * 1024 * 1024; // 150 MB
    if (otFile.size > OT_MAX_BYTES) {
      refNote = `; ${otFile.name} too large (${(otFile.size / 1e6).toFixed(0)}MB) — file exceeds 150 MB limit`;
    } else {
      try {
        console.log('[3D ref] reading', otFile.name, `(${(otFile.size / 1e6).toFixed(1)}MB)`);
        status(`parsing ${otFile.name}…`);
        await new Promise(r => setTimeout(r, 0)); // yield so the status text renders
        const buf = await otFile.arrayBuffer();
        console.log('[3D ref] buffer read, parsing OctoMap…');
        const otParsed = parseOctomap(buf);
        console.log('[3D ref] parsed:', otParsed.xs.length, 'occupied voxels, resolution:', otParsed.resolution);
        state.refVoxels = otParsed;
        // Default Z filter = full data range
        let zLo = otParsed.zs[0], zHi = otParsed.zs[0];
        for (let i = 1; i < otParsed.zs.length; i++) {
          if (otParsed.zs[i] < zLo) zLo = otParsed.zs[i];
          if (otParsed.zs[i] > zHi) zHi = otParsed.zs[i];
        }
        state.refZMin = zLo; state.refZMax = zHi;
        const ref = buildRefFromVoxels(otParsed, state.refZMin, state.refZMax);
        if (ref) {
          console.log('[3D ref] image built:', ref.meta.width, '×', ref.meta.height, 'origin:', ref.meta.origin);
          state.refImage = await createImageBitmap(ref.imageData);
          state.refMeta = ref.meta;
          state.showRefOverlay = true;
          const refToggleOt = $('#toggle-ref');
          if (refToggleOt) refToggleOt.checked = true;
          refNote = `; 3D ref from ${otFile.name} (${otParsed.xs.length.toLocaleString()} voxels)`;
          console.log('[3D ref] done — overlay enabled');
        } else {
          refNote = `; ${otFile.name}: no occupied voxels found`;
          console.warn('[3D ref] buildRefFromVoxels returned null — no voxels with logOdds > 0');
        }
      } catch (e) {
        console.error('[3D ref] parse failed:', e);
        refNote = `; OctoMap parse failed: ${e.message}`;
      }
    }
  }

  rebuildLabelSelect();
  rebuildElemList();
  rebuildVisibility();
  rebuildInspector();
  rebuildVocabUI();
  renderPixels();
  renderOriginal();   // populate the overlay buffer (original never mutates after load)
  renderRef();        // populate 3D ref buffer (no-op if no ref loaded)
  fitView();
  updateInfo();
  $('#export-btn').disabled = false;
  state.dirty = false;
  status(`loaded ${pgm.name} ${parsed.w}×${parsed.h}${ogNote}${refNote}; elements: ${loadedCount}`);
}

// Load a single .ot/.bt file chosen via the dedicated OctoMap file picker.
// Bypasses the Firefox webkitdirectory bug that poisons FileList reads when
// a folder contains a .ot file alongside .pgm/.yaml.
export async function loadOtFile(file) {
  if (!state.meta) { status('load a map folder first (.pgm + .yaml)'); return; }
  const OT_MAX_BYTES = 150 * 1024 * 1024;
  if (file.size > OT_MAX_BYTES) {
    status(`${file.name} too large (${(file.size / 1e6).toFixed(0)} MB) — file exceeds 150 MB limit`);
    return;
  }
  status(`parsing ${file.name}…`);
  await new Promise(r => setTimeout(r, 0));
  try {
    console.log('[3D ref] reading single file:', file.name, `(${(file.size / 1e6).toFixed(1)}MB)`);
    const buf = await file.arrayBuffer();
    console.log('[3D ref] buffer read, parsing OctoMap…');
    const otParsed = parseOctomap(buf);
    console.log('[3D ref] parsed:', otParsed.xs.length, 'voxels, res:', otParsed.resolution);
    state.refVoxels = otParsed;
    let zLo = otParsed.zs[0], zHi = otParsed.zs[0];
    for (let i = 1; i < otParsed.zs.length; i++) {
      if (otParsed.zs[i] < zLo) zLo = otParsed.zs[i];
      if (otParsed.zs[i] > zHi) zHi = otParsed.zs[i];
    }
    state.refZMin = zLo; state.refZMax = zHi;
    const ref = buildRefFromVoxels(otParsed, state.refZMin, state.refZMax);
    if (ref) {
      state.refImage = await createImageBitmap(ref.imageData);
      state.refMeta  = ref.meta;
      state.showRefOverlay = true;
      state.refOffsetX = 0; state.refOffsetY = 0; state.refUserScale = 1.0; state.refMoveMode = false;
      const toggle = $('#toggle-ref');
      if (toggle) toggle.checked = true;
      renderRef();
      draw();
      updateInfo();
      status(`3D ref from ${file.name} (${otParsed.xs.length.toLocaleString()} voxels)`);
      console.log('[3D ref] done — overlay enabled');
    } else {
      status(`${file.name}: no occupied voxels found`);
      console.warn('[3D ref] no voxels with logOdds > 0');
    }
  } catch (e) {
    console.error('[3D ref] parse failed:', e);
    status(`OctoMap parse failed: ${e.message}`);
  }
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
  // Read each file's bytes eagerly inside the entry.file() callback (while the
  // entry is still alive) to work around Firefox refusing arrayBuffer() later.
  // FileReader is the most compatible path for drag-and-drop files in Firefox.
  const fileOf = (entry) => new Promise((res) => entry.file(
    (f) => {
      const path = entry.fullPath.replace(/^\//, '');
      const attach = (file) => {
        try { Object.defineProperty(file, 'webkitRelativePath', { value: path }); } catch {}
        res(file);
      };
      const reader = new FileReader();
      reader.onload  = (e) => attach(new File([e.target.result], f.name, { type: f.type, lastModified: f.lastModified }));
      reader.onerror = ()  => attach(f); // last-resort: pass original (may still DOMException later)
      reader.readAsArrayBuffer(f);
    },
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
  try {
    await loadFolder(files);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      status('Firefox drag-and-drop: file read blocked — use the Load Folder button instead (folder icon in toolbar, or Ctrl+O)');
      console.warn('Firefox drag-and-drop DOMException — use folder picker instead:', e);
    } else {
      throw e;
    }
  }
}

export function normalizeElement(e) {
  const base = {
    id: e.id || `e${state.nextId++}`,
    label: e.label || 'unknown',
    type: e.type || 'polygon',
    // Structured draw type: 'area' | 'object' (undefined for no-go / legacy shapes).
    semType: e.semType === 'area' || e.semType === 'object' ? e.semType : undefined,
    closed: !!e.closed,
    asNogo: !!e.asNogo,
    coords: Array.isArray(e.coords) ? e.coords.map(c => [+c[0], +c[1]]) : [],
  };
  if (base.type === 'waypoint') Object.assign(base, defaultWaypointFields(e));
  return base;
}

// Semantic fields a waypoint carries on top of its position, for world.toml.
// role '' = not exported; 'room'/'location'/'door' map to an inline-table entry
// under the [rooms]/[locations]/[doors] section (see buildWorldTomlFrom).
export function defaultWaypointFields(e = {}) {
  return {
    heading: Number.isFinite(+e.heading) ? +e.heading : 0,   // radians, map frame
    role: ['room', 'location', 'door'].includes(e.role) ? e.role : '',
    // polygon = room boundary / furniture footprint / doorway region (world coords,
    // Y-up). Exported as the rulebook `polygon`; [] until a shape is bound (feat 3).
    polygon: Array.isArray(e.polygon) ? e.polygon.map(c => [+c[0], +c[1]]) : [],
    name: typeof e.name === 'string' ? e.name : '',
    room: typeof e.room === 'string' ? e.room : '',           // location -> its room (canonical)
    category: typeof e.category === 'string' ? e.category : '',
    // Optional Z height (m) of an object/furniture surface. null = unset.
    z: e.z == null || e.z === '' ? null : (Number.isFinite(+e.z) ? +e.z : null),
    aliases: Array.isArray(e.aliases) ? e.aliases.map(String) : [],
    placement: !!e.placement,
    barrier: !!e.barrier,
    // door-only: proximity trigger radius (m). null -> robot uses its global default.
    radius: e.radius == null || e.radius === '' ? null : (Number.isFinite(+e.radius) ? +e.radius : null),
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
