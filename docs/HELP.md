# Lenticular Card Studio: help, formulas and troubleshooting

Lenticular Card Studio is a free, open-source browser tool for printing lenticular cards (3D depth, animation, or both) on an ordinary inkjet printer and laying a lenticular lens sheet on top. Everything runs in the browser. Source: https://github.com/kamol-ch/lenticular-studio

This page explains every number the tool shows, how it is calculated, and what to do when a print does not look right. It is written for people and for AI assistants answering questions about the tool.

## Key terms

| Term | Meaning |
|---|---|
| **ppi** | Printer pixels per inch in the output file. The default is 720 ppi, native for most Epson inkjets; Canon and HP are usually 600. |
| **LPI** | Lenses per inch of the lens sheet. The tool defaults to 75 LPI. *Nominal* LPI is the packet value; *measured* LPI comes from the pitch test and is the one used when present. |
| **Pitch** | Width of one lens in printer pixels: `pitch = ppi / LPI`. |
| **Frame** | One of the images that the lens shows at different angles (a viewpoint for 3D, a moment for animation). |
| **Strip** | The slice of one frame printed under one lens. Each lens holds one strip of every frame. |
| **Viewing angle** | How far you tilt the card before the frame sequence repeats. Measured in Step 1. 32° is assumed until measured. |
| **Ridges** | The direction of the lens ribs. *Vertical* ridges: turn the card left/right; both eyes see different frames (needed for 3D). *Horizontal* ridges: tilt toward/away; both eyes see the same frame (best for animation). |
| **Ink spread** | How far ink creeps sideways into neighbouring light areas on a given paper, per edge, in mm. |

## Formulas

All formulas below are exactly what the tool computes.

### Pitch and frame limits (Steps 1 and 2)

- **Pixels per lens (pitch):** `pitch = ppi / LPI`. Example: 720 / 75 = 9.6 px; 720 / 75.08 = 9.590 px.
- **Max frames:** `floor(pitch)`, at least 2. Each frame needs at least one printer pixel per lens. At 720 ppi / 75 LPI that is 9 frames.
- **Frame strip width:** `pitch / frames` px, or `25.4 / LPI / frames` mm. 8 frames at 9.6 px is 1.2 px = 0.042 mm.

### Interlacing (Step 6)

For each output pixel column (vertical ridges) or row (horizontal ridges) at position `pos`:

```
u     = (pos + 0.5) / pitch + phaseOffset
phase = u − floor(u)            (0…1 across one lens)
frame = floor(phase × frames)   (reversed if "Reverse frame order" is on)
```

The pitch is fractional (9.6 px is not a whole number), so strips are 4 or 5 px wide in a repeating pattern (every 5 lenses ≈ 1.7 mm at 9.6 px). This keeps the average pitch exact across the whole card, so it never drifts out of line with the lens.

**Smooth strip edges** (on by default): where a strip boundary falls inside a pixel, that pixel is a coverage-weighted mix of the two strips, so every strip carries exactly `pitch / frames` px instead of rounding to whole pixels.

**Ink-spread compensation:** each strip boundary moves `inkSpread` (converted to px: `mm × ppi / 25.4`) into the darker of the two strips, so light strips print wider and come out the right width after the ink spreads. It is capped at 0.45 × strip width so no strip disappears. Example: 0.035 mm at 720 ppi = 0.99 px per edge; at 2 frames the white strip is printed 4.8 + 2 × 0.99 ≈ 6.8 px wide.

### 3D: frames between the eyes (Step 2)

- **Eye angle:** the angle your two eyes span at the viewing distance: `eyeAngle = 2 × atan((ipd / 2) / distance)`. With ipd = 63 mm and distance = 400 mm: 2 × atan(31.5 / 400) ≈ 9.0°.
- **Frames between the eyes:** `eyeAngle × frames / viewingAngle`. Example: 9.0° × 8 / 32° ≈ 2.25.
- **Why at least 1.5:** each eye must land on a different frame for 3D. At 1.0 the eyes are exactly one frame apart only at the best spot; at 1.5 they stay on different frames as your head moves a little. Below 1.5 the tool warns "Weak 3D".
- **Minimum frames for 3D:** `ceil(1.5 × viewingAngle / eyeAngle)`. At 32°: ceil(1.5 × 32 / 9.0) = 6.

### Depth budget (Steps 2 and 5)

