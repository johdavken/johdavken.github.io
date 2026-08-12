"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const nextRecipe = require("./next-recipe.js");
const payloads = require("./workspace-configuration-payloads.js");
const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

/* A live-recipe state shaped exactly like app.js's, operational fields and
 * all, so the boundary between recipe definition and line state is tested
 * against the real thing rather than a convenient subset. */
function liveState({ lineType = 3, assignments = {} } = {}){
  const names = payloads.expectedLayerNames(lineType);
  return {
    lineType,
    hopperNamingLine9: "standard",
    layers: names.map((name, layerIndex) => {
      const hoppers = Array.from({ length: 6 }, (_, index) => ({
        pct: 0,
        resinName: "",
        // Operational and physical state that must never leak into a plan.
        weight: 1450 + index,
        track: index === 0,
        pumpOff: index === 1,
        usableHeight: 40 + index,
        circumference: 120,
        ...(assignments[`${name}${index + 1}`] || {})
      }));
      // H1 is derived from the rest, exactly as recomputeAutoH1 does, so these
      // fixtures always satisfy the same validation the real recipe does.
      hoppers[0].pct = 100 - hoppers.slice(1).reduce((total, hopper) => total + Number(hopper.pct || 0), 0);
      return { name, layerPct: [20, 50, 30][layerIndex] ?? 0, hoppers };
    })
  };
}

/* ============================================================
 *   The planned recipe is a recipe payload
 * ============================================================ */

test("a plan snapshotted from the live recipe carries no operational or physical state", () => {
  const plan = nextRecipe.fromCurrent(liveState());
  assert.equal(payloads.validateRecipePayload(plan).valid, true);
  const serialized = JSON.stringify(plan);
  for (const leaked of ["weight", "track", "pumpOff", "usableHeight", "circumference"]){
    assert.equal(serialized.includes(leaked), false, `${leaked} must not appear in a planned recipe`);
  }
  // Only the recipe definition survives.
  assert.deepEqual(Object.keys(plan).sort(), ["hopper_naming_mode", "layers", "line_type", "schema_version"]);
  assert.deepEqual(Object.keys(plan.layers[0]).sort(), ["hoppers", "layer_pct", "name"]);
  assert.deepEqual(Object.keys(plan.layers[0].hoppers[0]).sort(), ["pct", "resin_name"]);
});

test("a plan round-trips through the same schema saved recipes use", () => {
  const plan = nextRecipe.fromCurrent(liveState({ assignments: { A2: { resinName: "MS0440", pct: 15 } } }));
  const stored = nextRecipe.normalize(JSON.parse(JSON.stringify(plan)));
  assert.deepEqual(stored, plan);
});

/* ============================================================
 *   Restoring a stored plan
 * ============================================================ */

test("a session with no planned recipe loads as nothing planned", () => {
  for (const absent of [undefined, null, "", 0, false]){
    assert.equal(nextRecipe.normalize(absent), null);
  }
});

test("a malformed or foreign plan is discarded rather than half-restored", () => {
  const valid = nextRecipe.fromCurrent(liveState());
  for (const [label, broken] of [
    ["wrong type", { ...valid, line_type: 4 }],
    ["missing layers", { ...valid, layers: undefined }],
    ["layer count mismatch", { ...valid, layers: valid.layers.slice(0, 2) }],
    ["renamed layer", { ...valid, layers: valid.layers.map((l, i) => (i ? l : { ...l, name: "Z" })) }],
    ["not an object", [valid]],
    ["arbitrary json", { hello: "world" }]
  ]){
    assert.equal(nextRecipe.normalize(broken), null, `${label} should be discarded`);
  }
});

