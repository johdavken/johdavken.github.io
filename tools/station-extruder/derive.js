#!/usr/bin/env node
/* Derive the Station extruder artwork from the authored assets.
 *
 *   node tools/station-extruder/derive.js          regenerate
 *   node tools/station-extruder/derive.js --check  exit 1 if the outputs are stale
 *
 * SOURCES  images/extruder/extruder-{front,intermediate,angled}.svg
 *          Authored, render-style, ~250 paths each. Never modified here.
 *
 * OUTPUTS  station/assets/extruder-{front,intermediate,angled}.svg
 *          Standalone Station derivatives, one per view, viewable on their
 *          own (the product's extruder rules are inlined with the token
 *          values resolved) - the review artefact.
 *
 *          station/station-extruder-assets.js
 *          The same polygons as data, for the renderer. This is what the
 *          stage actually draws from; the .svg files are the same thing in
 *          a form a person can open.
 *
 * WHAT "DERIVE" MEANS
 *
 * Nothing is redrawn. Every polygon in the output is a polygon from the
 * source, or the union of a run of adjacent source polygons (the 24-facet
 * cylinder sides become one band each). The work is subtraction and
 * relabelling:
 *
 *   - parts that do not survive Station scale are dropped (KEEP below);
 *   - every kept face is labelled with its PART and its FACE (top / side /
 *     front / round / cap), read off the source's own colour table, so
 *     Station's stylesheet can colour it and the asset carries no colour;
 *   - discs and cylinder bands are thinned to the point count that still
 *     draws a circle at the size they are actually shown;
 *   - the whole view is rescaled to stage units and translated so the FEED
 *     ANCHOR - the centre of the feed flange's top face, where the mixer
 *     neck lands - is the origin;
 *   - the feed is painted after the housing it stands on (raiseFeed) - the
 *     only departure from the source's paint order.
 *
 * The face labels depend on the source generator's colour table (a face is
 * "top" because it is painted with the generator's top colour). That
 * coupling is deliberate and total: an unrecognised fill is an error, not a
 * guess, so a regenerated source with new colours fails here rather than
 * silently arriving on the stage in the wrong shade.
 *
 * Node standard library only.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SOURCE_DIR = path.join(ROOT, "images", "extruder");
const ASSET_DIR = path.join(ROOT, "station", "assets");
const MODULE_PATH = path.join(ROOT, "station", "station-extruder-assets.js");
const TOKENS_PATH = path.join(ROOT, "station", "styles", "tokens.css");
const RULES_PATH = path.join(ROOT, "station", "styles", "components", "layer-bank.css");

const VIEWS = [
  { name: "front", file: "extruder-front.svg" },
  { name: "intermediate", file: "extruder-intermediate.svg" },
  { name: "angled", file: "extruder-angled.svg" }
];

/* Stage units from the feed anchor down to the lowest foot, in the FRONT
 * view. One scale for all three views - they share a physical scale in the
 * source, and must keep sharing one here or a turned machine would change
 * size as well as direction. */
const MACHINE_HEIGHT = 96;

/* Polygons with more points than this are thinned by half. 64-gon discs and
 * 24-facet bands are drawn at radius ~12 stage units. */
const THIN_ABOVE = 16;

/* Which source parts survive, and what they are called on the stage.
 *
 * Dropped, and why:
 *   vent-slot, vent-lip     23 slots on the lid - a grey smear at Station size
 *   motor-fin               cooling fins - same
 *   fan-cover               the motor's far end, behind the motor
 *   terminal-box            a small box on top of the motor
 *   motor-mount             a plate under the motor, hidden by the motor
 *   gearbox-cover           a small boss on the gearbox face
 *   *-bolt, flange-bolt-hole, end-panel-bolt   hardware under one pixel
 *   machined-face           a ring between flange and recess, one tone away
 *   housing-gasket, lower-fold   thin strips between base and housing
 *   foot                    the 5-unit floor plate under each leveling bolt
 *
 * The leveling bolt is what is KEPT of each leg, together with its bracket:
 * the bolt is the pillar that reaches the floor, and without it the bracket
 * hangs in the air. */
