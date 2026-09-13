"use strict";

/* The command contract (station-command-contract.js): the vocabulary, the
 * normalizers, and the two result shapes. Pure and deterministic, so every
 * rule is pinned here rather than discovered against live state later.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const contract = require("./station-command-contract.js");
const hookups = require("./hookup-sources.js");

const GOOD = { recipe: "current", layer: "A", index: 1, pct: 25, resin: "HX204", source: "silo 3" };

/* ----------------------------------------------------------------------
 *   Vocabulary
 * -------------------------------------------------------------------- */

test("the approved command vocabulary, and nothing else", () => {
  assert.deepEqual([...contract.COMMANDS],
    ["setHopperResin", "setHopperBlend", "setLayerShare", "clearHopper", "setSource", "moveHopper", "setHopperTracking", "setPumpOff", "resetTracking", "undo", "redo", "setLineRate", "setChangeover", "setProductionPounds", "setScrapPounds", "setHopperWeight", "setHopperWeights", "setHopperGeometry", "setHopperGeometries", "setHopperCircumference", "setSmartHoppers", "promoteNextRecipe", "copyCurrentToNext", "copyLayer", "clearLayer", "setHopperResins"]);
  assert.ok(Object.isFrozen(contract.COMMANDS));
  assert.deepEqual([...contract.RECIPES], ["current", "next"]);
  assert.deepEqual([...contract.JOB_COMMANDS], ["setLineRate", "setChangeover", "setProductionPounds", "setScrapPounds"]);
  for (const command of contract.COMMANDS) {
    assert.ok(Array.isArray(contract.ARGUMENTS[command]), `${command} declares no arguments`);
    // A recipe command names its recipe first; a job command names no
    // recipe at all - output and changeover belong to the whole job - nor
    // does the device's preference, nor the line's one circumference.
    if (contract.JOB_COMMANDS.includes(command) || contract.PREFERENCE_COMMANDS.includes(command) || contract.PLAN_COMMANDS.includes(command) || command === "setHopperCircumference") {
      assert.ok(!contract.ARGUMENTS[command].includes("recipe"), `${command} names a recipe`);
    } else {
      assert.equal(contract.ARGUMENTS[command][0], "recipe", `${command} does not name its recipe first`);
    }
  }
});

/* ----------------------------------------------------------------------
 *   Job commands: output and changeover
 * -------------------------------------------------------------------- */

test("setLineRate takes a non-negative number of lb/hr, as the Output field does; zero clears", () => {
  assert.deepEqual(contract.ARGUMENTS.setLineRate, ["lineRate"]);
  for (const [given, expected] of [[850, 850], ["850", 850], ["1,200.5", 1200.5], [0, 0], ["0", 0]]) {
    const request = contract.normalizeArguments("setLineRate", { lineRate: given });
    assert.equal(request.ok, true, `${JSON.stringify(given)} refused`);
    assert.deepEqual(request.args, { lineRate: expected });
    assert.ok(Object.isFrozen(request.args));
  }
  for (const bad of [undefined, null, "", "abc", NaN, Infinity, {}, true]) {
    const request = contract.normalizeArguments("setLineRate", { lineRate: bad });
    assert.equal(request.ok, false, `${JSON.stringify(bad)} accepted`);
    assert.equal(request.code, "bad_argument");
    assert.equal(request.field, "lineRate");
  }
  const negative = contract.normalizeArguments("setLineRate", { lineRate: -1 });
  assert.equal(negative.code, "out_of_range");
  assert.equal(negative.field, "lineRate");
  // Nothing else rides along.
  assert.deepEqual(Object.keys(contract.normalizeArguments("setLineRate", { lineRate: 1, recipe: "next", layer: "A" }).args), ["lineRate"]);
});

test("setChangeover takes an absolute instant in epoch milliseconds, or null to clear; never a clock string or a duration", () => {
  assert.deepEqual(contract.ARGUMENTS.setChangeover, ["at"]);
  const at = Date.UTC(2026, 8, 12, 3, 28);
  assert.deepEqual(contract.normalizeArguments("setChangeover", { at }).args, { at });
  assert.deepEqual(contract.normalizeArguments("setChangeover", { at: String(at) }).args, { at });
  assert.deepEqual(contract.normalizeArguments("setChangeover", { at: at + 0.4 }).args, { at });
  for (const clear of [null, undefined, ""]) {
    assert.deepEqual(contract.normalizeArguments("setChangeover", { at: clear }).args, { at: null });
  }
  for (const bad of ["03:28", "in 45m", 0, -5, NaN, Infinity, {}, true, "abc"]) {
    const request = contract.normalizeArguments("setChangeover", { at: bad });
    assert.equal(request.ok, false, `${JSON.stringify(bad)} accepted`);
    assert.equal(request.code, "bad_argument");
    assert.equal(request.field, "at");
  }
});

test("the error vocabulary is declared in full, with a default message for each code", () => {
  assert.deepEqual([...contract.ERROR_CODES], [
    "unavailable", "rearranging", "busy", "unknown_command", "bad_argument", "unknown_layer",
    "unknown_hopper", "h1_derived", "out_of_range", "blend_total", "no_resin", "empty_hopper", "nothing_to_undo", "no_plan", "internal"
  ]);
  for (const code of contract.ERROR_CODES) {
    assert.equal(typeof contract.MESSAGES[code], "string", `${code} has no message`);
    assert.ok(contract.MESSAGES[code].length > 0);
  }
  assert.ok(Object.isFrozen(contract.MESSAGES));
});

