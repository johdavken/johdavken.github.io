"use strict";

/* slate-recipe-draft.js: the bulk edit's arithmetic - the base, the diff
 * against the contract's shape, H1's preview, the layer totals against
 * the application's own rule, the foot's words. Pure. */

const test = require("node:test");
const assert = require("node:assert/strict");

const draft = require("./slate/slate-recipe-draft.js");
const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");
const validation = require("./validation.js");
const contract = require("./station-command-contract.js");

function resolved() {
  return source.resolveSource({ snapshot: demo.snapshot(5000) });
}

function baseNow() {
  const current = resolved();
  return draft.baseFrom(source.stateFor(current, "current"), current.line);
}

test("the base lists every slot of the shown recipe by the rows' keys, resin as stored, blend as a number; the draft starts as that text", () => {
  const base = baseNow();
  assert.deepEqual(Object.keys(base).slice(0, 7), ["A:0", "A:1", "A:2", "A:3", "A:4", "A:5", "B:0"]);
  assert.deepEqual(base["A:1"], { key: "A:1", layer: "A", index: 1, hopper: "A2", resin: "LD105", pct: 30 });
  assert.deepEqual(base["A:3"], { key: "A:3", layer: "A", index: 3, hopper: "A4", resin: "", pct: 0 });
  const text = draft.draftFrom(base);
  assert.deepEqual(text["A:0"], { resin: "HX204", pct: "" }, "H1's blend is derived: its draft carries no text");
  assert.deepEqual(text["A:1"], { resin: "LD105", pct: "30" });
  assert.deepEqual(text["A:3"], { resin: "", pct: "" });
  assert.ok(Object.isFrozen(base["A:1"]));
});

test("the diff names only what differs on each hopper - resin, blend or both - never a blend at index 0, and nothing for an unchanged row", () => {
  const base = baseNow();
  const text = draft.draftFrom(base);
  text["A:0"].resin = "hx204";          // the same code, as the application compares it
  text["A:1"].resin = "LL318";          // resin only
  text["A:2"].pct = "15";               // blend only
  text["B:1"].resin = "SL710";
  text["B:1"].pct = "25";               // both
  text["C:1"].pct = "20.0";             // the same number, written differently
  const changes = draft.changesFor(base, text, source.sameResin);
  assert.deepEqual(changes, [
    { layer: "A", index: 1, resin: "LL318" },
    { layer: "A", index: 2, pct: 15 },
    { layer: "B", index: 1, resin: "SL710", pct: 25 }
  ]);
  for (const entry of changes) assert.ok(Object.isFrozen(entry));
  // H1's resin may change; its blend never rides along.
  text["A:0"].resin = "NEW-1";
  const h1 = draft.changesFor(base, text, source.sameResin).find(entry => entry.index === 0);
  assert.deepEqual(h1, { layer: "A", index: 0, resin: "NEW-1" });
  // The contract accepts the list exactly as shaped.
  const normalized = contract.normalizeArguments("setHopperAssignments", { recipe: "current", hoppers: draft.changesFor(base, text, source.sameResin) });
  assert.ok(!normalized.error, normalized.error && normalized.error.message);
});

test("a blanked resin is a clear: with the blend blanked beside it the entry carries resin '' and pct 0; a blank blend alone is 0; a comma is read", () => {
  const base = baseNow();
  const text = draft.draftFrom(base);
  text["A:1"].resin = "";
  text["A:1"].pct = "";
  text["A:2"].pct = " ";
  text["B:1"].pct = "1,5";
  assert.deepEqual(draft.changesFor(base, text, source.sameResin), [
    { layer: "A", index: 1, resin: "", pct: 0 },
    { layer: "A", index: 2, pct: 0 },
    { layer: "B", index: 1, pct: 15 }
  ]);
  // Whitespace inside a code collapses as the application stores it.
  text["A:3"].resin = "  MB   white ";
  assert.deepEqual(draft.changesFor(base, text, source.sameResin).find(entry => entry.index === 3), { layer: "A", index: 3, resin: "MB white" });
});

test("a blend that is not a number, or out of range, is a problem on that field and is left out of the diff", () => {
  const base = baseNow();
  const text = draft.draftFrom(base);
  text["A:1"].pct = "thirty";
  text["A:2"].pct = "120";
  text["B:1"].pct = "-1";
  assert.deepEqual(draft.problemsFor(base, text), [
    { key: "A:1", message: draft.NOT_A_NUMBER },
    { key: "A:2", message: draft.OUT_OF_RANGE },
    { key: "B:1", message: draft.OUT_OF_RANGE }
  ]);
  const changes = draft.changesFor(base, text, source.sameResin);
  assert.deepEqual(changes, [{ layer: "A", index: 2, pct: 120 }, { layer: "B", index: 1, pct: -1 }], "a non-number was sent");
  assert.equal(draft.pctProblem("12.5"), null);
  assert.equal(draft.pctProblem(""), null);
  assert.equal(draft.pctOf(""), 0);
  assert.ok(Number.isNaN(draft.pctOf("x")));
});

