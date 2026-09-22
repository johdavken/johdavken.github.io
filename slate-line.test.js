"use strict";

/* slate-line.js: the line as Slate lists it, from a snapshot. */

const test = require("node:test");
const assert = require("node:assert/strict");

const line = require("./slate/slate-line.js");
const demo = require("./slate/slate-demo.js");

function snapshot(layerCount, options) {
  const settings = options || {};
  return {
    line: {
      lineNumber: settings.lineNumber === undefined ? 5 : settings.lineNumber,
      displayName: settings.displayName === undefined ? "Line 5" : settings.displayName,
      layerCount,
      layerAPosition: settings.layerAPosition === undefined ? "inside" : settings.layerAPosition,
      hopperNamingMode: settings.hopperNamingMode || "standard",
      hopperCounts: settings.hopperCounts === undefined ? null : settings.hopperCounts,
      linked: settings.linked !== false
    },
    layers: Array.from({ length: layerCount }, (_, index) => ({
      name: String.fromCharCode(65 + index),
      layerPct: 100 / layerCount,
      hoppers: Array.from({ length: 6 }, (_, hopper) => ({ index: hopper, pct: 0, resinName: "", effectiveWeight: 0, track: false, pumpOff: false }))
    }))
  };
}

test("roles derive from the physical stack: one layer is single, ends are outside/inside, an odd middle is the core", () => {
  assert.equal(line.roleForStackIndex(0, 1), "single");
  assert.deepEqual([0, 1, 2].map(i => line.roleForStackIndex(i, 3)), ["outside", "core", "inside"]);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => line.roleForStackIndex(i, 5)), ["outside", "subskin-outside", "core", "subskin-inside", "inside"]);
  // An even count has no single middle and gets no core.
  assert.deepEqual([0, 1, 2, 3].map(i => line.roleForStackIndex(i, 4)), ["outside", "subskin-outside", "subskin-inside", "inside"]);
  assert.equal(line.roleLabel("subskin-inside"), "Inside subskin");
  assert.equal(line.roleTone("subskin-outside"), "subskin");
  assert.equal(line.roleTone("subskin-inside"), "subskin");
  assert.equal(line.roleTone("nonsense"), "single");
});

test("layers are listed in recipe order; Layer A inside reverses the physical index", () => {
  const inside = line.buildLineModel(snapshot(3, { layerAPosition: "inside" }));
  assert.deepEqual(inside.layers.map(layer => [layer.id, layer.role]), [["A", "inside"], ["B", "core"], ["C", "outside"]]);
  const outside = line.buildLineModel(snapshot(3, { layerAPosition: "outside" }));
  assert.deepEqual(outside.layers.map(layer => [layer.id, layer.role]), [["A", "outside"], ["B", "core"], ["C", "inside"]]);
  assert.equal(inside.line.orientationKnown, true);
  const unknown = line.buildLineModel(snapshot(3, { layerAPosition: null }));
  assert.equal(unknown.line.orientationKnown, false);
  assert.deepEqual(unknown.layers.map(layer => layer.role), ["outside", "core", "inside"], "unknown orientation reads recipe order as physical");
  assert.equal(line.buildLineModel(snapshot(1)).line.orientationKnown, true);
});

test("hopper ids follow the naming mode, and the line's counts cap the session's slots", () => {
  const standard = line.buildLineModel(snapshot(3, { hopperCounts: [6, 4, 6] }));
  assert.deepEqual(standard.layers.map(layer => layer.hopperCount), [6, 4, 6]);
  assert.deepEqual(standard.layers[1].hoppers.map(hopper => hopper.id), ["B1", "B2", "B3", "B4"]);
  assert.equal(standard.hopperCount, 16);

  const main = line.buildLineModel(snapshot(1, { hopperNamingMode: "main-plus-five" }));
  assert.deepEqual(main.layers[0].hoppers.map(hopper => hopper.id), ["AM", "A1", "A2", "A3", "A4", "A5"]);
  assert.deepEqual(main.layers[0].hoppers.map(hopper => hopper.positionLabel), ["Main", "1", "2", "3", "4", "5"]);

  // Never more than the snapshot carries, and a bad count is ignored.
  const capped = line.buildLineModel(snapshot(2, { hopperCounts: [9, null] }));
  assert.deepEqual(capped.layers.map(layer => layer.hopperCount), [6, 6]);
});

test("a snapshot with no layers is no model; a headless snapshot still lists its layers", () => {
  assert.equal(line.buildLineModel(null), null);
  assert.equal(line.buildLineModel({ layers: [] }), null);
  const bare = line.buildLineModel({ layers: [{ name: "A", layerPct: 100, hoppers: [{ index: 0 }] }] });
  assert.equal(bare.line.lineNumber, null);
  assert.equal(bare.line.linked, false);
  assert.equal(bare.layers[0].role, "single");
  assert.equal(line.lineTitle(bare), "This device");
});

test("the title prefers the display name, then the line number", () => {
  assert.equal(line.lineTitle(line.buildLineModel(snapshot(1))), "Line 5");
  assert.equal(line.lineTitle(line.buildLineModel(snapshot(1, { displayName: null, lineNumber: 11 }))), "Line 11");
  assert.equal(line.lineTitle(null), "No line");
});

test("the demo snapshot is in the bridge's shape and builds a three-layer model", () => {
  const model = line.buildLineModel(demo.snapshot(1000));
  assert.equal(model.line.layerCount, 3);
  assert.deepEqual(model.layers.map(layer => layer.hopperCount), [6, 4, 6]);
  assert.equal(model.line.linked, false);
  const snap = demo.snapshot(1000);
  assert.deepEqual(Object.keys(snap).sort(), ["history", "job", "layers", "line", "lots", "nextRecipe", "revision", "smartHoppers", "sources"]);
  assert.equal(snap.job.changeoverSetAt, 1000);
  assert.match(snap.job.changeoverTime, /^\d\d:\d\d$/);
  // The model's shape is what station-rundown's projectEntries reads.
  for (const layer of model.layers) {
    assert.ok(typeof layer.id === "string" && typeof layer.role === "string");
    for (const hopper of layer.hoppers) assert.ok(Number.isInteger(hopper.index) && typeof hopper.id === "string");
  }
});
