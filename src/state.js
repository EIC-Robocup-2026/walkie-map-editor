// Shared mutable state + constants for the Walkie map editor.
// `state` is a singleton imported by reference across modules — mutating its
// fields is visible everywhere. NEVER reassign the `state` binding itself.
// PGM coord convention: image row 0 = top; world Y axis = up.
'use strict';

export const DEFAULT_LABELS = ['table', 'shelf', 'chair', 'sofa', 'tv', 'food', 'drink'];

// ───── Structured draw model (type → label) ─────────────────────────
// Every drawn shape is tagged with a semantic TYPE and a LABEL from that type's
// managed list (instead of one free-text label). The type auto-maps to a
// world.toml role when a waypoint is bound (area → room, object → location).
export const LABEL_TYPES = ['area', 'object'];
export const DEFAULT_LABEL_SETS = {
  area: ['living_room', 'kitchen_room', 'bedroom', 'laundry'],
  object: ['table', 'shelf', 'chair', 'sofa', 'tv'],
};
// Per-type colour tag. Picked to stay legible over BOTH free (white) and occupied
// (black) map pixels; refined in the colour-overhaul feature.
export const TYPE_COLORS = { area: '#22d3ee', object: '#f59e0b' };
export const TYPE_FILLS = { area: 'rgba(34,211,238,0.15)', object: 'rgba(245,158,11,0.15)' };
// area → [rooms], object → [locations] (the rulebook auto-map).
export const roleForType = (t) => (t === 'area' ? 'room' : t === 'object' ? 'location' : '');

// Per-LABEL colour, clustered inside its TYPE's hue band so every area reads as
// one family (cyan→teal→blue) and every object as another (amber→orange→yellow),
// while each label is still individually distinguishable. The type theme
// (TYPE_COLORS) stays the section/toggle accent; labels get these derived hues.
const TYPE_HUE = { area: 195, object: 35 };  // base hue of the cyan / amber theme
const HUE_BAND = 72;                          // total spread (±36°) around the base
const GOLDEN = 0.61803398875;                 // golden ratio → quasi-uniform spread
function _hash(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Stable fraction in [0,1) for a string (hash fallback for labels not in a set).
function _frac(s) { return (_hash(s) * GOLDEN) % 1; }
// Deterministic HSL for (type,label): hue inside the type band, saturated and
// mid-light so it stays legible over both white (free) and black (occupied) pixels.
// Labels in the type's list get EVENLY-SPACED hues (guaranteed distinct); a label
// not in the list (e.g. a freely renamed shape) falls back to a stable hash hue.
export function labelHsl(type, label) {
  const base = TYPE_HUE[type];
  if (base == null) return { h: 0, s: 0, l: 80 };  // untyped → neutral grey
  const set = (state.labelSets && state.labelSets[type]) || [];
  const i = set.indexOf(label), n = set.length;
  const frac = i < 0 ? _frac(label || '') : n > 1 ? i / (n - 1) : 0.5;
  const hue = (((base - HUE_BAND / 2 + frac * HUE_BAND) % 360) + 360) % 360;
  const l = i < 0 ? 60 : (i % 2 ? 64 : 56);  // zig-zag lightness for extra separation
  return { h: Math.round(hue), s: 82, l };
}
export function colorForLabel(type, label) {
  if (type == null) return '#22d3ee';
  const { h, s, l } = labelHsl(type, label);
  return `hsl(${h}, ${s}%, ${l}%)`;
}
export function fillForLabel(type, label) {
  if (type == null) return 'rgba(34,211,238,0.15)';
  const { h, s, l } = labelHsl(type, label);
  return `hsla(${h}, ${s}%, ${l}%, 0.15)`;
}

export const FREE = 254, OCC = 0;
export const KIND_LABELS = { point: 'point', rect: 'rect', polygon: 'polygon', nogo: 'no-go', waypoint: 'waypoint' };
// Default heading-arrow length on screen (px); world direction, y-flipped to canvas.
export const WAYPOINT_ARROW_PX = 26;

// Tool quick-select keybinds. TOOL_ORDER mirrors the toolbar button order so
// Shift+1 = first tool, Shift+2 = second, … TOOL_SHORTCUT_CODES uses KeyboardEvent
// .code (layout-independent) so Shift+1 works regardless of what "!" maps to.
export const TOOL_ORDER = ['pen', 'eraser', 'restore', 'select', 'point', 'rect', 'polygon', 'nogo', 'waypoint', 'door'];
export const TOOL_SHORTCUT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
export const TOOL_SHORTCUT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];

