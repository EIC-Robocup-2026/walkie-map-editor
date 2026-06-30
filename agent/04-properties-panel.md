# Feature 4 — properties panel

**Branch:** `feat/properties-panel` (off `feat/type-label-draw-flow`)
**Status:** ready for review

## Goal

Make the sidebar inspector a full **Properties** panel for the selected element:
edit every field — name, position (x/y), heading — plus an **optional Z height**
for objects, and a label editor for non-waypoint shapes.

## What changed

### `src/ui.js` — `rebuildInspector`
- Renamed concept to **Properties**; the guard now handles **any** selected element
  (was "not a waypoint" dead-end).
- **Non-waypoint shapes:** editable `label` input + a kind/extent readout.
- **Waypoints:** added an editable **position X/Y** row (commits `coords`), kept
  role/name/room/category/placement/heading/aliases/barrier/present/radius.
- **Locations:** added an optional **Z height m** field (`z`, null when blank).
- Replaced the static position readout with a hint line (right-click to aim, drag to
  move, edit fields above).
- `commit()` also does the lighter list/filter rebuild on a `label` change.

### `src/io.js`
- `defaultWaypointFields` round-trips `z` (number or null).

### `src/pure.js`
- `buildWorldTomlFrom` emits `z = <m>` in a location's inline table when set
  (after `polygon`); omitted when null. Rooms/doors unaffected.

### `index.html`
- Sidebar panel renamed `Waypoint → Properties` ("— selected element").

### `src/tests.js`
- Asserts `z` is exported for a location when set and omitted when null.

### `README.md`
- Properties panel docs (position, Z height, non-waypoint label editing) + `z` in
  the `_element.json` schema.

## Decisions

- **Z height home:** stored on the element, round-tripped in `_element.json`, and
  exported as a `z` key on the **location** inline table only when set. The rulebook
  pose is 2D `[x,y,heading]`; `z` is an additive optional key (loaders ignore unknown
  keys), so this gives the height a home without breaking the schema. Easy to drop if
  the robot side prefers it elsewhere.

## Verification

- `node --check` clean; self-check passes (incl. new `z` assertions).
- Headless render with a seeded location selected: Properties panel shows role,
  name, **position X/Y**, room, category, placement, **Z height = 0.75**, heading,
  aliases — and the canvas renders the unified footprint + arrow. No JS errors.

## Not in this feature (later branches)

- Main UI colour overhaul (Feature 5).
- Navigation polish (Feature 6).
