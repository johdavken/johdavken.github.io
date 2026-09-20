#!/usr/bin/env node
/* Generate the Station TSM blender artwork.
 *
 *   node tools/station-tsm/generate.js          regenerate
 *   node tools/station-tsm/generate.js --check  exit 1 if the outputs are stale
 *
 * WHAT THIS IS
 *
 * The second blender Station draws: the TSM gravimetric blender that some
 * lines run in place of the batch mixer (line 8 first). There are no
 * authored masters for it - it is described here, once, as solids in the
 * same model space the mixer masters use (tools/mixer-svg/generate.py:
 * x across the machine, z toward the rear, h above the discharge, the
 * discharge at the origin), and projected with the same orthographic camera
 * (yaw 0 / 30 / 60, elevation 12) at the same assembly scale (UNIT 0.42),
 * so it stands on the extruder exactly as the mixer does and turns with it.
 *
 * WHAT IT DRAWS, from the photographs of the floor - TWO machines:
 *
 *   The BLENDER
 *   - the discharge tube and its flange, at the origin;
 *   - the blue weigh / mix unit: a base plate, the lower body with its
 *     sight window and the material in it, the motor and gearbox on its
 *     left, and the hood over it;
 *   - the white steel hopper on top: the funnel (an inverted frustum) with
 *     its two round-cornered sight windows, the sensor ports under them,
 *     and the collar the loaders stand on.
 *
 *   The DOWNCOMER under it (the OPTIYIELD 400 of the photograph): a grey
 *   drum with a conical bottom and a sight glass, its neck into the name
 *   ring, the black drum and cone in a two-post frame below, and the
 *   outlet on a base plate that lands on the extruder's feed. Its origin
 *   is ITS outlet; the layout hangs it from the blender's discharge.
 *
 * The loaders themselves are NOT here: they are the hopper row the layout
 * draws above the blender, spread across as the batch mixer's hoppers are.
 *
 * OUTPUTS  station/station-tsm-assets.js   the polygons as data, for the renderer
 *          station/assets/tsm-{front,intermediate,angled}.svg   blender review files
 *          station/assets/tsm-downcomer-{front,intermediate,angled}.svg
 *
 * Every face carries a TONE from the mixer's own vocabulary (the twelve the
 * stylesheet colours, layer-bank.css) so the renderer paints it with the
 * mixer's classes and nothing is styled twice. A face stroked in its own
 * colour (a curved band's facet) is `seamless`, as the mixer's are.
 *
 * Node standard library only.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const shared = require("../station-extruder/derive.js");
const mixerTool = require("../station-mixer/derive.js");

const ROOT = path.resolve(__dirname, "..", "..");
const ASSET_DIR = path.join(ROOT, "station", "assets");
const MODULE_PATH = path.join(ROOT, "station", "station-tsm-assets.js");

const VIEWS = [
  { name: "front", yaw: 0, file: "tsm-front.svg", coreFile: "tsm-core-front.svg", downcomerFile: "tsm-downcomer-front.svg" },
  { name: "intermediate", yaw: 30, file: "tsm-intermediate.svg", coreFile: "tsm-core-intermediate.svg", downcomerFile: "tsm-downcomer-intermediate.svg" },
  { name: "angled", yaw: 60, file: "tsm-angled.svg", coreFile: "tsm-core-angled.svg", downcomerFile: "tsm-downcomer-angled.svg" }
];

/* The mixer masters' camera and scale, so the two blenders are one family. */
const ELEVATION = 12;
const UNIT = mixerTool.UNIT;
const TONES = mixerTool.TONES;

