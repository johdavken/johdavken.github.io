#!/usr/bin/env node
/* Derive the Station mixer artwork from the authored assets.
 *
 *   node tools/station-mixer/derive.js          regenerate
 *   node tools/station-mixer/derive.js --check  exit 1 if the outputs are stale
 *
 * SOURCES  images/mixer/mixer-{front,intermediate,angled}.svg
 *          Authored batch mixer, 139-189 paths each, in the Station palette.
 *          Never modified here. Corrections to the machine are made
 *          upstream, in tools/mixer-svg/generate.py, never here.
 *
 * OUTPUTS  station/assets/mixer-{front,intermediate,angled}.svg
 *          Standalone Station derivatives for review, product rules inlined.
 *
 *          station/station-mixer-assets.js
 *          The same polygons as data, plus the rotor, for the renderer.
 *
 * WHAT "DERIVE" MEANS HERE
 *
 * The masters are final: every part is kept, at its authored size and in
 * its authored paint order, and nothing is moved. (An earlier version of
 * this tool dropped hardware and tightened the frame; the masters were then
 * redrawn to be right at Station size, and that work came out.) What is
 * left is representation, not design:
 *
 *   - the view is rescaled to stage units (UNIT below) with the discharge
 *     at the origin, which the masters already put at (0, 0);
 *   - colour comes off each path and goes into the stylesheet: every face
 *     carries the TONE the source painted it in (its mixer__* class) and
 *     whether the source stroked it in its own colour - the curved bands
 *     and discs, so their facets do not show seams - or in the edge colour.
 *     An unrecognised tone is an error, not a guess;
 *   - the two stationary "agitator glimpse" paddles inside the inspection
 *     windows are lifted out as the ROTOR: expressed in the PLANE of the
 *     inspection cover (the projection is orthographic, so the door plane is
 *     one 2x2 matrix from the view's yaw and elevation) and handed to the
 *     renderer with the window outlines as a clip. The renderer rotates
 *     them in that plane; the standalone file shows them at rest.
 *
 * Node standard library only.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const shared = require("../station-extruder/derive.js");

const ROOT = path.resolve(__dirname, "..", "..");
const SOURCE_DIR = path.join(ROOT, "images", "mixer");
const ASSET_DIR = path.join(ROOT, "station", "assets");
const MODULE_PATH = path.join(ROOT, "station", "station-mixer-assets.js");

const VIEWS = [
  { name: "front", file: "mixer-front.svg" },
  { name: "intermediate", file: "mixer-intermediate.svg" },
  { name: "angled", file: "mixer-angled.svg" }
];

/* Stage units per source unit. The one number that sets the mixer's size
 * against the extruder, and it is the masters' own: tools/mixer-svg/
 * assemble.py places the blender on the Station extruder at exactly this
 * scale in its assembly previews, so the stage shows what the previews
 * show. */
const UNIT = 0.42;

/* The tones the source paints with (its mixer__* classes). Colour for each
 * is decided in layer-bank.css. */
const TONES = new Set(["front", "side", "top", "light", "dark", "steel", "edge", "accent", "window", "material", "hose", "blue"]);

/* The source strokes each path one of two ways: in the shared edge colour
 * (an outline), or in its own fill colour at a third of the width (a curved
 * band's facet, so the band reads as one surface). The second is recorded
 * as `seamless` and becomes a class; the widths themselves are the
 * stylesheet's. */
const EDGE_STROKE = "#445468";

/* ------------------------------------------------------------------------
 *   Reading the source
 * ---------------------------------------------------------------------- */

