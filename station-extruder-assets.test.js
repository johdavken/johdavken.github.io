"use strict";

/* The Station extruder artwork is DERIVED from authored assets, never drawn
 * by hand and never edited by hand. These tests hold the two ends of that:
 * the sources stay rich and untouched, and everything the stage draws is
 * exactly what tools/station-extruder/derive.js produces from them today.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const derive = require("./tools/station-extruder/derive.js");
const assets = require("./station/station-extruder-assets.js");

const sourceFile = view => path.join(derive.SOURCE_DIR, `extruder-${view}.svg`);
const derivedFile = view => path.join(derive.ASSET_DIR, `extruder-${view}.svg`);
const read = file => fs.readFileSync(file, "utf8");

/* ----------------------------------------------------------------------
 *   The sources are preserved
 * -------------------------------------------------------------------- */

test("the authored sources are still the rich originals, not overwritten by their derivatives", () => {
  for (const view of assets.ORDER) {
    const svg = read(sourceFile(view));
    const paths = (svg.match(/<path\b/g) || []).length;
    assert.ok(paths > 200, `${view}: the source has only ${paths} paths - was it replaced?`);
    assert.match(svg, /<linearGradient/, `${view}: the source lost its gradients`);
    // The parts the derivative drops are still there to be dropped.
    for (const part of ["vent-slot", "motor-fin", "flange-bolt-hole", "leveling-bolt", "terminal-box"]) {
      assert.ok(svg.includes(`data-part="${part}"`), `${view}: source has no ${part}`);
    }
  }
});

test("there is no fourth, hand-edited asset - three sources, three derivatives", () => {
  const sources = fs.readdirSync(derive.SOURCE_DIR).filter(f => f.endsWith(".svg") && f.startsWith("extruder-"));
  const derived = fs.readdirSync(derive.ASSET_DIR).filter(f => f.endsWith(".svg") && f.startsWith("extruder-"));
  assert.deepEqual(sources.sort(), assets.ORDER.map(v => `extruder-${v}.svg`).sort());
  assert.deepEqual(derived.sort(), assets.ORDER.map(v => `extruder-${v}.svg`).sort());
});

/* ----------------------------------------------------------------------
 *   The derivatives are exactly the tool's output
 * -------------------------------------------------------------------- */

test("the checked-in derivatives and the asset module are up to date with the sources and the tool", () => {
  const { files } = derive.derive();
  for (const [file, content] of Object.entries(files)) {
    assert.equal(read(file), content,
      `${path.relative(ROOT, file)} is stale - run: node tools/station-extruder/derive.js`);
  }
});

test("the tool is deterministic", () => {
  const a = derive.derive();
  const b = derive.derive();
  assert.deepEqual(a.files, b.files);
  assert.equal(a.unit, b.unit);
});

/* ----------------------------------------------------------------------
 *   What was kept, what was dropped
 * -------------------------------------------------------------------- */

test("the derivative keeps the parts that carry recognition and nothing that is under a pixel", () => {
  const kept = new Set(Object.values(derive.KEEP));
  for (const view of assets.ORDER) {
    const parts = new Set(assets.views[view].polygons.map(p => p.part));
    for (const part of ["housing", "feed", "outlet", "flange", "recess", "bore", "gearbox", "motor", "base", "foot"]) {
      assert.ok(parts.has(part), `${view}: missing ${part}`);
    }
    for (const part of parts) assert.ok(kept.has(part), `${view}: unexpected part ${part}`);
    // The source's fine detail is gone by name.
    const svg = read(derivedFile(view));
    for (const dropped of ["vent-slot", "vent-lip", "motor-fin", "fan-cover", "terminal-box",
      "gearbox-bolt", "feed-bolt", "end-panel-bolt", "flange-bolt-hole", "machined-face",
      "housing-gasket", "lower-fold", "motor-mount", "gearbox-cover"]) {
      assert.ok(!svg.includes(`data-part="${dropped}"`), `${view}: ${dropped} survived`);
    }
  }
});

test("the detail budget: a fraction of the source's paths, and no render-style shading", () => {
  for (const view of assets.ORDER) {
    const sourcePaths = (read(sourceFile(view)).match(/<path\b/g) || []).length;
    const count = assets.views[view].polygons.length;
    assert.ok(count <= 60, `${view}: ${count} polygons is not a simplification`);
    assert.ok(count < sourcePaths / 4, `${view}: ${count} of ${sourcePaths} paths kept`);
    const svg = read(derivedFile(view));
    assert.doesNotMatch(svg, /<linearGradient|<radialGradient|<filter/, `${view}: gradients or filters survived`);
    assert.doesNotMatch(svg, /<path[^>]*\b(fill|stroke|stroke-width)=/, `${view}: a path carries its own colour`);
  }
});

test("each cylinder is one band and one cap, not two dozen facets", () => {
  for (const view of assets.ORDER) {
    const of = part => assets.views[view].polygons.filter(p => p.part === part);
    for (const part of ["motor", "outlet", "flange"]) {
      assert.deepEqual(of(part).map(p => p.face).sort(), ["cap", "round"], `${view}: ${part} is not band + cap`);
    }
    // And no polygon is finer than the size it is drawn at needs.
    for (const polygon of assets.views[view].polygons) {
      assert.ok(polygon.points.length / 2 <= 40, `${view}: a ${polygon.part} polygon has ${polygon.points.length / 2} points`);
    }
  }
});

