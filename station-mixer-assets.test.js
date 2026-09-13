"use strict";

/* The Station mixer artwork is DERIVED from authored assets, never drawn by
 * hand and never edited by hand - the same contract as the extruder. The
 * masters are final (corrections go upstream, in tools/mixer-svg/), so the
 * derivative is the master whole: rescaled, its colour moved into classes,
 * and the rotor lifted out of the door. These tests hold it to that.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const derive = require("./tools/station-mixer/derive.js");
const assets = require("./station/station-mixer-assets.js");
const extruderAssets = require("./station/station-extruder-assets.js");

const sourceFile = view => path.join(derive.SOURCE_DIR, `mixer-${view}.svg`);
const derivedFile = view => path.join(derive.ASSET_DIR, `mixer-${view}.svg`);
const read = file => fs.readFileSync(file, "utf8");
const ys = polygon => polygon.points.filter((_, i) => i % 2 === 1);
const xs = polygon => polygon.points.filter((_, i) => i % 2 === 0);

/* ----------------------------------------------------------------------
 *   The masters are preserved
 * -------------------------------------------------------------------- */

test("the authored masters are still the full originals, not overwritten by their derivatives", () => {
  for (const view of assets.ORDER) {
    const svg = read(sourceFile(view));
    const paths = (svg.match(/<path\b/g) || []).length;
    assert.ok(paths >= 136, `${view}: the master has only ${paths} paths - was it replaced?`);
    // The parts the derivative drops are still there to be dropped.
    for (const part of ["fastener", "air-regulator", "pressure-gauge", "feed-guard-post", "weigh-mount", "discharge-collar"]) {
      assert.ok(svg.includes(`data-part="${part}"`), `${view}: master has no ${part}`);
    }
    // And the master still stands on its folded feet.
    assert.match(svg, /data-part="front-upright" d="M[^"]*L[^"]*L[^"]*L[^"]*L[^"]*L[^"]*Z"/, `${view}: master uprights are not the six-vertex flared shape`);
  }
});

test("three masters, three derivatives, in the same three views as the extruder", () => {
  const sources = fs.readdirSync(derive.SOURCE_DIR).filter(f => /^mixer-.*\.svg$/.test(f));
  const derived = fs.readdirSync(derive.ASSET_DIR).filter(f => /^mixer-.*\.svg$/.test(f));
  assert.deepEqual(sources.sort(), assets.ORDER.map(v => `mixer-${v}.svg`).sort());
  assert.deepEqual(derived.sort(), assets.ORDER.map(v => `mixer-${v}.svg`).sort());
  assert.deepEqual(assets.ORDER, extruderAssets.ORDER);
  assert.deepEqual(assets.ORDER.map(v => assets.views[v].yaw), extruderAssets.ORDER.map(v => extruderAssets.views[v].yaw));
});

/* ----------------------------------------------------------------------
 *   The derivatives are exactly the tool's output
 * -------------------------------------------------------------------- */

test("the checked-in derivatives and the asset module are up to date with the masters and the tool", () => {
  const { files } = derive.derive();
  for (const [file, content] of Object.entries(files)) {
    assert.equal(read(file), content,
      `${path.relative(ROOT, file)} is stale - run: node tools/station-mixer/derive.js`);
  }
});

/* ----------------------------------------------------------------------
 *   The masters are carried whole
 * -------------------------------------------------------------------- */

/* The master's paths, in order, with what the derivative has to reproduce
 * of each: the part, the tone, whether it is stroked in its own colour, and
 * the outline. */