/* The machine, in source units (x across, z toward the rear, h up). */
const M = Object.freeze({
  neck: { r: 20, top: 44 },
  flange: { r: 30, h0: 4, h1: 12 },
  base: { x: 74, z: 62, h0: 44, h1: 52 },
  body: { x: 62, z: 50, h0: 52, h1: 152 },
  window: { x: 38, h0: 72, h1: 138, fill: 106 },
  motor: { x0: -100, x1: -62, h: 104, r: 22 },
  gearbox: { x0: -82, x1: -62, z: 17, h0: 86, h1: 122 },
  hood: { x: 70, z: 58, h0: 152, h1: 192 },
  transition: { x: 46, z: 46, h0: 188, h1: 198 },
  funnel: { bottom: { x: 42, z: 42, h: 198 }, top: { x: 150, z: 76, h: 342 } },
  sight: { cx: 54, ch: 268, half: 22, corner: 7, frame: 3, fill: 0.55 },
  port: { r: 5, h: 296 },
  sensor: { cx: 48, h: 226, r: 6, proud: 9 },
  rim: { h0: 338, h1: 344 },
  collar: { x: 150, z: 76, h0: 344, h1: 420 },
  /* The side storage on the six-loader machine (the photographs' 5A and
   * A6): a wedge on each side of the funnel, its top open at the funnel's
   * top - the collar rides above the funnel alone, and the side loader
   * stands on the wedge - its front in the funnel's own front plane, its
   * outer wall sloping in and down to a small outlet beside the funnel's
   * bottom, which lands on a chute block on the weigh unit's side. */
  storage: { reach: 260, top: 338, outlet: { x0: 104, x1: 50, h: 192 }, chute: { x0: 70, x1: 112, z: 30, h0: 160, h1: 192 } }
});

/* The downcomer, in the same units, its outlet at the origin. */
const D = Object.freeze({
  base: { x: 46, z: 40, h0: 0, h1: 8 },
  outlet: { r: 12, h0: 0, h1: 16 },
  cone: { r0: 10, h0: 16, r1: 34, h1: 68 },
  drum: { r: 34, h0: 68, h1: 134 },
  glass: { w: 10, h0: 82, h1: 124 },
  ring: { r: 48, h0: 134, h1: 154 },
  neck: { r: 16, h0: 154, h1: 170 },
  upperCone: { r0: 16, h0: 170, r1: 42, h1: 202 },
  upperDrum: { r: 42, h0: 202, h1: 264 },
  upperGlass: { w: 10, h0: 214, h1: 254 },
  post: { x0: 38, x1: 46, z: 9, h0: 8, h1: 140 }
});

/* ------------------------------------------------------------------------
 *   Projection
 * ---------------------------------------------------------------------- */