test("a half-built plan survives autosave - completeness is not required to store it", () => {
  // A plan spends most of its life incomplete: layer percentages are still 0
  // while the operator is filling in resins. Storage must not throw that away.
  const partial = nextRecipe.fromCurrent(liveState({ assignments: { A2: { resinName: "MS0440", pct: 15 } } }));
  partial.layers.forEach(layer => { layer.layer_pct = 0; });

  const stored = nextRecipe.normalize(partial);
  assert.ok(stored, "an incomplete plan must still be storable");
  assert.equal(stored.layers[0].hoppers[1].resin_name, "MS0440");
  assert.equal(nextRecipe.isMeaningful(stored), true, "it is still a real plan");
  // But it is not yet complete enough to become the live recipe.
  assert.equal(nextRecipe.isPromotable(stored), false);
});

test("only a complete plan is promotable", () => {
  const complete = nextRecipe.fromCurrent(liveState({ assignments: { A2: { resinName: "MS0440", pct: 15 } } }));
  assert.equal(nextRecipe.isPromotable(complete), true);
  assert.equal(nextRecipe.isPromotable(null), false);
  // Layer percentages that miss 100% are the usual reason a plan is not ready.
  const short = nextRecipe.normalize({ ...complete, layers: complete.layers.map(l => ({ ...l, layer_pct: 10 })) });
  assert.equal(nextRecipe.isPromotable(short), false);
});

test("normalization coerces out-of-range and junk values instead of failing", () => {
  const plan = nextRecipe.fromCurrent(liveState());
  plan.layers[0].hoppers[2].pct = 250;
  plan.layers[0].hoppers[3].pct = "nonsense";
  plan.layers[0].hoppers[4].resin_name = "   MS0440   ";
  const stored = nextRecipe.normalize(plan);
  assert.equal(stored.layers[0].hoppers[2].pct, 100);
  assert.equal(stored.layers[0].hoppers[3].pct, 0);
  assert.equal(stored.layers[0].hoppers[4].resin_name, "MS0440");
});

test("normalize returns a copy, so a stored plan cannot be mutated by reference", () => {
  const plan = nextRecipe.fromCurrent(liveState());
  const restored = nextRecipe.normalize(plan);
  restored.layers[0].layer_pct = 99;
  assert.notEqual(plan.layers[0].layer_pct, 99);
});

/* ============================================================
 *   "A planned recipe exists"
 * ============================================================ */

test("an untouched recipe structure does not count as a planned recipe", () => {
  // Every layer and all six hoppers are present, and H1 already sits at its
  // calculated 100% - structure alone must not light up the Next indicator.
  assert.equal(nextRecipe.isMeaningful(nextRecipe.fromCurrent(liveState())), false);
  assert.equal(nextRecipe.isMeaningful(null), false);
  assert.equal(nextRecipe.isMeaningful({ nonsense: true }), false);
});

test("a resin assignment anywhere counts as a planned recipe", () => {
  const plan = nextRecipe.fromCurrent(liveState({ assignments: { C3: { resinName: "A0700" } } }));
  assert.equal(nextRecipe.isMeaningful(plan), true);
});

test("a percentage on any hopper but H1 counts, and H1 alone never does", () => {
  const beyondH1 = nextRecipe.fromCurrent(liveState({ assignments: { B4: { pct: 12 } } }));
  assert.equal(nextRecipe.isMeaningful(beyondH1), true);
  // H1 is derived, so it is non-zero in a blank recipe and can never be the
  // signal that something was planned.
  const h1Only = nextRecipe.fromCurrent(liveState());
  assert.equal(h1Only.layers[0].hoppers[0].pct, 100);
  assert.equal(nextRecipe.isMeaningful(h1Only), false);
});

test("whitespace is not an assignment", () => {
  const plan = nextRecipe.fromCurrent(liveState({ assignments: { A2: { resinName: "   " } } }));
  assert.equal(nextRecipe.isMeaningful(plan), false);
});

/* ============================================================
 *   Change summary for the confirmation
 * ============================================================ */

