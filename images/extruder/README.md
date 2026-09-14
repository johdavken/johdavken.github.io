# Extruder SVG assets

Three views of the enclosed screw beneath a mixer, based on the supplied equipment photographs. The yaw angles are illustrative estimates, with a shared orthographic camera elevated 12° above the die-facing outlet.

| File | Yaw | Use |
| --- | --- | --- |
| `extruder-front.svg` | 0° | Center machine |
| `extruder-intermediate.svg` | 30° | Inner pair, mirrored on the left |
| `extruder-angled.svg` | 60° | Outer pair, mirrored on the left |

Suggested left-to-right layouts: `0°` for one layer; `−30°, 0°, +30°` for three; `−60°, −30°, 0°, +30°, +60°` for five. Mirror an SVG image using `transform: scaleX(-1)`.

Open `index.html` for a 1/3/5-layer preview with a light/dark background switch. `preview.svg` is a self-contained vector contact sheet.

The individual SVGs have transparent backgrounds, no fonts, scripts, external resources or embedded bitmaps. They share a 610-unit viewBox height and a common physical scale. The machine's proportion (cross-section scale, and the barrel stretch ahead of the feed flange that keeps the motor end fixed) is set by the constants at the top of `generate.py`. Set the **same image height**, with automatic width, to preserve machine scale. Each root contains `data-outlet-x` and `data-outlet-y` in its viewBox coordinates for positioning a die connection. The feed flange above the rear housing provides the mixer connection. Path `data-part` attributes identify editable components. Gradient IDs are unique per angle; if inserting multiple copies of the same SVG inline, prefix IDs per instance (ordinary `<img>` usage needs no changes).

Regenerate the SVGs and contact sheet from the repository root:

```sh
python tools/extruder-svg/generate.py
```

These standalone assets do not change the station UI.

Station's full-detail versions are generated with `node tools/station-extruder/derive.js`
(`--check` verifies the checked-in outputs). The conversion preserves every
original path and vertex, including the cylinder facets, vents, fins, hardware,
and gradient directions and stops. Station's CSS supplies the replacement
palette; source lightness and line widths remain numeric drawing data.
The motor, fins, fan cover, terminal box, and mount share one semantic motor
hook and a lifted steel range so the rear assembly remains recognizable at UI size.
The existing feed paint-order correction keeps the mixer connection visible.
The runtime uses per-machine gradient IDs and a separate hit area.