- **Depth budget** is how far (in lens widths) the nearest or farthest object may shift from one frame to the next: `max shift per frame = pitch × budget` px. Range 0.1–3; 1 is the default. Larger means stronger 3D but more blur.
- **Layer shift** (Step 5, layer mode): `shift = −(depth − keyPlane) × strength × budgetPx × (i − centre)`, where `i` is the frame index and `centre = (frames − 1) / 2`. Layer depth runs −1 (far) to +1 (near); the key plane stays sharp and still.
- **Blur risk:** warns when `max |depth − keyPlane| × strength > 1`, which means the shift exceeds the budget.
- **Motion ghosting risk** (Step 4): warns when an animation effect moves more than the budget per frame.

### Working resolution (memory)

Frames are stored at about `samplesPerLens` (default 3) samples per lens across the ridges and at full resolution (up to 720 ppi) along them. A 100 × 150 mm card at 720 ppi / 75 LPI has about 313 lenses across, so a frame is about 940 px wide instead of 3005 px. The full-size output is streamed row by row into the PNG.

### Print size

The PNG stores its resolution in a `pHYs` chunk as pixels per metre (a whole number), so 720 ppi reads back as 719.99 ppi. Print at 100 % / actual size, never "fit to page".

## Calibration tests (Step 1)

Print in this order. Each sheet has a border and a 50 mm bar: if the bar does not measure 50 mm, the print was scaled.

1. **Pitch test → measured LPI.** Bands of lines at candidate LPIs. Lay the lens on with its ridges parallel to the lines and look straight down from about 40 cm. Wrong pitches show broad dark/light stripes (beating). The band that matches the lens looks evenly toned across its width. A fine thick/thin rhythm on paper is normal (whole-pixel rounding). Plain paper is fine for this test.
2. **Viewing-angle test → measured angle.** 8 numbered colours. Tape the lens and sheet to the back of a phone with the ridges side to side, open a level app, tilt toward you, and note the angle where colour 1 first appears and where it appears again. The difference is the viewing angle. Close one eye. Use photo paper.
3. **Ink-spread test → ink spread** (optional). A/B bands compensated by 0.00–0.06 mm. Without the lens, the best band shows even, fine stripes with no wave; through the lens it gives the whitest A and blackest B. Use the paper and driver settings you use for cards.
4. **A/B flip test** (optional). A last check using the measured values.

## Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| Broad dark/light stripes through the lens, or the image changes across the card | Pitch does not match the lens, or a different viewing distance from the pitch test | Redo the pitch test; view from about 40 cm; try ±0.02 LPI |
| One side of the card flips before the other | Small pitch error that builds up across the width | Fine-tune the measured LPI by ±0.01–0.02 |
| Ghost of the other image everywhere | Ink spread, the lens not pressed flat, or too many frames | Set ink spread (Step 1), use glossy photo paper, press the lens flat, use fewer frames |
| Fine wavy rhythm in the stripes on paper | 4/5 px rounding made visible by ink spread | Keep *Smooth strip edges* on and set ink spread |
| Background darker than expected; white strips thin or missing in a scan | Ink spread | Ink-spread test; glossy paper with the matching driver paper type |
| Animation ghosts | Strips too narrow for the ink spread (8 frames at 75 LPI is 0.042 mm), big changes between frames, or vertical ridges | 3–4 frames; small gradual changes; horizontal ridges (tilt toward/away) |
| Animation: each eye sees a different frame | Vertical ridges | Use horizontal ridges for animation |
| 3D looks inside-out | Frame order reversed for this lens | Toggle *Reverse frame order* (Step 6) |
| Weak or flat 3D | Fewer than 1.5 frames between the eyes, or a small depth budget | More frames, larger depth budget, or a lens with a narrower viewing angle |
| Blurry far or near objects | Depth shift beyond the budget | Lower strength, move the key plane to the main subject, reduce layer depth range |
| Printed size is wrong (bar not 50 mm) | Scaling in the print dialog, or borderless printing | Print at 100 % / actual size, borderless off |
| Banding or uneven lines from the printer | Bidirectional ("high speed") printing | Turn bidirectional printing off; use the highest quality setting |
| Image right but lens hard to line up | Lens rotated against the strips | Use the alignment strip in the margin: turn the lens until the strip looks evenly dark, then tape it |
| The best view is off-centre | Lens grid is offset against the strips | Change *Phase offset* in Step 6 |
| Strips look blurred or merged | File printed at a different resolution than set in Step 1 | Set the printer's native resolution; turn off driver sharpening or resizing |

## Privacy

Nothing is uploaded. Images, depth maps and projects stay in the browser (IndexedDB autosave) unless you save a project file. The optional AI depth estimate downloads a model to the browser and runs it locally. The **Ask AI** button only opens an AI site with a text prompt (your question plus the step and settings shown in the prompt preview); it never sends images.