test("the summary reports layer, resin and percentage changes", () => {
  const current = nextRecipe.fromCurrent(liveState({ assignments: { A2: { resinName: "MS0440", pct: 15 } } }));
  const planned = nextRecipe.fromCurrent(liveState({ assignments: { A2: { resinName: "MS0700B", pct: 20 } } }));
  // Layer percentages must still total 100, or the plan is not a valid recipe.
  planned.layers[0].layer_pct = 25;
  planned.layers[2].layer_pct = 25;

  const summary = nextRecipe.summarizeChange(current, planned);
  assert.deepEqual(summary.layerChanges, [
    { name: "A", from: 20, to: 25 },
    { name: "C", from: 30, to: 25 }
  ]);
  assert.equal(summary.resinChanges, 1);
  assert.ok(summary.percentageChanges >= 1);
  assert.equal(summary.unchanged, false);
  assert.equal(summary.lineTypeChanged, false);
});

test("an identical plan summarizes as no change", () => {
  const same = nextRecipe.fromCurrent(liveState({ assignments: { A2: { resinName: "MS0440", pct: 15 } } }));
  const summary = nextRecipe.summarizeChange(same, JSON.parse(JSON.stringify(same)));
  assert.equal(summary.unchanged, true);
  assert.equal(summary.resinChanges, 0);
  assert.equal(summary.percentageChanges, 0);
  assert.deepEqual(summary.layerChanges, []);
});

test("a plan for a different layer count is flagged", () => {
  const current = nextRecipe.fromCurrent(liveState({ lineType: 3 }));
  const planned = nextRecipe.fromCurrent(liveState({ lineType: 5 }));
  assert.equal(nextRecipe.summarizeChange(current, planned).lineTypeChanged, true);
});

test("summarizing against no plan yields nothing to confirm", () => {
  assert.equal(nextRecipe.summarizeChange(nextRecipe.fromCurrent(liveState()), null), null);
});

/* ============================================================
 *   Promotion uses the existing saved-recipe semantics
 * ============================================================ */

test("promoting a plan preserves weights, tracking, pump-off and hopper dimensions", () => {
  // Promotion is applyRecipePayload - the same call Saved Recipes makes - so
  // the documented behaviour is inherited rather than reimplemented.
  const state = liveState({ assignments: { A2: { resinName: "OLD", pct: 15 } } });
  const before = JSON.parse(JSON.stringify(state.layers));
  const plan = nextRecipe.fromCurrent(liveState({ assignments: { A2: { resinName: "PLANNED", pct: 22 } } }));

  const result = payloads.applyRecipePayload(state, plan);
  assert.equal(result.ok, true, result.errors?.join("; "));

  state.layers.forEach((layer, layerIndex)=>{
    layer.hoppers.forEach((hopper, index)=>{
      const original = before[layerIndex].hoppers[index];
      assert.equal(hopper.weight, original.weight, "receiver weight must survive promotion");
      assert.equal(hopper.track, original.track, "tracking must survive promotion");
      assert.equal(hopper.pumpOff, original.pumpOff, "pump-off must survive promotion");
      assert.equal(hopper.usableHeight, original.usableHeight, "Smart Hopper height must survive");
      assert.equal(hopper.circumference, original.circumference, "Smart Hopper circumference must survive");
    });
  });
  // And the recipe definition is what actually changed.
  assert.equal(state.layers[0].hoppers[1].resinName, "PLANNED");
  assert.equal(state.layers[0].hoppers[1].pct, 22);
  // H1 is recalculated, not copied.
  assert.equal(state.layers[0].hoppers[0].pct, 78);
});

test("promoting does not consume the plan - the payload is untouched", () => {
  const state = liveState();
  const plan = nextRecipe.fromCurrent(liveState({ assignments: { A2: { resinName: "PLANNED", pct: 10 } } }));
  const copy = JSON.parse(JSON.stringify(plan));
  payloads.applyRecipePayload(state, plan);
  assert.deepEqual(plan, copy, "Load Next must leave the planned recipe intact");
});

