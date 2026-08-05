"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { expectedPositionsForLetters, buildRecipePayloadFromScan } = require("./recipe-scan-mapping.js");
const { validateRecipePayload, applyRecipePayload } = require("./workspace-configuration-payloads.js");

function component(overrides = {}) {
  return {
    resin_code: "MS0440", resin_code_confidence: 0.9,
    percentage: 79, percentage_confidence: 0.9,
    hopper_designation: null, hopper_designation_confidence: null,
    ...overrides
  };
}

function layer(overrides = {}) {
  return {
    position: "inside", position_confidence: 0.9,
    layer_percentage: 20, layer_percentage_confidence: 0.9,
    components: [component({ percentage: 79 }), component({ resin_code: "MS1307", percentage: 21 })],
    component_percentage_total_status: "ok",
    ...overrides
  };
}

function threeLayerScan(overrides = {}) {
  return {
    name: null,
    layer_count: 3,
    layer_percentage_total_status: "ok",
    layers: [
      layer({ position: "inside", layer_percentage: 20 }),
      layer({ position: "core", layer_percentage: 60 }),
      layer({ position: "outside", layer_percentage: 20 })
    ],
    ...overrides
  };
}

function freshState(lineType) {
  const names = { 1: ["A"], 3: ["A", "B", "C"], 5: ["A", "B", "C", "D", "E"] }[lineType];
  return {
    lineType,
    hopperNamingLine9: "standard",
    layers: names.map(name => ({
      name,
      layerPct: 0,
      hoppers: Array.from({ length: 6 }, () => ({ pct: 0, resinName: "", weight: 0, track: false, pumpOff: false }))
    }))
  };
}

// --- layer count mismatch ---------------------------------------------

test("rejects when scanned layer count doesn't match the active line type", () => {
  const result = buildRecipePayloadFromScan(threeLayerScan(), { lineType: 5, orientation: "inside" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "layer_count_mismatch");
  assert.match(result.message, /Wrong layer configuration for active line/);
});

// --- orientation mapping -------------------------------------------------

test("orientation 'inside' maps printed order directly onto A, B, C", () => {
  const scan = threeLayerScan();
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload.layers.map(l => l.name), ["A", "B", "C"]);
  assert.equal(result.payload.layers[0].layer_pct, 20); // inside
  assert.equal(result.payload.layers[1].layer_pct, 60); // core
  assert.equal(result.payload.layers[2].layer_pct, 20); // outside
});

test("orientation 'outside' mirrors the printed order onto A, B, C", () => {
  const scan = threeLayerScan({
    layers: [
      layer({ position: "inside", layer_percentage: 15 }),
      layer({ position: "core", layer_percentage: 60 }),
      layer({ position: "outside", layer_percentage: 25 })
    ]
  });
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "outside" });
  assert.equal(result.ok, true);
  // A = outside(25), B = core(60), C = inside(15)
  assert.equal(result.payload.layers[0].layer_pct, 25);
  assert.equal(result.payload.layers[1].layer_pct, 60);
  assert.equal(result.payload.layers[2].layer_pct, 15);
});

test("5-layer orientation mirrors the full inside<->outside sequence, core always lands in the middle", () => {
  const scan = {
    name: null, layer_count: 5, layer_percentage_total_status: "ok",
    layers: [
      layer({ position: "inside", layer_percentage: 10 }),
      layer({ position: "inside_subskin", layer_percentage: 20 }),
      layer({ position: "core", layer_percentage: 40 }),
      layer({ position: "outside_subskin", layer_percentage: 20 }),
      layer({ position: "outside", layer_percentage: 10 })
    ]
  };
  const inside = buildRecipePayloadFromScan(scan, { lineType: 5, orientation: "inside" });
  assert.deepEqual(inside.payload.layers.map(l => l.layer_pct), [10, 20, 40, 20, 10]);

  const outside = buildRecipePayloadFromScan(scan, { lineType: 5, orientation: "outside" });
  assert.deepEqual(outside.payload.layers.map(l => l.layer_pct), [10, 20, 40, 20, 10].slice().reverse());
});

