"use strict";

/* slate-tracking.js: the tracking mode's rules - how Track is offered
 * under each mode, which rows Automatic wants - and the batch that
 * carries Automatic's choice to the application. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeCommands } = require("./tools/slate-test/fake-dom.js");
const tracking = require("./slate/slate-tracking.js");

const ROW = { planned: true, resinDiffers: true, assigned: true, track: false, pumpOff: false };
const rowWith = overrides => Object.assign({}, ROW, overrides);

test("the modes are three words and anything else is Assisted", () => {
  assert.deepEqual(tracking.MODES, ["automatic", "assisted", "manual"]);
  assert.equal(tracking.DEFAULT_MODE, "automatic");
  for (const mode of tracking.MODES) assert.equal(tracking.modeOf(mode), mode);
  for (const value of [undefined, null, "", "auto", "Manual", 1]) assert.equal(tracking.modeOf(value), "automatic", String(value));
});

test("Assisted offers Track where a planned resin goes away, where it is already on or the pump is off, and everywhere without a plan", () => {
  const offered = row => tracking.offersToggle("assisted", row);
  assert.equal(offered(rowWith({})), true, "a swapped resin");
  assert.equal(offered(rowWith({ resinDiffers: false })), false, "a continuing resin");
  assert.equal(offered(rowWith({ assigned: false })), false, "an empty hopper that fills next");
  assert.equal(offered(rowWith({ resinDiffers: false, track: true })), true, "tracked already");
  assert.equal(offered(rowWith({ resinDiffers: false, pumpOff: true })), true, "pump off");
  assert.equal(offered(rowWith({ planned: false, resinDiffers: false })), true, "no plan");
  assert.equal(offered(rowWith({ planned: false, assigned: false })), true, "no plan, empty (the toggle is disabled, not withheld)");
  assert.equal(tracking.offersToggle(undefined, rowWith({ resinDiffers: false })), false, "an unknown mode is Assisted");
  assert.equal(tracking.offersToggle("assisted", null), true, "no row reads as no plan");
});

test("Manual offers Track on every row; Automatic on none", () => {
  for (const row of [rowWith({}), rowWith({ resinDiffers: false }), rowWith({ assigned: false }), rowWith({ planned: false }), null]) {
    assert.equal(tracking.offersToggle("manual", row), true);
    assert.equal(tracking.offersToggle("automatic", row), false);
  }
});

test("Automatic wants a row tracked only where a planned resin goes away from an assigned, untracked hopper - and never in another mode", () => {
  assert.equal(tracking.wantsTracking("automatic", rowWith({})), true);
  assert.equal(tracking.wantsTracking("automatic", rowWith({ track: true })), false, "tracked already");
  assert.equal(tracking.wantsTracking("automatic", rowWith({ resinDiffers: false })), false, "a continuing resin");
  assert.equal(tracking.wantsTracking("automatic", rowWith({ assigned: false })), false, "fills next");
  assert.equal(tracking.wantsTracking("automatic", rowWith({ planned: false })), false, "no plan");
  assert.equal(tracking.wantsTracking("automatic", rowWith({ pumpOff: true })), true, "pump off is no bar");
  assert.equal(tracking.wantsTracking("automatic", null), false);
  for (const mode of ["assisted", "manual"]) assert.equal(tracking.wantsTracking(mode, rowWith({})), false, String(mode));
  // A word that is no mode reads as the default, which is automatic.
  for (const mode of [undefined, "auto"]) assert.equal(tracking.wantsTracking(mode, rowWith({})), true, String(mode));
});

test("trackMany asks one setHopperTracking(true) per request, on Current, in order, and returns the answers in order", () => {
  const commands = makeCommands({ capabilities: ["setHopperTracking"], answer: (command, args) => (args.layer === "B" ? { ok: false, code: "unknown_hopper", message: "No such hopper." } : undefined) });
  const results = tracking.trackMany(commands, [{ layer: "A", index: 0 }, { layer: "B", index: 2 }, { layer: "C", index: 1 }]);
  assert.deepEqual(commands.calls.map(call => call.command), ["setHopperTracking", "setHopperTracking", "setHopperTracking"]);
  assert.deepEqual(commands.calls.map(call => call.args), [
    { recipe: "current", layer: "A", index: 0, track: true },
    { recipe: "current", layer: "B", index: 2, track: true },
    { recipe: "current", layer: "C", index: 1, track: true }
  ]);
  assert.deepEqual(results.map(result => result.ok), [true, false, true]);
  assert.equal(results[1].code, "unknown_hopper");
  assert.deepEqual(tracking.trackMany(commands, []), []);
  assert.equal(commands.calls.length, 3);
});

test("trackMany without a bridge refuses every request the same way and throws nothing", () => {
  for (const commands of [null, undefined, {}, { dispatch: "no" }]) {
    const results = tracking.trackMany(commands, [{ layer: "A", index: 0 }, { layer: "B", index: 1 }]);
    assert.equal(results.length, 2);
    for (const result of results) {
      assert.equal(result.ok, false);
      assert.equal(result.code, "unavailable");
      assert.match(result.message, /No application is connected/);
    }
  }
  assert.deepEqual(tracking.trackMany(null, undefined), []);
});
