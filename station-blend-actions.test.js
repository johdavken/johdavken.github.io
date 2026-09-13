"use strict";

/* The blend actions seam (station/station-blend-actions.js): the three
 * layer commands a card's menu and the rail's bulk edit ride on, tested
 * against a stub bridge. What the boot file does with an answer is the
 * booted suite's (station-blend-actions-boot.test.js). */

const test = require("node:test");
const assert = require("node:assert/strict");

const actions = require("./station/station-blend-actions.js");
const contract = require("./station-command-contract.js");

function bridge(options) {
  const settings = options || {};
  const calls = [];
  return {
    calls,
    isAvailable: () => settings.available !== false,
    capabilities: () => settings.capabilities || [...contract.LAYER_COMMANDS],
    dispatch: (command, args) => { calls.push({ command, args }); return settings.answer || { ok: true, changed: true }; }
  };
}

test("the three actions ride on the three layer commands, and the module holds nothing", () => {
  assert.deepEqual([...actions.ACTIONS], ["copy", "clear", "resins"]);
  assert.deepEqual(actions.COMMAND, { copy: "copyLayer", clear: "clearLayer", resins: "setHopperResins" });
  for (const action of actions.ACTIONS) assert.ok(contract.LAYER_COMMANDS.includes(actions.COMMAND[action]));
  assert.ok(Object.isFrozen(actions));
});

test("can() is the bridge's offer: connected and declaring the command; reason() says which is missing", () => {
  const b = bridge();
  for (const action of actions.ACTIONS) assert.equal(actions.can(b, action), true);
  assert.equal(actions.can(b, "explode"), false);
  const partial = bridge({ capabilities: ["copyLayer"] });
  assert.equal(actions.can(partial, "copy"), true);
  assert.equal(actions.can(partial, "clear"), false);
  assert.match(actions.reason(partial, "clear"), /does not offer resetting a layer/);
  const off = bridge({ available: false });
  assert.equal(actions.can(off, "copy"), false);
  assert.match(actions.reason(off, "copy"), /no application is connected/);
  assert.equal(actions.can(null, "copy"), false);
  assert.match(actions.reason(null, "resins"), /no application is connected/);
});

test("copyLayer and clearLayer hand one command each, addressed to the recipe given, and return the answer untouched", () => {
  const b = bridge({ answer: { ok: true, changed: true, revision: 7 } });
  const pasted = actions.copyLayer(b, "next", "A", "C");
  assert.deepEqual(pasted, { ok: true, changed: true, revision: 7 });
  const cleared = actions.clearLayer(b, "current", "B");
  assert.equal(cleared.revision, 7);
  assert.deepEqual(b.calls, [
    { command: "copyLayer", args: { recipe: "next", layer: "A", toLayer: "C" } },
    { command: "clearLayer", args: { recipe: "current", layer: "B" } }
  ]);
});

test("applyResins turns a selection of keys or positions into one setHopperResins, and refuses an empty selection without dispatching", () => {
  const b = bridge();
  const result = actions.applyResins(b, "current", ["A:1", { layer: "C", index: 4 }, "bad", "A:x"], "LLDPE 1001");
  assert.equal(result.ok, true);
  assert.deepEqual(b.calls, [{ command: "setHopperResins", args: { recipe: "current", resins: [
    { layer: "A", index: 1, resin: "LLDPE 1001" }, { layer: "C", index: 4, resin: "LLDPE 1001" }
  ] } }]);
  const none = actions.applyResins(b, "current", [], "X");
  assert.deepEqual([none.ok, none.code], [false, "unavailable"]);
  assert.match(none.message, /Select at least one hopper/);
  assert.equal(b.calls.length, 1);
  assert.deepEqual(actions.parseKey("A:3"), { layer: "A", index: 3 });
  assert.deepEqual(actions.parseKey("L-2:0"), { layer: "L-2", index: 0 });
  assert.equal(actions.parseKey(":3"), null);
  assert.equal(actions.parseKey("A"), null);
});

test("no bridge, a bridge without dispatch, or a view addressing no recipe is unavailable, never a throw", () => {
  for (const b of [null, undefined, {}, { dispatch: 1 }]) {
    const result = actions.copyLayer(b, "current", "A", "B");
    assert.deepEqual([result.ok, result.code], [false, "unavailable"]);
    assert.ok(Object.isFrozen(result));
  }
  const b = bridge();
  const none = actions.clearLayer(b, null, "A");
  assert.equal(none.code, "unavailable");
  assert.match(none.message, /does not address a recipe/);
  assert.equal(b.calls.length, 0);
  assert.equal(actions.dispatch(b, "explode", { recipe: "current" }).code, "unavailable");
});

test("resinOnlyTarget words the grid's one paste exception: B on a 3-layer line, nowhere else", () => {
  assert.equal(actions.resinOnlyTarget(3, "B"), true);
  assert.equal(actions.resinOnlyTarget(3, "A"), false);
  assert.equal(actions.resinOnlyTarget(5, "B"), false);
  assert.equal(actions.resinOnlyTarget(1, "A"), false);
});