function masterPaths(view) {
  const svg = read(sourceFile(view));
  return [...svg.matchAll(/<path class="mixer__([a-z]+)" data-part="([a-z-]+)" d="M([^"]+) Z" fill="(#[0-9a-f]{6})" stroke="(#[0-9a-f]{6})"/g)]
    .map(m => ({
      tone: m[1], part: m[2], fill: m[4], stroke: m[5], seamless: m[4] === m[5],
      points: m[3].split(" L").map(pair => pair.split(",").map(Number)).flat()
    }));
}

test("every path of the master is in the derivative, in the master's order, and nothing is added", () => {
  for (const view of assets.ORDER) {
    const master = masterPaths(view);
    const derived = assets.views[view].polygons;
    const glimpses = master.filter(p => p.part === "agitator-glimpse");
    assert.equal(glimpses.length, 2, `${view}: the master has ${glimpses.length} agitator glimpses`);
    // Everything except the two glimpses, which become the rotor.
    const drawn = master.filter(p => p.part !== "agitator-glimpse");
    assert.equal(derived.length, drawn.length, `${view}: ${derived.length} polygons for ${drawn.length} master paths`);
    drawn.forEach((path, i) => {
      assert.equal(derived[i].part, path.part, `${view}: polygon ${i} is ${derived[i].part}, the master's is ${path.part}`);
      assert.equal(derived[i].tone, path.tone, `${view}: ${path.part} changed tone`);
      assert.equal(derived[i].points.length, path.points.length, `${view}: ${path.part} lost or gained vertices`);
    });
    // Every part the master draws is drawn - including all the hardware an
    // earlier, reducing version of the tool dropped.
    const parts = new Set(derived.map(p => p.part));
    for (const part of new Set(drawn.map(p => p.part))) {
      assert.ok(parts.has(part), `${view}: ${part} is missing - the derivative is editing the master`);
    }
    for (const part of ["fastener", "cover-knob", "door-hinge", "feed-guard-post", "air-regulator", "pressure-gauge", "air-hose", "discharge-collar"]) {
      assert.ok(parts.has(part), `${view}: ${part} is missing`);
    }
  }
});

test("the derivative is the master scaled by UNIT about the discharge - nothing moved, nothing squared off", () => {
  assert.equal(assets.UNIT, derive.UNIT);
  // The masters' own assembly scale (tools/mixer-svg/assemble.py places the
  // blender on the Station extruder at .42), so the stage shows what the
  // masters' previews show.
  assert.equal(assets.UNIT, 0.42);
  for (const view of assets.ORDER) {
    const drawn = masterPaths(view).filter(p => p.part !== "agitator-glimpse");
    const derived = assets.views[view].polygons;
    drawn.forEach((path, i) => {
      path.points.forEach((value, k) => {
        assert.ok(Math.abs(derived[i].points[k] - value * assets.UNIT) < 0.006,
          `${view}: ${path.part} vertex ${k >> 1} moved`);
      });
    });
    // The discharge stays at the origin, the inlet is the master's, scaled.
    const svg = read(sourceFile(view));
    const inletY = Number(svg.match(/data-inlet-y="([^"]+)"/)[1]);
    assert.ok(Math.abs(assets.views[view].inlet.y - inletY * assets.UNIT) < 0.006);
    assert.equal(assets.views[view].inlet.x, 0);
  }
});

test("colour leaves the paths and the master's two stroke treatments become classes", () => {
  for (const view of assets.ORDER) {
    const svg = read(derivedFile(view));
    assert.doesNotMatch(svg, /<linearGradient|<radialGradient|<filter/);
    assert.doesNotMatch(svg, /<path[^>]*\b(fill|stroke|stroke-width)=/, `${view}: a path carries its own colour`);
    const drawn = masterPaths(view).filter(p => p.part !== "agitator-glimpse");
    const derived = assets.views[view].polygons;
    drawn.forEach((path, i) => {
      // The master strokes a face either in the shared edge colour or in
      // its own fill (a curved band's facet). Only the second is "seamless".
      assert.ok(path.seamless || path.stroke === derive.EDGE_STROKE, `${view}: ${path.part} has a third stroke treatment`);
      assert.equal(Boolean(derived[i].seamless), path.seamless, `${view}: ${path.part} seam treatment changed`);
    });
    // And the standalone file says the same with classes.
    const classes = [...svg.matchAll(/<path class="([^"]+)" data-part=/g)].map(m => m[1]);
    assert.equal(classes.length, derived.length);
    classes.forEach((list, i) => {
      const expected = [`station-mixer__face`, `station-mixer__face--${derived[i].tone}`]
        .concat(derived[i].seamless ? [`station-mixer__seam`, `station-mixer__seam--${derived[i].tone}`] : []);
      assert.equal(list, expected.join(" "), `${view}: polygon ${i} classes`);
    });
  }
});

test("nothing of the machine hangs below its discharge but the base plate's own near corner", () => {
  for (const view of assets.ORDER) {
    const lowest = Math.max(...assets.views[view].polygons.flatMap(ys));
    assert.ok(lowest < 4, `${view}: something reaches ${lowest} below the discharge`);
  }
});

/* ----------------------------------------------------------------------
 *   The contract the renderer relies on
 * -------------------------------------------------------------------- */

test("every view is in stage units with the discharge at the origin and the frame above it", () => {
  for (const view of assets.ORDER) {
    const v = assets.views[view];
    assert.deepEqual(v.outlet, { x: 0, y: 0 });
    assert.ok(v.bounds.top < -100 && v.bounds.bottom < 5, `${view}: the machine does not hang above its discharge`);
    assert.ok(v.bounds.left < 0 && v.bounds.right > 0);
    // The inlet is centred above, where the hoppers are.
    assert.equal(v.inlet.x, 0);
    assert.ok(v.inlet.y < v.bounds.top + 15);
  }
  // The chamber is the master's (radius 77) at UNIT.
  const cap = assets.views.front.polygons.find(p => p.part === "mixing-chamber" && p.points.length === 96);
  assert.ok(Math.abs((Math.max(...xs(cap)) - Math.min(...xs(cap))) - 154 * assets.UNIT) < 0.5);
});

test("the rotor is four paddles in the plane of the door, clipped by two windows", () => {
  for (const view of assets.ORDER) {
    const r = assets.views[view].rotor;
    assert.equal(r.paddles.length, 4);
    assert.equal(r.windows.length, 2);
    // The second pair is the first pair through the centre.
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(r.paddles[i + 2], r.paddles[i].map(v => (v === 0 ? 0 : -v)));
    }
    // The plane is the view's own camera: x foreshortened by cos(yaw), y by cos(elevation).
    const yaw = (assets.views[view].yaw * Math.PI) / 180;
    assert.ok(Math.abs(r.plane.a - Math.cos(yaw)) < 0.01);
    assert.ok(Math.abs(r.plane.d + Math.cos((12 * Math.PI) / 180)) < 0.01);
    assert.equal(r.plane.c, 0);
    // The centre is the inspection cover's centre.
    // `points` is flat, so 96 numbers is the complete 48-vertex disc.
    const cover = assets.views[view].polygons.find(p => p.part === "inspection-cover" && p.points.length === 96);
    const cx = xs(cover).reduce((a, b) => a + b) / (cover.points.length / 2);
    const cy = ys(cover).reduce((a, b) => a + b) / (cover.points.length / 2);
    assert.ok(Math.hypot(cx - r.centre.x, cy - r.centre.y) < 0.6, `${view}: rotor is off the cover's centre`);
    // At rest, every paddle projects inside the cover.
    const radius = (Math.max(...ys(cover)) - Math.min(...ys(cover))) / 2;
    for (const paddle of r.paddles) {
      for (let i = 0; i < paddle.length; i += 2) {
        assert.ok(Math.hypot(paddle[i], paddle[i + 1]) < radius, `${view}: a paddle reaches outside the door`);
      }
    }
    // Paint order: the rotor goes in after the windows and before the frame.
    const parts = assets.views[view].polygons.map(p => p.part);
    assert.equal(parts.slice(0, assets.views[view].rotorAfter).filter(p => p === "inspection-window").length, 2);
    assert.ok(!parts.slice(assets.views[view].rotorAfter).includes("inspection-window"));
    assert.ok(parts.slice(assets.views[view].rotorAfter).includes("front-upright"));
  }
});