function camera(yaw) {
  const a = (yaw * Math.PI) / 180;
  const e = (ELEVATION * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(e), se = Math.sin(e);
  return {
    // Screen coordinates, y down: the mixer masters' own projection.
    project: ([x, z, h]) => [x * ca + z * sa, x * sa * se - z * ca * se - h * ce],
    // The direction toward the viewer: a face whose outward normal has a
    // positive component along it is seen.
    toward: [sa * ce, -ca * ce, se]
  };
}

/* The smallest projected face kept, in source units squared: below this a
 * face is a hairline the stage cannot draw. */
const MIN_FACE_AREA = 2;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const area = points => {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  return sum / 2;
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/* ------------------------------------------------------------------------
 *   One view
 * ---------------------------------------------------------------------- */

/* `options.storage` false draws the four-loader machine: the same body
 * without the side storage - the core layer's blender. */
function render(yaw, options) {
  const withStorage = !options || options.storage !== false;
  const cam = camera(yaw);
  const faces = [];

  /* A flat face: kept when its outward normal faces the viewer. `normal`
   * may be given; otherwise it is the polygon's own, oriented away from
   * `centre` (the solid's middle). `outline` false = stroked in its own
   * colour, as a curved band's facet is. */
  function face(points, tone, part, options) {
    const o = options || {};
    if (!TONES.has(tone)) throw new Error(`unknown tone ${tone} on ${part}`);
    let normal = o.normal || null;
    if (!normal) {
      normal = cross(sub(points[1], points[0]), sub(points[2], points[0]));
      if (o.centre) {
        const centroid = points.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0]).map(v => v / points.length);
        if (dot(normal, sub(centroid, o.centre)) < 0) normal = normal.map(v => -v);
      }
    }
    if (dot(normal, cam.toward) <= 0.001) return;
    const projected = points.map(cam.project);
    // A face seen almost edge-on is a sliver the stage cannot draw: dropped.
    if (Math.abs(area(projected)) < MIN_FACE_AREA) return;
    faces.push({ part, tone, seamless: o.outline === false, points: projected });
  }

  /* A box: top, the right side, the front - each with its own tone, in
   * the masters' paint order (top, side, front). */
  function box(x0, x1, z0, z1, h0, h1, part, tones) {
    const t = tones || ["front", "side", "top"];
    face([[x0, z0, h1], [x1, z0, h1], [x1, z1, h1], [x0, z1, h1]], t[2], part, { normal: [0, 0, 1] });
    face([[x1, z0, h0], [x1, z1, h0], [x1, z1, h1], [x1, z0, h1]], t[1], part, { normal: [1, 0, 0] });
    face([[x0, z0, h0], [x1, z0, h0], [x1, z0, h1], [x0, z0, h1]], t[0], part, { normal: [0, -1, 0] });
  }

  /* Curved bands: `n` facets round an axis, each visible or not by its
   * own normal, consecutive visible facets of one tone merged into one
   * polygon so the band reads as a surface. `ring(t, end)` gives the
   * point at angle t on end 0 or 1; `normal(t)` the facet's outward
   * normal at angle t. */
  function bands(n, ring, normal, shade, part) {
    const runs = [];
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) * 2 * Math.PI) / n;
      if (dot(normal(t), cam.toward) <= 0.001) continue;
      const tone = shade(t);
      if (runs.length && runs[runs.length - 1].last === i && runs[runs.length - 1].tone === tone) runs[runs.length - 1].last = i + 1;
      else runs.push({ first: i, last: i + 1, tone });
    }
    for (const run of runs) {
      const points = [];
      for (let i = run.first; i <= run.last; i++) points.push(ring((i * 2 * Math.PI) / n, 0));
      for (let i = run.last; i >= run.first; i--) points.push(ring((i * 2 * Math.PI) / n, 1));
      face(points, run.tone, part, { outline: false, normal: [0, 0, 0].map((_, k) => cam.toward[k]) });
    }
  }

  /* A vertical cylinder (axis h) with its top disc, as the masters' cone. */
  function cylinder(x, z, h0, h1, r, part, topTone) {
    const ring = (t, end) => [x + r * Math.cos(t), z + r * Math.sin(t), end === 0 ? h0 : h1];
    face(Array.from({ length: 48 }, (_, i) => ring((i * 2 * Math.PI) / 48, 1)), topTone || "top", part, { normal: [0, 0, 1] });
    bands(48, ring, t => [Math.cos(t), Math.sin(t), 0],
      t => (Math.cos(t) < -0.35 ? "top" : Math.cos(t) < 0.6 ? "front" : "side"), part);
  }

  /* A horizontal cylinder along x (the motor): bands only, its free end
   * turned away from every view the stage uses. */
  function barrelX(x0, x1, z, h, r, part) {
    const ring = (t, end) => [end === 0 ? x0 : x1, z + r * Math.cos(t), h + r * Math.sin(t)];
    bands(40, ring, t => [0, Math.cos(t), Math.sin(t)],
      t => (Math.sin(t) > 0.6 ? "light" : Math.cos(t) < 0 && Math.sin(t) > -0.55 ? "steel" : "dark"), part);
  }

  /* The funnel's front plane: z at a height, and the half-width there. */
  const funnel = M.funnel;
  const fz = h => funnel.bottom.z + ((h - funnel.bottom.h) / (funnel.top.h - funnel.bottom.h)) * (funnel.top.z - funnel.bottom.z);
  const frontZ = h => -fz(h);
  /* A point proud of the front plane by `d`, along the plane's outward normal. */
  const slope = (funnel.top.z - funnel.bottom.z) / (funnel.top.h - funnel.bottom.h);
  const frontNormal = (() => { const len = Math.hypot(1, slope); return [0, -1 / len, -slope / len]; })();
  const onFront = (x, h, d) => [x + 0, frontZ(h) + frontNormal[1] * (d || 0), h + frontNormal[2] * (d || 0)];

  /* A round-cornered square on the front plane, centred (cx, ch). */
  function roundedSquare(cx, ch, half, corner, d) {
    const points = [];
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    corners.forEach(([sx, sh], k) => {
      const ox = cx + sx * (half - corner);
      const oh = ch + sh * (half - corner);
      for (let i = 0; i <= 6; i++) {
        const t = ((k * 90 + (i * 90) / 6) * Math.PI) / 180;
        points.push(onFront(ox + corner * Math.cos(t), oh + corner * Math.sin(t), d));
      }
    });
    return points;
  }

  function disc(cx, ch, r, d, n) {
    return Array.from({ length: n || 24 }, (_, i) => {
      const t = (i * 2 * Math.PI) / (n || 24);
      return onFront(cx + r * Math.cos(t), ch + r * Math.sin(t), d);
    });
  }

  /* ---- Paint, back to front ---- */

  // The discharge, under everything.
  cylinder(0, 0, 0, M.neck.top, M.neck.r, "outlet-neck");
  cylinder(0, 0, M.flange.h0, M.flange.h1, M.flange.r, "outlet-flange");

  // The base plate the weigh unit stands on.
  box(-M.base.x, M.base.x, -M.base.z, M.base.z, M.base.h0, M.base.h1, "base-plate", ["dark", "dark", "steel"]);

  // The motor and gearbox on the unit's left, behind its body from the
  // viewer's side.
  barrelX(M.motor.x0, M.motor.x1, 0, M.motor.h, M.motor.r, "motor");
  box(M.gearbox.x0, M.gearbox.x1, -M.gearbox.z, M.gearbox.z, M.gearbox.h0, M.gearbox.h1, "gearbox", ["dark", "dark", "steel"]);

  // The lower body, its sight window, and the material in it.
  box(-M.body.x, M.body.x, -M.body.z, M.body.z, M.body.h0, M.body.h1, "weigh-body", ["blue", "dark", "blue"]);
  const wz = -M.body.z - 0.3;
  const w = M.window;
  face([[-w.x, wz, w.h0], [w.x, wz, w.h0], [w.x, wz, w.h1], [-w.x, wz, w.h1]], "window", "body-window", { normal: [0, -1, 0] });
  face([[-w.x + 2, wz - 0.1, w.h0 + 2], [w.x - 2, wz - 0.1, w.h0 + 2], [w.x - 2, wz - 0.1, w.fill - 10], [w.x * 0.45, wz - 0.1, w.fill + 6],
    [0, wz - 0.1, w.fill + 10], [-w.x * 0.5, wz - 0.1, w.fill + 4], [-w.x + 2, wz - 0.1, w.fill - 8]], "material", "body-material", { normal: [0, -1, 0], outline: false });

  // The hood over the body, and the transition flange the funnel sits on.
  box(-M.hood.x, M.hood.x, -M.hood.z, M.hood.z, M.hood.h0, M.hood.h1, "weigh-hood", ["blue", "dark", "blue"]);
  // The chute blocks the side storage's outlets land on, on the hood's sides.
  if (withStorage) {
    const c = M.storage.chute;
    box(-c.x1, -c.x0, -c.z, c.z, c.h0, c.h1, "storage-chute", ["blue", "dark", "blue"]);
    box(c.x0, c.x1, -c.z, c.z, c.h0, c.h1, "storage-chute", ["blue", "dark", "blue"]);
  }
  box(-M.transition.x, M.transition.x, -M.transition.z, M.transition.z, M.transition.h0, M.transition.h1, "transition", ["dark", "dark", "steel"]);

  // The funnel: the right side, then the front, both sloping inward.
  const fb = funnel.bottom, ft = funnel.top;
  const funnelCentre = [0, 0, (fb.h + ft.h) / 2];
  face([[fb.x, -fb.z, fb.h], [fb.x, fb.z, fb.h], [ft.x, ft.z, ft.h], [ft.x, -ft.z, ft.h]], "edge", "funnel", { centre: funnelCentre });
  face([[-fb.x, -fb.z, fb.h], [fb.x, -fb.z, fb.h], [ft.x, -ft.z, ft.h], [-ft.x, -ft.z, ft.h]], "light", "funnel", { centre: funnelCentre });

  // On the funnel's front: two round-cornered sight windows with material
  // behind the glass, a port over each, and a sensor under each.
  for (const side of [-1, 1]) {
    const s = M.sight;
    const cx = side * s.cx;
    face(roundedSquare(cx, s.ch, s.half + s.frame, s.corner + s.frame, 0.4), "dark", "sight-frame", { normal: frontNormal });
    face(roundedSquare(cx, s.ch, s.half, s.corner, 0.8), "window", "sight-window", { normal: frontNormal });
    const inner = s.half - 2;
    const top = s.ch - inner + 2 * inner * s.fill;
    face([onFront(cx - inner, s.ch - inner, 1.2), onFront(cx + inner, s.ch - inner, 1.2), onFront(cx + inner, top - 4, 1.2),
      onFront(cx + inner * 0.4, top + 3, 1.2), onFront(cx - inner * 0.3, top + 1, 1.2), onFront(cx - inner, top - 5, 1.2)],
      "material", "sight-material", { normal: frontNormal, outline: false });
    face(disc(cx, M.port.h, M.port.r, 1.2, 16), "dark", "sight-port", { normal: frontNormal });
    // The sensor stands proud of the face: its side as a short band, its end as a disc.
    const sensorRing = (t, end) => onFront(side * M.sensor.cx + M.sensor.r * Math.cos(t), M.sensor.h + M.sensor.r * Math.sin(t), end === 0 ? 0 : M.sensor.proud);
    bands(12, sensorRing, t => {
      // The band's normal lies in the face plane, turned by t about the face normal.
      const u = [1, 0, 0];
      const v = cross(frontNormal, u);
      return [u[0] * Math.cos(t) + v[0] * Math.sin(t), u[1] * Math.cos(t) + v[1] * Math.sin(t), u[2] * Math.cos(t) + v[2] * Math.sin(t)];
    }, t => (Math.sin(t) > 0.3 ? "accent" : "dark"), "level-sensor");
    face(disc(side * M.sensor.cx, M.sensor.h, M.sensor.r, M.sensor.proud, 12), "accent", "level-sensor", { normal: frontNormal });
  }

  // The side storage: a wedge each side, front and back in the funnel's
  // own planes, the top open at the funnel's top, the outer wall an
  // undercut seen from the near side when the machine is turned.
  if (withStorage) {
    const st = M.storage;
    const backNormal = [0, -frontNormal[1], frontNormal[2]];
    const outerLen = Math.hypot(st.reach - st.outlet.x0, st.top - st.outlet.h);
    for (const side of [-1, 1]) {
      const xO = side * st.reach, xI = side * M.funnel.top.x;
      const xBo = side * st.outlet.x0, xBi = side * st.outlet.x1;
      const zT = fz(st.top), zB = fz(st.outlet.h);
      face([[xO, -zT, st.top], [xI, -zT, st.top], [xBi, -zB, st.outlet.h], [xBo, -zB, st.outlet.h]], "light", "side-storage", { normal: frontNormal });
      face([[xO, zT, st.top], [xI, zT, st.top], [xBi, zB, st.outlet.h], [xBo, zB, st.outlet.h]], "light", "side-storage", { normal: backNormal });
      face([[xO, -zT, st.top], [xI, -zT, st.top], [xI, zT, st.top], [xO, zT, st.top]], "edge", "side-storage", { normal: [0, 0, 1] });
      // The outer wall faces out and DOWN: an undercut.
      face([[xO, -zT, st.top], [xO, zT, st.top], [xBo, zB, st.outlet.h], [xBo, -zB, st.outlet.h]], "edge", "side-storage",
        { normal: [(side * (st.top - st.outlet.h)) / outerLen, 0, -(st.reach - st.outlet.x0) / outerLen] });
    }
  }

  // The rim between funnel and collar, then the collar the loaders stand on.
  box(-M.collar.x, M.collar.x, -M.collar.z, M.collar.z, M.rim.h0, M.rim.h1, "collar-rim", ["dark", "dark", "dark"]);
  box(-M.collar.x, M.collar.x, -M.collar.z, M.collar.z, M.collar.h0, M.collar.h1, "collar", ["light", "edge", "edge"]);

  return { yaw, faces, inlet: cam.project([0, 0, M.collar.h1]) };
}

