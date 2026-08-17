"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const measurement = require("./bulk-density-measurement.js");

test("uses the established 32.0 lb default calibration", () => {
  const result = measurement.calculate({ resinWeightLb:25, polymerDensityGCm3:1.23 });
  assert.equal(measurement.DEFAULT_WATER_CALIBRATION_LB, 32);
  assert.equal(result.valid, true);
  assert.equal(result.waterCalibrationLb, 32);
  assert.equal(result.bulkDensityLbFt3.toFixed(1), "48.8");
});

test("persists and restores the most recent valid water calibration locally", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };

  assert.equal(measurement.readStoredWaterCalibration(storage), 32);
  assert.equal(measurement.persistWaterCalibration("18.75", storage), true);
  assert.equal(values.get(measurement.WATER_CALIBRATION_STORAGE_KEY), "18.75");
  assert.equal(measurement.readStoredWaterCalibration(storage), 18.75);
  assert.equal(measurement.persistWaterCalibration("0", storage), false);
  assert.equal(measurement.readStoredWaterCalibration(storage), 18.75);
});

test("calculates bulk density from the water/resin weight ratio with a custom calibration", () => {
  const result = measurement.calculate({ waterCalibrationLb:20, resinWeightLb:10 });
  assert.equal(result.valid, true);
  assert.equal(result.bulkDensityLbFt3, 31.214);
  assert.equal(result.bulkDensityGCm3, 0.5);
});

test("calculates packing factor only when polymer density is present", () => {
  const withPolymer = measurement.calculate({ waterCalibrationLb:32, resinWeightLb:25, polymerDensityGCm3:1.23 });
  assert.equal(withPolymer.valid, true);
  assert.equal(withPolymer.solidDensityLbFt3, 76.78644);
  assert.equal(withPolymer.packingFactor.toFixed(3), "0.635");

  const withoutPolymer = measurement.calculate({ waterCalibrationLb:32, resinWeightLb:"25", polymerDensityGCm3:"" });
  assert.equal(withoutPolymer.valid, true);
  assert.equal(withoutPolymer.bulkDensityLbFt3.toFixed(1), "48.8");
  assert.equal(withoutPolymer.packingFactor, null);
});

test("rejects zero, negative, missing, and non-finite calibration or resin weights", () => {
  for (const waterCalibrationLb of [0, -1, "", "not a number"]){
    const result = measurement.calculate({ waterCalibrationLb, resinWeightLb:25 });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(" "), /Water calibration/);
  }
  for (const resinWeightLb of [0, -1, "", "not a number"]){
    const result = measurement.calculate({ waterCalibrationLb:32, resinWeightLb });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(" "), /Resin net weight/);
  }
});

test("keeps database-range and implausible-packing safeguards", () => {
  const high = measurement.calculate({ waterCalibrationLb:32, resinWeightLb:60, polymerDensityGCm3:0.5 });
  assert.equal(high.valid, true);
  assert.ok(high.bulkDensityLbFt3 > 100);
  assert.equal(high.databaseAllowed, false);
  assert.match(high.warnings.join(" "), /outside the Resin Database range/);
  assert.match(high.warnings.join(" "), /greater than 1\.0/);

  const low = measurement.calculate({ waterCalibrationLb:32, resinWeightLb:5, polymerDensityGCm3:1.23 });
  assert.equal(low.valid, true);
  assert.ok(low.packingFactor < measurement.IMPLAUSIBLY_LOW_PACKING_FACTOR);
  assert.match(low.warnings.join(" "), /implausibly low/);
});
