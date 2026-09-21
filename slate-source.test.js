"use strict";

/* slate-source.js: which state Slate shows, and what kind of change a
 * publish is. */

const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");

function live(overrides) {
  const snap = demo.snapshot(5000);
  snap.revision = 7;
  snap.line.linked = true;
  return Object.assign(snap, overrides || {});
}

test("a connected snapshot is live; none falls back to the demo, which is never live", () => {
  const resolved = source.resolveSource({ snapshot: live(), demo });
  assert.equal(resolved.kind, "live");
  assert.equal(resolved.live, true);
  assert.equal(resolved.revision, 7);
  assert.equal(resolved.label, "Live");
  assert.ok(resolved.line && resolved.line.layers.length === 3);

  const fallback = source.resolveSource({ snapshot: null, demo, now: 5000 });
  assert.equal(fallback.kind, "demo");
  assert.equal(fallback.live, false);
  assert.equal(fallback.revision, null);
  assert.equal(fallback.label, "Demo");
  assert.match(fallback.detail, /No application/);
  // A demo pinned over a live line is not a thing: the snapshot wins.
  assert.equal(source.resolveSource({ snapshot: live(), demo }).live, true);
});

test("runtime state is keyed by slot and reduced to what the rows and run-down read", () => {
  const resolved = source.resolveSource({ snapshot: live() });
  assert.deepEqual(resolved.hopperState["A:0"], { track: true, pumpOff: false, resinName: "HX204", pct: 60, effectiveWeight: 400 });
  assert.deepEqual(resolved.hopperState["B:1"], { track: true, pumpOff: true, resinName: "HD622", pct: 20, effectiveWeight: 260 });
  assert.deepEqual(resolved.hopperState["C:5"], { track: false, pumpOff: false, resinName: "", pct: 0, effectiveWeight: 0 });
  assert.deepEqual(resolved.layerState, { A: { layerPct: 25 }, B: { layerPct: 50 }, C: { layerPct: 25 } });
  assert.equal(resolved.job.lineRate, 850);
  assert.equal(resolved.job.changeoverSetAt, 5000);
  assert.equal(resolved.job.prodResinLb, 12400);
});

test("the job reads a missing or negative rate as zero and carries pounds as stored", () => {
  assert.equal(source.jobStateFrom({ job: { lineRate: -5 } }).lineRate, 0);
  assert.equal(source.jobStateFrom({ job: { lineRate: "abc" } }).lineRate, 0);
  assert.equal(source.jobStateFrom(null).changeoverTime, "");
  assert.equal(source.jobStateFrom({ job: { prodResinLb: "1,200" } }).prodResinLb, "1,200");
  assert.equal(source.jobStateFrom({ job: {} }).prodResinLb, "");
});

test("classifyChange: values move in place, structure rebuilds, nothing is nothing", () => {
  const before = source.resolveSource({ snapshot: live() });
  assert.equal(source.classifyChange(null, before), "structural");
  assert.equal(source.classifyChange(before, null), "structural");

  const same = source.resolveSource({ snapshot: live() });
  assert.equal(source.classifyChange(before, same), "none");

  const tracked = live();
  tracked.layers[0].hoppers[2].track = true;
  assert.equal(source.classifyChange(before, source.resolveSource({ snapshot: tracked })), "values");

  const rate = live();
  rate.job.lineRate = 900;
  assert.equal(source.classifyChange(before, source.resolveSource({ snapshot: rate })), "values");

  const share = live();
  share.layers[1].layerPct = 40;
  assert.equal(source.classifyChange(before, source.resolveSource({ snapshot: share })), "values");

  const counts = live();
  counts.line.hopperCounts = [6, 6, 6];
  assert.equal(source.classifyChange(before, source.resolveSource({ snapshot: counts })), "structural");

  const flipped = live();
  flipped.line.layerAPosition = "outside";
  assert.equal(source.classifyChange(before, source.resolveSource({ snapshot: flipped })), "structural");

  const renamed = live();
  renamed.line.displayName = "Line 6";
  assert.equal(source.classifyChange(before, source.resolveSource({ snapshot: renamed })), "structural");

  // Live to demo (the producer went away) is structural: the source changed.
  assert.equal(source.classifyChange(before, source.resolveSource({ snapshot: null, demo })), "structural");
  // A publish that only moved the revision changes nothing Slate reads.
  const bumped = live({ revision: 8 });
  assert.equal(source.classifyChange(before, source.resolveSource({ snapshot: bumped })), "none");
});

/* ----------------------------------------------------------------------
 *   The planned recipe, history and compare
 * -------------------------------------------------------------------- */