function parseSource(svg, file) {
  const root = svg.match(/<svg\b[^>]*>/);
  if (!root) throw new Error(`${file}: no <svg> root`);
  const attr = name => {
    const m = root[0].match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? Number(m[1]) : NaN;
  };
  const view = {
    yaw: attr("data-yaw"), elevation: attr("data-elevation"),
    outlet: { x: attr("data-outlet-x"), y: attr("data-outlet-y") },
    inlet: { x: attr("data-inlet-x"), y: attr("data-inlet-y") }
  };
  for (const [key, value] of [["yaw", view.yaw], ["elevation", view.elevation], ["outlet", view.outlet.x], ["inlet", view.inlet.x]]) {
    if (!Number.isFinite(value)) throw new Error(`${file}: missing ${key} metadata`);
  }
  if (view.outlet.x !== 0 || view.outlet.y !== 0) throw new Error(`${file}: the discharge is not at the origin`);

  const faces = [];
  const pattern = /<path\b([^>]*)\/>/g;
  let match;
  let order = 0;
  while ((match = pattern.exec(svg))) {
    const attrs = match[1];
    const get = name => {
      const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
      return m ? m[1] : null;
    };
    const tone = (get("class") || "").match(/^mixer__([a-z]+)$/);
    const part = get("data-part");
    const d = get("d");
    const fill = get("fill");
    const stroke = get("stroke");
    if (!tone || !part || !d || !fill || !stroke) throw new Error(`${file}: a path without tone class, data-part, d, fill or stroke`);
    if (!TONES.has(tone[1])) throw new Error(`${file}: unrecognised tone ${tone[1]} on ${part}`);
    if (stroke !== fill && stroke !== EDGE_STROKE) throw new Error(`${file}: ${part} is stroked in ${stroke}, neither its fill nor the edge colour`);
    faces.push({ order: order++, part, tone: tone[1], seamless: stroke === fill, points: shared.parsePolygon(d, file) });
  }
  if (!faces.length) throw new Error(`${file}: no paths`);
  return { ...view, faces };
}

/* ------------------------------------------------------------------------
 *   Sorting the source into what is drawn and what turns
 * ---------------------------------------------------------------------- */

/* Orthographic camera terms, from the view's own metadata. */
function camera(view) {
  const a = (view.yaw * Math.PI) / 180;
  const e = (view.elevation * Math.PI) / 180;
  return { sa: Math.sin(a), ca: Math.cos(a), se: Math.sin(e), ce: Math.cos(e) };
}

/* Every face is kept as authored. The glimpses leave the face list to
 * become the rotor; the windows and the cover disc are noted because the
 * rotor is clipped by the one and centred on the other. */
function sort(source, file) {
  const cam = camera(source);
  const faces = [];
  const glimpses = [];
  const windows = [];
  let coverCap = null;

  for (const face of source.faces) {
    if (face.part === "agitator-glimpse") { glimpses.push(face); continue; }
    if (face.part === "inspection-window") windows.push(face);
    if (face.part === "inspection-cover" && face.points.length === 48) {
      if (coverCap) throw new Error(`${file}: two inspection-cover discs`);
      coverCap = face;
    }
    faces.push(face);
  }
  if (glimpses.length !== 2) throw new Error(`${file}: expected two agitator glimpses, found ${glimpses.length}`);
  if (windows.length !== 2) throw new Error(`${file}: expected two inspection windows`);
  if (!coverCap) throw new Error(`${file}: no inspection-cover disc to centre the rotor on`);

  return { cam, faces, glimpses, windows, coverCap };
}

/* ------------------------------------------------------------------------
 *   The rotor
 * ---------------------------------------------------------------------- */

/* The inspection cover lies in a plane of constant depth, so its projection
 * is affine: a point (u across, v up) in that plane lands at
 * (ca*u, sa*se*u - ce*v) from the cover's centre. That 2x2 is `plane`; the
 * renderer places it with one transform and rotates inside it. The paddles
 * are the two glimpses mapped back into the plane, plus their opposites, so
 * the rotor has four. */
function rotor(sorted, unit) {
  const { cam } = sorted;
  const centre = shared.centroid(sorted.coverCap.points);
  const plane = { a: cam.ca, b: cam.sa * cam.se, c: 0, d: -cam.ce };
  const toPlane = ([x, y]) => {
    const dx = x - centre.x;
    const dy = y - centre.y;
    // dx = a*u, dy = b*u + d*v
    const u = dx / plane.a;
    const v = (dy - plane.b * u) / plane.d;
    return [shared.round(u * unit), shared.round(v * unit)];
  };
  const paddles = sorted.glimpses.map(g => g.points.map(toPlane));
  const opposite = paddles.map(points => points.map(([u, v]) => [shared.round(-u), shared.round(-v)]));
  return {
    centre: { x: shared.round(centre.x * unit), y: shared.round(centre.y * unit) },
    plane: { a: shared.round(plane.a), b: shared.round(plane.b), c: 0, d: shared.round(plane.d) },
    paddles: paddles.concat(opposite),
    windows: sorted.windows.map(w => w.points.map(([x, y]) => [shared.round(x * unit), shared.round(y * unit)]))
  };
}

/* ------------------------------------------------------------------------
 *   Normalisation
 * ---------------------------------------------------------------------- */

