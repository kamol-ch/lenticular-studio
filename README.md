# Lenticular Card Studio

A browser tool for making lenticular cards (3D depth, animation, or both) from watercolor scans. It works with any inkjet printer and lens: you calibrate the lens pitch with a printed test sheet, and the defaults are 720 ppi and a 75 LPI lens. Everything runs locally in the browser and nothing is uploaded.

## Run it

ES modules and module workers need `http://`, so serve the folder instead of opening `index.html` directly:

```sh
npm start            # zero-dependency static server → http://localhost:8080
# or: python -m http.server 8080
```

There is no build step and no `npm install`. The browser loads two libraries from a CDN:

- **JSZip 3.10.1** (cdnjs) for project and step bundles.
- **transformers.js 3.0.2** (jsDelivr). It loads only when you click *Estimate with AI*. The first run downloads the Depth Anything V2 small model, which the browser then caches.

Use a current Chrome, Edge, Firefox or Safari (16.4 or later).

## Editor layout

Steps 2, 3 and 6 use a three-pane editor: the step list, a canvas in the middle and an inspector on the right. The canvas is drawn in millimetres, so the paper, card, bleed and marks are shown at scale. Scroll to zoom, drag the background to pan, double-click to fit, and use **Guides** to hide the overlays. The other steps still use the page layout and will move over in later phases.

## Workflow

| Step | What it does | Import / export |
|---|---|---|
| 1. Printer & lens | Calibration, once per lens: printer resolution → paper size → nominal LPI (+ lens sheet size) → pitch test → measured LPI → viewing-angle test → measured angle → optional A/B flip check. Test sheets match the lens sheet (100 × 150 mm if unknown), clamped to the paper. | `lens-profile.json`, test PNGs |
| 2. Card & frame plan | Effect (3D / animation / both) → ridge direction, card size + bleed, frames. Shows pixels per lens, frames between the eyes, depth budget, working frame size and memory. Warns about weak 3D, too many frames, blur or ghosting risk, and cards that don't fit the lens sheet or paper. | `plan.json` |
| 3. Images | Upload a scan or PNG layers. Drag to move, scroll to resize, reorder, set opacity and per-layer depth. | `source.zip` |
| 4. Animation *(optional)* | **Simple motion** on a layer or a painted mask (drift, bob, sway, scale, fade in/out, flicker, with easing). **Video clip**: pick start/end, extract N frames, optional ping-pong and drift alignment. Looping preview. | `animation.zip` |
| 5. Depth & 3D *(optional)* | **Layer mode**: shift = (depth − key plane) × strength × budget × (frame − centre). **Depth-map mode**: AI estimate, from layers, or flat. Brush near/far/smooth, plus edge cleanup. Forward warp with z-ordering and background-stretch gap fill. Wiggle and red/cyan anaglyph previews. | `depth.png`, `frames.zip` |
| 6. Slice & interlace | Fractional-pitch interlacing, reverse order, crop marks and registration strips, tiling on the Step 1 paper with one continuous lens grid, phase offset. 1:1 zoom preview and tilt simulator. | `interlaced.png` (with pHYs ppi) |
| 7. Print & mount | Printer checklist (bidirectional OFF), mounting steps, troubleshooting. | |

**Save project** writes everything to one `project.zip` (see plan §4). **Open…** restores it. **New** keeps your Step 1 calibration.

## How the output stays accurate

- **Interlace mapping** ([js/core/interlace.js](js/core/interlace.js)): for each output column (vertical ridges) or row (horizontal ridges), `u = (pos + 0.5) / pitch + phaseOffset`, and the frame is `floor(frac(u) × N)`, reversed if needed. Pitch is fractional (9.6 px at 720 ppi / 75 LPI, or 9.5898… at a measured 75.08 LPI), so it never drifts across the card. Tiled cards and registration strips use page coordinates, so one lens sheet lines up with all of them.
- **Memory**: frames are stored at a *working resolution*: about 3 samples per lens along the interlace axis and full resolution along the other. A 100 × 150 mm frame is about 940 × 4422 px instead of 3005 × 4422. The worker samples frames row by row and streams rows into a PNG encoder through `CompressionStream`, so the full-size image never exists as a canvas.
- **Print size**: every exported PNG carries a `pHYs` chunk. PNG stores pixels per metre as a whole number, so 720 ppi is saved as 28 346 px/m, which reads back as 719.99 ppi.

## Code layout

```
index.html, css/app.css
js/main.js             wizard shell, sidebar, editor shell, project open/save
js/stage.js            zoomable canvas (mm units, pan/zoom, guides)
js/scene.js            card-on-paper layout and overlays for the canvas
js/store.js            state (JSON, saved to localStorage) + in-memory assets
js/core/               pure, DOM-free logic (unit-tested in Node)
  geometry.js          mm/px, pitch, bleed box, working frame size, paper tiling, test-sheet size
  planner.js           Step 2 maths and warnings
  interlace.js         index maps, page layout, marks, row renderer, tilt mapping
  png.js               streaming PNG encoder, pHYs, chunk reader
  motion.js            effect curves
  warp.js              forward warp with z-buffer + background stretch
  depthmap.js          brushes, blur, dilate, resample
  sequence.js          ping-pong order, frame times, alignment search
  schema.js            defaults, normalisation, step slices
js/workers/pixel-worker.js   interlace + encode, zoom crop, depth warps
js/compose.js          layer compositing with motion / depth shifts
js/pipeline.js         build final frames, import frames, interlace calls
js/testsheets.js       pitch / angle / flip test sheets
js/project-io.js       project.zip and per-step bundles
js/steps/s1…s7         step UIs
```

## Tests

```sh
npm test
```

There are 25 Node tests. They cover the interlace mapping (hand-computed indices at 9.6 px, reverse order, measured fractional pitch, horizontal ridges, marks margin and strips, A4 tiling), exact output dimensions, the PNG encoder for all filters (decoded with zlib and checked pixel by pixel, CRCs and ppi), the planner warnings, motion curves, warp behaviour, depth-map tools, the alignment search, state round-trips and migration of older projects.

Print tests with the real lens, in order: pitch test → viewing-angle test → 2-frame flip → 3D.

## Known limitations

- Motion on a *painted mask* fills the uncovered area with a soft blur of its surroundings. This works for small motions. Large moves need a separate layer.
- Depth-map brush strokes have no undo yet. Export `depth.png` before heavy edits.
- Video decoding uses the browser's codecs. If a clip won't load, re-encode it to H.264 MP4.
- 1440 ppi works, but frames along the non-interlace axis are capped at 720 ppi to save memory.