test("the feed is painted on top of the housing it stands on - the one departure from the source's paint order", () => {
  // The source sorts the feed neck and flange behind the housing, which
  // hides the feed in the front view and cuts it off at the barrel's rear
  // top edge in the turned ones - so the mixer looked as if it stood off
  // the back of the extruder. The feed's base is on the housing top in
  // every view; it is drawn after every housing face, and nothing else moves.
  for (const view of assets.ORDER) {
    const polygons = assets.views[view].polygons;
    const lastHousing = polygons.map(p => p.part).lastIndexOf("housing");
    const firstFeed = polygons.findIndex(p => p.part === "feed");
    assert.ok(firstFeed > lastHousing, `${view}: the feed is painted behind the housing`);
    // And the feed is one contiguous run right after the housing, so the
    // gearbox behind it and the outlet beyond it keep their source order.
    const feedRun = polygons.slice(firstFeed).findIndex(p => p.part !== "feed");
    const feedCount = polygons.filter(p => p.part === "feed").length;
    assert.equal(firstFeed, lastHousing + 1, `${view}: the feed was moved further than it needed`);
    assert.ok(feedRun === -1 || feedRun === feedCount, `${view}: the feed run is split`);
    // Where it stands: the feed's lowest point lies on the housing top
    // face's screen band, i.e. it is on the barrel, not behind it.
    const feedBottom = Math.max(...polygons.filter(p => p.part === "feed").flatMap(p => p.points.filter((_, i) => i % 2 === 1)));
    const housingTop = polygons.find(p => p.part === "housing" && p.face === "top");
    const ys = housingTop.points.filter((_, i) => i % 2 === 1);
    assert.ok(feedBottom > Math.min(...ys) && feedBottom < Math.max(...ys), `${view}: the feed does not stand on the housing top`);
  }
});

/* ----------------------------------------------------------------------
 *   The contract the renderer relies on
 * -------------------------------------------------------------------- */

test("every view is in stage units with the feed anchor at the origin", () => {
  assert.equal(assets.views.front.bounds.bottom, assets.MACHINE_HEIGHT);
  for (const view of assets.ORDER) {
    const v = assets.views[view];
    assert.deepEqual(v.feed, { x: 0, y: 0 });
    // The origin is inside the machine, not off to one side of it.
    assert.ok(v.bounds.left < 0 && v.bounds.right > 0 && v.bounds.top < 0 && v.bounds.bottom > 0);
    // And the feed flange's top face really is centred on it.
    const flangeTops = v.polygons.filter(p => p.part === "feed" && p.face === "top");
    assert.ok(flangeTops.length >= 1);
    const centred = flangeTops.some(p => {
      const xs = p.points.filter((_, i) => i % 2 === 0);
      const ys = p.points.filter((_, i) => i % 2 === 1);
      const cx = xs.reduce((a, b) => a + b) / xs.length;
      const cy = ys.reduce((a, b) => a + b) / ys.length;
      return Math.abs(cx) < 0.05 && Math.abs(cy) < 0.05;
    });
    assert.ok(centred, `${view}: no feed top face is centred on the origin`);
  }
});

test("every view faces the same way, so mirroring is the renderer's job", () => {
  // The outlet is at or left of the feed in every source view: there is no
  // left-hand artwork, and a left-hand layer is the renderer's reflection.
  assert.equal(assets.views.front.outlet.x, 0);
  assert.ok(assets.views.intermediate.outlet.x < 0);
  assert.ok(assets.views.angled.outlet.x < assets.views.intermediate.outlet.x);
  assert.deepEqual(assets.ORDER, ["front", "intermediate", "angled"]);
  assert.deepEqual(assets.ORDER.map(v => assets.views[v].yaw), [0, 30, 60]);
});

test("the standalone derivative and the module agree, polygon for polygon", () => {
  for (const view of assets.ORDER) {
    const svg = read(derivedFile(view));
    const paths = [...svg.matchAll(/<path class="([^"]+)" data-part="([^"]+)" data-face="([^"]+)" d="M([^"]+) Z"\/>/g)];
    assert.equal(paths.length, assets.views[view].polygons.length);
    paths.forEach((match, i) => {
      const polygon = assets.views[view].polygons[i];
      assert.equal(match[2], polygon.part);
      assert.equal(match[3], polygon.face);
      const points = match[4].split(" L").map(pair => pair.split(",").map(Number)).flat();
      assert.deepEqual(points, polygon.points);
    });
    // The file's metadata is the module's.
    assert.ok(svg.includes(`data-yaw="${assets.views[view].yaw}"`));
    assert.ok(svg.includes(`data-outlet-x="${assets.views[view].outlet.x}"`));
  }
});

test("the standalone derivative is styled by the product's own rules, with every token resolved", () => {
  const rules = read(path.join(ROOT, "station/styles/components/layer-bank.css"));
  for (const view of assets.ORDER) {
    const svg = read(derivedFile(view));
    const style = svg.match(/<style>([\s\S]*?)<\/style>/)[1];
    assert.doesNotMatch(style, /var\(/, `${view}: an unresolved token reached the standalone file`);
    // Every class the file uses has a rule in the file.
    for (const className of new Set(svg.match(/station-extruder__[a-z-]+/g))) {
      assert.ok(style.includes(`.${className}`), `${view}: ${className} has no rule in the standalone style`);
      assert.ok(rules.includes(`.${className}`), `${view}: ${className} has no rule in layer-bank.css`);
    }
  }
});

/* ----------------------------------------------------------------------
 *   Loading
 * -------------------------------------------------------------------- */

test("the asset module is loaded by both Station entry points, before the layout that reads it", () => {
  const harness = read(path.join(ROOT, "station/station.html"));
  const host = read(path.join(ROOT, "station-host.js"));
  for (const [name, source] of [["station.html", harness], ["station-host.js", host]]) {
    const at = source.indexOf("station-extruder-assets.js");
    const layout = source.indexOf("station-machine-layout.js");
    assert.ok(at > 0, `${name} does not load the asset module`);
    assert.ok(at < layout, `${name} loads the asset module after the layout`);
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
