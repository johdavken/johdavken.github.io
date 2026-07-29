"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateNumber,
  validatePercentage,
  validateHopperPercentages,
  validateConfigPayload
} = require("./validation.js");

test("rejects negative numeric values", () => {
  const result = validateNumber("-1", { min: 0, label: "Weight" });
  assert.equal(result.valid, false);
  assert.match(result.message, /cannot be less than 0/);
});

test("rejects percentages over 100", () => {
  const result = validatePercentage("100.01", "Layer percentage");
  assert.equal(result.valid, false);
  assert.match(result.message, /cannot be greater than 100/);
});

test("rejects hopper 2–6 totals over 100", () => {
  const result = validateHopperPercentages([30, 25, 20, 15, 11]);
  assert.equal(result.valid, false);
  assert.equal(result.total, 101);
});

test("accepts hopper 2–6 totals equal to 100", () => {
  const result = validateHopperPercentages([30, 25, 20, 15, 10]);
  assert.equal(result.valid, true);
  assert.equal(result.total, 100);
});

test("rejects negative offsets", () => {
  const result = validateNumber("-5", { min: 0, label: "Offset" });
  assert.equal(result.valid, false);
  assert.match(result.message, /cannot be less than 0/);
});

function validPayload() {
  const hoppers = Array.from({ length: 6 }, (_, index) => ({
    pct: index === 0 ? 100 : 0,
    weight: 25,
    resinName: "",
    track: false,
    pumpOff: false
  }));
  return {
    lineType: 1,
    lineRate: 1000,
    gauge: 2,
    offsets: { A: 0 },
    layers: [{ name: "A", layerPct: 100, hoppers }],
    prodResinLb: 0,
    scrapResinLb: 0
  };
}

test("accepts a structurally valid imported configuration", () => {
  assert.deepEqual(validateConfigPayload(validPayload()), { valid: true, errors: [] });
});

test("reports malformed imported configuration structure", () => {
  const payload = validPayload();
  payload.layers[0].hoppers = [];

  const result = validateConfigPayload(payload);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /must contain six hoppers/);
});

test("reports invalid ranges in imported configurations", () => {
  const payload = validPayload();
  payload.offsets.A = -2;
  payload.layers[0].hoppers[1].pct = 101;

  const result = validateConfigPayload(payload);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /cannot be greater than 100/);
  assert.match(result.errors.join(" "), /offset cannot be less than 0/i);
});

test("reports imported layer and hopper totals that do not equal 100", () => {
  const payload = validPayload();
  payload.layers[0].layerPct = 90;
  payload.layers[0].hoppers[0].pct = 90;

  const result = validateConfigPayload(payload);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Layer percentages must total 100/);
  assert.match(result.errors.join(" "), /hopper percentages must total 100/);
});
