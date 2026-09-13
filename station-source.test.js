"use strict";

/* Which state Station shows, and - more importantly - which state it refuses
 * to substitute for another. The dangerous mistake this module exists to
 * prevent is demo hoppers appearing under a live label on a production floor.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const source = require("./station/station-source.js");
const demoLines = require("./station/station-demo-lines.js");
const lineModel = require("./station/station-line-model.js");
const bridgeModule = require("./station-state-bridge.js");

function snapshotFor(state, options) {
  const projected = bridgeModule.project(state, options || {});
  return Object.assign({ revision: 7 }, projected);
}

function liveState(overrides) {
  return Object.assign({
    lineType: 5,
    lineRate: 900,
    gauge: 2,
    changeoverTime: "",
    layers: ["A", "B", "C", "D", "E"].map(name => ({
      name,
      layerPct: 20,
      hoppers: Array.from({ length: 6 }, (_, index) => ({
        pct: index === 0 ? 100 : 0,
        weight: 400,
        resinName: index === 0 ? "RESIN-X" : "",
        track: index === 0,
        pumpOff: false
      }))
    }))
  }, overrides);
}

const LIVE_CONFIG = {
  lineNumber: 11, displayName: "Line 11", layerAPosition: "outside",
  hopperNamingMode: "standard", hopperGeometry: "cylindrical"
};

/* ----------------------------------------------------------------------
 *   Choosing a source
 * -------------------------------------------------------------------- */

test("with no snapshot, Station falls back to the selected demo configuration", () => {
  const resolved = source.resolveSource({ snapshot: null, demoLines, demoId: "three-layer" });
  assert.equal(resolved.kind, "demo");
  assert.equal(resolved.live, false);
  assert.equal(resolved.modelInput, 5);   // the demo entry's real line number
  assert.match(resolved.detail, /No application is connected/);
});

test("with a snapshot, Station reads the application", () => {
  const resolved = source.resolveSource({
    snapshot: snapshotFor(liveState(), { lineConfiguration: LIVE_CONFIG }),
    demoLines,
    demoId: "three-layer"
  });
  assert.equal(resolved.kind, "live");
  assert.equal(resolved.live, true);
  assert.equal(resolved.label, "Live");
  assert.equal(resolved.revision, 7);
});

test("demo mode pins demo data even while the application is connected", () => {
  const resolved = source.resolveSource({
    snapshot: snapshotFor(liveState(), { lineConfiguration: LIVE_CONFIG }),
    demoLines,
    demoId: "one-layer",
    mode: source.MODE_DEMO
  });
  assert.equal(resolved.kind, "demo");
  assert.equal(resolved.label, "Demo (pinned)");
  assert.match(resolved.detail, /pinned/);
});

test("a live but unlinked session says so instead of claiming a line", () => {
  const resolved = source.resolveSource({
    snapshot: snapshotFor(liveState(), { lineConfiguration: null }),
    demoLines,
    demoId: "one-layer"
  });
  assert.equal(resolved.kind, "live");
  assert.equal(resolved.label, "Live (no line linked)");
  assert.equal(resolved.modelInput.displayName, "Unlinked line");
});

test("a connected line that cannot be described never falls back to demo data", () => {
  // This is the rule that matters. An empty or undescribable live state must
  // produce an empty machine under a live label, not plausible demo hoppers.
  const resolved = source.resolveSource({
    snapshot: snapshotFor({ lineType: null, layers: [] }, {}),
    demoLines,
    demoId: "five-layer"
  });
  assert.equal(resolved.kind, "live");
  assert.equal(resolved.modelInput, null);
  assert.equal(lineModel.buildLineModel(resolved.modelInput), null,
    "an undescribable live line must render as the empty state");
});

