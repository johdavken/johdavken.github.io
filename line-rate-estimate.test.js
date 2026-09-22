"use strict";

/* line-rate-estimate.js: the output formula, the blend average, the
 * checks and the remembered answers behind Slate's line rate calculator. */

const test = require("node:test");
const assert = require("node:assert/strict");
const estimate = require("./line-rate-estimate.js");

function storage(initial) {
  const store = Object.assign({}, initial || {});
  return { getItem: key => (key in store ? store[key] : null), setItem(key, value) { store[key] = String(value); }, store };
}

test("the formula: twice the layflat, the gauge in thousandths, feet to inches and minutes to hours, the density in pounds per cubic inch", () => {
  // 40 in layflat, 2 mil, 150 ft/min, 0.920 g/cc: 80 x 0.002 x 150 x 12 x 60 = 17,280 in3/hr; x 0.920 x 0.0361273 = 574.3 lb/hr.
  const result = estimate.estimate({ layflat: "40", mil: "2", lineSpeed: "150", density: "0.92" });
  assert.equal(result.widthIn, 80);
  assert.ok(Math.abs(result.lbPerHour - 574.33) < 0.05, String(result.lbPerHour));
  assert.equal(result.lbPerHourRounded, 574);
  assert.equal(estimate.PLIES, 2);
  assert.equal(estimate.LB_PER_IN3_PER_G_CM3, 0.0361273);
  for (const bad of [{}, { layflat: "0", mil: "2", lineSpeed: "150", density: "0.92" }, { layflat: "40", mil: "x", lineSpeed: "150", density: "0.92" }, { layflat: "40", mil: "2", lineSpeed: "150", density: "" }]) {
    assert.equal(estimate.estimate(bad), null);
  }
});

test("every answer must be a number greater than zero, in the wizard's words", () => {
  for (const field of estimate.FIELDS) {
    assert.deepEqual(estimate.validateAnswer(field, "12"), { ok: true, message: "" });
    assert.deepEqual(estimate.validateAnswer(field, "0.5"), { ok: true, message: "" });
    for (const bad of ["", "0", "-1", "abc", " "]) assert.equal(estimate.validateAnswer(field, bad).ok, false, `${field}: ${bad}`);
    assert.equal(estimate.validateAnswer(field, "").message, "Enter a value greater than zero.");
  }
  assert.equal(estimate.validateAnswer("rolls", "3").ok, false);
});

test("the blend average weights each hopper by blend and layer share and leaves out a hopper without a density", () => {
  // Layer A half the film: 70% at 0.92, 30% at 0.95. Layer B half: 100% at 0.96.
  const items = [
    { share: 50, pct: 70, density: 0.92 }, { share: 50, pct: 30, density: 0.95 },
    { share: 50, pct: 100, density: 0.96 }
  ];
  const expected = (0.5 * 0.7 * 0.92 + 0.5 * 0.3 * 0.95 + 0.5 * 1 * 0.96) / (0.5 * 0.7 + 0.5 * 0.3 + 0.5);
  assert.ok(Math.abs(estimate.blendDensity(items) - expected) < 1e-9);
  assert.ok(Math.abs(estimate.blendDensity(items.concat([{ share: 50, pct: 20, density: null }])) - expected) < 1e-9, "a hopper without a density moved the average");
  assert.equal(estimate.blendDensity([{ share: 50, pct: 20, density: null }]), null);
  assert.equal(estimate.blendDensity([]), null);
  assert.equal(estimate.blendDensity(null), null);
  assert.equal(estimate.formatDensity(0.92345), "0.923");
  assert.equal(estimate.formatDensity(null), "");
});

test("the answers are remembered under their own device-local key, as strings, and a broken record reads as blank", () => {
  assert.equal(estimate.STORAGE_KEY, "resinTimer.lineRateCalculator.v0.01");
  const saved = storage();
  assert.deepEqual(estimate.readAnswers(saved), { layflat: "", mil: "", lineSpeed: "", density: "" });
  assert.equal(estimate.saveAnswers(saved, { layflat: "40", mil: 2, lineSpeed: "150", density: "0.92", extra: "no" }), true);
  assert.deepEqual(JSON.parse(saved.store[estimate.STORAGE_KEY]), { layflat: "40", mil: "2", lineSpeed: "150", density: "0.92" });
  assert.deepEqual(estimate.readAnswers(saved), { layflat: "40", mil: "2", lineSpeed: "150", density: "0.92" });
  assert.deepEqual(estimate.readAnswers(storage({ [estimate.STORAGE_KEY]: "{broken" })), { layflat: "", mil: "", lineSpeed: "", density: "" });
  assert.deepEqual(estimate.readAnswers(null), { layflat: "", mil: "", lineSpeed: "", density: "" });
  assert.equal(estimate.saveAnswers(null, {}), false);
  assert.equal(estimate.accept(saved, { layflat: "41" }), true);
  assert.equal(estimate.readAnswers(saved).layflat, "41");
  const blocked = {};
  Object.defineProperty(blocked, "localStorage", { get() { throw new Error("denied"); } });
  assert.equal(estimate.storageFrom(blocked), null);
  assert.equal(estimate.storageFrom({ localStorage: saved }), saved);
});