test("the bounds are the application's own", () => {
  assert.equal(contract.HOPPERS_PER_LAYER, 6);
  // validation.js refuses a resin name over 100 characters at the sync gate.
  const validation = fs.readFileSync(path.join(__dirname, "validation.js"), "utf8");
  assert.match(validation, /hopper\.resinName\.length > 100/);
  assert.equal(contract.MAX_RESIN_LENGTH, 100);
  assert.equal(contract.MAX_SOURCE_LENGTH, hookups.MAX_SOURCE_LENGTH);
});

test("the module is frozen, DOM-free and state-free", () => {
  assert.ok(Object.isFrozen(contract));
  const source = fs.readFileSync(path.join(__dirname, "station-command-contract.js"), "utf8");
  for (const pattern of [/\bdocument\b/, /\bwindow\b/, /localStorage/, /\bfetch\s*\(/, /supabase/i, /setTimeout/, /\bstate\.layers\b/]) {
    assert.doesNotMatch(source, pattern, `the contract reaches outside itself (${pattern})`);
  }
});

/* ----------------------------------------------------------------------
 *   Normalizers
 * -------------------------------------------------------------------- */

test("recipe must be current or next, with no default", () => {
  assert.deepEqual(contract.normalizeRecipe("current"), { ok: true, value: "current" });
  assert.deepEqual(contract.normalizeRecipe("next"), { ok: true, value: "next" });
  for (const bad of [undefined, null, "", "Current", "weights", 0, {}]) {
    const result = contract.normalizeRecipe(bad);
    assert.equal(result.ok, false, `${String(bad)} was accepted as a recipe`);
    assert.equal(result.code, "bad_argument");
  }
});

test("layer must be a non-empty identifier; existence is the executor's question", () => {
  assert.deepEqual(contract.normalizeLayer("A"), { ok: true, value: "A" });
  assert.deepEqual(contract.normalizeLayer(" C "), { ok: true, value: "C" });
  for (const bad of ["", "  ", null, 3, "1A", "A B", "a".repeat(17), {}]) {
    assert.equal(contract.normalizeLayer(bad).ok, false, `${JSON.stringify(bad)} was accepted as a layer`);
    assert.equal(contract.normalizeLayer(bad).code, "bad_argument");
  }
});

test("index must be an integer in the six-hopper range", () => {
  assert.deepEqual(contract.normalizeIndex(0), { ok: true, value: 0 });
  assert.deepEqual(contract.normalizeIndex(5), { ok: true, value: 5 });
  assert.deepEqual(contract.normalizeIndex("3"), { ok: true, value: 3 });
  for (const bad of [1.5, "x", "", null, undefined, NaN, {}]) {
    assert.equal(contract.normalizeIndex(bad).code, "bad_argument", `${String(bad)} accepted`);
  }
  for (const outside of [-1, 6, 99]) {
    assert.equal(contract.normalizeIndex(outside).code, "unknown_hopper", `${outside} accepted`);
  }
});

test("percentage must be finite and between 0 and 100", () => {
  assert.deepEqual(contract.normalizePercentage(0), { ok: true, value: 0 });
  assert.deepEqual(contract.normalizePercentage(100), { ok: true, value: 100 });
  assert.deepEqual(contract.normalizePercentage("12.5"), { ok: true, value: 12.5 });
  assert.deepEqual(contract.normalizePercentage("1,000").code, "out_of_range");
  for (const bad of ["", "  ", "abc", null, undefined, NaN, Infinity, {}, true]) {
    assert.equal(contract.normalizePercentage(bad).code, "bad_argument", `${String(bad)} accepted`);
  }
  for (const outside of [-0.01, 100.01, 250]) {
    assert.equal(contract.normalizePercentage(outside).code, "out_of_range", `${outside} accepted`);
  }
});

test("resin is trimmed and whitespace-collapsed like the application's normName, bounded to the sync-safe length", () => {
  assert.deepEqual(contract.normalizeResin("  HX  204 \n"), { ok: true, value: "HX 204" });
  assert.deepEqual(contract.normalizeResin(""), { ok: true, value: "" }, "empty means no resin");
  assert.deepEqual(contract.normalizeResin(null), { ok: true, value: "" });
  assert.deepEqual(contract.normalizeResin(undefined), { ok: true, value: "" });
  assert.equal(contract.normalizeResin("x".repeat(100)).ok, true);
  const long = contract.normalizeResin("x".repeat(101));
  assert.equal(long.ok, false);
  assert.equal(long.code, "bad_argument");
  assert.equal(contract.normalizeResin(42).code, "bad_argument");
  assert.equal(contract.normalizeResin({}).code, "bad_argument");
  // No catalog check, by design: an unknown code is a valid resin name.
  assert.equal(contract.normalizeResin("NOT-IN-CATALOG").ok, true);
});

test("source is normalized by hookup-sources' own rule, not a copy of it", () => {
  assert.deepEqual(contract.normalizeSource(" silo 3 "), { ok: true, value: hookups.normalizeSource(" silo 3 ") });
  assert.equal(contract.normalizeSource(" silo 3 ").value, "SILO 3");
  assert.equal(contract.normalizeSource("a".repeat(40)).value.length, hookups.MAX_SOURCE_LENGTH);
  assert.deepEqual(contract.normalizeSource(""), { ok: true, value: "" }, "empty removes the label");
  assert.deepEqual(contract.normalizeSource(null), { ok: true, value: "" });
  assert.equal(contract.normalizeSource(7).code, "bad_argument");
  const source = fs.readFileSync(path.join(__dirname, "station-command-contract.js"), "utf8");
  assert.doesNotMatch(source, /toUpperCase\(\)/, "the contract restates the source rule instead of calling it");
});

/* ----------------------------------------------------------------------
 *   The whole request
 * -------------------------------------------------------------------- */

test("normalizeArguments rebuilds exactly the command's arguments, normalized and frozen", () => {
  const result = contract.normalizeArguments("setHopperBlend", Object.assign({}, GOOD, { pct: "40", extra: "dropped" }));
  assert.deepEqual(result, { ok: true, command: "setHopperBlend", args: { recipe: "current", layer: "A", index: 1, pct: 40 } });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.args));
  assert.equal("extra" in result.args, false);
  assert.equal("resin" in result.args, false, "an argument the command does not take is dropped");

  assert.deepEqual(contract.normalizeArguments("undo", { recipe: "next" }).args, { recipe: "next" });
  assert.deepEqual(contract.normalizeArguments("setLayerShare", { recipe: "next", layer: "B", pct: 33.3 }).args,
    { recipe: "next", layer: "B", pct: 33.3 });
  assert.deepEqual(contract.normalizeArguments("clearHopper", { recipe: "current", layer: "A", index: "0" }).args,
    { recipe: "current", layer: "A", index: 0 });
  assert.deepEqual(contract.normalizeArguments("setSource", Object.assign({}, GOOD, { source: "box 12" })).args,
    { recipe: "current", layer: "A", index: 1, source: "BOX 12" });
  assert.deepEqual(contract.normalizeArguments("setHopperResin", Object.assign({}, GOOD, { resin: "" })).args,
    { recipe: "current", layer: "A", index: 1, resin: "" });
});