test("expectedPositionsForLetters exposes the same mapping for the review screen", () => {
  assert.deepEqual(expectedPositionsForLetters(3, "inside"), ["inside", "core", "outside"]);
  assert.deepEqual(expectedPositionsForLetters(3, "outside"), ["outside", "core", "inside"]);
  assert.deepEqual(expectedPositionsForLetters(1, undefined), ["single"]);
});

// --- hopper fill algorithm ------------------------------------------------

test("sequential fill: components populate H1->H6 in printed order", () => {
  const scan = threeLayerScan({
    layers: [
      layer({ position: "inside", components: [component({ resin_code: "R1", percentage: 50 }), component({ resin_code: "R2", percentage: 50 })] }),
      layer({ position: "core" }),
      layer({ position: "outside" })
    ]
  });
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside" });
  const hoppers = result.payload.layers[0].hoppers;
  assert.equal(hoppers[0].resin_name, "R1");
  assert.equal(hoppers[1].resin_name, "R2");
  assert.equal(hoppers[1].pct, 50);
  assert.equal(hoppers[0].pct, 50); // auto-derived, reproduces R1's printed 50%
  assert.equal(hoppers[2].resin_name, null);
});

test("a unique handwritten hopper_designation places its component directly, reducing sequential fill around it", () => {
  const scan = threeLayerScan({
    layers: [
      layer({
        position: "inside",
        components: [
          component({ resin_code: "R1", percentage: 30 }),
          component({ resin_code: "R2", percentage: 50, hopper_designation: "H4" }),
          component({ resin_code: "R3", percentage: 20 })
        ]
      }),
      layer({ position: "core" }),
      layer({ position: "outside" })
    ]
  });
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside" });
  const hoppers = result.payload.layers[0].hoppers;
  assert.equal(hoppers[3].resin_name, "R2"); // H4 = index 3, claimed directly
  // R1 and R3 sequentially fill the remaining slots (0, 1) in printed order
  assert.equal(hoppers[0].resin_name, "R1");
  assert.equal(hoppers[1].resin_name, "R3");
});

test("a conflicting hopper_designation (two components claim the same hopper) falls back to sequential fill for both", () => {
  const scan = threeLayerScan({
    layers: [
      layer({
        position: "inside",
        components: [
          component({ resin_code: "R1", percentage: 40, hopper_designation: "H2" }),
          component({ resin_code: "R2", percentage: 60, hopper_designation: "H2" })
        ]
      }),
      layer({ position: "core" }),
      layer({ position: "outside" })
    ]
  });
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside" });
  const hoppers = result.payload.layers[0].hoppers;
  // Neither gets to claim H2 directly - both fall into sequential fill, printed order
  assert.equal(hoppers[0].resin_name, "R1");
  assert.equal(hoppers[1].resin_name, "R2");
});

test("H1's percentage is always the auto-derived remainder, never the component's raw printed value directly", () => {
  const scan = threeLayerScan({
    layers: [
      layer({ position: "inside", components: [component({ resin_code: "R1", percentage: 33 }), component({ resin_code: "R2", percentage: 67 })] }),
      layer({ position: "core" }),
      layer({ position: "outside" })
    ]
  });
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside" });
  const hoppers = result.payload.layers[0].hoppers;
  assert.equal(hoppers[0].pct, 100 - hoppers.slice(1).reduce((t, h) => t + h.pct, 0));
});

// --- null percentage substitution -----------------------------------------