const KEEP = {
  "housing": "housing",
  "vent-inset": "vent",
  "panel-seam": "seam",
  "base": "base",
  "support-bracket": "foot",
  "leveling-bolt": "foot",
  "gearbox": "gearbox",
  "motor": "motor",
  "feed-neck": "feed",
  "feed-flange": "feed",
  "outlet-boss": "outlet",
  "outlet-flange": "flange",
  "outlet-recess": "recess",
  "outlet-bore": "bore"
};

/* Parts drawn as many facets round a cylinder in the source. Their side
 * facets are merged into one band; their end disc is kept as one cap. */
const CYLINDERS = new Set(["motor", "outlet-boss", "outlet-flange"]);

/* The source generator's colour table, read back as face roles. Each box is
 * painted (front, side, top); each cylinder end is a gradient. */
const FACE_BY_FILL = {
  // structure: base, support-bracket
  "#343b3e": "front", "#424a4e": "side", "#5b6468": "top",
  // gearbox
  "#30383c": "front", "#3f474b": "side", "#61696b": "top",
  // leveling-bolt
  "#7b8488": "front", "#899297": "side", "#bec6c8": "top",
  // feed-neck
  "#879194": "front", "#a3adaf": "side", "#d8dedd": "top",
  // feed-flange
  "#929da0": "front", "#bbc3c4": "side", "#edf0ed": "top",
  // housing
  "#e8ebea": "side",
  // single-face details: the seam lies on the side panel, the vent inset
  // on the lid, the recess and bore on the flange face
  "#c3caca": "side",
  "#c1c9ca": "top",
  "#6a767b": "cap",
  "#11191d": "cap"
};
const FACE_BY_GRADIENT = { end: "front", lid: "top", drive: "cap", metal: "cap" };

const FEED_ANCHOR = { part: "feed-flange", face: "top" };

/* ------------------------------------------------------------------------
 *   Reading the source
 * ---------------------------------------------------------------------- */

function parseSource(svg, file) {
  const root = svg.match(/<svg\b[^>]*>/);
  if (!root) throw new Error(`${file}: no <svg> root`);
  const attr = name => {
    const m = root[0].match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? m[1] : null;
  };
  const yaw = Number(attr("data-yaw"));
  const outlet = { x: Number(attr("data-outlet-x")), y: Number(attr("data-outlet-y")) };
  if (!Number.isFinite(yaw) || !Number.isFinite(outlet.x)) throw new Error(`${file}: missing view metadata`);

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
    const d = get("d");
    const part = get("data-part");
    if (!d || !part) throw new Error(`${file}: a path without data-part or d`);
    faces.push({ order: order++, part, fill: get("fill"), width: Number(get("stroke-width")), points: parsePolygon(d, file) });
  }
  if (!faces.length) throw new Error(`${file}: no paths`);
  return { yaw, outlet, faces };
}

