const test = require("node:test");
const assert = require("node:assert/strict");
const {
  estimateBulkDensity,
  calculateHopperWeight
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
