"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateNumber,
  validatePercentage,
  validateHopperPercentages,
  validateConfigPayload,
  validateActiveJobPayload
} = require("../validation.js");

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
    version: "0.17",
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

test("active-job validation allows incomplete totals but rejects totals over 100", () => {
  const partial = validPayload();
  partial.layers[0].layerPct = 0;
  partial.layers[0].hoppers[0].pct = 0;
  assert.equal(validateActiveJobPayload(partial).valid, true);

  partial.layers[0].layerPct = 101;
  assert.equal(validateActiveJobPayload(partial).valid, false);
});

test("active-job validation requires a supported string version", () => {
  const missing = validPayload();
  delete missing.version;
  assert.equal(validateActiveJobPayload(missing).valid, false);

  const numeric = validPayload();
  numeric.version = 0.17;
  assert.equal(validateActiveJobPayload(numeric).valid, false);

  const unsupported = validPayload();
  unsupported.version = "0.16";
  assert.equal(validateActiveJobPayload(unsupported).valid, false);
  assert.equal(validateActiveJobPayload(validPayload()).valid, true);
});

test("saved configuration validation remains compatible with legacy versions", () => {
  for (const version of [undefined, "0.14", "0.15", "0.16"]){
    const payload = validPayload();
    if (version === undefined) delete payload.version;
    else payload.version = version;
    assert.equal(validateConfigPayload(payload).valid, true);
  }
});

/* balanceHopperBlend: one hopper's blend changed, balanced the way the
 * blender panel on the line does it. */
const { balanceHopperBlend } = require("../validation.js");
const layerOf = rows => rows.map(([resinName, pct]) => ({ resinName, pct, weight: 400, track: true, pumpOff: false }));

test("balanceHopperBlend: H1 holding a resin stays the remainder (unchanged behaviour)", () => {
  const hoppers = layerOf([["HD", 60], ["LL", 40], ["", 0], ["", 0], ["", 0], ["", 0]]);
  const ok = balanceHopperBlend(hoppers, 2, 25);
  assert.equal(ok.valid, true);
  assert.equal(ok.balanceIndex, 0);
  assert.deepEqual(ok.changed, [2]);
  assert.deepEqual(ok.pcts.slice(1), [40, 25, 0, 0, 0]);
  const over = balanceHopperBlend(hoppers, 2, 70);
  assert.equal(over.valid, false);
  assert.equal(over.total, 110);
  assert.match(over.message, /cannot total more than 100/);
});

test("balanceHopperBlend: an empty H1 hands the change to the first hopper in use", () => {
  const hoppers = layerOf([["", 0], ["", 0], ["", 0], ["HD", 90], ["LL", 10], ["", 0]]);
  const up = balanceHopperBlend(hoppers, 2, 5);
  assert.equal(up.valid, true);
  assert.equal(up.balanceIndex, 3);
  assert.deepEqual(up.pcts, [0, 0, 5, 85, 10, 0]);
  assert.deepEqual(up.changed, [2, 3]);
  // Editing the first hopper in use itself balances against the next one.
  const self = balanceHopperBlend(hoppers, 3, 80);
  assert.equal(self.balanceIndex, 4);
  assert.deepEqual(self.pcts, [0, 0, 0, 80, 20, 0]);
  // Not enough to give: refused, naming the hopper with the line's label.
  const short = balanceHopperBlend(hoppers, 4, 15, { label: i => `A${i + 1}` });
  assert.equal(short.valid, true, "H5 + 5 comes out of H4");
  const tooMuch = balanceHopperBlend(hoppers, 2, 95, { label: i => `A${i + 1}` });
  assert.equal(tooMuch.valid, false);
  assert.equal(tooMuch.code, "blend_total");
  assert.equal(tooMuch.message, "A4 only has 90% to give.");
});

test("balanceHopperBlend: an empty H1's leftover is used up first, and never refilled", () => {
  // Built hopper by hopper: H4 at 90 left 10 on an empty H1.
  const hoppers = layerOf([["", 10], ["", 0], ["", 0], ["HD", 90], ["LL", 0], ["", 0]]);
  const fill = balanceHopperBlend(hoppers, 4, 10);
  assert.deepEqual(fill.pcts.slice(1), [0, 0, 90, 10, 0], "the 10 came out of H1's leftover, H4 untouched");
  const past = balanceHopperBlend(hoppers, 4, 15);
  assert.deepEqual(past.pcts.slice(1), [0, 0, 85, 15, 0], "leftover first, the rest from H4");
  const down = balanceHopperBlend(layerOf([["", 0], ["", 0], ["", 0], ["HD", 85], ["LL", 15], ["", 0]]), 4, 5);
  assert.deepEqual(down.pcts.slice(1), [0, 0, 95, 5, 0], "a decrease goes to H4, not the empty H1");
});

test("balanceHopperBlend: a fresh layer falls back to H1; decimals stay exact; input is not mutated", () => {
  const fresh = layerOf([["", 100], ["", 0], ["", 0], ["", 0], ["", 0], ["", 0]]);
  const first = balanceHopperBlend(fresh, 1, 30);
  assert.equal(first.balanceIndex, 0);
  assert.deepEqual(first.pcts.slice(1), [30, 0, 0, 0, 0]);
  const dec = layerOf([["", 0], ["A", 70.1], ["B", 29.9], ["", 0], ["", 0], ["", 0]]);
  const snapshot = JSON.stringify(dec);
  const res = balanceHopperBlend(dec, 2, 30.2);
  assert.deepEqual(res.pcts.slice(1, 3), [69.8, 30.2]);
  assert.equal(JSON.stringify(dec), snapshot);
  assert.equal(balanceHopperBlend(dec, 0, 10).code, "bad_argument");
  assert.equal(balanceHopperBlend(dec, 2, 101).code, "out_of_range");
});