/* ============================================================
 *   Persistence wiring
 * ============================================================ */

test("the planned recipe is persisted and restored with the session", () => {
  assert.match(app, /nextRecipe: null,/, "state should start with nothing planned");
  assert.match(app, /nextRecipe: state\.nextRecipe,/, "snapshotPayload must persist the plan");
  assert.match(app, /state\.nextRecipe = window\.PolynNextRecipe\?\.normalize\(payload\.nextRecipe\) \?\? null;/);
});

test("the plan travels with the shared job, and the no-op guard covers it", () => {
  const activeJob = require("./active-job.js");
  // Listed as a synchronized field, so canonicalActiveJob - and therefore the
  // existing no-op guard - compares it like any other.
  assert.ok(activeJob.ACTIVE_JOB_FIELDS.includes("nextRecipe"));
  assert.ok(activeJob.ACTIVE_JOB_FIELDS.includes("layers"));

  const base = { lineRate: 100, lineType: 3, gauge: 0, changeoverTime: "", offsets: {}, layers: [], prodResinLb: 0, scrapResinLb: 0, hopperNamingLine9: "standard", hopperCircumference: 0 };
  const withoutPlan = activeJob.snapshotActiveJob({ ...base, nextRecipe: null }, "0.17");
  const plan = nextRecipe.fromCurrent(liveState({ assignments: { A2: { resinName: "MS0440", pct: 15 } } }));
  const withPlan = activeJob.snapshotActiveJob({ ...base, nextRecipe: plan }, "0.17");

  // Re-saving the same plan is a no-op: no write is queued.
  assert.equal(activeJob.activeJobsEqual(withPlan, activeJob.snapshotActiveJob({ ...base, nextRecipe: JSON.parse(JSON.stringify(plan)) }, "0.17")), true);
  // Changing the plan is a real change: exactly one write.
  assert.equal(activeJob.activeJobsEqual(withPlan, withoutPlan), false);
});

test("an absent plan synchronizes as null rather than a missing field", () => {
  const activeJob = require("./active-job.js");
  const snapshot = activeJob.snapshotActiveJob({ layers: [], nextRecipe: undefined }, "0.17");
  assert.equal(snapshot.nextRecipe, null, "an absent plan must be an explicit null, or clearing it would never sync");
});

test("sharing the plan stays additive - no active-job version bump", () => {
  // Bumping the version would make clients running older code reject the whole
  // payload. An optional field they ignore is strictly safer.
  const validation = fs.readFileSync("validation.js", "utf8");
  assert.match(validation, /SUPPORTED_ACTIVE_JOB_VERSIONS = Object\.freeze\(\["0\.17"\]\)/);
  const activeJobSource = fs.readFileSync("active-job.js", "utf8");
  assert.match(activeJobSource, /Deliberately left at active-job version 0\.17/);
});

test("a plan arriving from another device is not overwritten by this one's working copy", () => {
  assert.match(app, /state\.nextRecipe = window\.PolynNextRecipe\?\.normalize\(payload\.nextRecipe\) \?\? null;[\s\S]{0,320}?nextRecipeWorking = null;/);
});

test("the module loads before app.js so restore can normalize the stored plan", () => {
  const moduleAt = html.indexOf('src="next-recipe.js');
  const appAt = html.indexOf('src="app.js');
  assert.ok(moduleAt > -1 && moduleAt < appAt, "next-recipe.js must be loaded before app.js");
  assert.ok(html.indexOf('src="workspace-configuration-payloads.js') < moduleAt, "its payload dependency must load first");
});

test("a plan arriving from another device announces itself", () => {
  // The marker is otherwise only refreshed on local commit or a page switch,
  // so a receiving device would show no sign a plan had appeared.
  assert.match(app, /nextRecipeWorking = null;[\s\S]{0,320}?syncPlannedRecipeIndicator\(\);/);
});
