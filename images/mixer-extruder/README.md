# Complete blender and extruder SVGs

`mixer-extruder-front.svg`, `mixer-extruder-intermediate.svg` and `mixer-extruder-angled.svg` combine the corrected batch blender and its matching flat-shaded extruder at 0°, 30° and 60°. The transparent SVGs contain both machines as editable vector groups, with no embedded bitmaps or external references.

The blender masters come from `images/mixer/`; the matching blue-gray extruders come from `station/assets/extruder-*.svg`. The blender is scaled by 0.42 to fit the extruder feed. Both connection anchors meet at `(0, 0)`. All three assemblies share a vertical viewBox and scale; use equal image heights and automatic widths. The root's `data-inlet-*` describes the blender inlet and `data-outlet-*` describes the die-facing extruder outlet.

`data-component="blender"` and `data-component="extruder"` identify the groups. Mirror the whole assembly for left-hand views. IDs are unique within each asset and within the supplied 1/3/5-layer compositions. Prefix IDs again if you insert multiple copies of the same SVG inline; `<img>` instances are automatically isolated.

Open `index.html` for the three downloads and switchable layer previews. `preview.svg` is the vector contact sheet; `preview.png` is its convenience raster preview.

Regenerate after updating the source assets:

```sh
python tools/mixer-svg/assemble.py
```

This assembles the existing artwork without changing the individual machine masters or the station application.
