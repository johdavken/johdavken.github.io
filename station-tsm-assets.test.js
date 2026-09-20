"use strict";

/* The Station TSM blender artwork is GENERATED (tools/station-tsm/generate.js)
 * and never edited by hand - the same contract as the mixer and the
 * extruder, without masters: the machine is described once, as solids, in
 * the tool. These tests hold the checked-in module and review files to the
 * tool's output, and the artwork to the stage's contract: the mixer's three
 * views and scale, the discharge at the origin, the mixer's tone vocabulary,
 * no rotor.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const tool = require("./tools/station-tsm/generate.js");
const assets = require("./station/station-tsm-assets.js");
const mixerAssets = require("./station/station-mixer-assets.js");
const mixerTool = require("./tools/station-mixer/derive.js");
const extruderAssets = require("./station/station-extruder-assets.js");

const read = file => fs.readFileSync(file, "utf8");

test("the checked-in module and review files are exactly the tool's output", () => {
  const { files } = tool.generate();
  assert.equal(Object.keys(files).length, 7, "the module, three blender views and three downcomer views");
  for (const [file, content] of Object.entries(files)) {
    assert.equal(read(file), content, `${path.relative(ROOT, file)} is stale - run: node tools/station-tsm/generate.js`);
  }
});

test("three views, the mixer's and the extruder's own: the same names, yaws, elevation and assembly scale, so a layer's blender and extruder turn together", () => {
  assert.deepEqual(assets.ORDER, mixerAssets.ORDER);
  assert.deepEqual(assets.ORDER, extruderAssets.ORDER);
  assert.deepEqual(assets.ORDER.map(v => assets.views[v].yaw), extruderAssets.ORDER.map(v => extruderAssets.views[v].yaw));
  assert.deepEqual(assets.ORDER.map(v => assets.views[v].elevation), mixerAssets.ORDER.map(v => mixerAssets.views[v].elevation));
  assert.equal(assets.UNIT, mixerAssets.UNIT);
  assert.equal(tool.ELEVATION, mixerAssets.views.front.elevation);
  assert.ok(Object.isFrozen(assets) && Object.isFrozen(assets.views));
  assert.equal(assets.SOURCE, "tools/station-tsm/generate.js");
});

test("the discharge is the origin in every view, the collar's top is the inlet, and the machine stands about the mixer's height so the extruder lands where it does under the mixer", () => {
  for (const name of assets.ORDER) {
    const view = assets.views[name];
    assert.deepEqual(view.outlet, { x: 0, y: 0 });
    assert.ok(view.bounds.bottom >= 0 && view.bounds.bottom < 4, `${name}: the discharge's foot is not at the origin`);
    // The inlet is the centre of the collar's top; the top's far edge projects a little higher.
    assert.ok(view.inlet.y < view.bounds.top + 16 && view.inlet.y > view.bounds.top - 1, `${name}: the inlet is not at the top`);
    const height = view.bounds.bottom - view.bounds.top;
    const mixerHeight = mixerAssets.views[name].bounds.bottom - mixerAssets.views[name].bounds.top;
    assert.ok(Math.abs(height - mixerHeight) < 12, `${name}: ${height} tall against the mixer's ${mixerHeight}`);
    assert.ok(view.bounds.right - view.bounds.left > 100 && view.bounds.right - view.bounds.left < 160, `${name}: width ${view.bounds.right - view.bounds.left}`);
  }
});

test("every face wears a tone from the mixer's vocabulary - the white hopper light, the weigh unit blue, the windows and the material - and none is a colour; there is no rotor", () => {
  for (const name of assets.ORDER) {
    const view = assets.views[name];
    const tones = new Set(view.polygons.map(p => p.tone));
    for (const tone of tones) assert.ok(mixerTool.TONES.has(tone), `${name}: unknown tone ${tone}`);
    for (const tone of ["light", "blue", "window", "material", "accent", "dark"]) assert.ok(tones.has(tone), `${name}: no ${tone} face`);
    assert.equal(view.rotor, null);
    assert.equal(view.rotorAfter, view.polygons.length);
    for (const polygon of view.polygons) {
      assert.ok(polygon.points.length >= 6 && polygon.points.length % 2 === 0, `${name}: ${polygon.part} is not a polygon`);
      assert.ok(polygon.points.every(Number.isFinite));
      assert.match(polygon.part, /^[a-z-]+$/);
    }
    // The parts the photographs show, each present.
    const parts = new Set(view.polygons.map(p => p.part));
    for (const part of ["outlet-neck", "outlet-flange", "weigh-body", "body-window", "weigh-hood", "funnel", "sight-window", "sight-material", "level-sensor", "collar"]) {
      assert.ok(parts.has(part), `${name}: no ${part}`);
    }
  }
  // The motor stands on the machine's left: seen only when the machine is turned.
  assert.equal(assets.views.front.polygons.some(p => p.part === "motor"), true);
  assert.ok(assets.views.angled.polygons.filter(p => p.part === "motor").length >= 1);
});

test("a face is kept only when it faces the viewer: the funnel's right side shows on the turned views and not on the front; nothing shows its back", () => {
  const funnelFaces = name => assets.views[name].polygons.filter(p => p.part === "funnel").length;
  assert.equal(funnelFaces("front"), 1, "the front view sees the funnel's front alone");
  assert.equal(funnelFaces("intermediate"), 2);
  assert.equal(funnelFaces("angled"), 2);
  // The hood's top, right side and front on a turned view; top and front on the front view.
  assert.equal(assets.views.front.polygons.filter(p => p.part === "weigh-hood").length, 2);
  assert.equal(assets.views.angled.polygons.filter(p => p.part === "weigh-hood").length, 3);
  // Every polygon has positive area on screen (no degenerate or inverted face).
  for (const name of assets.ORDER) {
    for (const polygon of assets.views[name].polygons) {
      let area = 0;
      const p = polygon.points;
      for (let i = 0; i < p.length; i += 2) {
        const j = (i + 2) % p.length;
        area += p[i] * p[j + 1] - p[j] * p[i + 1];
      }
      assert.ok(Math.abs(area) > 0.3, `${name}: ${polygon.part} has no area`);
    }
  }
});

test("the review files are standalone: the mixer's tone rules inlined with tokens resolved, one path per polygon, the discharge at the origin", () => {
  for (const name of assets.ORDER) {
    const svg = read(path.join(tool.ASSET_DIR, `tsm-${name}.svg`));
    assert.match(svg, /data-outlet-x="0" data-outlet-y="0"/);
    assert.equal((svg.match(/<path\b/g) || []).length, assets.views[name].polygons.length);
    assert.match(svg, /\.station-mixer__face--blue \{ fill: #/);
    assert.doesNotMatch(svg, /var\(--station-(?!mixer)/, "an unresolved token");
    assert.match(svg, /GENERATED by tools\/station-tsm\/generate\.js/);
  }
});

test("the downcomer: the same three views, its outlet at the origin and its inlet at the top of its upper drum, a third the blender's height, the grey and black drums with their sight glasses, no rotor", () => {
  const dc = assets.downcomer;
  assert.deepEqual(dc.ORDER, assets.ORDER);
  for (const name of assets.ORDER) {
    const view = dc.views[name];
    assert.equal(view.yaw, assets.views[name].yaw);
    assert.deepEqual(view.outlet, { x: 0, y: 0 });
    assert.ok(view.bounds.bottom >= 0 && view.bounds.bottom < 8, `${name}: the outlet is not at the origin`);
    assert.ok(view.inlet.y < view.bounds.top + 8 && view.inlet.y >= view.bounds.top - 1, `${name}: the inlet is not at the top`);
    assert.equal(view.inlet.x, 0);
    const height = view.bounds.bottom - view.bounds.top;
    const blenderHeight = assets.views[name].bounds.bottom - assets.views[name].bounds.top;
    assert.ok(height > blenderHeight * 0.5 && height < blenderHeight * 0.75, `${name}: ${height} tall against the blender's ${blenderHeight}`);
    assert.ok(view.bounds.right - view.bounds.left < 60, `${name}: too wide for a downcomer`);
    assert.equal(view.rotor, null);
    assert.equal(view.rotorAfter, view.polygons.length);
    const parts = new Set(view.polygons.map(p => p.part));
    for (const part of ["outlet", "lower-cone", "lower-drum", "lower-glass", "frame-post", "name-ring", "neck", "upper-cone", "upper-drum", "upper-glass"]) {
      assert.ok(parts.has(part), `${name}: no ${part}`);
    }
    const tones = new Set(view.polygons.map(p => p.tone));
    for (const tone of tones) assert.ok(mixerTool.TONES.has(tone), `${name}: unknown tone ${tone}`);
    for (const tone of ["dark", "light", "window", "material"]) assert.ok(tones.has(tone), `${name}: no ${tone} face`);
    const svg = read(path.join(tool.ASSET_DIR, `tsm-downcomer-${name}.svg`));
    assert.equal((svg.match(/<path\b/g) || []).length, view.polygons.length);
    assert.match(svg, /Station TSM downcomer/);
  }
});

test("both hosts load the module, after the mixer's and before the layout that places it", () => {
  const host = read("station-host.js");
  const scripts = host.slice(host.indexOf("const SCRIPTS = ["), host.indexOf("];", host.indexOf("const SCRIPTS = [")));
  const at = name => scripts.indexOf(`"station/${name}"`);
  assert.ok(at("station-tsm-assets.js") > at("station-mixer-assets.js"));
  assert.ok(at("station-tsm-assets.js") < at("station-machine-layout.js"));
  const harness = read("station/station.html");
  assert.match(harness, /<script src="station-tsm-assets\.js\?v=[^"]+" defer><\/script>/);
  assert.ok(harness.indexOf("station-tsm-assets.js") < harness.indexOf('src="station-machine-layout.js'));
});
