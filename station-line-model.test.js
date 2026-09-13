"use strict";

/* The Station model is the file that decides what the machine IS, so these
 * tests are about the two things that would quietly turn Station back into a
 * hard-coded five-layer machine: a layer count that isn't really configurable,
 * and a hopper count that isn't really configurable.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const model = require("./station/station-line-model.js");
const lineIdentity = require("./line-identity.js");
const payloads = require("./workspace-configuration-payloads.js");

function literal(overrides) {
  return Object.assign({
    lineNumber: 1,
    displayName: "Test line",
    layerCount: 3,
    layerAPosition: "outside",
    hopperNamingMode: "standard",
    hopperGeometry: "cylindrical"
  }, overrides);
}

/* ----------------------------------------------------------------------
 *   Layer count drives the layer modules
 * -------------------------------------------------------------------- */

test("a 1-layer configuration produces exactly one layer", () => {
  const built = model.buildLineModel(literal({ layerCount: 1, layerAPosition: null }));
  assert.equal(built.layers.length, 1);
  assert.deepEqual(built.layers.map(layer => layer.id), ["A"]);
  assert.equal(built.line.singleLayer, true);
});

test("a 3-layer configuration produces exactly three layers", () => {
  const built = model.buildLineModel(literal({ layerCount: 3 }));
  assert.equal(built.layers.length, 3);
  assert.deepEqual(built.layers.map(layer => layer.id), ["A", "B", "C"]);
});

test("a 5-layer configuration produces exactly five layers", () => {
  const built = model.buildLineModel(literal({ layerCount: 5 }));
  assert.equal(built.layers.length, 5);
  assert.deepEqual(built.layers.map(layer => layer.id), ["A", "B", "C", "D", "E"]);
});

test("layer names come from the payload module, not from a second table", () => {
  for (const count of [1, 3, 5]) {
    const built = model.buildLineModel(literal({ layerCount: count, layerAPosition: count === 1 ? null : "outside" }));
    assert.deepEqual(built.layers.map(layer => layer.id), payloads.expectedLayerNames(count));
  }
});

test("a layer count the payload module does not define still renders, with generated names", () => {
  // Line configurations validate 1-9 layers, so a 4-layer line is a legal
  // thing to configure even though no recipe payload shape exists for it.
  // Station must describe it rather than returning nothing.
  assert.equal(payloads.expectedLayerNames(4), null);
  const built = model.buildLineModel(literal({ layerCount: 4 }));
  assert.equal(built.layers.length, 4);
  assert.deepEqual(built.layers.map(layer => layer.id), ["A", "B", "C", "D"]);
});

/* ----------------------------------------------------------------------
 *   Hopper count is configuration, never a constant
 * -------------------------------------------------------------------- */

test("hopper count defaults to the payload module's HOPPERS_PER_LAYER", () => {
  const built = model.buildLineModel(literal({}));
  for (const layer of built.layers) {
    assert.equal(layer.hopperCount, payloads.HOPPERS_PER_LAYER);
    assert.equal(layer.hoppers.length, payloads.HOPPERS_PER_LAYER);
  }
});

test("a line-wide hopper count overrides the default on every layer", () => {
  const built = model.buildLineModel(literal({ hopperCount: 4 }));
  assert.deepEqual(built.layers.map(layer => layer.hoppers.length), [4, 4, 4]);
  assert.equal(model.totalHopperCount(built), 12);
});

test("per-layer hopper counts are honored independently", () => {
  const built = model.buildLineModel(literal({
    layers: [{ id: "A", hopperCount: 4 }, { id: "B", hopperCount: 6 }, { id: "C", hopperCount: 3 }]
  }));
  assert.deepEqual(built.layers.map(layer => layer.hoppers.length), [4, 6, 3]);
  assert.equal(model.totalHopperCount(built), 13);
});

test("a layer with no declared hopper count falls back to the line default, not to zero", () => {
  const built = model.buildLineModel(literal({ hopperCount: 5, layers: [{ id: "B", hopperCount: 2 }] }));
  assert.deepEqual(built.layers.map(layer => layer.hoppers.length), [5, 2, 5]);
});

/* ----------------------------------------------------------------------
 *   Physical order and roles
 * -------------------------------------------------------------------- */