test("demo data carries a recipe fixture but no running-job state", () => {
  /* The fixture exists so the equipment can be developed and reviewed with
   * something in it, and it is built into the bridge's own snapshot shape and
   * read by the same two functions - so demo mode exercises the live code path
   * rather than a parallel one.
   *
   * What it must NOT carry is job state. A demo line is not running: nothing
   * is tracking, nothing is pumping off, and there is no revision. */
  const resolved = source.resolveSource({ snapshot: null, demoLines, demoId: "five-layer" });
  assert.equal(resolved.revision, null);

  const entries = Object.values(resolved.hopperState);
  assert.ok(entries.length > 0, "the demo fixture produced no hoppers");
  assert.ok(entries.some(entry => entry.resinName), "the demo fixture assigned no resin");
  assert.ok(entries.some(entry => entry.pct > 0), "the demo fixture assigned no blend");
  for (const entry of entries) {
    assert.equal(entry.track, false, "demo data claims a hopper is tracking");
  }

  /* Sources on some hoppers and not others, so both presentations - a label,
   * and a hopper left quiet - are reviewable. Carried in hookup-sources' own
   * {resin, source} shape and resolved by its own helper, not read raw. */
  assert.ok(entries.some(entry => entry.source), "the demo fixture shows no source example");
  assert.ok(entries.some(entry => !entry.source), "the demo fixture shows no absent-source example");

  /* Pump state is the exception, and deliberately so: the receiver is the pump
   * indicator, and a fixture where every pump is on would leave half of that
   * component undrawable in the harness. It illustrates equipment state, not a
   * running job - unlike tracking, which is timeline state and stays false. */
  assert.ok(entries.some(entry => entry.pumpOff), "the demo fixture shows no pump-off example");
  assert.ok(entries.some(entry => !entry.pumpOff), "the demo fixture shows no pump-on example");

  /* Profile heights too, so the height-to-scale drawing has something to draw.
   * Physical equipment description, the same category as pump state. */
  assert.ok(entries.every(entry => entry.usableHeight > 0), "the demo fixture has no profile heights");
  assert.ok(new Set(entries.map(entry => entry.usableHeight)).size > 1,
    "every demo hopper is the same height - the scaling would look like it does nothing");

  // Layer shares come through the same way.
  assert.deepEqual(Object.keys(resolved.layerState).sort(), ["A", "B", "C", "D", "E"]);
  assert.equal(Object.values(resolved.layerState).reduce((sum, l) => sum + l.layerPct, 0), 100);
});

test("a live snapshot still wins over the demo fixture", () => {
  const resolved = source.resolveSource({
    snapshot: snapshotFor(liveState(), { lineConfiguration: LIVE_CONFIG }),
    demoLines, demoId: "five-layer"
  });
  assert.equal(resolved.kind, "live");
  assert.equal(resolved.hopperState["A:0"].resinName, "RESIN-X");
});

test("the demo fixture matches the configuration it belongs to, including mixed hopper counts", () => {
  const resolved = source.resolveSource({ snapshot: null, demoLines, demoId: "mixed-hoppers" });
  const perLayer = { A: 0, B: 0, C: 0 };
  for (const key of Object.keys(resolved.hopperState)) perLayer[key.split(":")[0]] += 1;
  assert.deepEqual(perLayer, { A: 4, B: 6, C: 3 });
});

/* ----------------------------------------------------------------------
 *   Live state shapes the machine
 * -------------------------------------------------------------------- */

test("the live layer count drives the rendered layer count", () => {
  for (const layerCount of [1, 3, 5]) {
    const names = ["A", "B", "C", "D", "E"].slice(0, layerCount);
    const state = liveState({
      lineType: layerCount,
      layers: names.map(name => ({ name, layerPct: 0, hoppers: [{ pct: 0, weight: 0, resinName: "", track: false, pumpOff: false }] }))
    });
    const resolved = source.resolveSource({
      snapshot: snapshotFor(state, { lineConfiguration: LIVE_CONFIG }),
      demoLines, demoId: "one-layer"
    });
    const model = lineModel.buildLineModel(resolved.modelInput);
    assert.equal(model.layers.length, layerCount);
  }
});