test("H1's preview is 100 less the layer's other blends as typed: null while one is not a number, over when they exceed 100", () => {
  const base = baseNow();
  const text = draft.draftFrom(base);
  assert.deepEqual(draft.derivedH1(base, text, "A"), { value: 60, over: false, total: 40 });
  text["A:3"].pct = "12.5";
  assert.deepEqual(draft.derivedH1(base, text, "A"), { value: 47.5, over: false, total: 52.5 });
  text["A:4"].pct = "60";
  assert.deepEqual(draft.derivedH1(base, text, "A"), { value: null, over: true, total: 112.5 });
  text["A:4"].pct = "abc";
  assert.deepEqual(draft.derivedH1(base, text, "A"), { value: null, over: false, total: null });
  assert.deepEqual(draft.derivedH1(base, text, "C"), { value: 80, over: false, total: 20 });
});

test("the totals ask the application's own rule per layer, and say which layer would be refused", () => {
  const current = resolved();
  const base = baseNow();
  const text = draft.draftFrom(base);
  const fine = draft.totalsFor(base, text, current.line, validation.validateHopperPercentages);
  assert.deepEqual(fine, [{ layer: "A", ok: true, message: "" }, { layer: "B", ok: true, message: "" }, { layer: "C", ok: true, message: "" }]);
  text["B:2"].pct = "85";
  const over = draft.totalsFor(base, text, current.line, validation.validateHopperPercentages);
  assert.equal(over[1].ok, false);
  assert.equal(over[1].message, "Hopper percentages 2–6 cannot total more than 100%.");
  assert.equal(over[0].ok, true);
  // Without the validator the same rule, restated; a throwing one is no validator.
  assert.equal(draft.totalsFor(base, text, current.line, null)[1].message, draft.OVER_TOTAL);
  assert.equal(draft.totalsFor(base, text, current.line, () => { throw new Error("no"); })[1].ok, false);
  text["B:2"].pct = "x";
  assert.equal(draft.totalsFor(base, text, current.line, validation.validateHopperPercentages)[1].message, draft.NOT_A_NUMBER);
});

test("a rebase moves one slot of the base under the draft, so a foreign change that matches what was typed sends nothing", () => {
  const base = baseNow();
  const text = draft.draftFrom(base);
  text["A:1"].resin = "LL318";
  assert.equal(draft.changesFor(base, text, source.sameResin).length, 1);
  const moved = draft.rebase(base, "A:1", { resinName: "LL318", pct: 30 });
  assert.notEqual(moved, base);
  assert.equal(base["A:1"].resin, "LD105", "the old base was written");
  assert.equal(moved["A:1"].resin, "LL318");
  assert.deepEqual(draft.changesFor(moved, text, source.sameResin), []);
  assert.equal(draft.rebase(base, "Z:9", { resinName: "X" }), base, "an unknown key made a new base");
});

test("the foot's words", () => {
  assert.equal(draft.summary([]), "Nothing changes");
  assert.equal(draft.summary([{}]), "1 hopper changes on Apply");
  assert.equal(draft.summary([{}, {}, {}]), "3 hoppers change on Apply");
  assert.equal(draft.applied([{}]), "1 hopper changed.");
  assert.equal(draft.applied([{}, {}]), "2 hoppers changed.");
});

test("a fill writes one resin and/or one blend into the keys given: blank leaves that field alone, H1 takes the resin only, and what already matches is not counted", () => {
  const base = baseNow();
  const text = draft.draftFrom(base);
  assert.equal(draft.fillInto(base, text, ["A:0", "A:1", "A:3"], { resin: " LL318 ", pct: "" }), 3);
  assert.deepEqual([text["A:0"].resin, text["A:1"].resin, text["A:3"].resin], ["LL318", "LL318", "LL318"]);
  assert.equal(text["A:1"].pct, "30", "a resin-only fill moved a blend");
  assert.equal(draft.fillInto(base, text, ["A:0", "A:1", "A:3"], { resin: "", pct: "20" }), 2, "H1 took a blend");
  assert.deepEqual([text["A:0"].pct, text["A:1"].pct, text["A:3"].pct], ["", "20", "20"]);
  assert.equal(draft.fillInto(base, text, ["A:1"], { resin: "LL318", pct: "20" }), 0, "an unchanged fill counted");
  assert.equal(draft.fillInto(base, text, ["A:0"], { pct: "5" }), 0);
  assert.equal(draft.fillInto(base, text, ["Z:9"], { resin: "X" }), 0);
  assert.equal(draft.fillInto(base, text, [], { resin: "X" }), 0);
  assert.equal(draft.fillInto(base, text, ["A:2"], {}), 0);
  assert.deepEqual(draft.changesFor(base, text, source.sameResin), [
    { layer: "A", index: 0, resin: "LL318" },
    { layer: "A", index: 1, resin: "LL318", pct: 20 },
    { layer: "A", index: 3, resin: "LL318", pct: 20 }
  ]);
});