test("moveHopper names the position it moves as every command does, and the destination as toLayer/toIndex", () => {
  assert.deepEqual([...contract.ARGUMENTS.moveHopper], ["recipe", "layer", "index", "toLayer", "toIndex"]);
  assert.deepEqual(contract.normalizeArguments("moveHopper", Object.assign({}, GOOD, { toLayer: " B ", toIndex: "3" })).args,
    { recipe: "current", layer: "A", index: 1, toLayer: "B", toIndex: 3 });
  // The same position twice is well formed: whether it is a change is the
  // executor's answer (a no-op), not a malformed request.
  assert.equal(contract.normalizeArguments("moveHopper", Object.assign({}, GOOD, { toLayer: "A", toIndex: 1 })).ok, true);
  // The destination is held to the same rules as the source, under its own names.
  assert.deepEqual(contract.normalizeArguments("moveHopper", Object.assign({}, GOOD, { toLayer: "1A", toIndex: 0 })), {
    ok: false, code: "bad_argument", message: "The layer must be named.", field: "toLayer"
  });
  assert.equal(contract.normalizeArguments("moveHopper", Object.assign({}, GOOD, { toLayer: "B", toIndex: 6 })).code, "unknown_hopper");
  assert.equal(contract.normalizeArguments("moveHopper", Object.assign({}, GOOD, { toLayer: "B", toIndex: 6 })).field, "toIndex");
  assert.equal(contract.normalizeArguments("moveHopper", Object.assign({}, GOOD, { toLayer: "B" })).field, "toIndex");
  assert.equal(contract.normalizeArguments("moveHopper", GOOD).field, "toLayer");
  // Nothing but the five: a `resin` or `pct` passed along is dropped.
  assert.deepEqual(Object.keys(contract.normalizeArguments("moveHopper", Object.assign({}, GOOD, { toLayer: "B", toIndex: 0 })).args),
    ["recipe", "layer", "index", "toLayer", "toIndex"]);
  assert.equal(contract.MESSAGES.empty_hopper, "The hopper has no resin or share to move.");
});

test("a bad argument is a value naming the field, never a throw", () => {
  const missingRecipe = contract.normalizeArguments("setHopperResin", { layer: "A", index: 0, resin: "X" });
  assert.deepEqual(missingRecipe, { ok: false, code: "bad_argument", message: 'The recipe must be "current" or "next".', field: "recipe" });
  assert.equal(contract.normalizeArguments("setHopperBlend", Object.assign({}, GOOD, { pct: 101 })).code, "out_of_range");
  assert.equal(contract.normalizeArguments("setHopperBlend", Object.assign({}, GOOD, { pct: 101 })).field, "pct");
  assert.equal(contract.normalizeArguments("clearHopper", Object.assign({}, GOOD, { index: 9 })).code, "unknown_hopper");
  assert.equal(contract.normalizeArguments("clearHopper", Object.assign({}, GOOD, { index: 9 })).field, "index");
  assert.equal(contract.normalizeArguments("setSource", Object.assign({}, GOOD, { source: 3 })).field, "source");
  assert.equal(contract.normalizeArguments("setHopperResin", Object.assign({}, GOOD, { resin: "x".repeat(200) })).field, "resin");
  // The first failing argument, in declaration order, is the one reported.
  assert.equal(contract.normalizeArguments("setHopperBlend", { recipe: "next", layer: "", index: 99, pct: 500 }).field, "layer");
});

