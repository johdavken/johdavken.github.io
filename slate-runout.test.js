"use strict";

/* slate/slate-runout.js: what a hopper that ran out early says about its
 * stored weight - or, under Smart Hoppers, its measure. */

const test = require("node:test");
const assert = require("node:assert/strict");
const runout = require("./slate/slate-runout.js");

const HOUR = 60 * 60 * 1000;
const T0 = new Date(2026, 8, 25, 14, 0, 0).getTime();
const CYL = { dimension: "height", unit: "in", field: "usableHeight" };

test("stored x fed / expected: 400 lb expected to feed 2h that ran dry 1h 30m after pump-off holds 300 lb", () => {
  const c = runout.correctionFor({ entry: { durationMs: 2 * HOUR }, runtime: { weight: 400 }, pumpedOffAt: T0, ranOutAt: T0 + 1.5 * HOUR });
  assert.equal(c.ok, true);
  assert.equal(c.target, "weight");
  assert.equal(c.from, 400);
  assert.equal(c.to, 300);
  assert.equal(c.unit, "lb");
  assert.equal(c.fedMs, 1.5 * HOUR);
  assert.equal(c.expectedMs, 2 * HOUR);
  assert.equal(c.ratio, 0.75);
  // No margin: exactly what the run-down measured.
  assert.equal(runout.correctionFor({ entry: { durationMs: 3 * HOUR }, runtime: { weight: 260 }, pumpedOffAt: T0, ranOutAt: T0 + HOUR }).to, 86.7);
});

test("with Smart Hoppers computing the weight, the correction goes to the hopper's measure, in the line's dimension", () => {
  const runtime = { weight: 400, usableHeight: 48, smartWeight: { value: 412, bulkDensity: 45, resinCode: "HX204" } };
  const c = runout.correctionFor({ entry: { durationMs: 2 * HOUR }, runtime, measure: CYL, pumpedOffAt: T0, ranOutAt: T0 + 1.5 * HOUR });
  assert.equal(c.ok, true);
  assert.equal(c.target, "geometry");
  assert.equal(c.dimension, "height");
  assert.equal(c.field, "usableHeight");
  assert.equal(c.from, 48);
  assert.equal(c.to, 36);
  const volume = runout.correctionFor({ entry: { durationMs: 2 * HOUR }, runtime: { usableGallons: 60, smartWeight: { value: 300 } }, measure: { dimension: "volume", unit: "gal", field: "usableGallons" }, pumpedOffAt: T0, ranOutAt: T0 + HOUR });
  assert.equal(volume.to, 30);
  assert.equal(volume.unit, "gal");
  // Smart Hoppers on but nothing computed for this hopper: the entered weight is the one used, and corrected.
  const entered = runout.correctionFor({ entry: { durationMs: 2 * HOUR }, runtime: { weight: 400, usableHeight: 48, smartWeight: null }, measure: CYL, pumpedOffAt: T0, ranOutAt: T0 + HOUR });
  assert.equal(entered.target, "weight");
  assert.equal(entered.to, 200);
});

test("only an early run-out is corrected; bad times, no estimate or nothing stored say why and correct nothing", () => {
  const base = { entry: { durationMs: 2 * HOUR }, runtime: { weight: 400 }, pumpedOffAt: T0 };
  assert.equal(runout.correctionFor(Object.assign({}, base, { ranOutAt: T0 + 2.5 * HOUR })).reason, "not-early");
  assert.equal(runout.correctionFor(Object.assign({}, base, { ranOutAt: T0 + 2 * HOUR - 30 * 1000 })).reason, "not-early", "less than a minute short is a clock read to the minute");
  assert.equal(runout.correctionFor(Object.assign({}, base, { ranOutAt: T0 - 60 * 1000 })).reason, "before-pump-off");
  assert.equal(runout.correctionFor(Object.assign({}, base, { ranOutAt: NaN })).reason, "no-times");
  assert.equal(runout.correctionFor({ entry: {}, runtime: { weight: 400 }, pumpedOffAt: T0, ranOutAt: T0 + HOUR }).reason, "no-estimate");
  assert.equal(runout.correctionFor({ entry: { durationMs: 2 * HOUR }, runtime: { weight: 0 }, pumpedOffAt: T0, ranOutAt: T0 + HOUR }).reason, "no-weight");
  assert.equal(runout.correctionFor({ entry: { durationMs: 2 * HOUR }, runtime: { smartWeight: { value: 300 } }, measure: CYL, pumpedOffAt: T0, ranOutAt: T0 + HOUR }).reason, "no-measure");
  for (const reason of ["no-estimate", "no-times", "before-pump-off", "not-early", "no-measure", "no-weight", "too-short"]) {
    assert.ok(runout.reasonText(reason).length > 10, `no words for ${reason}`);
  }
  assert.equal(runout.correctionFor(Object.assign({}, base, { ranOutAt: T0 + 2.5 * HOUR })).ok, false);
});

test("several hoppers short by about the same share point at the line; scattered shortfalls or too few do not", () => {
  assert.equal(runout.sharedShortfall([0.75, 0.74]), null, "two are not several");
  const shared = runout.sharedShortfall([0.75, 0.72, 0.78]);
  assert.ok(Math.abs(shared - 0.25) < 1e-9);
  assert.equal(runout.sharedShortfall([0.3, 0.6, 0.9]), null);
  assert.equal(runout.sharedShortfall([1.2, 1.1, 1.3]), null, "running late is not a shortfall");
});
