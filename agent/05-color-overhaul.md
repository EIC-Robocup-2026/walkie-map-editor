# Feature 5 — colour overhaul

**Branch:** `feat/color-overhaul` (off `feat/properties-panel`)
**Status:** ready for review

## Goal

1. Apply the requested **oklab brand palette** to the whole UI as a token system.
2. Make **canvas elements legible over the black/white occupancy map**.

## What changed

### `style.css` — token system
- New `:root` palette (verbatim oklab values):
  `--text`, `--bg`, `--primary`, `--secondary`, `--accent`.
- Derived tokens via `color-mix(in oklab, …)`: `--surface-1..4` (panels/buttons/
  hover), `--sunken` (inputs/code), `--border`/`--border-soft`, `--text-dim`/
  `--text-mute`, `--canvas-bg`, `--accent-soft`, `--on-accent`, `--danger`.
- Replaced every hard-coded grey/blue (`#1e1e1e`, `#2a2a2a`, `#2563eb`, …) with
  tokens across toolbar, sidebar, element list, filters, inspector, vocab editor,
  status bar, command palette, cheat-sheet, and the draw/type/chip styles.
- Active/selected states now use `--accent` with `--on-accent` text; added a
  visible `:focus-visible` outline (accessibility floor).

### `src/render.js` — high-contrast canvas
- New `casedStroke()` draws a dark casing under each coloured stroke, so shapes,
  waypoint polygons, the pose arrow, and points stay visible over white free space
  AND black walls. Arrowhead + dot get a thin dark outline too.
- Element labels get a dark **text halo** (`strokeText` under `fillText`).
- Per-label colours (from Feature 2) are unchanged — the casing/halo is what
  guarantees contrast regardless of what's underneath.

## Verification

- `node --check` clean; self-check passes.
- Headless render (oklab theme): cohesive dark-teal UI, mint accent on active tool /
  selected row / toggles; chips keep their per-label colours.
- Headless render over a synthetic **white-field + black-rectangle** map: the room
  outline crosses white↔black and stays visible; the selected (yellow) table reads
  over black; `#e3 shelf`'s label reads over white — casing + halo confirmed.

## Notes

- `oklab()` and `color-mix(in oklab, …)` are used directly (supported in the
  Chromium targets the tool recommends; `color-mix` was already in use from Feature 2).
- Canvas element hues (selection yellow, role/label colours) were kept; only the
  legibility scaffolding (casing/halo) was added, so existing colour semantics hold.

## Not in this feature

- Navigation polish (Feature 6).
