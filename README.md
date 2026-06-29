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

**Draw type & label** — before drawing a shape, pick a **type** and a **label**:

- **Type** is `area` or `object`, shown as the toolbar toggle and colour-coded
  (area = cyan, object = amber). `area` auto-maps to a `world.toml` **room**,
  `object` to a **location**.
- **Label** comes from that type's managed list (the toolbar dropdown). Manage the
  lists in the sidebar **Draw** panel — click a chip to make it active, `×` to
  remove, or type in the add box (`+`) to add a custom label. Defaults: area =
  `living_room`, `kitchen_room`, `bedroom`, `laundry`; object = `table`, `shelf`,
  `chair`, `sofa`, `tv`. Custom labels persist across sessions.

Each **label gets its own colour**, evenly spread within its type's family (area =
cool cyan→blue, object = warm red→amber→yellow), so labels are individually
distinguishable while still reading as their type at a glance. A drawn shape
carries its label colour on the canvas and as a swatch in the element list; the
chip dots in the Draw panel preview each label's colour. No-go zones are untyped.

**Shape** — store coordinates in **world meters**, resolution-independent.

| Tool | Click behaviour |
|---|---|
| Select | click an element to highlight it, then drag a yellow node handle to move that vertex |
| Point | single click places one point |
| Rect | press and drag two corners (preview shows the live bounding box) |
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
| Door | mark a *physical door*: click to place, **drag to aim the passage direction**. A door is a waypoint with role pre-set to `door`; it exports to `world.toml` `[doors]` and the robot's door-opening skill engages when it's within the door's trigger radius (the dashed ring on the canvas) |

A waypoint stores a full pose `(x, y, heading)`. Select it (Select tool or the
sidebar list) and fill the **Waypoint** inspector in the sidebar:

- **role** — dropdown: `room`, `location`, `door`, or `(not exported)`. Only
  `room`/`location`/`door` waypoints land in `world.toml` (as `[rooms.*]` /
  `[locations.*]` / `[doors.*]`).
- **name** — the canonical id (auto-snake_cased, e.g. `kitchen_table`); must be
  unique. The box is a **combo**: it suggests the challenge-contract names
  (role-aware — room names vs location names) so you pick them instead of
  mistyping, but you can still type any name (GPSR arena places are arbitrary).
- **room** (locations only) — dropdown of your room waypoints, so the
  location→room link can never dangle.
