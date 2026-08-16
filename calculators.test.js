const test = require("node:test");
const assert = require("node:assert/strict");
const {
  estimateBulkDensity,
  calculateHopperWeight,
  calculateHopperVolumeWeight
} = require("./calculators.js");

test("estimates bulk density from polymer density and packing factor", () => {
  assert.equal(estimateBulkDensity(0.95, 0.63), 0.95 * 62.43 * 0.63);
});

test("uses the documented cylinder-volume formula for hopper weight", () => {
  const circumference = 2 * Math.PI * 10;
  const expected = ((Math.PI * 10 * 10 * 36) / 1728) * 40;
  assert.ok(Math.abs(calculateHopperWeight(circumference, 36, 40) - expected) < 1e-10);
});

test("rejects negative calculator inputs", () => {
  assert.ok(Number.isNaN(estimateBulkDensity(-0.95, 0.63)));
  assert.ok(Number.isNaN(calculateHopperWeight(60, -20, 40)));
});

test("calculateHopperVolumeWeight uses the documented gallon-volume formula", () => {
  const expected = (120 * 0.133681) * 40;
  assert.ok(Math.abs(calculateHopperVolumeWeight(120, 40) - expected) < 1e-10);
});

test("calculateHopperVolumeWeight supports decimal gallon values", () => {
  const expected = (37.5 * 0.133681) * 28.4;
  assert.ok(Math.abs(calculateHopperVolumeWeight(37.5, 28.4) - expected) < 1e-10);
});

test("calculateHopperVolumeWeight rejects negative or non-finite inputs", () => {
  assert.ok(Number.isNaN(calculateHopperVolumeWeight(-10, 40)));
  assert.ok(Number.isNaN(calculateHopperVolumeWeight(120, -40)));
  assert.ok(Number.isNaN(calculateHopperVolumeWeight(NaN, 40)));
});

test("estimateBulkDensity accepts an overridden g/cm3-to-lb/ft3 conversion constant, defaulting to the existing Hopper Weight constant", () => {
  assert.equal(estimateBulkDensity(0.95, 0.63), 0.95 * 62.43 * 0.63);
  assert.equal(estimateBulkDensity(0.95, 0.63, 62.428), 0.95 * 62.428 * 0.63);
  assert.notEqual(estimateBulkDensity(0.95, 0.63, 62.428), estimateBulkDensity(0.95, 0.63));
});
