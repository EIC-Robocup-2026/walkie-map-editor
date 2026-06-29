# Feature 3 — unified shape + forced waypoint

**Branch:** `feat/type-label-draw-flow` (continues Feature 2's branch)
**Status:** ready for review

## Goal

Drawing a typed closed shape produces ONE unified `world.toml` place: the drawn
outline becomes the `polygon`, and a waypoint pose is auto-placed at the shape's
centre. Forced for area (→ room), optional for object (→ location).

## Decisions (confirmed with user)

- **Unified element model:** `area = { pose = <centroid waypoint>, polygon = <drawn shape> }`.
  Represented as a `type:'waypoint'` element carrying a `polygon` — consistent with
  the Feature 1 export (which already reads `pose` from `coords[0]` + `e.polygon`).
- **Pose at the CENTRE of the drawn area** (area-weighted centroid), not the screen.
- **Forced for area, optional for object** (Draw-panel toggle, default on).
- **Auto-map:** area → `[rooms]`, object → `[locations]` (`roleForType`).
- **Auto-name** from the label; de-duplicated per role (`table`, `table_2`, …).
- **Auto-room:** an object whose centre falls inside a room's polygon links to it.

## What changed

### `src/pure.js`
- New `polygonCentroid(pts)` — area-weighted centroid; vertex-average fallback for
  degenerate/`<3`-vertex inputs.

### `src/input.js`
- `buildDrawnElement(...)` — a closed typed shape becomes a unified waypoint
  (`coords:[centroid]`, `polygon:<drawn>`, `role`, auto-name, present); otherwise a
  plain shape. `wantWp = area always || (object && state.objectWaypoint)`.
- `uniqueWaypointName(base, role)` — collision-free names within a role.
- `roomContaining(point)` — point-in-polygon room lookup for object auto-linking.
- `commitDrawnElement(el)` — adds + (for waypoints) selects so the inspector opens.
- Rect mouseup and `finishPoly` now route through these (polygons, rects; no-go and
  open polylines stay plain shapes; points unchanged).

### `src/render.js`
- A waypoint with a `polygon` now draws its boundary/footprint (fill + outline)
  under the pose arrow. Typed waypoints use the per-label colour; plain
  waypoints/doors keep their role colour.

### `src/elements.js`
- `hitTest` treats a unified waypoint's polygon as a selectable area (smallest
  containing area wins), so clicking inside a room/footprint selects it.

### `src/state.js`
- New `objectWaypoint` flag (default true).

### `src/ui.js`
- Draw panel gains the *"Place a waypoint for objects (areas always do)"* toggle.

### `src/tests.js`
- `polygonCentroid` assertions (unit-square centre, segment midpoint).

### `README.md`
- "Drawing an area or object makes one unified world.toml place" section.

## Verification

- `node --check` clean on all changed modules; self-check logs `self-check ok`.
- End-to-end node test: drawing area `living_room` + object `table` inside it
  exports `[rooms] living_room = { pose=[2,1.5,0], polygon=[…] }` and
  `[locations] table = { room="living_room", pose=[1.5,1.5,0], polygon=[…] }` —
  centroid poses correct, room auto-linked.
- Headless Chromium: app boots with no errors; Draw-panel toggle renders.

## Known limitations / notes

- Dragging a unified waypoint's handle moves the **pose** only (polygon is fixed at
  draw time); re-draw to change the boundary. Documented in the README.
- Two objects with the same label auto-suffix (`table_2`); rename freely in the inspector.

## Follow-up (same branch): right-click heading aim

Added on request — the unified area/object waypoints start at heading 0, so a quick
way to set heading was needed:

- **Right-click a waypoint** (including by clicking inside a room/footprint polygon)
  enters aim mode; the arrow follows the cursor (`heading = atan2(cursor − pose)`).
- **Any click** commits as one undoable `elem-mod`; **Esc** cancels (restores the
  original heading). Live angle shown in the status bar.
- Implemented in `input.js` (`aiming` state + `startAim`/`commitAim`/`cancelAim`,
  hooked into mousedown/mousemove/keydown). Inspector hint, in-app Help, cheat-sheet,
  and README updated.

## Not in this feature (later branches)

- Z height + full field editing in the properties panel (Feature 4).
- Main UI colour overhaul (Feature 5) and navigation polish (Feature 6).
