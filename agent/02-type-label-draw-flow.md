# Feature 2 — type + label settings & draw flow

**Branch:** `feat/type-label-draw-flow` (off `feat/world-toml-rulebook-structure`)
**Status:** ready for review

## Goal

Replace the old "pick a tool, type a free label" flow with a structured
**Type → Label → Draw tool** flow, colour-coded for navigation.

## Decisions (confirmed with user)

- **Two types:** `area` and `object`, each with a managed label list (add/remove custom).
  - area defaults: `living_room`, `kitchen_room`, `bedroom`, `laundry`
  - object defaults: `table`, `shelf`, `chair`, `sofa`, `tv`
- **Auto-map:** area → `[rooms]`, object → `[locations]` (`roleForType` helper;
  the actual waypoint binding lands in Feature 3).
- **Colour tag per type:** area = cyan `#22d3ee`, object = amber `#f59e0b` —
  chosen to read over both white (free) and black (occupied) map pixels. Refined
  in the colour-overhaul feature.
- **Colour per label (added on request):** each label gets its own hue, evenly
  spaced inside its type's hue band, so labels are distinguishable but stay in the
  type family (area = cool cyan→blue, object = warm red→amber→yellow). The type
  theme (`TYPE_COLORS`) stays the section/toggle accent. Implemented as
  `labelHsl`/`colorForLabel`/`fillForLabel` in `state.js` (index-based even spread
  with a golden-ratio hash fallback for labels not in the set — pure hashing
  alone clustered near-identical hues). Applied on the canvas, the element-list
  swatch, and the Draw-panel chip dots.

## What changed

### `src/state.js`
- New constants: `LABEL_TYPES`, `DEFAULT_LABEL_SETS`, `TYPE_COLORS`, `TYPE_FILLS`,
  `roleForType`.
- New state: `labelSets` (per-type lists), `activeType`, `activeLabel` (per type).
  `state.labels` kept (still used by the waypoint category datalist + shape rename).

### `src/ui.js`
- Replaced the flat-label section with the type model: `currentType`,
  `currentLabel`, `setActiveType`, `setActiveLabel`, `addLabelToType`,
  `removeLabelFromType`, `colorForType`.
- `rebuildLabelSelect` now paints the Area/Object toggle + fills the label
  `<select>` for the active type, then refreshes the sidebar panel.
- New `rebuildDrawSettings` renders the sidebar **Draw** panel (per-type chips,
  click-to-select, `×`-to-remove, add-label input).
- `saveLabels`/`loadLabels` persist `{ sets, active, labels }` under
  `walkie-label-sets`.
- Element-list rows show a colour swatch for typed shapes.

### `src/input.js`
- Point/Rect/Polygon creation now tags `semType: currentType()` and uses the
  active label. No-go zones stay untyped.

### `src/render.js`
- Drawn shapes use the per-type stroke/fill colour (`TYPE_COLORS`/`TYPE_FILLS`);
  legacy/untyped shapes stay cyan.

### `src/io.js`
- `normalizeElement` round-trips `semType` (`'area'|'object'`, else undefined), so
  `_element.json` re-import preserves the type.

### `src/commands.js`
- "Set label" palette command now lists `type: label` entries and runs
  `setActiveType` + `setActiveLabel`.

### `index.html` / `style.css`
- Toolbar: Area/Object segmented toggle. Sidebar: **Draw** panel.
- Styles for the toggle, draw panel, chips, and element-list swatch.

### `README.md`
- New "Draw type & label" subsection.

## Verification

- `node --check` passes for every changed module.
- Pure self-check still logs `self-check ok`.
- Headless Chromium render: full UI initialises with no JS errors; toolbar toggle,
  type-driven label dropdown, and colour-coded sidebar chips all display correctly.

## Not in this feature (later branches)

- Force-create a waypoint at the drawn area's centre + bind the shape into the
  waypoint `polygon` (Feature 3 — the auto-map actually produces rooms/locations there).
- Z height + full field editing in the properties panel (Feature 4).
- Main UI colour overhaul (Feature 5).