test("live per-layer hopper counts drive the rendered banks", () => {
  const state = liveState({
    lineType: 3,
    layers: [
      { name: "A", layerPct: 34, hoppers: Array.from({ length: 4 }, () => ({ pct: 0, weight: 0, resinName: "", track: false, pumpOff: false })) },
      { name: "B", layerPct: 33, hoppers: Array.from({ length: 6 }, () => ({ pct: 0, weight: 0, resinName: "", track: false, pumpOff: false })) },
      { name: "C", layerPct: 33, hoppers: Array.from({ length: 2 }, () => ({ pct: 0, weight: 0, resinName: "", track: false, pumpOff: false })) }
    ]
  });
  const resolved = source.resolveSource({
    snapshot: snapshotFor(state, { lineConfiguration: LIVE_CONFIG }),
    demoLines, demoId: "one-layer"
  });
  const model = lineModel.buildLineModel(resolved.modelInput);
  assert.deepEqual(model.layers.map(layer => layer.hopperCount), [4, 6, 2]);
});

test("the live line's orientation reverses the physical stack - as roles on each layer, never as the order the layers are listed in", () => {
  const resolved = source.resolveSource({
    snapshot: snapshotFor(liveState({ lineType: 3, layers: ["A", "B", "C"].map(name => ({ name, layerPct: 33, hoppers: [] })) }),
      { lineConfiguration: Object.assign({}, LIVE_CONFIG, { layerAPosition: "inside" }) }),
    demoLines, demoId: "one-layer"
  });
  const model = lineModel.buildLineModel(resolved.modelInput);
  assert.deepEqual(model.layers.map(layer => layer.id), ["A", "B", "C"], "listed in the recipe's order");
  assert.deepEqual(model.layers.map(layer => layer.role), ["inside", "core", "outside"], "A is the inside");
  assert.deepEqual(model.layers.map(layer => layer.stackIndex), [2, 1, 0]);
});

/* ----------------------------------------------------------------------
 *   Runtime state, keyed by physical slot
 * -------------------------------------------------------------------- */

test("hopper runtime state is keyed by slot, not by label", () => {
  // A naming mode change renames A1 to AM. It does not move the hopper, so
  // the key must not move either.
  const state = liveState({ lineType: 1, layers: [{ name: "A", layerPct: 100, hoppers: [
    { pct: 100, weight: 1, resinName: "R", track: true, pumpOff: false },
    { pct: 0, weight: 0, resinName: "", track: false, pumpOff: true }
  ] }] });

  for (const namingMode of ["standard", "main-plus-five"]) {
    const resolved = source.resolveSource({
      snapshot: snapshotFor(state, { lineConfiguration: Object.assign({}, LIVE_CONFIG, { hopperNamingMode: namingMode, layerAPosition: null }) }),
      demoLines, demoId: "one-layer"
    });
    assert.deepEqual(Object.keys(resolved.hopperState).sort(), ["A:0", "A:1"]);
    assert.equal(resolved.hopperState["A:0"].track, true);
    assert.equal(resolved.hopperState["A:1"].pumpOff, true);
  }
});

test("an unassigned hopper is reported as unassigned", () => {
  const resolved = source.resolveSource({
    snapshot: snapshotFor(liveState(), { lineConfiguration: LIVE_CONFIG }),
    demoLines, demoId: "one-layer"
  });
  assert.equal(resolved.hopperState["A:0"].assigned, true);
  assert.equal(resolved.hopperState["A:1"].assigned, false);
});

test("hopperStateFrom tolerates a malformed snapshot rather than throwing", () => {
  assert.deepEqual(source.hopperStateFrom(null), {});
  assert.deepEqual(source.hopperStateFrom({}), {});
  assert.deepEqual(source.hopperStateFrom({ layers: [{ name: "A" }] }), {});
});

/* ----------------------------------------------------------------------
 *   End to end: bridge -> source -> model
 * -------------------------------------------------------------------- */