/* The downcomer, one view: the same camera, its outlet at the origin. */
function renderDowncomer(yaw) {
  const cam = camera(yaw);
  const faces = [];

  function face(points, tone, part, options) {
    const o = options || {};
    if (!TONES.has(tone)) throw new Error(`unknown tone ${tone} on ${part}`);
    if (dot(o.normal, cam.toward) <= 0.001) return;
    const projected = points.map(cam.project);
    if (Math.abs(area(projected)) < MIN_FACE_AREA) return;
    faces.push({ part, tone, seamless: o.outline === false, points: projected });
  }
  function box(x0, x1, z0, z1, h0, h1, part, tones) {
    const t = tones || ["front", "side", "top"];
    face([[x0, z0, h1], [x1, z0, h1], [x1, z1, h1], [x0, z1, h1]], t[2], part, { normal: [0, 0, 1] });
    face([[x1, z0, h0], [x1, z1, h0], [x1, z1, h1], [x1, z0, h1]], t[1], part, { normal: [1, 0, 0] });
    face([[x0, z0, h0], [x1, z0, h0], [x1, z0, h1], [x0, z0, h1]], t[0], part, { normal: [0, -1, 0] });
  }
  function bands(n, ring, normal, shade, part) {
    const runs = [];
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) * 2 * Math.PI) / n;
      if (dot(normal(t), cam.toward) <= 0.001) continue;
      const tone = shade(t);
      if (runs.length && runs[runs.length - 1].last === i && runs[runs.length - 1].tone === tone) runs[runs.length - 1].last = i + 1;
      else runs.push({ first: i, last: i + 1, tone });
    }
    for (const run of runs) {
      const points = [];
      for (let i = run.first; i <= run.last; i++) points.push(ring((i * 2 * Math.PI) / n, 0));
      for (let i = run.last; i >= run.first; i--) points.push(ring((i * 2 * Math.PI) / n, 1));
      face(points, run.tone, part, { outline: false, normal: cam.toward });
    }
  }
  /* A frustum about the vertical axis: r0 at h0 to r1 at h1, its facets
   * shaded as the mixer masters shade a cone, and its top disc. `tones`
   * are [top-facing, front, side] for the band; a dark machine shades
   * darker. */
  function cone(h0, h1, r0, r1, part, tones, capTone) {
    const t = tones || ["top", "front", "side"];
    const ring = (a, end) => [(end === 0 ? r0 : r1) * Math.cos(a), (end === 0 ? r0 : r1) * Math.sin(a), end === 0 ? h0 : h1];
    // The facet's outward normal: radial, tilted by the frustum's slope.
    const slope = (r1 - r0) / (h1 - h0);
    if (capTone) face(Array.from({ length: 48 }, (_, i) => ring((i * 2 * Math.PI) / 48, 1)), capTone, part, { normal: [0, 0, 1] });
    bands(48, ring, a => [Math.cos(a), Math.sin(a), -slope],
      a => (Math.cos(a) < -0.35 ? t[0] : Math.cos(a) < 0.6 ? t[1] : t[2]), part);
  }
  /* A sight glass on a drum's front: a slot on the cylinder's surface,
   * with the material behind it. */
  function glass(r, w, h0, h1, part) {
    const at = (x, h, out) => [x, -Math.sqrt(Math.max(0, r * r - x * x)) - out, h];
    face([at(-w, h0, 0.4), at(w, h0, 0.4), at(w, h1, 0.4), at(-w, h1, 0.4)], "dark", `${part}-frame`, { normal: [0, -1, 0] });
    face([at(-w + 2, h0 + 2, 0.8), at(w - 2, h0 + 2, 0.8), at(w - 2, h1 - 2, 0.8), at(-w + 2, h1 - 2, 0.8)], "window", part, { normal: [0, -1, 0] });
    const fill = h0 + (h1 - h0) * 0.6;
    face([at(-w + 3, h0 + 3, 1.2), at(w - 3, h0 + 3, 1.2), at(w - 3, fill - 3, 1.2), at(0, fill + 2, 1.2), at(-w + 3, fill - 2, 1.2)], "material", `${part}-material`, { normal: [0, -1, 0], outline: false });
  }

  const darkTones = ["dark", "dark", "dark"];
  const greyTones = ["light", "edge", "steel"];

  box(-D.base.x, D.base.x, -D.base.z, D.base.z, D.base.h0, D.base.h1, "base-plate", ["dark", "dark", "steel"]);
  cone(D.outlet.h0, D.outlet.h1, D.outlet.r, D.outlet.r, "outlet", darkTones);
  cone(D.cone.h0, D.cone.h1, D.cone.r0, D.cone.r1, "lower-cone", ["steel", "dark", "dark"]);
  cone(D.drum.h0, D.drum.h1, D.drum.r, D.drum.r, "lower-drum", ["steel", "dark", "dark"]);
  glass(D.drum.r, D.glass.w, D.glass.h0, D.glass.h1, "lower-glass");
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -D.post.x1 : D.post.x0;
    const x1 = side < 0 ? -D.post.x0 : D.post.x1;
    box(x0, x1, -D.post.z, D.post.z, D.post.h0, D.post.h1, "frame-post", ["edge", "steel", "light"]);
  }
  cone(D.ring.h0, D.ring.h1, D.ring.r, D.ring.r, "name-ring", greyTones, "light");
  cone(D.neck.h0, D.neck.h1, D.neck.r, D.neck.r, "neck", greyTones);
  cone(D.upperCone.h0, D.upperCone.h1, D.upperCone.r0, D.upperCone.r1, "upper-cone", greyTones);
  cone(D.upperDrum.h0, D.upperDrum.h1, D.upperDrum.r, D.upperDrum.r, "upper-drum", greyTones, "edge");
  glass(D.upperDrum.r, D.upperGlass.w, D.upperGlass.h0, D.upperGlass.h1, "upper-glass");

  return { yaw, faces, inlet: cam.project([0, 0, D.upperDrum.h1]) };
}

