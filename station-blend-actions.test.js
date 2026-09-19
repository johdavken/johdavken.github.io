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
    capabilities: () => settings.capabilities || [...contract.LAYER_COMMANDS, "undo", "redo"],
    dispatch: (command, args) => { calls.push({ command, args }); return settings.answer || { ok: true, changed: true }; }
  };
}

test("the six actions ride on the four layer commands and the history pair, and the module holds nothing", () => {
  assert.deepEqual([...actions.ACTIONS], ["copy", "clear", "resins", "assign", "undo", "redo"]);
  assert.deepEqual(actions.COMMAND, { copy: "copyLayer", clear: "clearLayer", resins: "setHopperResins", assign: "setHopperAssignments", undo: "undo", redo: "redo" });
  for (const action of ["copy", "clear", "resins", "assign"]) assert.ok(contract.LAYER_COMMANDS.includes(actions.COMMAND[action]));
  for (const action of ["undo", "redo"]) assert.ok(contract.COMMANDS.includes(actions.COMMAND[action]));
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

test("applyAssignments turns a selection and the two drafts into one setHopperAssignments carrying only what was given; nothing given, or nothing selected, is refused without dispatching", () => {
  const b = bridge({ answer: { ok: true, changed: true, revision: 9 } });
  const both = actions.applyAssignments(b, "next", ["A:1", { layer: "C", index: 4 }, "bad"], { resin: "EVA", pct: 12.5 });
  assert.equal(both.revision, 9);
  const resinOnly = actions.applyAssignments(b, "current", ["B:2"], { resin: "" });
  assert.equal(resinOnly.ok, true);
  const pctOnly = actions.applyAssignments(b, "current", ["B:2"], { pct: 0 });
  assert.equal(pctOnly.ok, true);
  assert.deepEqual(b.calls, [
    { command: "setHopperAssignments", args: { recipe: "next", hoppers: [{ layer: "A", index: 1, resin: "EVA", pct: 12.5 }, { layer: "C", index: 4, resin: "EVA", pct: 12.5 }] } },
    { command: "setHopperAssignments", args: { recipe: "current", hoppers: [{ layer: "B", index: 2, resin: "" }] } },
    { command: "setHopperAssignments", args: { recipe: "current", hoppers: [{ layer: "B", index: 2, pct: 0 }] } }
  ]);
  assert.equal("pct" in b.calls[1].args.hoppers[0], false, "no change is the field's absence");
  assert.equal("resin" in b.calls[2].args.hoppers[0], false);
  const nothing = actions.applyAssignments(b, "current", ["A:1"], {});
  assert.deepEqual([nothing.ok, nothing.code], [false, "unavailable"]);
  assert.match(nothing.message, /Enter a resin or a percentage/);
  const nan = actions.applyAssignments(b, "current", ["A:1"], { pct: NaN });
  assert.equal(nan.ok, false);
  const none = actions.applyAssignments(b, "current", [], { resin: "X" });
  assert.match(none.message, /Select at least one hopper/);
  assert.equal(b.calls.length, 3);
});

test("undoEdit and redoEdit hand one command each, addressed to the recipe given, and return the answer untouched; can() reads the offer for them as for any action", () => {
  const b = bridge({ answer: { ok: true, changed: true, revision: 3 } });
  assert.deepEqual(actions.undoEdit(b, "next"), { ok: true, changed: true, revision: 3 });
  assert.equal(actions.redoEdit(b, "current").revision, 3);
  assert.deepEqual(b.calls, [
    { command: "undo", args: { recipe: "next" } },
    { command: "redo", args: { recipe: "current" } }
  ]);
  assert.equal(actions.can(b, "undo"), true);
  assert.equal(actions.can(bridge({ capabilities: [...contract.LAYER_COMMANDS] }), "undo"), false);
  assert.match(actions.reason(bridge({ capabilities: [] }), "redo"), /does not offer redo/);
  assert.equal(actions.undoEdit(b, "plan").code, "unavailable");
  assert.equal(actions.undoEdit(null, "current").code, "unavailable");
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