test("Layer A on the outside keeps recipe order as the physical stack", () => {
  const built = model.buildLineModel(literal({ layerCount: 5, layerAPosition: "outside" }));
  assert.deepEqual(built.layers.map(layer => layer.id), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(built.layers.map(layer => layer.role),
    ["outside", "subskin-outside", "core", "subskin-inside", "inside"]);
});

test("Layer A on the inside reverses the physical stack but keeps the recipe index", () => {
  const built = model.buildLineModel(literal({ layerCount: 3, layerAPosition: "inside" }));
  assert.deepEqual(built.layers.map(layer => layer.id), ["C", "B", "A"]);
  assert.deepEqual(built.layers.map(layer => layer.role), ["outside", "core", "inside"]);
  // Physical order changed; the recipe's own order is still recoverable.
  assert.deepEqual(built.layers.map(layer => layer.recipeIndex), [2, 1, 0]);
});

test("the ends of the stack agree with line-identity's own layerOrder", () => {
  // Two derivations of the same physical fact must not be able to disagree.
  for (const lineNumber of [5, 9, 11, 15]) {
    const identity = lineIdentity.getLineConfiguration(lineNumber);
    const built = model.buildLineModel(lineNumber);
    assert.deepEqual(
      [
        { layer: built.layers[0].id, position: "outside" },
        { layer: built.layers[built.layers.length - 1].id, position: "inside" }
      ].sort((a, b) => a.layer.localeCompare(b.layer)),
      identity.layerOrder.slice().sort((a, b) => a.layer.localeCompare(b.layer)),
      `line ${lineNumber} disagrees with line-identity about which layer is outside`
    );
  }
});

test("a single-layer line has no orientation and one 'single' role", () => {
  const built = model.buildLineModel(literal({ layerCount: 1, layerAPosition: "outside" }));
  assert.equal(built.line.layerAPosition, null);
  assert.deepEqual(built.layers.map(layer => layer.role), ["single"]);
});

test("an even layer count gets no invented core", () => {
  const roles = model.buildLineModel(literal({ layerCount: 4 })).layers.map(layer => layer.role);
  assert.deepEqual(roles, ["outside", "subskin-outside", "subskin-inside", "inside"]);
  assert.ok(!roles.includes("core"));
});

test("an unknown orientation keeps recipe order and says the orientation is unknown", () => {
  const built = model.buildLineModel(literal({ layerCount: 3, layerAPosition: null }));
  assert.equal(built.line.orientationKnown, false);
  assert.deepEqual(built.layers.map(layer => layer.id), ["A", "B", "C"]);
});

/* ----------------------------------------------------------------------
 *   Hopper naming follows the line, not a Station constant
 * -------------------------------------------------------------------- */

test("standard naming numbers hoppers from 1", () => {
  const built = model.buildLineModel(literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 }));
  assert.deepEqual(built.layers[0].hoppers.map(h => h.id), ["A1", "A2", "A3"]);
});

test("main-plus-five naming names the first hopper Main, exactly as line-identity does", () => {
  const built = model.buildLineModel(9);
  assert.deepEqual(built.layers[0].hoppers.map(h => h.id), ["AM", "A1", "A2", "A3", "A4", "A5"]);
  for (let index = 0; index < 6; index++) {
    assert.equal(
      built.layers[0].hoppers[index].positionLabel,
      lineIdentity.hopperPositionLabel(index, { selectedWorkspace: { id: "ws-9", line_number: 9 } })
    );
  }
});

/* ----------------------------------------------------------------------
 *   Reading the real line catalog
 * -------------------------------------------------------------------- */

test("a line number resolves through line-identity rather than a Station table", () => {
  for (const lineNumber of [1, 5, 9, 11, 15]) {
    const identity = lineIdentity.getLineConfiguration(lineNumber);
    const built = model.buildLineModel(lineNumber);
    assert.equal(built.line.layerCount, identity.layerCount, `line ${lineNumber} layer count`);
    assert.equal(built.layers.length, identity.layerCount);
    assert.equal(built.line.layerAPosition, identity.layerAPosition);
    assert.equal(built.line.hopperNamingMode, identity.hopperNamingMode);
    assert.equal(built.line.hopperGeometry, identity.hopperGeometry);
  }
});

test("an unmapped line produces null rather than an invented machine", () => {
  assert.equal(model.buildLineModel(999), null);
  assert.equal(model.buildLineModel(null), null);
  assert.equal(model.buildLineModel({}), null);
  assert.equal(model.buildLineModel(literal({ layerCount: 0 })), null);
});

test("injected dependencies replace the defaults, so the model has no hidden globals", () => {
  const fakeIdentity = {
    getLineConfiguration: () => ({ lineNumber: 42, displayName: "Injected", layerCount: 2, layerAPosition: "outside", hopperNamingMode: "standard" })
  };
  const built = model.buildLineModel(42, { lineIdentity: fakeIdentity, payloads: { HOPPERS_PER_LAYER: 2, expectedLayerNames: () => null } });
  assert.equal(built.line.displayName, "Injected");
  assert.equal(built.layers.length, 2);
  assert.deepEqual(built.layers.map(layer => layer.hoppers.length), [2, 2]);
});

/* ----------------------------------------------------------------------
 *   Shared equipment is shared
 * -------------------------------------------------------------------- */

test("shared equipment is listed once regardless of layer count", () => {
  const one = model.buildLineModel(literal({ layerCount: 1, layerAPosition: null }));
  const five = model.buildLineModel(literal({ layerCount: 5 }));
  assert.deepEqual(one.shared.map(item => item.role), five.shared.map(item => item.role));
  assert.equal(one.shared.length, model.SHARED_EQUIPMENT.length);
});

test("no shared piece of equipment is also a per-layer piece", () => {
  const shared = new Set(model.SHARED_EQUIPMENT.map(item => item.role));
  for (const item of model.LAYER_EQUIPMENT) {
    assert.ok(!shared.has(item.role), `${item.role} is declared both shared and per-layer`);
  }
  // The die in particular: one per line, never one per extruder.
  assert.ok(shared.has("die"));
});

test("the hopper index resolves every hopper on the line by id", () => {
  const built = model.buildLineModel(11);
  assert.equal(Object.keys(built.hopperIndex).length, model.totalHopperCount(built));
  assert.equal(built.hopperIndex.E6.layer, "E");
  assert.equal(built.hopperIndex.A1.index, 0);
});