/* ------------------------------------------------------------------------
 *   Stage units
 * ---------------------------------------------------------------------- */

function normalise(view, unit) {
  const map = ([x, y]) => [shared.round(x * unit), shared.round(y * unit)];
  const polygons = view.faces.map(f => ({ part: f.part, tone: f.tone, seamless: f.seamless, points: f.points.map(map) }));
  const all = polygons.flatMap(p => p.points);
  const bounds = {
    left: Math.min(...all.map(p => p[0])),
    right: Math.max(...all.map(p => p[0])),
    top: Math.min(...all.map(p => p[1])),
    bottom: Math.max(...all.map(p => p[1]))
  };
  const inlet = map(view.inlet);
  return {
    yaw: view.yaw,
    elevation: ELEVATION,
    outlet: { x: 0, y: 0 },
    inlet: { x: inlet[0], y: inlet[1] },
    bounds,
    polygons,
    // No rotor: nothing on this machine turns in view.
    rotorAfter: polygons.length,
    rotor: null
  };
}

/* ------------------------------------------------------------------------
 *   Outputs
 * ---------------------------------------------------------------------- */

function classesFor(polygon) {
  const classes = ["station-mixer__face", `station-mixer__face--${polygon.tone}`];
  if (polygon.seamless) classes.push("station-mixer__seam", `station-mixer__seam--${polygon.tone}`);
  return classes.join(" ");
}

