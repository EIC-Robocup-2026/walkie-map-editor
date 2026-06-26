// Shared mutable state + constants for the Walkie map editor.
// `state` is a singleton imported by reference across modules — mutating its
// fields is visible everywhere. NEVER reassign the `state` binding itself.
// PGM coord convention: image row 0 = top; world Y axis = up.
'use strict';

export const DEFAULT_LABELS = ['table', 'shelf', 'chair', 'sofa', 'tv', 'food', 'drink'];
export const FREE = 254, OCC = 0;
export const KIND_LABELS = { point: 'point', rect: 'rect', polygon: 'polygon', nogo: 'no-go', waypoint: 'waypoint' };
// Default heading-arrow length on screen (px); world direction, y-flipped to canvas.
export const WAYPOINT_ARROW_PX = 26;

// Inspector combo-box suggestions. The name/category inputs stay FREE TEXT (GPSR
// names arbitrary arena places), but these surface the load-bearing challenge-
// contract names (docs/MAP_LOCATIONS.md) so they're picked, not mistyped.
export const SUGGEST_ROOM_NAMES = ['kitchen', 'living_room', 'bedroom', 'office', 'dining_room', 'hallway', 'bathroom'];
export const SUGGEST_LOCATION_NAMES = ['dining_table', 'kitchen_bar', 'dishwasher', 'cabinet', 'trash_bin',
  'breakfast_surface', 'extra_surface', 'laundry_area', 'laundry_basket', 'folding_table',
  'washing_machine', 'entrance_door'];
export const SUGGEST_CATEGORIES = ['table', 'shelf', 'cabinet', 'counter', 'bin', 'sofa', 'chair', 'bed', 'sink', 'door', 'appliance', 'rack'];
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
  // monotonic element-id counter (was a module-level `let` in the monolith).
  nextId: 1,
};

export function markDirty() { state.dirty = true; }