- **category** (locations only) — combo suggesting common categories + your
  existing labels. **placement** / **aliases** / **barrier** / **present** —
  see the [schema](#worldtoml--walkie-agent-v2-map).
- **heading °** — edit the facing angle numerically (degrees) if dragging
  wasn't precise enough. (For a `door` this is the **passage °**, display-only.)
- **radius m** (doors only) — the proximity-trigger radius: the robot asks for
  *this* door only inside this circle. Blank = the robot's global default
  (`WALKIE_DOOR_NEAR_RADIUS_M`, 1.5 m). The dashed ring previews it.

Re-aim a committed waypoint by re-drawing it with the Waypoint (or Door) tool.

> **Door vs. `barrier`.** A `door` is a geographic point — the robot engages its
> open-the-door routine when it's near one, on any route. The `barrier` flag on a
> room/location instead gates *by destination* (ask when nav to that place is
> blocked). Use a `door` for "there's a physical door here"; use `barrier` for
> "the way to this spot may be shut". They're independent — set either or both.

**Arena vocabulary (GPSR)** — a sidebar panel of structured row editors for the
non-spatial nouns GPSR grounds against:

- **Object categories** — each row is a category name + a comma-separated object
  list (e.g. `drinks` → `cola, water, milk`). The name box suggests common
  RoboCup categories.
- **Names** — one person name per row.
- **Gestures** — each row is a gesture name + comma-separated aliases.

Click **+** to add a row, **×** to remove one. Empty rows are ignored on export.
These round-trip through `_element.json` so re-exporting never loses them.

**Viewport**

- Mouse wheel — zoom at cursor
- Middle-drag, Alt-drag, or Ctrl-drag — pan
- **Fit** button — fit the whole map
- **Orig overlay** toggle — draws the pristine `_og.pgm` at 60% opacity on top of
  the edited map, so you can see exactly what you changed
- Red/green crosshair = world origin `(0, 0)`
- Bottom-left = grid step size in meters / centimetres
- The brush cursor outline is colour-inverted against the map, so it stays
  visible over both free (white) and occupied (black) space

**Tool shortcuts**

- `Shift`+`1`…`0` quick-select tools, in toolbar order: Pen, Eraser, Restore,
  Select, Point, Rect, Polygon, No-Go, Waypoint, Door (`Shift`+`0`) — the binding
  is shown in each tool button's tooltip.

**Command palette & navigation**

- **`Ctrl/Cmd`+`K`** or **`F1`** — open the command palette (toolbar **⌘K Search**
  button too). Fuzzy-search every tool, action, and view toggle (each shows its
  keybind), **jump to a drawn element** by `#id`/label (selects + zooms to it), or
  **set the active label**. `↑`/`↓` to move, `Enter` to run, `Esc` to close.
  `Ctrl/Cmd`+`Shift`+`P` also works in Chromium browsers (Firefox reserves it for a
  private window, so use `Ctrl/Cmd`+`K` / `F1` there).
- **`?`** — keyboard & mouse shortcuts cheat-sheet (toolbar **?** button).
- **`Ctrl/Cmd`+`B`** — collapse / expand the sidebar (toolbar **☰** button);
  remembered across sessions.
- **Load by drag-and-drop** — drop a map folder onto the canvas (an empty-state
  prompt shows when nothing is loaded).
- **Elements panel** — a filter box narrows the list by id/label/kind; the **⌖**
  button on a row zooms the view to that element; hovering a row highlights it on
  the canvas.

**History**

- Ctrl/Cmd + Z — undo
- Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z — redo

**Selection**

- Switch to **Select** tool, then click an element on the map
- Or click an item in the sidebar
- Yellow square handles appear on the selected element — drag one to move that
  vertex (point/waypoint = its position). **Drag the element's body** (its line or
  interior) to move the whole shape at once. The status bar at the bottom shows the
  element id and every node's world coordinates as you edit; each move is one undo
  step.
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

Click **Export**. The browser asks which directory to save into (e.g.
`~/map_download`). The editor creates a subfolder named
`<prefix>_export_<YYYYMMDD_HHMMSS>/` inside that chosen directory and writes
seven files into it. The `<prefix>` defaults to the **imported folder's name**
(editable in the toolbar prefix box).

| File | Content |
|---|---|
| `<prefix>_og.pgm` | original PGM (never mutated, kept for Restore) |
| `<prefix>.pgm` | edited PGM |
| `<prefix>.yaml` | Nav2 metadata, `image:` points at `<prefix>.pgm` |
| `<prefix>_element.json` | labels + elements + arena vocab (world coords) |
| `<prefix>_keepout.pgm` | white image with all no-go and `asNogo` areas filled black |
| `<prefix>_keepout.yaml` | Nav2 metadata for the keepout layer (same as `<prefix>.yaml`, `image:` points at `<prefix>_keepout.pgm`) |
| `<prefix>_world.toml` | named waypoints + vocab for `walkie-agent-v2` (see below) |

Before writing, the editor validates the `world.toml` data. Issues that would
make the file unparsable — two names that normalize to the same key (e.g.
`Kitchen`/`kitchen`, `soft drinks`/`soft-drinks`), in waypoints or vocab —
**block** the export, because a duplicate table/key makes the robot load *no*
map at all. Softer issues (a nameless place, a location pointing at an unknown
room, a name shared by a room and a location) are listed as warnings you can
confirm through.

Re-import the exported subfolder to round-trip — element geometry, waypoint
fields, and arena vocab are all preserved.

**Browsers without `showDirectoryPicker`** (Firefox, Safari) can't open an
OS folder picker from JavaScript, so they instead download a single
`<prefix>_export_<YYYYMMDD_HHMMSS>.zip` that unzips into the same folder with
all seven files inside. To choose *where* that zip lands, enable Firefox's
**Settings → General → Downloads → "Always ask you where to save files"** —
you'll get a Save-As dialog for the one download. For direct write-into-a-
folder, use Chrome / Edge / Brave (over `localhost` or HTTPS).

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