function parsePolygon(d, file) {
  // The generator writes only "M x,y L x,y ... Z".
  const body = d.trim().replace(/^M/, "").replace(/Z$/, "").trim();
  return body.split(/\s*L\s*/).map(pair => {
    const [x, y] = pair.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${file}: unreadable path "${d.slice(0, 40)}"`);
    return [x, y];
  });
}

function faceRole(face, file) {
  const gradient = face.fill && face.fill.match(/^url\(#extruder-\d+-([a-z]+)\)$/);
  if (gradient) {
    const role = FACE_BY_GRADIENT[gradient[1]];
    if (!role) throw new Error(`${file}: unknown gradient ${gradient[1]} on ${face.part}`);
    return role;
  }
  const role = FACE_BY_FILL[face.fill];
  if (!role) throw new Error(`${file}: unrecognised fill ${face.fill} on ${face.part} - the source palette changed`);
  return role;
}

/* ------------------------------------------------------------------------
 *   Reduction
 * ---------------------------------------------------------------------- */

const same = (a, b) => Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[1] - b[1]) < 0.02;

/* Cylinder side facets are quads [A0, A1, B1, B0]: A and B the two angular
 * edges, 0 the near rim and 1 the far rim. Consecutive facets share an edge,
 * so the run chains up by geometry alone, and its union is the near rim
 * forward and the far rim back. */
function mergeBand(facets, part, file) {
  if (!facets.length) return null;
  const remaining = facets.slice();
  let chain = [remaining.shift()];
  let progress = true;
  while (progress && remaining.length) {
    progress = false;
    for (let i = 0; i < remaining.length; i++) {
      const f = remaining[i];
      const head = chain[0].points;
      const tail = chain[chain.length - 1].points;
      if (same(tail[3], f.points[0]) && same(tail[2], f.points[1])) {
        chain.push(f); remaining.splice(i, 1); progress = true; break;
      }
      if (same(f.points[3], head[0]) && same(f.points[2], head[1])) {
        chain.unshift(f); remaining.splice(i, 1); progress = true; break;
      }
    }
  }
  if (remaining.length) throw new Error(`${file}: ${part} side facets do not form one run`);
  const near = [chain[0].points[0], ...chain.map(f => f.points[3])];
  const far = [chain[chain.length - 1].points[2], ...chain.slice().reverse().map(f => f.points[1])];
  return {
    order: Math.min(...chain.map(f => f.order)),
    points: near.concat(far)
  };
}

function thin(points) {
  if (points.length <= THIN_ABOVE) return points;
  return points.filter((_, index) => index % 2 === 0);
}

function centroid(points) {
  const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
  return { x: sum[0] / points.length, y: sum[1] / points.length };
}

function reduce(source, file) {
  const out = [];
  let anchor = null;
  const bands = new Map();

  for (const face of source.faces) {
    const part = KEEP[face.part];
    if (!part) continue;
    if (CYLINDERS.has(face.part) && face.points.length === 4) {
      if (!bands.has(face.part)) bands.set(face.part, []);
      bands.get(face.part).push(face);
      continue;
    }
    const role = faceRole(face, file);
    if (face.part === FEED_ANCHOR.part && role === FEED_ANCHOR.face) {
      if (anchor) throw new Error(`${file}: two feed anchors`);
      anchor = centroid(face.points);
    }
    out.push({ order: face.order, part, face: role, points: thin(face.points) });
  }
  for (const [sourcePart, facets] of bands) {
    const band = mergeBand(facets, sourcePart, file);
    out.push({ order: band.order, part: KEEP[sourcePart], face: "round", points: thin(band.points) });
  }
  if (!anchor) throw new Error(`${file}: no feed anchor (${FEED_ANCHOR.part} ${FEED_ANCHOR.face} face)`);

  out.sort((a, b) => a.order - b.order);
  return { polygons: raiseFeed(out, file), anchor };
}

/* The one place the source's paint order is not kept. The generator sorts
 * faces by depth and puts the feed neck and flange BEHIND the housing, so
 * the feed is hidden in the front view and cut off by the barrel's rear top
 * edge in the turned ones - only the gearbox shows above the housing. Its
 * base sits on the housing's top face in every view, so that is a sorting
 * slip, and at stage size it makes the mixer look as if it stands off the
 * back edge of the extruder rather than on a feed block. The feed is moved
 * to just after the last housing face; nothing else is reordered. */
function raiseFeed(polygons, file) {
  const feed = polygons.filter(p => p.part === "feed");
  const rest = polygons.filter(p => p.part !== "feed");
  let last = -1;
  rest.forEach((p, i) => { if (p.part === "housing") last = i; });
  if (last < 0) throw new Error(`${file}: no housing to raise the feed over`);
  return [...rest.slice(0, last + 1), ...feed, ...rest.slice(last + 1)];
}

/* ------------------------------------------------------------------------
 *   Normalisation: stage units, feed anchor at the origin
 * ---------------------------------------------------------------------- */

const round = value => Math.round(value * 100) / 100;

function normalise(view, reduced, unit) {
  const map = ([x, y]) => [round((x - reduced.anchor.x) * unit), round((y - reduced.anchor.y) * unit)];
  const polygons = reduced.polygons.map(p => ({ part: p.part, face: p.face, points: p.points.map(map) }));
  const all = polygons.flatMap(p => p.points);
  const bounds = {
    left: Math.min(...all.map(p => p[0])),
    right: Math.max(...all.map(p => p[0])),
    top: Math.min(...all.map(p => p[1])),
    bottom: Math.max(...all.map(p => p[1]))
  };
  const outlet = map([view.outlet.x, view.outlet.y]);
  return {
    yaw: view.yaw,
    feed: { x: 0, y: 0 },
    outlet: { x: outlet[0], y: outlet[1] },
    bounds,
    polygons
  };
}

/* ------------------------------------------------------------------------
 *   Standalone SVG: the product's rules, tokens resolved
 * ---------------------------------------------------------------------- */

function readTokens() {
  const css = fs.readFileSync(TOKENS_PATH, "utf8");
  const tokens = {};
  for (const m of css.matchAll(/(--station-[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

function resolveVars(value, tokens) {
  let out = value;
  for (let guard = 0; guard < 8 && /var\(/.test(out); guard++) {
    out = out.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_, name, fallback) =>
      tokens[name] !== undefined ? tokens[name] : (fallback !== undefined ? fallback : "none"));
  }
  return out;
}

/* Every flat rule in layer-bank.css whose selectors all start with `prefix`,
 * with the tokens resolved - the product's own styling, inlined so a
 * standalone derivative can be opened on its own. Shared with the mixer
 * tool. */
function stationRules(tokens, prefix) {
  const css = fs.readFileSync(RULES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  // Flat rules only: selector text is whatever sits between the previous
  // brace and the next. At-rule preludes never pass the selector filter.
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(css))) {
    const selectors = match[1].split(",").map(s => s.trim());
    if (!selectors.every(s => s.startsWith(`.${prefix}`) && /^\.[a-z0-9_-]+$/.test(s))) continue;
    const body = match[2].split(";").map(s => s.trim()).filter(Boolean)
      .map(declaration => resolveVars(declaration, tokens)).join("; ");
    rules.push(`${selectors.join(", ")} { ${body}; }`);
  }
  if (!rules.length) throw new Error(`no .${prefix} rules found in ${path.relative(ROOT, RULES_PATH)}`);
  return rules;
}

const extruderRules = tokens => stationRules(tokens, "station-extruder__");

/* The same three classes the renderer emits (station-machine-parts.js):
 * every face, its part, and its part-and-face. */
function classesFor(polygon) {
  return `station-extruder__face station-extruder__${polygon.part} station-extruder__${polygon.part}--${polygon.face}`;
}

function pathData(points) {
  return `M${points.map(p => `${p[0]},${p[1]}`).join(" L")} Z`;
}

function standaloneSvg(name, view, rules, sourceFile) {
  const margin = 6;
  const b = view.bounds;
  const viewBox = [b.left - margin, b.top - margin, b.right - b.left + margin * 2, b.bottom - b.top + margin * 2]
    .map(round).join(" ");
  const paths = view.polygons.map(p =>
    `  <path class="${classesFor(p)}" data-part="${p.part}" data-face="${p.face}" d="${pathData(p.points)}"/>`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="station-extruder-${name}-title"`,
    `     data-view="${name}" data-yaw="${view.yaw}" data-feed-x="0" data-feed-y="0" data-outlet-x="${view.outlet.x}" data-outlet-y="${view.outlet.y}">`,
    `  <title id="station-extruder-${name}-title">Station extruder — ${name} view</title>`,
    `  <!-- DERIVED from images/extruder/${sourceFile} by tools/station-extruder/derive.js. Do not edit; edit the`,
    `       source or the tool and regenerate. Coordinates are stage units; the feed anchor (where the`,
    `       mixer neck lands) is the origin. Colour comes from station/styles, inlined here with the`,
    `       token values resolved so the file can be viewed on its own. -->`,
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
  const literal = view => [
    `      yaw: ${view.yaw},`,
    `      feed: { x: 0, y: 0 },`,
    `      outlet: { x: ${view.outlet.x}, y: ${view.outlet.y} },`,
    `      bounds: { left: ${view.bounds.left}, top: ${view.bounds.top}, right: ${view.bounds.right}, bottom: ${view.bounds.bottom} },`,
    `      polygons: [`,
    ...view.polygons.map(p =>
      `        { part: "${p.part}", face: "${p.face}", points: [${p.points.map(q => `${q[0]},${q[1]}`).join(", ")}] },`),
    `      ]`
  ].join("\n");

  return `/* GENERATED FILE - do not edit.
 *
 * The Station extruder artwork, as data. Produced by
 * tools/station-extruder/derive.js from the authored assets in
 * images/extruder/; regenerate with:
 *
 *   node tools/station-extruder/derive.js
 *
 * THREE VIEWS, ONE MACHINE. front (0 deg) for the centre layer, intermediate
 * (30 deg) for the ring next to it, angled (60 deg) for everything further
 * out. Each is drawn with its front end toward the viewer's LEFT; the layout
 * mirrors it for layers left of centre, so there is no left-hand artwork.
 *
 * COORDINATES are stage units - the same units the rest of the layer bank is
 * laid out in - and the FEED ANCHOR is the origin: (0, 0) is the centre of
 * the feed flange's top face, which is where the mixer neck lands. Placing
 * a machine is therefore "put the origin under the neck". \`outlet\` is the
 * die-facing bore centre, for anything that later wants to connect there.
 *
 * Each polygon carries its PART and its FACE. Colour is not here: the
 * stylesheet decides it from those two labels (layer-bank.css).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationExtruderAssets = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const views = {
${VIEWS.map(v => `    ${v.name}: {\n${literal(views[v.name])}\n    }`).join(",\n")}
  };

  return Object.freeze({
    SOURCE: "images/extruder",
    // Stage units per source unit, and the height that fixed it.
    UNIT: ${round(unit * 10000) / 10000},
    MACHINE_HEIGHT: ${MACHINE_HEIGHT},
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
  const sources = VIEWS.map(v => ({
    ...v,
    parsed: parseSource(fs.readFileSync(path.join(SOURCE_DIR, v.file), "utf8"), v.file)
  }));
  const reduced = sources.map(s => ({ ...s, reduced: reduce(s.parsed, s.file) }));

  // One scale, fixed by the front view.
  const front = reduced.find(s => s.name === "front");
  const lowest = Math.max(...front.reduced.polygons.flatMap(p => p.points.map(q => q[1])));
  const unit = MACHINE_HEIGHT / (lowest - front.reduced.anchor.y);

  const views = {};
  for (const s of reduced) views[s.name] = normalise(s.parsed, s.reduced, unit);

  const rules = extruderRules(readTokens());
  const files = {};
  for (const s of reduced) {
    files[path.join(ASSET_DIR, s.file)] = standaloneSvg(s.name, views[s.name], rules, s.file);
  }
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
    console.log("station extruder assets are up to date");
  } else if (!stale) {
    console.log("station extruder assets already up to date");
  }
}

module.exports = {
  derive, KEEP, CYLINDERS, MACHINE_HEIGHT, VIEWS, SOURCE_DIR, ASSET_DIR, MODULE_PATH,
  // Shared with tools/station-mixer/derive.js.
  parsePolygon, readTokens, resolveVars, stationRules, round, thin, centroid, pathData
};

if (require.main === module) main(process.argv.slice(2));