test("a publish propagates all the way to a changed machine", () => {
  const state = liveState({ lineType: 3, layers: ["A", "B", "C"].map(name => ({
    name, layerPct: 33,
    hoppers: Array.from({ length: 6 }, () => ({ pct: 0, weight: 0, resinName: "", track: false, pumpOff: false }))
  })) });

  const bridge = bridgeModule.create({ scheduler: run => run() });
  const handle = bridge.connect({ read: () => bridge.project(state, { lineConfiguration: LIVE_CONFIG }) });

  const rendered = [];
  bridge.subscribe(snapshot => {
    const resolved = source.resolveSource({ snapshot, demoLines, demoId: "one-layer" });
    const model = lineModel.buildLineModel(resolved.modelInput);
    rendered.push({
      layers: model ? model.layers.length : 0,
      tracking: Object.values(resolved.hopperState).filter(hopper => hopper.track).length
    });
  });

  handle.publish();
  assert.deepEqual(rendered.at(-1), { layers: 3, tracking: 0 });

  // The operator starts tracking a hopper and adds two layers.
  state.layers[0].hoppers[0].track = true;
  state.lineType = 5;
  state.layers.push(
    { name: "D", layerPct: 0, hoppers: Array.from({ length: 6 }, () => ({ pct: 0, weight: 0, resinName: "", track: false, pumpOff: false })) },
    { name: "E", layerPct: 0, hoppers: Array.from({ length: 6 }, () => ({ pct: 0, weight: 0, resinName: "", track: false, pumpOff: false })) }
  );
  handle.publish();
  assert.deepEqual(rendered.at(-1), { layers: 5, tracking: 1 });

  // Losing the producer returns Station to demo data, not to a stale machine.
  handle.disconnect();
  const afterDisconnect = source.resolveSource({ snapshot: bridge.getSnapshot(), demoLines, demoId: "three-layer" });
  assert.equal(afterDisconnect.kind, "demo");
});

/* ----------------------------------------------------------------------
 *   Classifying a publish
 * -------------------------------------------------------------------- */

/* Every publish used to redraw the stage, which rebuilt the focused editor
 * and lost an open search. The boot file now asks what kind of change a
 * new resolution is, and only a structural one goes down the render path. */

function resolvedFor(state, options) {
  return source.resolveSource({
    snapshot: snapshotFor(state, Object.assign({ lineConfiguration: LIVE_CONFIG }, options || {})),
    demoLines, demoId: "three-layer"
  });
}

function edited(mutate) {
  const state = liveState();
  mutate(state);
  return state;
}

test("a publish that changes no value the drawing or the timeline reads is 'none'", () => {
  const a = resolvedFor(liveState());
  const b = resolvedFor(liveState({ gauge: 3 }));
  assert.equal(source.classifyChange(a, b), "none");
  assert.equal(source.classifyChange(a, resolvedFor(liveState())), "none");
});

test("the job's output and changeover are values - the run-down timeline projects from them", () => {
  const a = resolvedFor(liveState());
  assert.equal(source.classifyChange(a, resolvedFor(liveState({ lineRate: 999 }))), "values");
  assert.equal(source.classifyChange(a, resolvedFor(liveState({ changeoverTime: "03:28", changeoverSetAt: 1 }))), "values");
  assert.deepEqual(a.job, { lineRate: 900, changeoverTime: "", changeoverSetAt: null, prodResinLb: 0, scrapResinLb: 0, lots: {} });
  const b = resolvedFor(liveState({ lineRate: 850, changeoverTime: "03:28", changeoverSetAt: 1700000000000 }));
  assert.deepEqual(b.job, { lineRate: 850, changeoverTime: "03:28", changeoverSetAt: 1700000000000, prodResinLb: 0, scrapResinLb: 0, lots: {} });
});

test("the job's production, scrap and scanned lots are values - the Handbook's Resin Totals reads them", () => {
  const a = resolvedFor(liveState());
  assert.equal(source.classifyChange(a, resolvedFor(liveState({ prodResinLb: 999 }))), "values");
  assert.equal(source.classifyChange(a, resolvedFor(liveState({ scrapResinLb: 12 }))), "values");
  assert.equal(source.classifyChange(a, resolvedFor(liveState({ resinLots: { "RESIN-X": "LOT-1" } }))), "values");
  const b = resolvedFor(liveState({ prodResinLb: 10926, scrapResinLb: "1,200", resinLots: { "RESIN-X": "LOT-1" } }));
  assert.equal(b.job.prodResinLb, 10926);
  assert.equal(b.job.scrapResinLb, "1,200", "carried as the bridge carries it; resin-totals.js reads it");
  assert.deepEqual(b.job.lots, { "RESIN-X": "LOT-1" });
});