function normalise(source, sorted, unit) {
  const map = ([x, y]) => [shared.round(x * unit), shared.round(y * unit)];
  // Full outlines, every vertex: adjacent curved bands share their rim
  // samples, and thinning them independently opens gaps between facets.
  const polygons = sorted.faces.map(face => ({
    part: face.part, tone: face.tone, seamless: face.seamless, points: face.points.map(map)
  }));
  const all = polygons.flatMap(p => p.points);
  const bounds = {
    left: Math.min(...all.map(p => p[0])),
    right: Math.max(...all.map(p => p[0])),
    top: Math.min(...all.map(p => p[1])),
    bottom: Math.max(...all.map(p => p[1]))
  };
  // The rotor paints after the windows, which paint after the cover.
  const lastWindow = polygons.reduce((last, p, i) => (p.part === "inspection-window" ? i : last), -1);
  const inlet = map([source.inlet.x, source.inlet.y]);
  return {
    yaw: source.yaw,
    elevation: source.elevation,
    outlet: { x: 0, y: 0 },
    inlet: { x: inlet[0], y: inlet[1] },
    bounds,
    polygons,
    rotorAfter: lastWindow + 1,
    rotor: rotor(sorted, unit)
  };
}

/* ------------------------------------------------------------------------
 *   Standalone SVG
 * ---------------------------------------------------------------------- */

/* The classes the renderer emits (station-machine-parts.js): every face,
 * its tone, and - for a face the source stroked in its own colour - the
 * seam class for that tone. */
function classesFor(polygon) {
  const classes = ["station-mixer__face", `station-mixer__face--${polygon.tone}`];
  if (polygon.seamless) classes.push("station-mixer__seam", `station-mixer__seam--${polygon.tone}`);
  return classes.join(" ");
}

function standaloneSvg(name, view, rules, sourceFile) {
  const margin = 6;
  const b = view.bounds;
  const viewBox = [b.left - margin, b.top - margin, b.right - b.left + margin * 2, b.bottom - b.top + margin * 2]
    .map(shared.round).join(" ");
  const face = p => `  <path class="${classesFor(p)}" data-part="${p.part}" d="${shared.pathData(p.points)}"/>`;
  const r = view.rotor;
  const clipId = `station-mixer-${name}-windows`;
  const rotorMarkup = [
    `  <clipPath id="${clipId}">`,
    ...r.windows.map(w => `    <path d="${shared.pathData(w)}"/>`),
    `  </clipPath>`,
    `  <g clip-path="url(#${clipId})" data-part="rotor">`,
    `    <g transform="translate(${r.centre.x} ${r.centre.y}) matrix(${r.plane.a} ${r.plane.b} ${r.plane.c} ${r.plane.d} 0 0)">`,
    `      <g class="station-mixer__agitator">`,
    ...r.paddles.map(p => `        <path class="station-mixer__blade" d="${shared.pathData(p)}"/>`),
    `      </g>`,
    `    </g>`,
    `  </g>`
  ];
  const paths = view.polygons.slice(0, view.rotorAfter).map(face)
    .concat(rotorMarkup, view.polygons.slice(view.rotorAfter).map(face));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="station-mixer-${name}-title"`,
    `     data-view="${name}" data-yaw="${view.yaw}" data-outlet-x="0" data-outlet-y="0" data-inlet-x="${view.inlet.x}" data-inlet-y="${view.inlet.y}">`,
    `  <title id="station-mixer-${name}-title">Station mixer — ${name} view</title>`,
    `  <!-- DERIVED from images/mixer/${sourceFile} by tools/station-mixer/derive.js. Do not edit; edit the`,
    `       source or the tool and regenerate. Coordinates are stage units; the discharge (where the`,
    `       extruder's feed anchor goes) is the origin. Colour comes from station/styles, inlined here`,
    `       with the token values resolved so the file can be viewed on its own. The rotor is shown at`,
    `       rest; the stage rotates it. -->`,
    `  <style>`,
    ...rules.map(rule => `    ${rule}`),
    `  </style>`,
    ...paths,
    `</svg>`,
    ``
  ].join("\n");
}

/* ------------------------------------------------------------------------
 *   The renderer's module
 * ---------------------------------------------------------------------- */

