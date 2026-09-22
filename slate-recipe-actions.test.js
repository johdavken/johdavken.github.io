"use strict";

/* The two dispatch seams behind the Recipe panel: slate-recipe-actions.js
 * (edits, moves, layer moves, history) and slate-plan-actions.js (the
 * plan's copy and promote). Every command's name and args are pinned. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeCommands } = require("./tools/slate-test/fake-dom.js");
const actions = require("./slate/slate-recipe-actions.js");
const plan = require("./slate/slate-plan-actions.js");
const contract = require("./station-command-contract.js");

const ALL = [...contract.COMMANDS];

test("every command the seams name is in the contract, and every recipe command is sent with an explicit recipe", () => {
  for (const name of Object.values(actions.COMMAND)) assert.ok(ALL.includes(name), `${name} is not a contract command`);
  for (const name of Object.values(plan.COMMAND)) assert.ok(ALL.includes(name), `${name} is not a contract command`);
  const commands = makeCommands({ capabilities: ALL });
  actions.setResin(commands, "current", "A", 1, " HX204 ");
  actions.setResin(commands, "next", "B", 2, "");
  actions.setBlend(commands, "next", "A", 1, "45");
  actions.setShare(commands, "current", "B", "40");
  actions.move(commands, "current", { layer: "A", index: 2 }, { layer: "B", index: 0 });
  actions.applyAssignments(commands, "next", [{ layer: "A", index: 0, resin: "HX204" }, { layer: "A", index: 2, resin: "", pct: 0 }, { layer: "B", index: 1, pct: 35 }]);
  actions.copyLayer(commands, "next", "A", "C");
  actions.clearLayer(commands, "current", "B");
  actions.undo(commands, "current");
  actions.redo(commands, "next");
  assert.deepEqual(commands.calls, [
    { command: "setHopperResin", args: { recipe: "current", layer: "A", index: 1, resin: "HX204" } },
    { command: "clearHopper", args: { recipe: "next", layer: "B", index: 2 } },
    { command: "setHopperBlend", args: { recipe: "next", layer: "A", index: 1, pct: "45" } },
    { command: "setLayerShare", args: { recipe: "current", layer: "B", pct: "40" } },
    { command: "moveHopper", args: { recipe: "current", layer: "A", index: 2, toLayer: "B", toIndex: 0 } },
    { command: "setHopperAssignments", args: { recipe: "next", hoppers: [{ layer: "A", index: 0, resin: "HX204" }, { layer: "A", index: 2, resin: "", pct: 0 }, { layer: "B", index: 1, pct: 35 }] } },
    { command: "copyLayer", args: { recipe: "next", layer: "A", toLayer: "C" } },
    { command: "clearLayer", args: { recipe: "current", layer: "B" } },
    { command: "undo", args: { recipe: "current" } },
    { command: "redo", args: { recipe: "next" } }
  ]);
  // The contract accepts each exactly as sent.
  for (const call of commands.calls) {
    const normalized = contract.normalizeArguments(call.command, call.args);
    assert.ok(!normalized.error, `${call.command}: ${normalized.error && normalized.error.message}`);
  }
});

test("a null bridge or a nonsense recipe answers unavailable and sends nothing", () => {
  assert.equal(actions.setBlend(null, "current", "A", 1, "10").code, "unavailable");
  assert.equal(actions.undo(null, "current").code, "unavailable");
  const commands = makeCommands({ capabilities: ALL });
  assert.equal(actions.setResin(commands, "planned", "A", 1, "X").code, "unavailable");
  assert.equal(actions.move(commands, undefined, { layer: "A", index: 0 }, { layer: "A", index: 1 }).code, "unavailable");
  assert.equal(commands.calls.length, 0);
  assert.equal(plan.copy(null).code, "unavailable");
});

test("abilities follow the bridge's capabilities; resin needs both set and clear; read-only withholds all", () => {
  const full = makeCommands({ capabilities: ALL });
  const able = actions.abilities(full);
  assert.deepEqual(able, { resin: true, clear: true, blend: true, share: true, move: true, assign: true, copyLayer: true, clearLayer: true, undo: true, redo: true });
  const partial = makeCommands({ capabilities: ["setHopperResin", "setHopperBlend", "undo"] });
  const some = actions.abilities(partial);
  assert.equal(some.resin, false, "a resin edit without clearHopper was offered");
  assert.equal(some.blend, true);
  assert.equal(some.undo, true);
  assert.equal(some.redo, false);
  assert.equal(some.assign, false, "the bulk edit was offered without setHopperAssignments");
  assert.equal(actions.applyAssignments(null, "current", [{ layer: "A", index: 1, pct: 5 }]).code, "unavailable");
  assert.ok(Object.values(actions.abilities(full, { readOnly: true })).every(value => value === false));
  assert.ok(Object.values(actions.abilities(null)).every(value => value === false));
  assert.equal(actions.reason(full, "blend", { readOnly: true }), actions.READ_ONLY_REASON);
  assert.match(actions.reason(null, "blend"), /no application/);
  assert.match(actions.reason(partial, "move"), /does not offer moveHopper/);
});

test("plan actions: copy and promote each send an empty argument object; promote needs a plan", () => {
  const commands = makeCommands({ capabilities: ALL });
  plan.copy(commands);
  plan.promote(commands);
  assert.deepEqual(commands.calls, [{ command: "copyCurrentToNext", args: {} }, { command: "promoteNextRecipe", args: {} }]);
  assert.deepEqual(plan.can(commands, { planned: true }), { copy: true, promote: true });
  assert.deepEqual(plan.can(commands, { planned: false }), { copy: true, promote: false });
  assert.deepEqual(plan.can(commands, { readOnly: true, planned: true }), { copy: false, promote: false });
  assert.deepEqual(plan.can(null, { planned: true }), { copy: false, promote: false });
  assert.equal(plan.reason(commands, "promote", { planned: false }), "nothing is planned.");
  assert.equal(plan.reason(commands, "copy", { readOnly: true }), plan.READ_ONLY_REASON);
  assert.match(plan.reason(null, "copy"), /no application/);
  assert.match(plan.reason(makeCommands({ capabilities: [] }), "copy"), /does not offer copyCurrentToNext/);
});