test("the resolved source carries the recipe as Resin Totals reads it, in recipe order, recipe fields only", () => {
  const live = resolvedFor(liveState());
  assert.equal(live.recipe.layers.length, 5);
  assert.deepEqual(live.recipe.layers[0].hoppers[0], { pct: 100, resinName: "RESIN-X" });
  assert.deepEqual(Object.keys(live.recipe.layers[0]).sort(), ["hoppers", "layerPct", "name"]);
  assert.equal(live.recipe.layers[0].layerPct, 20);
  const demo = source.resolveSource({ snapshot: null, demoLines, demoId: "three-layer" });
  assert.ok(Array.isArray(demo.recipe.layers) && demo.recipe.layers.length > 0, "a demo line has a recipe to total (and no pounds)");
  assert.equal(demo.job.prodResinLb, 0);
  assert.deepEqual(source.recipeFrom(null), { layers: [] });
});

test("a value change - resin, blend, tracking, pump, source, share - is 'values'", () => {
  const base = resolvedFor(liveState());
  const cases = {
    resin: edited(s => { s.layers[0].hoppers[1].resinName = "REMOTE"; }),
    blend: edited(s => { s.layers[0].hoppers[0].pct = 90; }),
    tracking: edited(s => { s.layers[1].hoppers[0].track = false; }),
    pump: edited(s => { s.layers[2].hoppers[0].pumpOff = true; }),
    source: edited(s => { s.hookupSources = { current: { "A:0": { resin: "RESIN-X", source: "SILO 9" } }, next: {} }; }),
    share: edited(s => { s.layers[0].layerPct = 50; }),
    weight: edited(s => { s.layers[0].hoppers[0].weight = 12; })
  };
  for (const [name, state] of Object.entries(cases)) {
    const kind = source.classifyChange(base, resolvedFor(state));
    // A weight is not read by the drawing, but the run-down timeline
    // projects from it, so it too is a value.
    assert.equal(kind, "values", `${name} classified as ${kind}`);
  }
});

test("a structural change - layers, hopper counts, naming, profile height, or the source itself - is 'structural'", () => {
  const base = resolvedFor(liveState());
  assert.equal(source.classifyChange(base, resolvedFor(liveState({ lineType: 3, layers: liveState().layers.slice(0, 3) }))), "structural");
  assert.equal(source.classifyChange(base, resolvedFor(edited(s => { s.layers[0].hoppers.pop(); }))), "structural");
  assert.equal(source.classifyChange(base, resolvedFor(liveState(), { lineConfiguration: Object.assign({}, LIVE_CONFIG, { hopperNamingMode: "main-plus-five" }) })), "structural");
  assert.equal(source.classifyChange(base, resolvedFor(liveState(), { lineConfiguration: Object.assign({}, LIVE_CONFIG, { layerAPosition: "inside" }) })), "structural");
  // A profile height changes the layout, so it is a render even though it is one number.
  assert.equal(source.classifyChange(base, resolvedFor(edited(s => { s.layers[0].hoppers[0].usableHeight = 40; }))), "structural");
  // Live to demo and back.
  const demo = source.resolveSource({ snapshot: null, demoLines, demoId: "three-layer" });
  assert.equal(source.classifyChange(base, demo), "structural");
  assert.equal(source.classifyChange(demo, base), "structural");
  // Nothing before, or nothing after, is a render.
  assert.equal(source.classifyChange(null, base), "structural");
  assert.equal(source.classifyChange(base, null), "structural");
});

test("classifyChange is pure and reads nothing it is not given", () => {
  const a = resolvedFor(liveState());
  const b = resolvedFor(edited(s => { s.layers[0].hoppers[1].resinName = "X"; }));
  const before = JSON.stringify([a, b]);
  source.classifyChange(a, b);
  source.classifyChange(b, a);
  assert.equal(JSON.stringify([a, b]), before);
});