function standaloneSvg(name, view, rules, machine) {
  const what = machine || "blender";
  const label = what === "core" ? "blender, four-loader (no side storage)" : what;
  const margin = 6;
  const b = view.bounds;
  const viewBox = [b.left - margin, b.top - margin, b.right - b.left + margin * 2, b.bottom - b.top + margin * 2]
    .map(shared.round).join(" ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="station-tsm-${what}-${name}-title"`,
    `     data-view="${name}" data-yaw="${view.yaw}" data-outlet-x="0" data-outlet-y="0" data-inlet-x="${view.inlet.x}" data-inlet-y="${view.inlet.y}">`,
    `  <title id="station-tsm-${what}-${name}-title">Station TSM ${label} — ${name} view</title>`,
    `  <!-- GENERATED by tools/station-tsm/generate.js. Do not edit; edit the tool and regenerate.`,
    `       Coordinates are stage units; the discharge (where the extruder's feed anchor goes) is the`,
    `       origin. Colour comes from station/styles (the mixer's tone classes), inlined here with the`,
    `       token values resolved so the file can be viewed on its own. -->`,
    `  <style>`,
    ...rules.map(rule => `    ${rule}`),
    `  </style>`,
    ...view.polygons.map(p => `  <path class="${classesFor(p)}" data-part="${p.part}" d="${shared.pathData(p.points)}"/>`),
    `</svg>`,
    ``
  ].join("\n");
}

