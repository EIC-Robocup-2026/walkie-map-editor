// DOM-free core logic: PGM/raster, YAML, canon/number formatting, world.toml
// builders + validators, vocab model, and geometry predicates. No imports from
// state/DOM — everything here is a pure function of its arguments, so tests.js
// can exercise it headlessly.
'use strict';

// ───── PGM ──────────────────────────────────────────────────────────

export function parsePGM(buf) {
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

export function writePGM(w, h, pixels) {
  const header = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`);
  const out = new Uint8Array(header.length + pixels.length);
  out.set(header); out.set(pixels, header.length);
  return out;
}

// ───── Polygon raster (even-odd scanline) ───────────────────────────

export function rasterPoly(out, w, h, poly, val) {
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

// ───── YAML ─────────────────────────────────────────────────────────

export function parseYAML(text) {
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

export function writeYAML(m) {
  return `image: ${m.image}\nmode: ${m.mode}\nresolution: ${m.resolution}\norigin: [${m.origin.join(', ')}]\nnegate: ${m.negate}\noccupied_thresh: ${m.occupied_thresh}\nfree_thresh: ${m.free_thresh}\n`;
}

// ───── canon + number formatting ────────────────────────────────────

// Canonical key matching walkie's tasks.skills.locations._norm:
// lowercase, runs of space/hyphen -> single underscore, drop non-word chars.
// The strip uses Unicode \w (\p{L}\p{N}_) like Python's re, so non-ASCII names
// ("Café") survive identically on both sides instead of diverging to "caf".
export function canon(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[\s\-]+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '');
}

export function fmtNum(n) {
  const v = +n;
  if (!Number.isFinite(v)) return '0.0';
  // up to 4 decimals, trailing zeros trimmed, kept as a float-looking literal
  return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
}

// ───── world.toml export (walkie-agent-v2 contract) ─────────────────
// Serializes named waypoints -> [rooms.*]/[locations.*] and the arena
// vocabulary -> [object_categories]/names/[gestures], matching the schema
// parsed by walkie-agent-v2 (tasks/skills/locations.py + tasks/GPSR/world.py).

const _TOML_CTRL = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };
const _TOML_CTRL_RE = /[\u0000-\u001f\u007f]/g;
export function tomlStr(s) {
  // TOML basic string: escape \ and ", plus every control char (a raw newline
  // is an "Illegal character" that makes the whole file unparsable).
  return '"' + String(s)
    .replace(/[\\"]/g, c => '\\' + c)
    .replace(_TOML_CTRL_RE, c => _TOML_CTRL[c]
      || '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase())
    + '"';
}
export function tomlKey(s) { return /^[A-Za-z0-9_-]+$/.test(s) ? s : tomlStr(s); }
export function tomlStrArray(arr) { return '[' + arr.map(tomlStr).join(', ') + ']'; }

export function poseOf(e) {
  const c = (e.coords && e.coords[0]) || [0, 0];
  return [c[0], c[1], e.heading || 0];
}

// pose = [x, y, heading_rad]; the nav approach goal + facing.
function poseToToml(e) { return `[${poseOf(e).map(fmtNum).join(', ')}]`; }
// polygon = ordered [[x,y], ...] vertices (the room boundary / footprint / doorway
// region). Empty -> [] ("not yet surveyed"), matching the rulebook template.
export function polyToToml(poly) {
  if (!Array.isArray(poly) || !poly.length) return '[]';
  return '[' + poly.map(p => `[${fmtNum(p[0])}, ${fmtNum(p[1])}]`).join(', ') + ']';
}
// One arena entry as a TOML inline table: `name = { k = v, k = v }`.
function inlineTable(pairs) { return '{ ' + pairs.map(([k, v]) => `${k} = ${v}`).join(', ') + ' }'; }
// Emit a `[table]` section of inline-table rows, padding keys so the `=` align
// (cosmetic, mirrors world.rulebook_2026.toml). `rows` = [[name, [[k,v],...]], ...].
function emitSection(lines, header, rows) {
  lines.push('', header);
  const w = rows.reduce((m, [n]) => Math.max(m, n.length), 0);
  for (const [name, pairs] of rows)
    lines.push(`${name.padEnd(w)} = ${inlineTable(pairs)}`);
}

// Reference-only tables (rulebook §3.2.5): documented for the mapping system but
// NOT read by walkie-agent-v2's loaders (world.py only grounds [object_categories]).
export const OBJECT_FUNCTIONAL_TYPES = ['tableware', 'cutlery', 'bag', 'tray',
  'pourable', 'heavy', 'tiny', 'fragile', 'deformable', 'laundry', 'laundry_basket', 'garbage_bag'];
export const OBJECT_QUERY_ATTRIBUTES = ['color', 'size', 'weight', 'relative_position', 'description'];

// Pure (DOM-free, so window._test can exercise it): build world.toml text
// from waypoint elements + a vocab object.
export function buildWorldTomlFrom(elements, vocab) {
  const lines = [
    '# Generated by walkie-map-editor — arena map for walkie-agent-v2.',
    '# Use as GPSR_WORLD_FILE (covers all challenges) or drop in as tasks/GPSR/world.toml.',
    '# Follows world.rulebook_2026.toml: pose = [x, y, heading_rad] (nav approach goal);',
    '# polygon = [[x,y], ...] (room boundary / furniture footprint / doorway region).',
  ];

  // Top-level keys (the `names` array) MUST precede every [table] header — in TOML
  // a bare key after `[object_categories]` would bind under that table instead.
  const names = ((vocab && vocab.names) || []).map(s => String(s).trim()).filter(Boolean);
  if (names.length) lines.push('', `names = ${tomlStrArray(names)}`);

  const rooms = elements.filter(e => e.type === 'waypoint' && e.role === 'room');
  const locs = elements.filter(e => e.type === 'waypoint' && e.role === 'location');
  const doors = elements.filter(e => e.type === 'waypoint' && e.role === 'door');

  // [rooms] — pose = room nav goal, polygon = room BOUNDARY (point-in-polygon = "which
  // room am I in"). One inline table per room, mirroring world.rulebook_2026.toml.
  emitSection(lines, '[rooms]', rooms.map(e => canon(e.name) && [tomlKey(canon(e.name)), (() => {
    const pairs = [['pose', poseToToml(e)], ['polygon', polyToToml(e.polygon)]];
    if (e.aliases && e.aliases.length) pairs.push(['aliases', tomlStrArray(e.aliases)]);
    if (e.barrier) pairs.push(['barrier', 'true']);
    if (!e.present) pairs.push(['present', 'false']);
    return pairs;
  })()]).filter(Boolean));

  // [locations] — pose = furniture approach goal, polygon = its 2D FOOTPRINT (stamped
  // into the costmap by the semantic furniture layer). room links to a [rooms.*] key.
  emitSection(lines, '[locations]', locs.map(e => canon(e.name) && [tomlKey(canon(e.name)), (() => {
    const pairs = [];
    if (canon(e.room)) pairs.push(['room', tomlStr(canon(e.room))]);
    if (e.placement) pairs.push(['placement', 'true']);
    if (canon(e.category)) pairs.push(['category', tomlStr(canon(e.category))]);
    pairs.push(['pose', poseToToml(e)], ['polygon', polyToToml(e.polygon)]);
    if (e.aliases && e.aliases.length) pairs.push(['aliases', tomlStrArray(e.aliases)]);
    if (e.barrier) pairs.push(['barrier', 'true']);
    if (!e.present) pairs.push(['present', 'false']);
    return pairs;
  })()]).filter(Boolean));

  // [object_categories] — small objects that appear in random positions; plain name
  // lists (no survey-time pose/polygon). world.py grounds these as lists.
  const cats = (vocab && vocab.object_categories) || {};
  const catKeys = Object.keys(cats).filter(k => canon(k));
  if (catKeys.length) {
    lines.push('', '[object_categories]');
    for (const k of catKeys) {
      const objs = (cats[k] || []).map(canon).filter(Boolean);
      lines.push(`${tomlKey(canon(k))} = ${tomlStrArray(objs)}`);
    }
  }

  // [object_attributes] — reference only (not read by the loaders); documents the
  // functional object types + query attributes the rulebook guarantees.
  lines.push('', '[object_attributes]',
    `functional_types = ${tomlStrArray(OBJECT_FUNCTIONAL_TYPES)}`,
    `query_attributes = ${tomlStrArray(OBJECT_QUERY_ATTRIBUTES)}`);

  // [doors] — a physical door; pose = [x, y, passage_heading_rad], polygon = optional
  // doorway region. The door skill checks "am I in the door area" by point-in-polygon
  // and/or radius (defaults to WALKIE_DOOR_NEAR_RADIUS_M).
  emitSection(lines, '[doors]', doors.map(e => canon(e.name) && [tomlKey(canon(e.name)), (() => {
    const pairs = [['pose', poseToToml(e)], ['polygon', polyToToml(e.polygon)]];
    if (e.radius != null && Number.isFinite(+e.radius) && +e.radius > 0)
      pairs.push(['radius', fmtNum(e.radius)]);
    if (!e.present) pairs.push(['present', 'false']);
    return pairs;
  })()]).filter(Boolean));

  const gestures = (vocab && vocab.gestures) || {};
  for (const g of Object.keys(gestures).filter(k => canon(k))) {
    lines.push('', `[gestures.${tomlKey(canon(g))}]`);
    lines.push(`aliases = ${tomlStrArray((gestures[g] || []).map(String))}`);
  }

  // [object_instances] — runtime only (filled by the perception loop, not surveyed).
  // Emitted commented-out as the documented slot, mirroring the rulebook template.
  lines.push('',
    '# [object_instances] — runtime cache, filled by the detector (not surveyed here).',
    '#   <name>.<index> = { pose = [x,y,heading], polygon = [[x,y], ...], on = "<location>" }',
    '# [object_instances]',
    '# pringles.0 = { pose = [0,0,0], polygon = [], on = "cabinet" }');
  return lines.join('\n') + '\n';
}

// Pre-export checks (pure, so window._test can exercise it). Splits issues into:
//   errors   — make the TOML unparsable (duplicate table/key from canon-collision);
//              export MUST block, since a half-written file loses the WHOLE arena.
//   warnings — droppable/advisory (location -> absent room, no name, shadowing,
//              non-finite pose); export may proceed after a confirm.
export function worldIssuesFrom(elements, vocab) {
  const errors = [], warnings = [];
  const rooms = elements.filter(e => e.type === 'waypoint' && e.role === 'room');
  const locs = elements.filter(e => e.type === 'waypoint' && e.role === 'location');
  const doors = elements.filter(e => e.type === 'waypoint' && e.role === 'door');

  // canon-collision within a namespace => duplicate [rooms.x]/[locations.x]/[doors.x] header.
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
  keysOf(doors, 'doors');

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
  for (const e of [...rooms, ...locs, ...doors]) {
    if (!poseOf(e).every(Number.isFinite))
      warnings.push(`${e.role} "${canon(e.name) || ('#' + e.id)}" has a non-finite pose — it will export as 0`);
  }
  return { errors, warnings };
}

// ───── arena vocabulary (structured editor model) ───────────────────

export function normalizeVocab(v) {
  const out = { object_categories: {}, names: [], gestures: {} };
  const oc = (v && v.object_categories) || {};
  for (const k of Object.keys(oc)) out.object_categories[k] = (oc[k] || []).map(String);
  out.names = Array.isArray(v && v.names) ? v.names.map(String) : [];
  const g = (v && v.gestures) || {};
  for (const k of Object.keys(g)) out.gestures[k] = (g[k] || []).map(String);
  return out;
}
// "a, b, c" -> ["a","b","c"] (trimmed, blanks dropped)
export function splitList(s) { return String(s).split(',').map(x => x.trim()).filter(Boolean); }

// ───── geometry predicates ──────────────────────────────────────────

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Signed polygon area (shoelace); callers take abs for magnitude.
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return a / 2;
}
// Area-weighted polygon centroid (where the forced waypoint pose is placed when a
// shape is drawn). Falls back to the vertex average for a degenerate (zero-area)
// polygon, and to the single point / midpoint for < 3 vertices.
export function polygonCentroid(pts) {
  if (!pts || !pts.length) return [0, 0];
  if (pts.length < 3) {
    const n = pts.length;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cross = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += cross; cx += (pts[j][0] + pts[i][0]) * cross; cy += (pts[j][1] + pts[i][1]) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = pts.length;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}
export function distToSeg(x, y, a, b) {
  const [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(x - ax, y - ay);
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// ───── OctoMap parser (.ot / .bt) ───────────────────────────────────

/**
 * Parse an OctoMap binary file (.ot full OcTree or .bt binary OcTree).
 * Returns { resolution, xs, ys, zs } — Float32Arrays of occupied voxel centres.
 *
 * Both formats share an ASCII header ending with "data\n".
 * After the header the binary encoding differs:
 *
 *  .bt (binary OcTree) — compact, 2 bytes per inner node:
 *    Byte covers 4 children × 2 bits each: bit(shift+0)=exists, bit(shift+1)=is_inner.
 *    Children 0-3 in byte1, children 4-7 in byte2.  Occupied leaf: exists=1, inner=0.
 *    Inner node: exists=1, inner=1 → recurse.  DFS order, inner nodes recursed
 *    in order 0→3 (byte1) then 4→7 (byte2).
 *
 *  .ot (full OcTree) — each node: float32(log_odds) + uint8(child_bitmap) + children...
 *    Pre-order DFS.  Leaf node ↔ child_bitmap==0.  Occupied leaf ↔ log_odds > 0.
 *
 * OctoMap child index bit convention (from computeChildKey):
 *   bit 0 → +x, bit 1 → +y, bit 2 → +z.
 * Root centre = (0, 0, 0), root edge = resolution × 2^16.
 */
export function parseOctomap(buf) {
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder('ascii');
  let pos = 0;

  // --- ASCII header -------------------------------------------------
  let resolution = 0, isBt = false;
  while (pos < bytes.length) {
    const start = pos;
    while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
    const line = dec.decode(bytes.subarray(start, pos)).replace(/\r$/, '');
    pos++; // skip \n
    if (line.includes('binary')) isBt = true;
    if (line.startsWith('res ')) resolution = parseFloat(line.slice(4));
    if (line === 'data') break;
  }
  if (!resolution) throw new Error('OctoMap header missing resolution');

  // Root covers resolution × 2^16 metres, centred at world origin.
  const ROOT_SIZE = resolution * 65536;

  const xArr = [], yArr = [], zArr = [];

  if (isBt) {
    // .bt: 2 bytes per node = 8 children × 2 bits (exists | is_inner)
    const readBt = (p, cx, cy, cz, size) => {
      if (p + 2 > bytes.length) return p;
      const b1 = bytes[p], b2 = bytes[p + 1]; p += 2;
      const half = size * 0.5;          // child node edge (passed as next size)
      const q = half * 0.5;             // child-centre offset from parent centre (= size/4)
      const recurse = [];
      for (let i = 0; i < 8; i++) {
        const b = i < 4 ? b1 : b2;
        const sh = (i & 3) << 1;          // (i%4)*2
        const exists = (b >> sh) & 1;
        const inner  = (b >> (sh + 1)) & 1;
        if (!exists && !inner) continue;
        // bit0=x, bit1=y, bit2=z
        const dx = (i & 1) ? q : -q;
        const dy = (i & 2) ? q : -q;
        const dz = (i & 4) ? q : -q;
        if (inner) { recurse.push(cx + dx, cy + dy, cz + dz); }
        else        { xArr.push(cx + dx); yArr.push(cy + dy); zArr.push(cz + dz); }
      }
      for (let r = 0; r < recurse.length; r += 3)
        p = readBt(p, recurse[r], recurse[r+1], recurse[r+2], half);
      return p;
    };
    readBt(pos, 0, 0, 0, ROOT_SIZE);
  } else {
    // .ot: float32(log_odds) + uint8(child_bitmap) then children recursively
    const view = new DataView(buf);
    const readOt = (p, cx, cy, cz, size) => {
      if (p + 5 > bytes.length) return p;
      const logOdds   = view.getFloat32(p, true); // little-endian (x86)
      const childMask = bytes[p + 4];
      p += 5;
      const half = size * 0.5;          // child node edge (passed as next size)
      const q = half * 0.5;             // child-centre offset from parent centre (= size/4)
      let hasChildren = false;
      for (let i = 0; i < 8; i++) {
        if (!(childMask & (1 << i))) continue;
        hasChildren = true;
        const dx = (i & 1) ? q : -q;
        const dy = (i & 2) ? q : -q;
        const dz = (i & 4) ? q : -q;
        p = readOt(p, cx + dx, cy + dy, cz + dz, half);
      }
      // Occupied leaf: no children and positive log-odds (prob > 0.5)
      if (!hasChildren && logOdds > 0) {
        xArr.push(cx); yArr.push(cy); zArr.push(cz);
      }
      return p;
    };
    readOt(pos, 0, 0, 0, ROOT_SIZE);
  }

  return {
    resolution,
    xs: new Float32Array(xArr),
    ys: new Float32Array(yArr),
    zs: new Float32Array(zArr),
  };
}