Output follows the **`world.rulebook_2026.toml`** structure: one `[rooms]` /
`[locations]` / `[doors]` table header, with **one inline table per entry**, and
every place carries both a `pose` and a `polygon`.

```toml
names = ["Charlie", "Alex"]      # person names (top-level; precedes all tables)

[rooms]
# pose = [x_m, y_m, heading_rad] (nav approach goal); polygon = room BOUNDARY
# ([[x,y], ...], map frame) — point-in-polygon answers "which room am I in".
kitchen     = { pose = [1.20, 3.40, 1.57], polygon = [[0,0],[4,0],[4,3],[0,3]], aliases = ["the kitchen"], barrier = true }
living_room = { pose = [0.50, 1.20, 0.00], polygon = [], present = false }   # present = false drops it

[locations]
# pose = furniture approach goal; polygon = its 2D FOOTPRINT (stamped into the costmap).
# room must match a [rooms.*] key, else the location is cascade-dropped.
kitchen_table = { room = "kitchen", placement = true, category = "dishes", pose = [1.0, 2.0, 0.0], polygon = [[0.6,1.6],[1.4,1.6],[1.4,2.4],[0.6,2.4]], aliases = ["dining table"] }

[object_categories]              # small objects (random positions; plain name lists)
drinks = ["cola", "water", "milk"]

[object_attributes]              # reference only — not read by the loaders
functional_types = ["tableware", "cutlery", "bag", "tray", "..."]
query_attributes = ["color", "size", "weight", "relative_position", "description"]

[doors]
# pose = [x_m, y_m, passage_heading_rad]; polygon = optional doorway region. The door
# skill checks "am I in the door area" by point-in-polygon and/or radius.
entrance     = { pose = [0.0, 0.0, 1.57], polygon = [], present = false }
kitchen_door = { pose = [2.8, 3.0, 0.0], polygon = [[2.5,2.8],[3.1,2.8],[3.1,3.2],[2.5,3.2]], radius = 1.5 }

# [object_instances] — runtime cache, filled by the detector (emitted commented-out).
# pringles.0 = { pose = [0,0,0], polygon = [], on = "cabinet" }

[gestures.waving]
aliases = ["waving person"]
```

- Keys (room/location/category/object/gesture names) are **snake_case**;
  `names` keep their human casing.
- `pose = [x, y, heading_rad]` is the nav **approach goal**; `polygon = [[x,y], …]`
  is the spatial **extent** (boundary / footprint / doorway). They're
  complementary — both are kept. Empty `polygon = []` = "not yet surveyed".
- `heading` is **radians**, REP-103 (`0` = +x / map east, CCW positive). The
  editor stores radians; the inspector shows degrees for convenience.
- `present = false` drops a place. `room` is optional — a location with no
  room is kept; only a location pointing at an **unknown / absent** room is
  cascade-dropped, and the pre-export check warns about that case.
- `[object_attributes]` and `[object_instances]` are **reference-only template
  tables** (the robot loaders ignore them); `[object_instances]` is emitted
  commented-out as the slot the perception loop fills at runtime.

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
      "polygon": [[x_m, y_m], "..."],
      "role": "room | location | door | \"\"",
      "name": "kitchen_table",
      "room": "kitchen",
      "category": "table",
      "aliases": ["dining table"],
      "placement": true,
      "barrier": false,
      "radius": null,
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
- **Firefox / Safari** lack `showDirectoryPicker`, so export falls back to a
  single `.zip` download (they can't pick a destination folder from JS).
- **Restore tool** requires `*_og.pgm` to revert to a pristine baseline.
  Without it, Restore reverts only to the as-loaded state of the editable PGM.
- **Vertex editing** moves existing vertices (Select tool, drag a handle) but
  doesn't add or delete vertices on a committed shape — delete and redraw to
  change the vertex count.
- Not profiled above ~5000 px on a side.

## Self-check

Open dev console and run `_test()` — round-trips a tiny PGM, parses a YAML
sample, rasterizes a square, and builds a `world.toml` from sample waypoints +
vocab (checking snake_case keys, the location→room link, radian heading, and
the vocab parsers). Logs `self-check ok` on success.