function moduleSource(views, coreViews, downcomerViews, unit) {
  const flat = points => points.map(q => `${q[0]},${q[1]}`).join(", ");
  const literal = view => [
    `      yaw: ${view.yaw},`,
    `      elevation: ${view.elevation},`,
    `      outlet: { x: 0, y: 0 },`,
    `      inlet: { x: ${view.inlet.x}, y: ${view.inlet.y} },`,
    `      bounds: { left: ${view.bounds.left}, top: ${view.bounds.top}, right: ${view.bounds.right}, bottom: ${view.bounds.bottom} },`,
    `      rotorAfter: ${view.rotorAfter},`,
    `      rotor: null,`,
    `      polygons: [`,
    ...view.polygons.map(p => `        { part: "${p.part}", tone: "${p.tone}"${p.seamless ? ", seamless: true" : ""}, points: [${flat(p.points)}] },`),
    `      ]`
  ].join("\n");

  return `/* GENERATED FILE - do not edit.
 *
 * The Station TSM blender artwork, as data. Produced by
 * tools/station-tsm/generate.js; regenerate with:
 *
 *   node tools/station-tsm/generate.js
 *
 * The second blender the stage can draw (station-line-model.js says which
 * lines run it): the gravimetric blender - the white steel hopper with its
 * sight windows over the blue weigh unit - in the same THREE VIEWS as the
 * mixer and the extruder: front (0 deg), intermediate (30 deg), angled
 * (60 deg), at the same assembly scale, so a layer's blender and extruder
 * turn together whichever blender it has.
 *
 * COORDINATES are stage units and the DISCHARGE is the origin: (0, 0) is
 * the bottom of the discharge tube, which is placed on the extruder's feed
 * anchor. \`inlet\` is the centre of the collar's top.
 *
 * There is no rotor: \`rotor\` is null and \`rotorAfter\` is the polygon
 * count, so the renderer paints every polygon in order and nothing else.
 *
 * \`views\` is the six-loader machine, with the side storage (the
 * photographs' 5A and A6 wedges) on each side of the funnel; \`core.views\`
 * is the same body without it - the four-loader machine a core layer runs.
 *
 * \`downcomer\` is the second machine, the same way: the downcomer that
 * stands between the blender's discharge and the extruder's feed on these
 * lines, its outlet at ITS origin.
 *
 * Each polygon carries a TONE from the mixer's vocabulary, and \`seamless\`
 * where it is a curved band's facet. Colour is the stylesheet's
 * (layer-bank.css, the mixer's tone rules).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationTsmAssets = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const views = {
${VIEWS.map(v => `    ${v.name}: {\n${literal(views[v.name])}\n    }`).join(",\n")}
  };

  /* The four-loader machine: the body alone, no side storage. */
  const core = {
${VIEWS.map(v => `    ${v.name}: {\n${literal(coreViews[v.name])}\n    }`).join(",\n")}
  };

  /* The downcomer under the blender: the same three views, its OUTLET at
   * the origin and its \`inlet\` the centre of its top, where the blender's
   * discharge lands. */
  const downcomer = {
${VIEWS.map(v => `    ${v.name}: {\n${literal(downcomerViews[v.name])}\n    }`).join(",\n")}
  };

  return Object.freeze({
    SOURCE: "tools/station-tsm/generate.js",
    // Stage units per source unit: the mixer masters' assembly scale.
    UNIT: ${unit},
    ORDER: Object.freeze(${JSON.stringify(VIEWS.map(v => v.name))}),
    views: Object.freeze(views),
    core: Object.freeze({ ORDER: Object.freeze(${JSON.stringify(VIEWS.map(v => v.name))}), views: Object.freeze(core) }),
    downcomer: Object.freeze({ ORDER: Object.freeze(${JSON.stringify(VIEWS.map(v => v.name))}), views: Object.freeze(downcomer) })
  });
});
`;
}