test("a null component percentage becomes 0, resin name preserved when known", () => {
  const scan = threeLayerScan({
    layers: [
      layer({ position: "inside", components: [component({ resin_code: "R1", percentage: null }), component({ resin_code: "R2", percentage: 100 })] }),
      layer({ position: "core" }),
      layer({ position: "outside" })
    ]
  });
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside" });
  const hoppers = result.payload.layers[0].hoppers;
  assert.equal(hoppers[1].resin_name, "R2");
  // H1 gets the null-percentage component (printed first); its own pct is irrelevant to the input,
  // it's overwritten by the auto-remainder regardless.
  assert.equal(hoppers[0].resin_name, "R1");
});

test("percentage_estimated flags a hopper whose component percentage was null - a review-screen hint, not part of applyRecipePayload's contract", () => {
  const scan = threeLayerScan({
    layers: [
      layer({ position: "inside", components: [component({ resin_code: "R1", percentage: null }), component({ resin_code: "R2", percentage: 100 })] }),
      layer({ position: "core" }),
      layer({ position: "outside" })
    ]
  });
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside" });
  const hoppers = result.payload.layers[0].hoppers;
  assert.equal(hoppers[0].percentage_estimated, true);
  assert.equal(hoppers[1].percentage_estimated, false);
  assert.equal(hoppers[2].percentage_estimated, false, "an empty hopper slot is not 'estimated', it's just empty");
});

test("layer_pct_estimated flags a layer whose printed percentage was null", () => {
  const scan = threeLayerScan({
    layers: [
      layer({ position: "inside", layer_percentage: null }),
      layer({ position: "core", layer_percentage: 60 }),
      layer({ position: "outside", layer_percentage: 20 })
    ]
  });
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside" });
  assert.equal(result.payload.layers[0].layer_pct_estimated, true);
  assert.equal(result.payload.layers[1].layer_pct_estimated, false);
});

test("a null layer_percentage becomes 0 in the payload", () => {
  const scan = threeLayerScan({
    layers: [
      layer({ position: "inside", layer_percentage: null }),
      layer({ position: "core", layer_percentage: 60 }),
      layer({ position: "outside", layer_percentage: 20 })
    ]
  });
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside" });
  assert.equal(result.payload.layers[0].layer_pct, 0);
});

// --- integration: the built payload is accepted by the real apply pathway --

test("a well-formed scan (all percentages known and totaling correctly) is accepted by applyRecipePayload end to end", () => {
  const scan = threeLayerScan();
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside", hopperNamingMode: "standard" });
  assert.equal(result.ok, true);
  assert.equal(validateRecipePayload(result.payload).valid, true);
  const applied = applyRecipePayload(freshState(3), result.payload);
  assert.equal(applied.ok, true);
  assert.equal(applied.layers[0].hoppers[0].resinName, "MS0440");
  assert.equal(applied.layers[0].hoppers[1].resinName, "MS1307");
});

test("a scan with a null layer percentage that breaks the 100% total is rejected by applyRecipePayload, not silently half-applied", () => {
  const scan = threeLayerScan({
    layers: [
      layer({ position: "inside", layer_percentage: null }), // becomes 0
      layer({ position: "core", layer_percentage: 60 }),
      layer({ position: "outside", layer_percentage: 20 }) // totals 80, not 100
    ]
  });
  const result = buildRecipePayloadFromScan(scan, { lineType: 3, orientation: "inside" });
  assert.equal(result.ok, true); // mapping itself succeeds - it's the apply step that must fail
  const applied = applyRecipePayload(freshState(3), result.payload);
  assert.equal(applied.ok, false);
  assert.match(applied.errors.join(" "), /Layer percentages must total 100/);
});

// --- 1-layer line, no orientation needed -----------------------------------

test("a 1-layer scan needs no orientation and maps 'single' directly to A", () => {
  const scan = {
    name: null, layer_count: 1, layer_percentage_total_status: "ok",
    layers: [layer({ position: "single", layer_percentage: 100 })]
  };
  const result = buildRecipePayloadFromScan(scan, { lineType: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.payload.layers.length, 1);
  assert.equal(result.payload.layers[0].name, "A");
  assert.equal(result.payload.layers[0].layer_pct, 100);
});