test("every tone the module emits has a rule, and the standalone file resolves every token", () => {
  const rules = read(path.join(ROOT, "station/styles/components/layer-bank.css"));
  for (const view of assets.ORDER) {
    for (const tone of new Set(assets.views[view].polygons.map(p => p.tone))) {
      assert.ok(rules.includes(`.station-mixer__face--${tone}`), `${view}: no rule for tone ${tone}`);
    }
    const svg = read(derivedFile(view));
    const style = svg.match(/<style>([\s\S]*?)<\/style>/)[1];
    assert.doesNotMatch(style, /var\(/, `${view}: an unresolved token reached the standalone file`);
    for (const className of new Set(svg.match(/station-mixer__[a-z-]+/g))) {
      assert.ok(style.includes(`.${className}`), `${view}: ${className} has no rule in the standalone style`);
    }
    // The standalone file carries the rotor at rest, clipped like the stage's.
    assert.match(svg, /<clipPath id="station-mixer-[a-z]+-windows">/);
    assert.equal((svg.match(/class="station-mixer__blade"/g) || []).length, 4);
  }
});

/* ----------------------------------------------------------------------
 *   Loading
 * -------------------------------------------------------------------- */

test("the asset module is loaded by both Station entry points, before the layout that reads it", () => {
  const harness = read(path.join(ROOT, "station/station.html"));
  const host = read(path.join(ROOT, "station-host.js"));
  for (const [name, source] of [["station.html", harness], ["station-host.js", host]]) {
    const at = source.indexOf("station-mixer-assets.js");
    const layout = source.indexOf("station-machine-layout.js");
    assert.ok(at > 0, `${name} does not load the mixer asset module`);
    assert.ok(at < layout, `${name} loads the mixer asset module after the layout`);
  }
});

test("the asset module is inert data - no DOM, no storage, no network, frozen", () => {
  const source = read(derive.MODULE_PATH);
  for (const pattern of [/\bdocument\b/, /localStorage/, /\bfetch\s*\(/, /XMLHttpRequest/, /supabase/i]) {
    assert.doesNotMatch(source, pattern);
  }
  assert.match(source, /GENERATED FILE - do not edit/);
  assert.ok(Object.isFrozen(assets));
  assert.ok(Object.isFrozen(assets.views));
});
