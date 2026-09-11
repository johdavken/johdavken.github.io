# Batch mixer SVGs

Three matching views of the supplied workplace batch mixer, with the flat blue-gray palette used by the adapted station extruders. The paired inspection windows, hinged circular cover, open frame, weighing hopper, amber rim, pneumatic regulator and bottom outlet carry its identity at small sizes.

| View | Station palette | Neutral steel |
| --- | --- | --- |
| 0° front | `mixer-front.svg` | `steel/mixer-front.svg` |
| 30° photo angle | `mixer-intermediate.svg` | `steel/mixer-intermediate.svg` |
| 60° outer angle | `mixer-angled.svg` | `steel/mixer-angled.svg` |

The 30° yaw approximates the supplied photograph. The other views use the same geometry at 0° and 60°, with the extruder study's shared 12° camera elevation. Unseen dimensions, rear frame and inlet arrangement are inferred from the single photograph; this is a UI illustration, not a dimensional equipment drawing.

Open `index.html` to compare palettes and see the mixers connected to the existing screw artwork in 1-, 3- and 5-layer review layouts. `preview.svg` and `steel/preview.svg` are self-contained vector contact sheets. `layers-{1,3,5}.svg` are self-contained assembly previews; their screw artwork is copied from the existing station assets during generation. No live station code is changed.

## Placement and editing

- Individual assets have transparent backgrounds; no gradients, filters, raster images, scripts, fonts or external dependencies.
- All views share a **469-unit viewBox height**. Use the same image height and automatic width to preserve scale between angles.
- The center of the bottom discharge is **(0, 0)**, also recorded as `data-outlet-x` and `data-outlet-y`. Align that point with the screw's feed anchor. The inlet center is recorded in `data-inlet-x` and `data-inlet-y`.
- Mirror the left machines with `scaleX(-1)` when used as images, or with `scale(-1 1)` around the outlet anchor when inline. Suggested views: `0°`; `−30°, 0°, +30°`; `−60°, −30°, 0°, +30°, +60°`.
- Named `data-assembly` groups separate the frame, chamber, inspection cover, weighing hopper, outlet, air controls and inlet chutes. `data-part` and color classes identify individual surfaces. Inline CSS can override `.mixer__front`, `.mixer__side`, `.mixer__top`, `.mixer__steel`, `.mixer__accent`, etc. Stroke colors are explicit presentation attributes.
- Repeated inline SVG instances should receive unique title/description IDs and matching `aria-labelledby` references. Ordinary `<img>` instances are isolated automatically.

## Regeneration

Run `python tools/mixer-svg/generate.py` from the repository root (Python standard library only). This regenerates the six mixer SVGs, vector contact sheets and assembly previews. It reads `station/assets/extruder-*.svg` for assembly previews but never changes those assets. Then run `node tools/station-mixer/derive.js` to update the station's simplified mixer SVGs and renderer data from the corrected masters.

The chamber and entire inspection-cover assembly sit behind the front posts, within the frame. The three valves share evenly spaced mounting points on the top crossmember; their bevel-cut mouths face along the beam's front plane. These positions are shared model coordinates, not per-angle offsets. Run `python tools/mixer-svg/test_geometry.py` to check frame clearance, valve alignment and exported projections.

PNG contact sheets are convenience previews, rendered separately from the SVGs using the repository's `sharp` package.