// Inspector combo-box suggestions. The name/category inputs stay FREE TEXT (GPSR
// names arbitrary arena places), but these surface the load-bearing challenge-
// contract names (docs/MAP_LOCATIONS.md) so they're picked, not mistyped.
export const SUGGEST_ROOM_NAMES = ['kitchen', 'living_room', 'bedroom', 'office', 'dining_room', 'hallway', 'bathroom'];
export const SUGGEST_LOCATION_NAMES = ['dining_table', 'kitchen_bar', 'dishwasher', 'cabinet', 'trash_bin',
  'breakfast_surface', 'extra_surface', 'laundry_area', 'laundry_basket', 'folding_table',
  'washing_machine', 'entrance_door'];
export const SUGGEST_CATEGORIES = ['table', 'shelf', 'cabinet', 'counter', 'bin', 'sofa', 'chair', 'bed', 'sink', 'door', 'appliance', 'rack'];
// Door waypoint name suggestions (free text — arenas vary). A door is exported to
// world.toml's [doors] table; the robot's door-opening skill engages near it.
export const SUGGEST_DOOR_NAMES = ['entrance', 'entrance_door', 'exit', 'kitchen_door', 'hallway_door', 'bedroom_door'];
// Fallback door trigger radius (m) for the dashed activation ring, when a door has
// no explicit radius. Matches walkie-agent-v2's WALKIE_DOOR_NEAR_RADIUS_M default.
export const DOOR_DEFAULT_RADIUS_M = 1.5;
// Arena-vocabulary key suggestions (GPSR). Free text — arenas vary — but these are
// the usual RoboCup categories/gestures so they're picked, not retyped.
export const SUGGEST_OBJECT_CATEGORIES = ['drinks', 'snacks', 'fruits', 'food', 'dishes', 'cleaning_supplies', 'toys', 'containers'];
export const SUGGEST_GESTURES = ['waving', 'raising_left_arm', 'raising_right_arm', 'pointing_left', 'pointing_right', 'pointing_up', 'pointing_down'];

export const state = {
  meta: null,
  w: 0, h: 0,
  pixels: null,
  original: null,
  prefix: 'map',
  elements: [],
  labels: DEFAULT_LABELS.slice(),
  // Structured draw selection: managed label list per type, the active type, and
  // the remembered active label per type (so switching type restores its label).
  labelSets: { area: DEFAULT_LABEL_SETS.area.slice(), object: DEFAULT_LABEL_SETS.object.slice() },
  activeType: 'area',
  activeLabel: { area: DEFAULT_LABEL_SETS.area[0], object: DEFAULT_LABEL_SETS.object[0] },
  // Whether drawing an OBJECT also creates a location waypoint at the shape's
  // centre (areas always do — the waypoint is forced for area, optional for object).
  objectWaypoint: true,
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
  // Overlay the pristine _og.pgm at 60% opacity (Khemin's request) to see edits.
  showOriginalOverlay: false,
  // 3D OctoMap reference overlay (loaded from *_3dref.png + *_3dref.json).
  // refImage is an ImageBitmap; refMeta = { origin, resolution, width, height, z_range }.
  refImage: null,
  refMeta: null,
  showRefOverlay: false,
  refOpacity: 1.0,
  refOffsetX: 0,
  refOffsetY: 0,
  refUserScale: 1.0,
  refMoveMode: false,
  refVoxels: null,   // raw { resolution, xs, ys, zs } kept for Z-range re-filtering
  refZMin: -Infinity,
  refZMax: Infinity,
  // UI navigation: hovered element (list↔canvas highlight), sidebar collapse,
  // element-list search filter, and a transient drag-over flag for the drop zone.
  hoverId: null,
  sidebarCollapsed: false,
  elemFilter: '',
  _dropActive: false,
  // monotonic element-id counter (was a module-level `let` in the monolith).
  nextId: 1,
};

export function markDirty() { state.dirty = true; }
