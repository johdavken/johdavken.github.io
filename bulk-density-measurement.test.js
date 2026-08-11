"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const measurement = require("./bulk-density-measurement.js");

test("known 25 lb and 1.23 g/cm³ example matches the calibrated-volume result", () => {
  const result = measurement.calculate({ resinWeightLb:25, polymerDensityGCm3:1.23 });
  assert.equal(result.valid, true);
  assert.equal(result.bulkDensityLbFt3.toFixed(1), "48.8");
  assert.equal(result.bulkDensityGCm3.toFixed(3), "0.781");
  assert.equal(result.packingFactor.toFixed(3), "0.635");
});

test("calculation works without resin selection or polymer density", () => {
  const result = measurement.calculate({ resinWeightLb:"25", polymerDensityGCm3:"" });
  assert.equal(result.valid, true);
  assert.equal(result.packingFactor, null);
  assert.equal(result.bulkDensityLbFt3.toFixed(1), "48.8");
});

test("invalid numbers are rejected without clamping", () => {
  assert.equal(measurement.calculate({ resinWeightLb:0 }).valid, false);
  assert.equal(measurement.calculate({ resinWeightLb:"not a number" }).valid, false);
  assert.equal(measurement.calculate({ resinWeightLb:25, polymerDensityGCm3:11 }).valid, false);
  const high = measurement.calculate({ resinWeightLb:60, polymerDensityGCm3:0.5 });
  assert.equal(high.valid, true);
  assert.ok(high.bulkDensityLbFt3 > 100);
  assert.equal(high.databaseAllowed, false);
  assert.match(high.warnings.join(" "), /outside the Resin Database range/);
  assert.match(high.warnings.join(" "), /greater than 1\.0/);
});

test("implausibly low packing factors produce a warning", () => {
  const result = measurement.calculate({ resinWeightLb:5, polymerDensityGCm3:1.23 });
  assert.equal(result.valid, true);
  assert.ok(result.packingFactor < measurement.IMPLAUSIBLY_LOW_PACKING_FACTOR);
  assert.match(result.warnings.join(" "), /implausibly low/);
});
