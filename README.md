# Walkie Map Editor

Static web tool to post-process Nav2 SLAM maps: erase/draw pixels, label
furniture, mark no-go zones, export a Nav2-ready keepout layer — **and place
named room/location waypoints + arena vocabulary, exported as a `world.toml`
for [`walkie-agent-v2`](https://github.com/EIC-Robocup-2026/walkie-agent-v2)**
(the on-robot brain). One arena file then drives every challenge (GPSR,
Restaurant, HRI, Laundry, PickAndPlace) — see [world.toml](#worldtoml--walkie-agent-v2-map).

Live: https://map-editor-two-eta.vercel.app

## Run locally

No build, no install. Static files only.

```bash
cd walkie-navigation/map-editor
python3 -m http.server 8080
```

Open <http://localhost:8080>. Chrome / Edge / Brave recommended for
- `webkitdirectory` folder picker
- `showDirectoryPicker()` write-to-disk export

## Load a map

Click **Load folder** and pick a folder containing:

| File | Required | Notes |
|---|---|---|
| `*.pgm` | yes | P5 (binary) Nav2 map |
| `*.yaml` | yes | Nav2 map metadata |
| `*_og.pgm` | no | original-pristine PGM, used by Restore tool |
| `*_element.json` | no | previously saved elements + custom labels |

`*_keepout.pgm` is ignored on load (regenerated on export).

## Tools

**Pixel** — operate on the raster image, brush slider on the toolbar.

| Tool | Effect |
|---|---|
| Pen | paint occupied (black, value 0) |
| Eraser | paint free (white, value 254) |
| Restore | revert pixels to the value in `_og.pgm` |

- Brush `1` paints exactly one pixel. `2+` is a filled disk of that diameter.
- Fast mouse moves are interpolated, so a straight drag draws a continuous
  line (no gaps).

**Shape** — store coordinates in **world meters**, resolution-independent.

| Tool | Click behaviour |
|---|---|
| Select | click an element on the map to highlight it |
| Point | single click places one point |
| Rect | press and drag two corners |
| Polygon | left-click adds vertex; click near start to close |
| No-Go | polygon tagged as `nogo`, exported into `*_keepout.pgm` |

Closed polygons or rectangles can ALSO be flagged as no-go without changing
their label: select the element in the sidebar and click the **nogo** button.
The shape keeps its original label, and its area is rasterized into
`*_keepout.pgm` alongside dedicated no-go polygons.

A dashed rubber-band line follows the cursor while drawing.

**Map** — named waypoints that become the robot's `world.toml` places.

| Tool | Click behaviour |
|---|---|
| Waypoint | click to place the robot's stand position, then **drag to aim its heading** (release commits) |

A waypoint stores a full pose `(x, y, heading)`. Select it (Select tool or the
sidebar list) and fill the **Waypoint** inspector in the sidebar:

- **role** — `room`, `location`, or `(not exported)`. Only `room`/`location`
  waypoints land in `world.toml`.
- **name** — the canonical id (auto-snake_cased, e.g. `kitchen_table`); must be
  unique.
- **room** (locations only) — dropdown of your room waypoints, so the
  location→room link can never dangle.
- **category** / **placement** (locations only), **aliases**, **barrier**,
  **present** — see the [schema](#worldtoml--walkie-agent-v2-map).
- **heading °** — edit the facing angle numerically (degrees) if dragging
  wasn't precise enough.

Re-aim a committed waypoint by re-drawing it with the Waypoint tool.

**Viewport**

- Mouse wheel — zoom at cursor
- Middle-drag, Alt-drag, or Ctrl-drag — pan
- **Fit** button — fit the whole map
- Red/green crosshair = world origin `(0, 0)`
- Bottom-left = grid step size in meters / centimetres

**History**

- Ctrl/Cmd + Z — undo
- Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z — redo

**Selection**

- Switch to **Select** tool, then click an element on the map
- Or click an item in the sidebar
- Double-click a sidebar item to rename the label (Enter commits, Esc cancels)
- `Delete` / `Backspace` — remove the selected element
- `×` in the sidebar — remove that element

**Visibility filters**

Two filter panels in the sidebar — **Label** and **Drawing kind**. Untick to
hide matching elements from the canvas and dim them in the list. Hidden
elements are not click-selectable but stay in the export.

The **IDs** checkbox in the Elements summary toggles `#id` tags on the canvas.

Closing the tab with unsaved edits triggers a browser confirm. Export first
to silence it.

## Export

Click **Export**. The browser asks where to save. The editor creates a
subfolder named `<prefix>_YYYYMMDD_HHMM/` inside the chosen directory and
writes six files into it:

| File | Content |
|---|---|
| `<prefix>_og.pgm` | original PGM (never mutated, kept for Restore) |
| `<prefix>.pgm` | edited PGM |
| `<prefix>.yaml` | Nav2 metadata, `image:` points at `<prefix>.pgm` |
| `<prefix>_element.json` | labels + elements + arena vocab (world coords) |
| `<prefix>_keepout.pgm` | white image with all no-go and `asNogo` areas filled black |
| `<prefix>_world.toml` | named waypoints + vocab for `walkie-agent-v2` (see below) |

Before writing, the editor checks the `world.toml` data (missing/duplicate
names, a location pointing at an unknown room) and, if anything would be
silently dropped on the robot, lists it and asks to confirm.

Re-import the exported subfolder to round-trip — element geometry, waypoint
fields, and arena vocab are all preserved.

**Browsers without `showDirectoryPicker`** (Firefox, Safari) fall back to
individual downloads, each prefixed with the folder name so you can group
them manually.

## `world.toml` — walkie-agent-v2 map

The contract with the robot. `walkie-agent-v2` reads this through
`tasks/skills/locations.py` (rooms/locations, used by Restaurant / HRI /
Laundry / PickAndPlace) and `tasks/GPSR/world.py` (+ object categories / names
/ gestures, used by GPSR). Give it to the robot one of two ways:

- **Zero config (recommended):** drop the file in as `tasks/GPSR/world.toml`
  (rename `<prefix>_world.toml` → `world.toml`). Both resolvers fall back to
  that sibling, so every challenge picks it up with no env var.
- **By env var:** `GPSR_WORLD_FILE=/path/to/<prefix>_world.toml`. This is the
  one var **both** resolvers honour, so it covers all five challenges (no
  rename needed).

> ⚠️ Do **not** use `WALKIE_MAP_FILE` for this. GPSR's `load_world()` reads
> only `GPSR_WORLD_FILE`/the sibling, so `WALKIE_MAP_FILE` updates the four
> location-based challenges but leaves **GPSR reading the stale old map**.
> Treat `WALKIE_MAP_FILE` as a 4-challenge-only override.

```toml
names = ["Charlie", "Alex"]      # person names (top-level; precedes all tables)

[rooms.kitchen]
pose = [1.20, 3.40, 1.57]        # [x_m, y_m, heading_rad], map frame (heading in RADIANS)
aliases = ["the kitchen"]        # optional
barrier = true                   # optional — a human-operated door/partition blocks the route
# present = false                # optional — drop a place not in the running arena

[locations.kitchen_table]
room = "kitchen"                 # must match a [rooms.*] key, else the location is dropped
pose = [1.00, 2.00, 0.00]
placement = true                 # optional — a surface you can put objects on
category = "table"               # optional
aliases = ["dining table"]

[object_categories]
drinks = ["cola", "water", "milk"]

[gestures.waving]
aliases = ["waving person"]
```

- Keys (room/location/category/object/gesture names) are **snake_case**;
  `names` keep their human casing.
- `heading` is **radians**, REP-103 (`0` = +x / map east, CCW positive). The
  editor stores radians; the inspector shows degrees for convenience.
- `present = false` and a location whose `room` is missing are **dropped**
  by the robot — the pre-export check warns about the latter.

## `_element.json` format

```json
{
  "labels": ["table", "shelf", "..."],
  "elements": [
    {
      "id": "e1",
      "label": "shelf",
      "type": "rect | polygon | point | nogo | waypoint",
      "closed": true,
      "asNogo": false,
      "coords": [[x_m, y_m], ...],

      "// waypoint-only fields": "present when type == waypoint",
      "heading": 1.57,
      "role": "room | location | \"\"",
      "name": "kitchen_table",
      "room": "kitchen",
      "category": "table",
      "aliases": ["dining table"],
      "placement": true,
      "barrier": false,
      "present": true
    }
  ],
  "vocab": {
    "object_categories": { "drinks": ["cola", "water"] },
    "names": ["Charlie"],
    "gestures": { "waving": ["waving person"] }
  }
}
```

`coords` are in the map frame (Nav2 world coords, Y-up, meters); `heading` is
radians. `vocab` round-trips the GPSR arena vocabulary so re-exporting a map
never loses hand-entered names/categories/gestures. This file is the editor's
own save format; the robot consumes `world.toml`.

## Known limitations

- **Safari** has weak `webkitdirectory` support. Fallback: shift/cmd-click to
  pick the files individually in the folder dialog.
- **Firefox / Safari** lack `showDirectoryPicker`, so export falls back to
  five separate downloads.
- **Restore tool** requires `*_og.pgm` to revert to a pristine baseline.
  Without it, Restore reverts only to the as-loaded state of the editable PGM.
- **Vertex editing** after a polygon is committed is not supported — delete
  and redraw.
- Not profiled above ~5000 px on a side.

## Self-check

Open dev console and run `_test()` — round-trips a tiny PGM, parses a YAML
sample, rasterizes a square, and builds a `world.toml` from sample waypoints +
vocab (checking snake_case keys, the location→room link, radian heading, and
the vocab parsers). Logs `self-check ok` on success.