test("nothing thrown for any input, including no input at all", () => {
  for (const command of [undefined, null, 42, "", "nope", "SETHOPPERRESIN", {}, [], () => {}]) {
    let result;
    assert.doesNotThrow(() => { result = contract.normalizeArguments(command, GOOD); });
    assert.equal(result.ok, false);
    assert.equal(result.code, "unknown_command");
  }
  for (const args of [undefined, null, "string", 7, [], () => {}]) {
    let result;
    assert.doesNotThrow(() => { result = contract.normalizeArguments("undo", args); });
    assert.equal(result.ok, false);
    assert.equal(result.code, "bad_argument");
    assert.equal(result.field, "recipe");
  }
  assert.doesNotThrow(() => contract.normalizeArguments());
});

/* ----------------------------------------------------------------------
 *   Result shapes
 * -------------------------------------------------------------------- */

test("a success result has the documented shape, frozen, and does not clone the snapshot it is handed", () => {
  const snapshot = Object.freeze({ revision: 9 });
  const result = contract.success({ changed: 1, revision: 9, persisted: true, snapshot });
  assert.deepEqual(result, { ok: true, changed: true, revision: 9, persisted: true, snapshot });
  assert.equal(result.snapshot, snapshot, "the snapshot must be the same object the bridge will publish");
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(contract.success(), { ok: true, changed: false, revision: null, persisted: false, snapshot: null });
  assert.deepEqual(contract.success({ revision: "9", snapshot: "no" }).revision, null);
});

test("a failure result carries a known code, a message, and field/total only when given", () => {
  assert.deepEqual(contract.failure("blend_total", { total: 120 }),
    { ok: false, code: "blend_total", message: contract.MESSAGES.blend_total, total: 120 });
  assert.deepEqual(contract.failure("bad_argument", { field: "pct", message: "Custom wording" }),
    { ok: false, code: "bad_argument", message: "Custom wording", field: "pct" });
  assert.ok(Object.isFrozen(contract.failure("busy")));
  // The vocabulary is closed: an invented code becomes internal.
  assert.equal(contract.failure("made_up").code, "internal");
  assert.equal(contract.failure().code, "internal");
  assert.equal(contract.failure("no_resin", { field: 7, total: "lots" }).field, undefined);
  assert.equal(contract.failure("no_resin", { field: 7, total: "lots" }).total, undefined);
});

test("isResult recognizes exactly the two shapes", () => {
  assert.equal(contract.isResult(contract.success({ changed: true, revision: 1, persisted: true, snapshot: {} })), true);
  assert.equal(contract.isResult(contract.failure("busy")), true);
  for (const bad of [null, undefined, {}, { ok: "yes" }, { ok: true }, { ok: true, changed: true, revision: 1, persisted: true, snapshot: "x" },
    { ok: false }, { ok: false, code: "made_up", message: "x" }, { ok: false, code: "busy" }, "ok", []]) {
    assert.equal(contract.isResult(bad), false, `${JSON.stringify(bad)} passed as a result`);
  }
});

/* ----------------------------------------------------------------------
 *   Step 10: the runtime commands - tracking and pump-off
 * -------------------------------------------------------------------- */

test("the runtime commands are declared, the two toggles take a boolean flag, and all are addressable to the Current recipe only", () => {
  assert.deepEqual([...contract.RUNTIME_COMMANDS], ["setHopperTracking", "setPumpOff", "resetTracking"]);
  assert.ok(Object.isFrozen(contract.RUNTIME_COMMANDS));
  assert.deepEqual([...contract.ARGUMENTS.setHopperTracking], ["recipe", "layer", "index", "track"]);
  assert.deepEqual([...contract.ARGUMENTS.setPumpOff], ["recipe", "layer", "index", "pumpOff"]);

  const on = contract.normalizeArguments("setHopperTracking", { recipe: "current", layer: "B", index: "2", track: true, extra: 1 });
  assert.deepEqual(on, { ok: true, command: "setHopperTracking", args: { recipe: "current", layer: "B", index: 2, track: true } });
  assert.ok(Object.isFrozen(on.args));
  const off = contract.normalizeArguments("setPumpOff", { recipe: "current", layer: "B", index: 0, pumpOff: false });
  assert.deepEqual(off.args, { recipe: "current", layer: "B", index: 0, pumpOff: false });

  // The plan cannot carry runtime state: "next" is refused here, before
  // any executor sees it, and the field is named.
  for (const [command, flag] of [["setHopperTracking", "track"], ["setPumpOff", "pumpOff"]]) {
    const refused = contract.normalizeArguments(command, { recipe: "next", layer: "B", index: 1, [flag]: true });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "bad_argument");
    assert.equal(refused.field, "recipe");
    assert.match(refused.message, /running job/);
  }
});

