# Feature 7 — area dimensions, door radius drag, measure tool

**Branch:** `feat/measure-door-dims` (off `feat/nav-polish`)
**Status:** ready for review

Three drawing-tool additions requested together.

## 1. Width × height in Properties (on select)
- **Revised per review:** the first cut drew a live `W × H` label on the canvas
  while dragging — the user wanted it in the **Properties panel on select** instead.
  Removed the canvas label (`drawDimsLabel`) and the rect-drag status text.
- A read-only **`size` row** (`W × H m`, from the polygon bounding box) now shows in
  the Properties panel for any selected place that has a polygon (areas/locations),
  and a non-waypoint shape's readout shows its extent (`ui.js`).

## 2. Door tool — radius by drag + draggable ring
- **On placement:** dragging a door now sets BOTH the passage heading (drag
  direction) AND the trigger radius (drag distance). The dashed ring previews it
  live (`input.js` waypoint-drag branch, door-only).
- **Resize later:** with a door selected, grabbing its dashed ring drags the radius
  (`radiusDrag` state; `nearDoorRing()` hit-test; `ew-resize` cursor). Commits as one
  undoable `radius` change.

## 3. Measure tool
- New `measure` tool (toolbar ruler icon; `TOOL_ORDER` → Shift+`-`). Drag a line to
  read its length in metres — gold line + endpoint ticks + `N.NN m` label
  (`render.js` `drawMeasure`). Display-only, never exported; `Esc` clears it.
- `state.measure = { a, b }` (world metres); `measuring` drag flag in `input.js`.

## Shared
- `render.js` `worldText()` — haloed world-space label helper (used by dims +
  measure), consistent with Feature 5's high-contrast casing/halo.

## Files
- `state.js` (TOOL_ORDER + `measure` state), `index.html` (ruler icon + Measure
  button + Help), `render.js` (worldText/drawDimsLabel/drawMeasure + draw wiring),
  `input.js` (measure tool, door radius drag/resize, rect dims status),
  `ui.js` (shape extent readout), `commands.js` (tool titles), `cheatsheet.js`,
  `README.md`.

## Verification

- `node --check` clean; self-check passes.
- Headless render: in-progress rect shows `2.00 × 1.80 m`; a door renders its
  dashed radius ring; the measure line shows `2.00 m`; ruler tool visible in the
  toolbar. No JS errors.