function moduleSource(views, unit) {
  const flat = points => points.map(q => `${q[0]},${q[1]}`).join(", ");
  const literal = view => [
    `      yaw: ${view.yaw},`,
    `      elevation: ${view.elevation},`,
    `      outlet: { x: 0, y: 0 },`,
    `      inlet: { x: ${view.inlet.x}, y: ${view.inlet.y} },`,
    `      bounds: { left: ${view.bounds.left}, top: ${view.bounds.top}, right: ${view.bounds.right}, bottom: ${view.bounds.bottom} },`,
    `      rotorAfter: ${view.rotorAfter},`,
    `      rotor: {`,
    `        centre: { x: ${view.rotor.centre.x}, y: ${view.rotor.centre.y} },`,
    `        plane: { a: ${view.rotor.plane.a}, b: ${view.rotor.plane.b}, c: ${view.rotor.plane.c}, d: ${view.rotor.plane.d} },`,
    `        paddles: [`,
    ...view.rotor.paddles.map(p => `          [${flat(p)}],`),
    `        ],`,
    `        windows: [`,
    ...view.rotor.windows.map(w => `          [${flat(w)}],`),
    `        ]`,
    `      },`,
    `      polygons: [`,
    ...view.polygons.map(p => `        { part: "${p.part}", tone: "${p.tone}"${p.seamless ? ", seamless: true" : ""}, points: [${flat(p.points)}] },`),
    `      ]`
  ].join("\n");

  return `/* GENERATED FILE - do not edit.
 *
 * The Station mixer artwork, as data. Produced by
 * tools/station-mixer/derive.js from the authored assets in images/mixer/;
 * regenerate with:
 *
 *   node tools/station-mixer/derive.js
 *
 * THREE VIEWS, ONE MACHINE, the same three the extruder has: front (0 deg),
 * intermediate (30 deg), angled (60 deg). A layer picks one view for both
 * machines, so they turn together. Each is authored turned the same way the
 * extruder is; the layout mirrors it for layers left of centre.
 *
 * COORDINATES are stage units and the DISCHARGE is the origin: (0, 0) is
 * the bottom of the outlet neck, which is placed on the extruder's feed
 * anchor. \`inlet\` is the centre of the top of the frame, for anything that
 * later wants to connect from above.
 *
 * The ROTOR is not in \`polygons\`. It is four paddles in the plane of the
 * inspection cover - \`plane\` is that plane's 2x2 projection, \`centre\` where
 * it sits - and \`windows\` are the two openings that clip it. The renderer
 * paints \`polygons[0..rotorAfter)\`, then the rotor, then the rest.
 *
 * Each polygon carries the TONE the source painted it in, and \`seamless\`
 * where the source stroked it in its own colour (a curved band's facet).
 * Colour is not here: the stylesheet decides it from those (layer-bank.css).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationMixerAssets = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const views = {
${VIEWS.map(v => `    ${v.name}: {\n${literal(views[v.name])}\n    }`).join(",\n")}
  };

  return Object.freeze({
    SOURCE: "images/mixer",
    // Stage units per source unit: the masters' own assembly scale.
    UNIT: ${unit},
    ORDER: Object.freeze(${JSON.stringify(VIEWS.map(v => v.name))}),
    views: Object.freeze(views)
  });
});
`;
}

/* ------------------------------------------------------------------------
 *   Driver
 * ---------------------------------------------------------------------- */

function derive() {
  const unit = UNIT;
  const views = {};
  for (const v of VIEWS) {
    const source = parseSource(fs.readFileSync(path.join(SOURCE_DIR, v.file), "utf8"), v.file);
    views[v.name] = normalise(source, sort(source, v.file), unit);
  }
  const rules = shared.stationRules(shared.readTokens(), "station-mixer__");
  const files = {};
  for (const v of VIEWS) files[path.join(ASSET_DIR, v.file)] = standaloneSvg(v.name, views[v.name], rules, v.file);
  files[MODULE_PATH] = moduleSource(views, unit);
  return { views, unit, files };
}

function main(argv) {
  const check = argv.includes("--check");
  const { files } = derive();
  let stale = 0;
  for (const [file, content] of Object.entries(files)) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (current === content) continue;
    stale++;
    if (check) {
      console.error(`stale: ${path.relative(ROOT, file)}`);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      console.log(`wrote ${path.relative(ROOT, file)}`);
    }
  }
  if (check) {
    if (stale) process.exit(1);
    console.log("station mixer assets are up to date");
  } else if (!stale) {
    console.log("station mixer assets already up to date");
  }
}

module.exports = { derive, UNIT, TONES, EDGE_STROKE, VIEWS, SOURCE_DIR, ASSET_DIR, MODULE_PATH };

if (require.main === module) main(process.argv.slice(2));
