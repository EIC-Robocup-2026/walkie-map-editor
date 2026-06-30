# Feature 1 — world.toml rulebook structure + data model

**Branch:** `feat/world-toml-rulebook-structure`
**Status:** ready for review

## Goal

Switch the exported `world.toml` to the `world.rulebook_2026.toml` structure and
lay the data-model foundation the later features build on.

## Decisions (confirmed with user)

- **Unified element model:** a place is `name = { pose = <waypoint>, polygon = <drawn shape> }`.
  This feature adds the `polygon` field + export; the drawing→polygon wiring lands
  in Feature 3.
- **Auto-map:** type `area` → `[rooms]`, type `object` → `[locations]` (wired in Feature 2).
- **Reference tables:** emit both `[object_attributes]` and a commented `[object_instances]`.
- **Doors** follow the same inline-table format (entrance/exit included) and carry
  `pose = [x, y, heading_rad]` + `polygon` so the robot can check "am I in the door
  area" by point-in-polygon and/or `radius`.

## What changed

### `src/pure.js`
- New helpers: `poseToToml`, `polyToToml` (exported), `inlineTable`, `emitSection`
  (pads keys so `=` align, mirroring the rulebook).
- New exported constants `OBJECT_FUNCTIONAL_TYPES`, `OBJECT_QUERY_ATTRIBUTES`.
- **Rewrote `buildWorldTomlFrom`:**
  - `[rooms]` / `[locations]` / `[doors]` are now **single table headers with one
    inline table per entry** (was `[rooms.kitchen]` sub-tables).
  - Every room/location/door entry emits `pose` **and** `polygon` (`[]` when unset).
  - Added `[object_attributes]` (reference) and a commented `[object_instances]` slot.
  - `[object_categories]`, top-level `names`, and `[gestures.*]` kept as-is
    (still consumed by GPSR; out of the rulebook's places/things scope but not removed).
- `worldIssuesFrom` unchanged — validation keys off `role`/`name`, not output shape.

### `src/io.js`
- `defaultWaypointFields` now round-trips `polygon` (`[[x,y], …]`, world coords,
  Y-up), defaulting to `[]`. `_element.json` save already serializes the whole
  element, so polygon persists both ways.

### `src/tests.js`
- `runSelfCheck` updated to the inline-table format; added coverage for room/door
  `polygon` coords, empty `polygon = []`, `[object_attributes]`, and the commented
  `[object_instances]`.

### `README.md`
- `world.toml` section rewritten to the new structure; `polygon` added to the
  `_element.json` schema and waypoint field docs.

## Verification

- Headless self-check passes (`node` runner over `runSelfCheck`): **all assertions pass**,
  logs `self-check ok`.
- Eyeballed a real multi-entry sample — rooms/locations/doors render as aligned
  inline tables with `pose` + `polygon`; reference tables present.

## Not in this feature (later branches)

- Binding a drawn area/object shape into `polygon` (Feature 3).
- Type/label system + auto-map area→rooms / object→locations (Feature 2).
- Z height + full field editing in the properties panel (Feature 4).