/* ------------------------------------------------------------------------
 *   Driver
 * ---------------------------------------------------------------------- */

function generate() {
  const views = {};
  const core = {};
  const downcomer = {};
  for (const v of VIEWS) {
    views[v.name] = normalise(render(v.yaw), UNIT);
    core[v.name] = normalise(render(v.yaw, { storage: false }), UNIT);
    downcomer[v.name] = normalise(renderDowncomer(v.yaw), UNIT);
  }
  const rules = shared.stationRules(shared.readTokens(), "station-mixer__");
  const files = {};
  for (const v of VIEWS) {
    files[path.join(ASSET_DIR, v.file)] = standaloneSvg(v.name, views[v.name], rules, "blender");
    files[path.join(ASSET_DIR, v.coreFile)] = standaloneSvg(v.name, core[v.name], rules, "core");
    files[path.join(ASSET_DIR, v.downcomerFile)] = standaloneSvg(v.name, downcomer[v.name], rules, "downcomer");
  }
  files[MODULE_PATH] = moduleSource(views, core, downcomer, UNIT);
  return { views, core, downcomer, unit: UNIT, files };
}

function main(argv) {
  const check = argv.includes("--check");
  const { files } = generate();
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
    console.log("station tsm assets are up to date");
  } else if (!stale) {
    console.log("station tsm assets already up to date");
  }
}

module.exports = { generate, render, renderDowncomer, normalise, UNIT, ELEVATION, VIEWS, ASSET_DIR, MODULE_PATH, MACHINE: M, DOWNCOMER: D };

if (require.main === module) main(process.argv.slice(2));