function withPlan(mutate) {
  const snap = live();
  snap.nextRecipe = {
    layers: snap.layers.map(layer => ({
      name: layer.name,
      layerPct: layer.layerPct,
      hoppers: layer.hoppers.map(hopper => ({ index: hopper.index, pct: hopper.pct, resinName: hopper.resinName }))
    }))
  };
  snap.history = { current: { canUndo: true, canRedo: false }, next: { canUndo: false, canRedo: true } };
  if (mutate) mutate(snap);
  return snap;
}

test("the plan is keyed like Current and carries no runtime keys; no plan is no plan", () => {
  const none = source.resolveSource({ snapshot: live() });
  assert.deepEqual(none.nextHopperState, {});
  assert.deepEqual(none.nextLayerState, {});
  assert.deepEqual(none.plan, { planned: false });
  assert.deepEqual(none.history, { current: { canUndo: false, canRedo: false }, next: { canUndo: false, canRedo: false } });

  const planned = source.resolveSource({ snapshot: withPlan() });
  assert.deepEqual(planned.plan, { planned: true });
  assert.deepEqual(planned.nextHopperState["A:0"], { resinName: "HX204", pct: 60 });
  assert.deepEqual(Object.keys(planned.nextHopperState["A:0"]).sort(), ["pct", "resinName"], "a plan slot carries runtime keys");
  assert.deepEqual(planned.nextLayerState.B, { layerPct: 50 });
  assert.deepEqual(planned.history, { current: { canUndo: true, canRedo: false }, next: { canUndo: false, canRedo: true } });
  assert.deepEqual(source.planFrom({ nextRecipe: { layers: [] } }), { planned: false });
  assert.deepEqual(source.stateFor(planned, "next").hoppers, planned.nextHopperState);
  assert.deepEqual(source.stateFor(planned, "current").layers, planned.layerState);
});

test("compareFor: nothing to compare without a plan; with one, each slot names the other recipe and whether it differs", () => {
  assert.equal(source.compareFor(source.resolveSource({ snapshot: live() }), "current"), null);
  const same = source.compareFor(source.resolveSource({ snapshot: withPlan() }), "current");
  assert.deepEqual(same.hoppers["A:0"], { resin: "HX204", pct: 60, differs: false });
  assert.deepEqual(same.layers.A, { share: 25, differs: false });
  assert.ok(Object.values(same.hoppers).every(one => !one.differs));

  const changed = source.resolveSource({ snapshot: withPlan(snap => {
    snap.nextRecipe.layers[0].hoppers[0].resinName = " hx204 ";  // the same resin, spelt differently
    snap.nextRecipe.layers[0].hoppers[1].resinName = "LL318";     // a different resin
    snap.nextRecipe.layers[0].hoppers[2].pct = 15;                // a different blend
    snap.nextRecipe.layers[1].layerPct = 40;                      // a different share
  }) });
  const fromCurrent = source.compareFor(changed, "current");
  assert.equal(fromCurrent.hoppers["A:0"].differs, false, "case and whitespace made a resin differ");
  assert.deepEqual(fromCurrent.hoppers["A:1"], { resin: "LL318", pct: 30, differs: true });
  assert.deepEqual(fromCurrent.hoppers["A:2"], { resin: "AB120", pct: 15, differs: true });
  assert.deepEqual(fromCurrent.layers.B, { share: 40, differs: true });
  // From the Next tab the "other" is Current.
  const fromNext = source.compareFor(changed, "next");
  assert.deepEqual(fromNext.hoppers["A:1"], { resin: "LD105", pct: 30, differs: true });
  assert.deepEqual(fromNext.layers.B, { share: 50, differs: true });
  assert.equal(source.sameResin("a b", "A  B "), true);
});

test("a Next-only edit, a history flip and a plan appearing are all changes Slate redraws for", () => {
  const before = source.resolveSource({ snapshot: withPlan() });
  const nextEdit = source.resolveSource({ snapshot: withPlan(snap => { snap.nextRecipe.layers[0].hoppers[0].resinName = "ZZ1"; }) });
  assert.equal(source.classifyChange(before, nextEdit), "values");
  const history = source.resolveSource({ snapshot: withPlan(snap => { snap.history.next.canUndo = true; }) });
  assert.equal(source.classifyChange(before, history), "values");
  const unplanned = source.resolveSource({ snapshot: live() });
  assert.equal(source.classifyChange(unplanned, before), "structural", "a plan appearing did not rebuild");
  assert.equal(source.classifyChange(before, unplanned), "structural");
});