test("resetTracking names the running job and nothing else: no position, no flag, Current only", () => {
  assert.deepEqual([...contract.ARGUMENTS.resetTracking], ["recipe"]);
  const request = contract.normalizeArguments("resetTracking", { recipe: "current", layer: "B", index: 1, track: false });
  assert.deepEqual(request, { ok: true, command: "resetTracking", args: { recipe: "current" } }, "a position handed along is dropped: the command is the job's");
  assert.ok(Object.isFrozen(request.args));
  const refused = contract.normalizeArguments("resetTracking", { recipe: "next" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "bad_argument");
  assert.equal(refused.field, "recipe");
  assert.match(refused.message, /running job/);
  const unnamed = contract.normalizeArguments("resetTracking", {});
  assert.equal(unnamed.ok, false, "the recipe is named, never defaulted");
  assert.equal(unnamed.field, "recipe");
});

/* ----------------------------------------------------------------------
 *   Weights: the equipment commands
 * -------------------------------------------------------------------- */

test("the equipment commands are declared, read pounds like the job's figures, and are addressable to the Current recipe only", () => {
  assert.deepEqual([...contract.EQUIPMENT_COMMANDS], ["setHopperWeight", "setHopperWeights", "setHopperGeometry", "setHopperGeometries", "setHopperCircumference"]);
  assert.ok(Object.isFrozen(contract.EQUIPMENT_COMMANDS));
  assert.deepEqual([...contract.ARGUMENTS.setHopperWeight], ["recipe", "layer", "index", "weight"]);
  assert.deepEqual([...contract.ARGUMENTS.setHopperWeights], ["recipe", "weights"]);

  const one = contract.normalizeArguments("setHopperWeight", { recipe: "current", layer: "B", index: "2", weight: "1,250", extra: 1 });
  assert.deepEqual(one, { ok: true, command: "setHopperWeight", args: { recipe: "current", layer: "B", index: 2, weight: 1250 } });
  assert.ok(Object.isFrozen(one.args));
  const cleared = contract.normalizeArguments("setHopperWeight", { recipe: "current", layer: "B", index: 0, weight: 0 });
  assert.equal(cleared.args.weight, 0, "0 is 'not entered', as the Weights page reads a blank field");

  const negative = contract.normalizeArguments("setHopperWeight", { recipe: "current", layer: "B", index: 0, weight: -5 });
  assert.equal(negative.ok, false);
  assert.equal(negative.code, "out_of_range");
  assert.equal(negative.field, "weight");
  const text = contract.normalizeArguments("setHopperWeight", { recipe: "current", layer: "B", index: 0, weight: "heavy" });
  assert.equal(text.ok, false);
  assert.equal(text.code, "bad_argument");
  assert.equal(text.field, "weight");

  // The plan has no weights: "next" is refused here, before any executor
  // sees it, with the field named - and the wording is the equipment's,
  // not the runtime commands'.
  const refusedOne = contract.normalizeArguments("setHopperWeight", { recipe: "next", layer: "B", index: 1, weight: 10 });
  assert.equal(refusedOne.ok, false);
  assert.equal(refusedOne.code, "bad_argument");
  assert.equal(refusedOne.field, "recipe");
  assert.match(refusedOne.message, /physical hoppers/);
  assert.doesNotMatch(refusedOne.message, /running job/);
  const refusedMany = contract.normalizeArguments("setHopperWeights", { recipe: "next", weights: [{ layer: "A", index: 0, weight: 10 }] });
  assert.equal(refusedMany.ok, false);
  assert.equal(refusedMany.field, "recipe");
  assert.match(refusedMany.message, /physical hoppers/);
});

test("a weight list is read entry by entry, frozen, never empty, never twice the same hopper, never more than a page", () => {
  const request = contract.normalizeArguments("setHopperWeights", {
    recipe: "current",
    weights: [{ layer: "A", index: "0", weight: "1,000" }, { layer: "A", index: 1, weight: 0 }, { layer: "C", index: 5, weight: 12.5, extra: true }]
  });
  assert.deepEqual(request, {
    ok: true,
    command: "setHopperWeights",
    args: { recipe: "current", weights: [{ layer: "A", index: 0, weight: 1000 }, { layer: "A", index: 1, weight: 0 }, { layer: "C", index: 5, weight: 12.5 }] }
  });
  assert.ok(Object.isFrozen(request.args.weights));
  assert.ok(request.args.weights.every(entry => Object.isFrozen(entry)));

  for (const empty of [[], null, undefined, "A:0", {}]) {
    const refused = contract.normalizeArguments("setHopperWeights", { recipe: "current", weights: empty });
    assert.equal(refused.ok, false, `${JSON.stringify(empty)} accepted`);
    assert.equal(refused.code, "bad_argument");
    assert.equal(refused.field, "weights");
  }

  const twice = contract.normalizeArguments("setHopperWeights", { recipe: "current", weights: [{ layer: "A", index: 1, weight: 1 }, { layer: "A", index: "1", weight: 2 }] });
  assert.equal(twice.ok, false);
  assert.equal(twice.field, "weights");
  assert.match(twice.message, /A:1 is listed twice/);

  // Each entry's own fault, in the list's field: a bad layer, index or
  // weight is the same code the single command would give.
  const badIndex = contract.normalizeArguments("setHopperWeights", { recipe: "current", weights: [{ layer: "A", index: 6, weight: 1 }] });
  assert.equal(badIndex.ok, false);
  assert.equal(badIndex.field, "weights");
  const badWeight = contract.normalizeArguments("setHopperWeights", { recipe: "current", weights: [{ layer: "A", index: 0, weight: -1 }] });
  assert.equal(badWeight.ok, false);
  assert.equal(badWeight.code, "out_of_range");
  assert.equal(badWeight.field, "weights");
  const noLayer = contract.normalizeArguments("setHopperWeights", { recipe: "current", weights: [{ index: 0, weight: 1 }] });
  assert.equal(noLayer.ok, false);
  assert.equal(noLayer.field, "weights");

  assert.equal(contract.MAX_WEIGHT_ENTRIES, 48);
  const tooMany = Array.from({ length: contract.MAX_WEIGHT_ENTRIES + 1 }, (_, i) => ({ layer: `L${i}`, index: 0, weight: 1 }));
  const refused = contract.normalizeArguments("setHopperWeights", { recipe: "current", weights: tooMany });
  assert.equal(refused.ok, false);
  assert.equal(refused.field, "weights");
  assert.match(refused.message, /48/);
  const justEnough = contract.normalizeArguments("setHopperWeights", { recipe: "current", weights: tooMany.slice(0, contract.MAX_WEIGHT_ENTRIES) });
  assert.equal(justEnough.ok, true);
});

test("a runtime flag is a boolean and nothing else: no strings, numbers or absence", () => {
  assert.deepEqual(contract.normalizeFlag(true), { ok: true, value: true });
  assert.deepEqual(contract.normalizeFlag(false), { ok: true, value: false });
  for (const bad of ["true", "on", 1, 0, null, undefined, {}, []]) {
    const result = contract.normalizeFlag(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} was accepted as a flag`);
    assert.equal(result.code, "bad_argument");
  }
  const request = contract.normalizeArguments("setPumpOff", { recipe: "current", layer: "A", index: 1, pumpOff: "true" });
  assert.equal(request.ok, false);
  assert.equal(request.field, "pumpOff");
  assert.equal(contract.normalizeArguments("setHopperTracking", { recipe: "current", layer: "A", index: 1 }).field, "track");
});

/* ----------------------------------------------------------------------
 *   Smart Hoppers: geometry, circumference, the switch
 * -------------------------------------------------------------------- */

test("the geometry commands are equipment commands: Current only, a hopper's usable measure stated in the line's own terms, 0 clearing", () => {
  assert.deepEqual([...contract.ARGUMENTS.setHopperGeometry], ["recipe", "layer", "index", "dimension", "value"]);
  assert.deepEqual([...contract.ARGUMENTS.setHopperGeometries], ["recipe", "geometries"]);
  assert.deepEqual([...contract.DIMENSIONS], ["height", "volume"]);
  const ok = contract.normalizeArguments("setHopperGeometry", { recipe: "current", layer: "A", index: "2", dimension: "height", value: "31.5" });
  assert.deepEqual(ok, { ok: true, command: "setHopperGeometry", args: { recipe: "current", layer: "A", index: 2, dimension: "height", value: 31.5 } });
  assert.ok(Object.isFrozen(ok.args));
  assert.equal(contract.normalizeArguments("setHopperGeometry", { recipe: "current", layer: "A", index: 0, dimension: "volume", value: "1,200" }).args.value, 1200);
  assert.equal(contract.normalizeArguments("setHopperGeometry", { recipe: "current", layer: "A", index: 0, dimension: "height", value: 0 }).args.value, 0, "0 clears");
  const next = contract.normalizeArguments("setHopperGeometry", { recipe: "next", layer: "A", index: 0, dimension: "height", value: 30 });
  assert.equal(next.ok, false);
  assert.equal(next.field, "recipe");
  assert.match(next.message, /hopper geometry belong to the physical hoppers/);
  const bad = contract.normalizeArguments("setHopperGeometry", { recipe: "current", layer: "A", index: 0, dimension: "depth", value: 30 });
  assert.equal(bad.code, "bad_argument");
  assert.equal(bad.field, "dimension");
  assert.equal(contract.normalizeArguments("setHopperGeometry", { recipe: "current", layer: "A", index: 0, dimension: "height", value: -1 }).code, "out_of_range");
  assert.equal(contract.normalizeArguments("setHopperGeometry", { recipe: "current", layer: "A", index: 0, dimension: "height", value: "tall" }).code, "bad_argument");
  assert.equal(contract.normalizeArguments("setHopperGeometry", { recipe: "current", layer: "A", index: 0, dimension: "height" }).field, "value");
});

test("the bulk geometry list follows the weight list's rules: non-empty, capped, no position twice, each entry read by the single command's normalizers", () => {
  const two = contract.normalizeArguments("setHopperGeometries", { recipe: "current", geometries: [
    { layer: "A", index: 0, dimension: "volume", value: "55" }, { layer: "B", index: "1", dimension: "volume", value: 0 }
  ] });
  assert.equal(two.ok, true);
  assert.deepEqual([...two.args.geometries], [{ layer: "A", index: 0, dimension: "volume", value: 55 }, { layer: "B", index: 1, dimension: "volume", value: 0 }]);
  assert.ok(Object.isFrozen(two.args.geometries) && Object.isFrozen(two.args.geometries[0]));
  assert.equal(contract.normalizeArguments("setHopperGeometries", { recipe: "current", geometries: [] }).code, "bad_argument");
  assert.equal(contract.normalizeArguments("setHopperGeometries", { recipe: "current", geometries: "A:0" }).code, "bad_argument");
  const twice = contract.normalizeArguments("setHopperGeometries", { recipe: "current", geometries: [
    { layer: "A", index: 0, dimension: "height", value: 1 }, { layer: "A", index: 0, dimension: "height", value: 2 }
  ] });
  assert.equal(twice.code, "bad_argument");
  assert.match(twice.message, /listed twice/);
  assert.equal(contract.normalizeArguments("setHopperGeometries", { recipe: "current", geometries: [{ layer: "A", index: 0, dimension: "girth", value: 1 }] }).code, "bad_argument");
  assert.equal(contract.normalizeArguments("setHopperGeometries", { recipe: "current", geometries: [{ layer: "A", index: 9, dimension: "height", value: 1 }] }).code, "unknown_hopper");
  const tooMany = Array.from({ length: contract.MAX_WEIGHT_ENTRIES + 1 }, (_, i) => ({ layer: `L${i}`, index: 0, dimension: "height", value: 1 }));
  assert.equal(contract.normalizeArguments("setHopperGeometries", { recipe: "current", geometries: tooMany }).code, "bad_argument");
  assert.equal(contract.normalizeArguments("setHopperGeometries", { recipe: "current", geometries: tooMany.slice(0, contract.MAX_WEIGHT_ENTRIES) }).ok, true);
  assert.equal(contract.normalizeArguments("setHopperGeometries", { recipe: "next", geometries: [{ layer: "A", index: 0, dimension: "height", value: 1 }] }).field, "recipe");
});

test("the circumference is the line's one value - no recipe, no position - and the switch is the device's preference, a boolean", () => {
  assert.deepEqual([...contract.ARGUMENTS.setHopperCircumference], ["circumference"]);
  assert.deepEqual([...contract.ARGUMENTS.setSmartHoppers], ["enabled"]);
  assert.deepEqual([...contract.PREFERENCE_COMMANDS], ["setSmartHoppers"]);
  assert.ok(Object.isFrozen(contract.PREFERENCE_COMMANDS));
  assert.ok(contract.EQUIPMENT_COMMANDS.includes("setHopperCircumference"));
  assert.ok(!contract.EQUIPMENT_COMMANDS.includes("setSmartHoppers"));
  // A recipe handed to either is dropped, never refused: the command has no
  // recipe to be wrong about.
  assert.deepEqual(contract.normalizeArguments("setHopperCircumference", { circumference: "40.25", recipe: "next" }).args, { circumference: 40.25 });
  assert.equal(contract.normalizeArguments("setHopperCircumference", { circumference: 0 }).args.circumference, 0, "0 clears");
  assert.equal(contract.normalizeArguments("setHopperCircumference", { circumference: -2 }).code, "out_of_range");
  assert.equal(contract.normalizeArguments("setHopperCircumference", {}).field, "circumference");
  assert.deepEqual(contract.normalizeArguments("setSmartHoppers", { enabled: true, recipe: "next" }).args, { enabled: true });
  assert.deepEqual(contract.normalizeArguments("setSmartHoppers", { enabled: false }).args, { enabled: false });
  assert.equal(contract.normalizeArguments("setSmartHoppers", { enabled: "yes" }).code, "bad_argument");
  assert.equal(contract.normalizeArguments("setSmartHoppers", { enabled: 1 }).field, "enabled");
  // The measure normalizer itself, exported like the others.
  assert.deepEqual(contract.normalizeMeasure("1,000"), { ok: true, value: 1000 });
  assert.equal(contract.normalizeMeasure("").ok, false);
  assert.deepEqual(contract.normalizeDimension("volume"), { ok: true, value: "volume" });
  assert.equal(contract.normalizeDimension("Volume").ok, false);
});

test("the plan commands are the two moves between the running recipe and the planned one: no recipe, no position, no arguments at all", () => {
  assert.deepEqual([...contract.PLAN_COMMANDS], ["promoteNextRecipe", "copyCurrentToNext"]);
  assert.ok(Object.isFrozen(contract.PLAN_COMMANDS));
  for (const command of contract.PLAN_COMMANDS) {
    assert.deepEqual([...contract.ARGUMENTS[command]], []);
    assert.ok(!contract.RUNTIME_COMMANDS.includes(command) && !contract.EQUIPMENT_COMMANDS.includes(command) && !contract.JOB_COMMANDS.includes(command));
    // Whatever is handed over is dropped: the direction is the command.
    const checked = contract.normalizeArguments(command, { recipe: "next", layer: "A", index: 0 });
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.args, {});
    assert.ok(Object.isFrozen(checked.args));
    assert.equal(contract.normalizeArguments(command).ok, true);
  }
  // Its one failure of its own: nothing planned, or a plan that cannot be promoted.
  assert.equal(contract.failure("no_plan").message, contract.MESSAGES.no_plan);
});

/* ----------------------------------------------------------------------
 *   Layer commands: paste, reset and the bulk resin
 * -------------------------------------------------------------------- */

test("the layer commands are recipe edits over a layer at once: each names its recipe, may address the plan, and is neither runtime nor equipment", () => {
  assert.deepEqual([...contract.LAYER_COMMANDS], ["copyLayer", "clearLayer", "setHopperResins"]);
  assert.ok(Object.isFrozen(contract.LAYER_COMMANDS));
  for (const command of contract.LAYER_COMMANDS) {
    assert.equal(contract.ARGUMENTS[command][0], "recipe");
    assert.ok(!contract.RUNTIME_COMMANDS.includes(command) && !contract.EQUIPMENT_COMMANDS.includes(command) && !contract.JOB_COMMANDS.includes(command) && !contract.PLAN_COMMANDS.includes(command));
  }
  assert.deepEqual([...contract.ARGUMENTS.copyLayer], ["recipe", "layer", "toLayer"]);
  assert.deepEqual([...contract.ARGUMENTS.clearLayer], ["recipe", "layer"]);
  assert.deepEqual([...contract.ARGUMENTS.setHopperResins], ["recipe", "resins"]);

  // copyLayer: the source as every command names its position, the
  // destination as toLayer; the plan is a valid address. The same layer
  // twice passes here - whether that is a no-op is the executor's.
  const paste = contract.normalizeArguments("copyLayer", { recipe: "next", layer: " A ", toLayer: "C", index: 2 });
  assert.equal(paste.ok, true);
  assert.deepEqual(paste.args, { recipe: "next", layer: "A", toLayer: "C" });
  assert.ok(Object.isFrozen(paste.args));
  assert.equal(contract.normalizeArguments("copyLayer", { recipe: "current", layer: "B", toLayer: "B" }).ok, true);
  const noTarget = contract.normalizeArguments("copyLayer", { recipe: "current", layer: "A" });
  assert.equal(noTarget.ok, false);
  assert.equal(noTarget.field, "toLayer");

  // clearLayer: recipe and layer, nothing else.
  const reset = contract.normalizeArguments("clearLayer", { recipe: "current", layer: "B", index: 3 });
  assert.equal(reset.ok, true);
  assert.deepEqual(reset.args, { recipe: "current", layer: "B" });
  assert.equal(contract.normalizeArguments("clearLayer", { recipe: "current" }).field, "layer");
});

test("a resin list follows the weight list's rules: non-empty, capped, no position twice, each entry read by setHopperResin's own normalizers", () => {
  const one = contract.normalizeArguments("setHopperResins", { recipe: "current", resins: [
    { layer: "A", index: "1", resin: "  LLDPE   1001 " },
    { layer: "B", index: 2, resin: "" },
    { layer: "B", index: 3 }
  ] });
  assert.equal(one.ok, true);
  assert.deepEqual(one.args.resins, [
    { layer: "A", index: 1, resin: "LLDPE 1001" },
    { layer: "B", index: 2, resin: "" },
    { layer: "B", index: 3, resin: "" }
  ]);
  assert.ok(Object.isFrozen(one.args.resins) && Object.isFrozen(one.args.resins[0]));

  const empty = contract.normalizeArguments("setHopperResins", { recipe: "current", resins: [] });
  assert.equal(empty.ok, false);
  assert.equal(empty.field, "resins");
  assert.equal(contract.normalizeArguments("setHopperResins", { recipe: "current" }).ok, false);

  const twice = contract.normalizeArguments("setHopperResins", { recipe: "current", resins: [
    { layer: "A", index: 1, resin: "X" }, { layer: "A", index: 1, resin: "Y" }
  ] });
  assert.equal(twice.ok, false);
  assert.match(twice.message, /A:1 is listed twice/);

  const badIndex = contract.normalizeArguments("setHopperResins", { recipe: "current", resins: [{ layer: "A", index: 6, resin: "X" }] });
  assert.equal(badIndex.ok, false);
  assert.equal(badIndex.code, "unknown_hopper");

  const tooLong = contract.normalizeArguments("setHopperResins", { recipe: "current", resins: [{ layer: "A", index: 1, resin: "x".repeat(contract.MAX_RESIN_LENGTH + 1) }] });
  assert.equal(tooLong.ok, false);

  const page = [];
  for (let i = 0; i <= contract.MAX_WEIGHT_ENTRIES; i++) page.push({ layer: `L${i}`, index: 0, resin: "X" });
  const over = contract.normalizeArguments("setHopperResins", { recipe: "next", resins: page });
  assert.equal(over.ok, false);
  assert.match(over.message, /No more than/);
  assert.equal(contract.normalizeArguments("setHopperResins", { recipe: "next", resins: page.slice(1) }).ok, true);
});
