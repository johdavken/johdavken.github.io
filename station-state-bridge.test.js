"use strict";

/* The bridge's whole value is a guarantee: the console can read application
 * state and cannot touch it. A guarantee nobody checks is a comment, so this
 * file attacks it from the consumer's side - trying to mutate the snapshot,
 * trying to reach the source object through it, trying to publish without
 * being the producer - and then checks that legitimate updates still arrive.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const bridgeModule = require("./station-state-bridge.js");

/* A synchronous scheduler, so notification tests are ordinary straight-line
 * code. The production default coalesces on a microtask; that behavior gets
 * its own test below rather than being assumed everywhere. */
const sync = () => bridgeModule.create({ scheduler: run => run() });

function appState(overrides) {
  return Object.assign({
    lineType: 3,
    lineRate: 850,
    gauge: 2.5,
    changeoverTime: "2026-09-11T14:00",
    // Preferences and identity, present in the real state object and expected
    // never to cross the bridge.
    theme: "industrial-slate",
    density: "comfort",
    timeFormat: "12",
    surfaceStyle: "divided",
    mobileTimelineAlarm: true,
    pumpOffAlarmSoundUri: "content://alarm",
    hopperNamingLine9: "standard",
    resinLots: { "RESIN-A": "LOT-9" },
    hookupSources: {
      current: { "A:0": { source: "silo 3" } },
      next: { "A:0": { source: "next-only-source" } }
    },
    // A stored plan in PolynNextRecipe.normalize's shape: the durable
    // payload, which is what project() reads when the application does not
    // hand it the effective one.
    nextRecipe: {
      schema_version: 1, line_type: 3, hopper_naming_mode: "standard",
      layers: [
        { name: "A", layer_pct: 40, hoppers: [{ resin_name: "PLAN-A", pct: 100 }, { resin_name: null, pct: 0 }] },
        { name: "B", layer_pct: 30, hoppers: [{ resin_name: null, pct: 100 }] },
        { name: "C", layer_pct: 30, hoppers: [] }
      ]
    },
    layers: [
      { name: "A", layerPct: 34, hoppers: [
        { pct: 100, weight: 420, resinName: "RESIN-A", track: true, pumpOff: false, usableHeight: 30 },
        { pct: 0, weight: 0, resinName: "", track: false, pumpOff: false, usableHeight: 0 }
      ] },
      { name: "B", layerPct: 33, hoppers: [
        { pct: 100, weight: 380, resinName: "RESIN-B", track: false, pumpOff: true, usableHeight: 28 }
      ] },
      { name: "C", layerPct: 33, hoppers: [] }
    ]
  }, overrides);
}

function connected(state, projectOptions) {
  const bridge = sync();
  const handle = bridge.connect({
    read: () => bridge.project(state, projectOptions || {})
  });
  return { bridge, handle };
}

/* ----------------------------------------------------------------------
 *   Read-only: the module surface
 * -------------------------------------------------------------------- */

test("the module surface offers no way to write", () => {
  for (const name of ["publish", "disconnect", "setState", "getState", "state", "update"]) {
    assert.equal(bridgeModule[name], undefined, `${name} is exposed on the module`);
  }
  assert.deepEqual(
    Object.keys(bridgeModule).sort(),
    ["connect", "create", "getRevision", "getSnapshot", "isConnected", "project", "subscribe"]
  );
});

test("the module surface is frozen, so a consumer cannot swap out getSnapshot", () => {
  assert.ok(Object.isFrozen(bridgeModule));
  const original = bridgeModule.getSnapshot;
  try { bridgeModule.getSnapshot = () => "hijacked"; } catch (error) { /* strict mode throws */ }
  assert.equal(bridgeModule.getSnapshot, original);
});

test("publish and disconnect exist only on the handle connect() returns", () => {
  const { bridge, handle } = connected(appState());
  assert.equal(typeof handle.publish, "function");
  assert.equal(typeof handle.disconnect, "function");
  assert.equal(bridge.publish, undefined);
  assert.equal(bridge.disconnect, undefined);
  assert.ok(Object.isFrozen(handle));
  handle.disconnect();
});

test("a consumer cannot displace the application as the source", () => {
  const { bridge, handle } = connected(appState());
  assert.throws(
    () => bridge.connect({ read: () => ({ line: { layerCount: 99 } }) }),
    /already connected/
  );
  // The original producer is untouched.
  assert.equal(bridge.getSnapshot().line.layerCount, 3);
  handle.disconnect();
});

test("connect requires a read function rather than accepting a state object", () => {
  const bridge = sync();
  assert.throws(() => bridge.connect({}), TypeError);
  assert.throws(() => bridge.connect({ read: { lineType: 5 } }), TypeError);
  assert.equal(bridge.isConnected(), false);
});

test("a disconnected handle is inert and cannot publish again", () => {
  const { bridge, handle } = connected(appState());
  assert.equal(handle.disconnect(), true);
  assert.equal(handle.disconnect(), false);
  assert.equal(handle.publish(), false);
  assert.equal(handle.isActive(), false);
  assert.equal(bridge.isConnected(), false);
  assert.equal(bridge.getSnapshot(), null);
});

/* ----------------------------------------------------------------------
 *   Read-only: the snapshot
 * -------------------------------------------------------------------- */

test("the snapshot is frozen all the way down", () => {
  const { bridge, handle } = connected(appState());
  const snapshot = bridge.getSnapshot();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.line));
  assert.ok(Object.isFrozen(snapshot.job));
  assert.ok(Object.isFrozen(snapshot.layers));
  assert.ok(Object.isFrozen(snapshot.layers[0]));
  assert.ok(Object.isFrozen(snapshot.layers[0].hoppers));
  assert.ok(Object.isFrozen(snapshot.layers[0].hoppers[0]));
  handle.disconnect();
});

test("every documented attempt to mutate a snapshot fails", () => {
  const { bridge, handle } = connected(appState());
  const snapshot = bridge.getSnapshot();
  const attempts = [
    () => { snapshot.line.layerCount = 5; },
    () => { snapshot.layers[0].hoppers[0].track = false; },
    () => { snapshot.layers.push({ name: "Z", hoppers: [] }); },
    () => { snapshot.layers[0].hoppers.pop(); },
    () => { delete snapshot.job; },
    () => { snapshot.injected = true; }
  ];
  for (const attempt of attempts) {
    try { attempt(); } catch (error) { /* strict mode throws; sloppy mode no-ops */ }
  }
  assert.equal(snapshot.line.layerCount, 3);
  assert.equal(snapshot.layers[0].hoppers[0].track, true);
  assert.equal(snapshot.layers.length, 3);
  assert.equal(snapshot.layers[0].hoppers.length, 2);
  assert.ok(snapshot.job);
  assert.equal(snapshot.injected, undefined);
  handle.disconnect();
});

test("mutating a snapshot cannot reach the application state it was built from", () => {
  const state = appState();
  const { bridge, handle } = connected(state);
  const snapshot = bridge.getSnapshot();

  try { snapshot.layers[0].hoppers[0].weight = 1; } catch (error) {}
  try { snapshot.layers[0].name = "HACKED"; } catch (error) {}
  try { snapshot.job.lineRate = 0; } catch (error) {}

  assert.equal(state.layers[0].hoppers[0].weight, 420);
  assert.equal(state.layers[0].name, "A");
  assert.equal(state.lineRate, 850);
  handle.disconnect();
});

test("no object in the snapshot is the same object as in application state", () => {
  const state = appState();
  const { bridge, handle } = connected(state);
  const snapshot = bridge.getSnapshot();
  assert.notEqual(snapshot.layers, state.layers);
  assert.notEqual(snapshot.layers[0], state.layers[0]);
  assert.notEqual(snapshot.layers[0].hoppers[0], state.layers[0].hoppers[0]);
  handle.disconnect();
});

test("the bridge freezes its own copy, never the object the producer handed back", () => {
  // The hazard this guards: a producer that one day returns the live state
  // object would otherwise have that object frozen underneath it, breaking the
  // running application in a way nothing would attribute to the console.
  const state = appState();
  const bridge = sync();
  const handle = bridge.connect({ read: () => state });   // deliberately wrong
  const snapshot = bridge.getSnapshot();

  assert.ok(Object.isFrozen(snapshot), "the snapshot handed out must still be frozen");
  assert.ok(!Object.isFrozen(state), "the application's own state object was frozen");
  assert.ok(!Object.isFrozen(state.layers[0]), "application state was frozen at depth");

  state.lineRate = 900;                       // the application is still writable
  assert.equal(state.lineRate, 900);
  handle.disconnect();
});

test("a snapshot taken before a change does not see the change", () => {
  const state = appState();
  const { bridge, handle } = connected(state);
  const before = bridge.getSnapshot();
  state.lineRate = 1200;
  handle.publish();
  const after = bridge.getSnapshot();
  assert.equal(before.job.lineRate, 850, "an old snapshot mutated under its holder");
  assert.equal(after.job.lineRate, 1200);
  handle.disconnect();
});

/* ----------------------------------------------------------------------
 *   Narrowness
 * -------------------------------------------------------------------- */

test("preferences, identity and transport state never cross the bridge", () => {
  // Two device switches are the exceptions, each by name and each only as
  // on or off: Smart Hoppers (smartHoppers.enabled) and the pump-off alarm
  // (alarm.enabled), since a presentation layer flips them with a
  // preference command. The alarm's sound and vibration never cross.
  const { bridge, handle } = connected(appState());
  const serialized = JSON.stringify(bridge.getSnapshot());
  for (const leaked of ["theme", "density", "timeFormat", "surfaceStyle", "mobileTimelineAlarm",
    "pumpOffAlarmSoundUri", "hopperNamingLine9", "schema_version", "line_type",
    "industrial-slate", "content://alarm"]) {
    assert.ok(!serialized.includes(leaked), `the snapshot carries "${leaked}"`);
  }
  handle.disconnect();
});

test("the job's production and scrap pounds and the scanned lots cross - Resin Totals reads them", () => {
  /* Added when the Handbook's Resin Totals needed them: job facts (the
   * pounds run and scrapped) beside output and changeover, and the lots by
   * resin key as the application stores them. Read by resin-totals.js
   * through the same clampNum the application uses, so a stored string
   * crosses as that string. */
  const { bridge, handle } = connected(appState({ prodResinLb: 10926, scrapResinLb: "1,200", resinLots: { "RESIN-A": "LOT-9", "RESIN-B": "  ", "X": 7 } }));
  const snapshot = bridge.getSnapshot();
  assert.equal(snapshot.job.prodResinLb, 10926);
  assert.equal(snapshot.job.scrapResinLb, "1,200", "an entered string is carried, not reinterpreted");
  assert.deepEqual(snapshot.lots, { "RESIN-A": "LOT-9" }, "string lots only, blanks dropped");
  assert.ok(Object.isFrozen(snapshot.lots));
  handle.disconnect();
  const bare = bridgeModule.project({ layers: [] }, {});
  assert.equal(bare.job.prodResinLb, 0);
  assert.equal(bare.job.scrapResinLb, 0);
  assert.deepEqual(bare.lots, {});
  assert.deepEqual(bridgeModule.project({ layers: [], resinLots: ["not", "a", "map"], prodResinLb: "" }, {}).lots, {});
  assert.equal(bridgeModule.project({ layers: [], prodResinLb: "  " }, {}).job.prodResinLb, 0, "a blank string is nothing entered");
});

test("the snapshot's top level is exactly the documented blocks", () => {
  const { bridge, handle } = connected(appState());
  assert.deepEqual(Object.keys(bridge.getSnapshot()).sort(),
    ["alarm", "history", "job", "layers", "line", "lots", "nextRecipe", "revision", "smartHoppers", "sources"]);
  handle.disconnect();
});

test("hookup sources cross per recipe document, in their own module's shape", () => {
  /* Added when Station's expanded layer view needed to show where a resin came
   * from, and widened to both documents when the Next recipe crossed: the
   * planned recipe's editor needs its own labels. Each map carries the resin
   * alongside the label so hookup-sources' own sourceForPosition() can refuse
   * a label whose resin has since changed. */
  const { bridge, handle } = connected(appState());
  const snapshot = bridge.getSnapshot();
  assert.deepEqual(snapshot.sources, {
    current: { "A:0": { resin: "", source: "silo 3" } },
    next: { "A:0": { resin: "", source: "next-only-source" } }
  });
  assert.deepEqual(Object.keys(snapshot.sources), ["current", "next"]);
  handle.disconnect();
});

/* ----------------------------------------------------------------------
 *   The Next recipe and history availability
 * -------------------------------------------------------------------- */

/* Added ahead of Station editing. The bridge stays a one-way window: what
 * crosses here is the planned recipe as recipe fields, and whether each
 * document has anything to undo - never the stacks, never a setter. */

test("when a pump went off crosses as pumpOffAt only while it is off; a running pump, or an unreadable time, crosses as null", () => {
  const state = appState();
  const hoppers = state.layers[0].hoppers;
  hoppers[0].pumpOff = true;
  hoppers[0].pumpOffAt = 1790000000000;
  hoppers[1].pumpOff = false;
  hoppers[1].pumpOffAt = 1790000000000;
  state.layers[1].hoppers[0].pumpOff = true;
  state.layers[1].hoppers[0].pumpOffAt = "soon";
  const layers = bridgeModule.project(state, {}).layers;
  assert.equal(layers[0].hoppers[0].pumpOffAt, 1790000000000);
  assert.equal(layers[0].hoppers[1].pumpOffAt, null, "a running pump carried a pump-off moment");
  assert.equal(layers[1].hoppers[0].pumpOffAt, null);
});

test("the Current projection is unchanged by the Next recipe crossing", () => {
  const snapshot = bridgeModule.project(appState(), {});
  assert.deepEqual(Object.keys(snapshot.layers[0].hoppers[0]).sort(),
    ["effectiveWeight", "index", "pct", "pumpOff", "pumpOffAt", "resinName", "smartWeight", "track", "usableGallons", "usableHeight", "weight"]);
  assert.deepEqual(Object.keys(snapshot.layers[0]).sort(), ["hoppers", "layerPct", "name"]);
  assert.equal(snapshot.layers[0].hoppers[0].resinName, "RESIN-A", "Current must still read the live layers");
  assert.equal(snapshot.layers[0].layerPct, 34);
});

test("the Next recipe is projected from the effective plan the application hands over, not the stored payload", () => {
  // The application passes the plan it itself reads when it needs the
  // effective one - the operator's working copy. Here it differs from the
  // stored payload, and the working copy must win.
  const working = {
    schema_version: 1, line_type: 3, hopper_naming_mode: "standard",
    layers: [
      { name: "A", layer_pct: 50, hoppers: [{ resin_name: "WORKING-A", pct: 70 }, { resin_name: "WORKING-A2", pct: 30 }] },
      { name: "B", layer_pct: 25, hoppers: [{ resin_name: null, pct: 100 }] },
      { name: "C", layer_pct: 25, hoppers: [] }
    ]
  };
  const snapshot = bridgeModule.project(appState(), { plannedRecipe: working });
  assert.deepEqual(snapshot.nextRecipe, {
    layers: [
      { name: "A", layerPct: 50, hoppers: [
        { index: 0, pct: 70, resinName: "WORKING-A" },
        { index: 1, pct: 30, resinName: "WORKING-A2" }
      ] },
      { name: "B", layerPct: 25, hoppers: [{ index: 0, pct: 100, resinName: "" }] },
      { name: "C", layerPct: 25, hoppers: [] }
    ]
  });
});

test("without the effective plan, the Next recipe falls back to the stored payload", () => {
  const snapshot = bridgeModule.project(appState(), {});
  assert.equal(snapshot.nextRecipe.layers[0].hoppers[0].resinName, "PLAN-A");
  assert.equal(snapshot.nextRecipe.layers[0].layerPct, 40);
  assert.equal(snapshot.nextRecipe.layers.length, 3);
});

test("the Next recipe is null when nothing is planned", () => {
  assert.equal(bridgeModule.project(appState({ nextRecipe: null }), {}).nextRecipe, null);
  assert.equal(bridgeModule.project(appState(), { plannedRecipe: null }).nextRecipe, null,
    "an explicit null from the application means no plan, whatever is stored");
  // A malformed stored plan is no plan either, not a throw.
  assert.equal(bridgeModule.project(appState({ nextRecipe: { layers: "nonsense" } }), {}).nextRecipe, null);
  assert.equal(bridgeModule.project(appState({ nextRecipe: "x" }), {}).nextRecipe, null);
});

test("the Next recipe carries recipe fields only: no weight, tracking, pump or geometry", () => {
  const snapshot = bridgeModule.project(appState(), {
    plannedRecipe: {
      layers: [{ name: "A", layer_pct: 100, hoppers: [
        // A payload that somehow carried physical fields must still not
        // project them: a plan cannot hold operational state.
        { resin_name: "X", pct: 100, weight: 400, track: true, pumpOff: true, usableHeight: 30 }
      ] }]
    }
  });
  const hopper = snapshot.nextRecipe.layers[0].hoppers[0];
  assert.deepEqual(Object.keys(hopper).sort(), ["index", "pct", "resinName"]);
  assert.deepEqual(Object.keys(snapshot.nextRecipe.layers[0]).sort(), ["hoppers", "layerPct", "name"]);
  assert.deepEqual(Object.keys(snapshot.nextRecipe), ["layers"]);
  const serialized = JSON.stringify(snapshot.nextRecipe);
  for (const field of ["weight", "track", "pumpOff", "usableHeight", "effectiveWeight", "circumference"]) {
    assert.ok(!serialized.includes(field), `the plan carries ${field}`);
  }
});

test("history availability crosses as two booleans per document, never the stacks", () => {
  const snapshot = bridgeModule.project(appState(), {
    history: { current: { canUndo: true, canRedo: false }, next: { canUndo: 0, canRedo: "yes" } }
  });
  assert.deepEqual(snapshot.history, {
    current: { canUndo: true, canRedo: false },
    next: { canUndo: false, canRedo: true }
  });
  assert.deepEqual(bridgeModule.project(appState(), {}).history, {
    current: { canUndo: false, canRedo: false },
    next: { canUndo: false, canRedo: false }
  });
  // Handing over the stacks themselves is ignored: only the two facts cross.
  const withStacks = bridgeModule.project(appState(), {
    history: { current: { canUndo: true, canRedo: true, undo: [{ layers: [] }], redo: [] }, next: {} }
  });
  assert.deepEqual(Object.keys(withStacks.history.current).sort(), ["canRedo", "canUndo"]);
});

test("the Next recipe and history are frozen and pure like the rest of the snapshot", () => {
  const state = appState();
  const before = JSON.stringify(state);
  const plan = state.nextRecipe;
  const planBefore = JSON.stringify(plan);
  const { bridge, handle } = connected(state, { plannedRecipe: plan, history: { current: { canUndo: true } } });
  const snapshot = bridge.getSnapshot();
  assert.ok(Object.isFrozen(snapshot.nextRecipe));
  assert.ok(Object.isFrozen(snapshot.nextRecipe.layers[0]));
  assert.ok(Object.isFrozen(snapshot.nextRecipe.layers[0].hoppers[0]));
  assert.ok(Object.isFrozen(snapshot.history));
  assert.ok(Object.isFrozen(snapshot.history.current));
  assert.ok(Object.isFrozen(snapshot.sources.next));
  try { snapshot.nextRecipe.layers[0].hoppers[0].resinName = "HACKED"; } catch (error) {}
  try { snapshot.history.current.canUndo = false; } catch (error) {}
  assert.equal(snapshot.nextRecipe.layers[0].hoppers[0].resinName, "PLAN-A");
  assert.equal(snapshot.history.current.canUndo, true);
  assert.equal(JSON.stringify(state), before, "project wrote to application state");
  assert.equal(JSON.stringify(plan), planBefore, "project wrote to the plan it was handed");
  assert.notEqual(snapshot.nextRecipe.layers[0], plan.layers[0], "the plan is copied, not shared");
  handle.disconnect();
});

test("the module surface still offers nothing that writes, with the wider projection", () => {
  assert.deepEqual(
    Object.keys(bridgeModule).sort(),
    ["connect", "create", "getRevision", "getSnapshot", "isConnected", "project", "subscribe"]
  );
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "station-state-bridge.js"), "utf8");
  for (const pattern of [/\bdispatch\b/, /\bexecute\b/, /\bsetState\b/, /\bsetHopper/, /\bcommand/i]) {
    assert.doesNotMatch(source, pattern, "the state bridge gained a write path");
  }
});

/* ----------------------------------------------------------------------
 *   Subscriptions propagate
 * -------------------------------------------------------------------- */

test("a publish reaches every subscriber with the new snapshot", () => {
  const state = appState();
  const { bridge, handle } = connected(state);
  const seenA = [];
  const seenB = [];
  bridge.subscribe(snapshot => seenA.push(snapshot && snapshot.job.lineRate));
  bridge.subscribe(snapshot => seenB.push(snapshot && snapshot.job.lineRate));

  state.lineRate = 999;
  handle.publish();

  assert.deepEqual(seenA, [999]);
  assert.deepEqual(seenB, [999]);
  handle.disconnect();
});

test("a change with no publish does not reach subscribers", () => {
  // The bridge reports committed state, not every intermediate keystroke.
  const state = appState();
  const { bridge, handle } = connected(state);
  const seen = [];
  bridge.subscribe(snapshot => seen.push(snapshot.job.lineRate));
  state.lineRate = 5;
  assert.deepEqual(seen, []);
  handle.publish();
  assert.deepEqual(seen, [5]);
  handle.disconnect();
});

test("unsubscribing stops delivery, and is safe to call twice", () => {
  const { bridge, handle } = connected(appState());
  let count = 0;
  const stop = bridge.subscribe(() => { count += 1; });
  handle.publish();
  assert.equal(count, 1);
  stop();
  stop();
  handle.publish();
  assert.equal(count, 1);
  handle.disconnect();
});

test("subscribers are told when the producer disconnects, and see no snapshot", () => {
  const { bridge, handle } = connected(appState());
  const seen = [];
  bridge.subscribe(snapshot => seen.push(snapshot));
  handle.disconnect();
  assert.deepEqual(seen, [null]);
});

test("a subscriber that throws does not stop the others, or the producer", () => {
  const { bridge, handle } = connected(appState());
  const seen = [];
  bridge.subscribe(() => { throw new Error("consumer bug"); });
  bridge.subscribe(() => seen.push("second"));
  assert.doesNotThrow(() => handle.publish());
  assert.deepEqual(seen, ["second"]);
  handle.disconnect();
});

test("a subscriber may unsubscribe from inside its own callback", () => {
  const { bridge, handle } = connected(appState());
  let count = 0;
  const stop = bridge.subscribe(() => { count += 1; stop(); });
  handle.publish();
  handle.publish();
  assert.equal(count, 1);
  handle.disconnect();
});

test("publishes in one tick coalesce into a single notification", async () => {
  // The production scheduler. saveSession() runs at keystroke rate, so a burst
  // of edits must not become a burst of re-renders in the console.
  const state = appState();
  const bridge = bridgeModule.create();
  const handle = bridge.connect({ read: () => bridge.project(state, {}) });
  const seen = [];
  bridge.subscribe(snapshot => seen.push(snapshot && snapshot.job.lineRate));
  await new Promise(resolve => setTimeout(resolve, 0));
  seen.length = 0;

  state.lineRate = 1;
  handle.publish();
  state.lineRate = 2;
  handle.publish();
  state.lineRate = 3;
  handle.publish();
  assert.deepEqual(seen, [], "notification was delivered synchronously");

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(seen, [3], "expected one coalesced notification carrying the latest state");
  handle.disconnect();
});

/* ----------------------------------------------------------------------
 *   Cost and caching
 * -------------------------------------------------------------------- */

test("nothing is read or cloned until a consumer asks", () => {
  const state = appState();
  const bridge = sync();
  let reads = 0;
  const handle = bridge.connect({ read: () => { reads += 1; return bridge.project(state, {}); } });
  handle.publish();
  handle.publish();
  handle.publish();
  assert.equal(reads, 0, "publish() built a snapshot nobody asked for");
  bridge.getSnapshot();
  assert.equal(reads, 1);
  handle.disconnect();
});

test("repeat reads at one revision return the identical frozen object", () => {
  const { bridge, handle } = connected(appState());
  const first = bridge.getSnapshot();
  assert.equal(bridge.getSnapshot(), first);
  handle.publish();
  assert.notEqual(bridge.getSnapshot(), first, "the snapshot did not change after a publish");
  handle.disconnect();
});

/* ----------------------------------------------------------------------
 *   Failure never reaches the application
 * -------------------------------------------------------------------- */

test("a reader that throws yields no snapshot rather than propagating", () => {
  const bridge = sync();
  const handle = bridge.connect({ read: () => { throw new Error("projection bug"); } });
  assert.doesNotThrow(() => bridge.getSnapshot());
  assert.equal(bridge.getSnapshot(), null);
  assert.doesNotThrow(() => handle.publish());
  handle.disconnect();
});

test("a reader returning something uncloneable yields no snapshot", () => {
  const bridge = sync();
  const circular = { line: {} };
  circular.self = circular;
  const handle = bridge.connect({ read: () => circular });
  assert.equal(bridge.getSnapshot(), null);
  handle.disconnect();
});

test("getSnapshot before anything connects is null, not a throw", () => {
  const bridge = sync();
  assert.equal(bridge.isConnected(), false);
  assert.equal(bridge.getSnapshot(), null);
  assert.doesNotThrow(() => bridge.subscribe(() => {})());
});

/* ----------------------------------------------------------------------
 *   The projection itself
 * -------------------------------------------------------------------- */

test("project is pure: it never writes to the state it reads", () => {
  const state = appState();
  const before = JSON.stringify(state);
  bridgeModule.project(state, {});
  bridgeModule.project(state, {});
  assert.equal(JSON.stringify(state), before);
});

test("project returns a new object every call", () => {
  const state = appState();
  assert.notEqual(bridgeModule.project(state, {}), bridgeModule.project(state, {}));
});

test("the line block is filled from the resolved line configuration", () => {
  const snapshot = bridgeModule.project(appState(), {
    lineConfiguration: {
      lineNumber: 9, displayName: "Line 9", layerAPosition: "outside",
      hopperNamingMode: "main-plus-five", hopperGeometry: "cylindrical"
    }
  });
  assert.equal(snapshot.line.lineNumber, 9);
  assert.equal(snapshot.line.hopperNamingMode, "main-plus-five");
  assert.equal(snapshot.line.linked, true);
  // The live session's own layer count, not the catalog's.
  assert.equal(snapshot.line.layerCount, 3);
  // No count configured: null, never a guess.
  assert.equal(snapshot.line.hopperCounts, null);
});

test("the line's hoppers per layer cross as configured - one integer a layer, frozen - and as null when the line does not say", () => {
  const snapshot = bridgeModule.project(appState(), {
    lineConfiguration: { lineNumber: 12, displayName: "Line 12", layerAPosition: "outside", hopperNamingMode: "standard", hopperGeometry: "cylindrical", hopperCounts: [6, "4", 6] }
  });
  assert.deepEqual(snapshot.line.hopperCounts, [6, 4, 6]);
  assert.equal(bridgeModule.project(appState(), { lineConfiguration: { lineNumber: 12, hopperCounts: null } }).line.hopperCounts, null);
  // The hopper manufacturer crosses as the line's word, or null when it has none.
  assert.equal(snapshot.line.hopperManufacturer, null);
  assert.equal(bridgeModule.project(appState(), { lineConfiguration: { lineNumber: 12, hopperManufacturer: "tsm" } }).line.hopperManufacturer, "tsm");
  assert.equal(bridgeModule.project(appState(), { lineConfiguration: { lineNumber: 12, hopperManufacturer: "" } }).line.hopperManufacturer, null);
  assert.equal(bridgeModule.project(appState(), { lineConfiguration: null }).line.hopperManufacturer, null);
  assert.equal(bridgeModule.project(appState(), { lineConfiguration: { lineNumber: 12, hopperCounts: "6,4,6" } }).line.hopperCounts, null);
  assert.deepEqual(bridgeModule.project(appState(), { lineConfiguration: { lineNumber: 12, hopperCounts: [6, "x", 6] } }).line.hopperCounts, [6, null, 6]);
  // Through the bridge the list is frozen with the rest of the snapshot.
  const handle = bridgeModule.connect({ read: () => bridgeModule.project(appState(), { lineConfiguration: { lineNumber: 12, hopperCounts: [6, 4, 6] } }) });
  assert.ok(Object.isFrozen(bridgeModule.getSnapshot().line.hopperCounts));
  handle.disconnect();
});

test("an unlinked session is reported as unlinked rather than as a guess", () => {
  const snapshot = bridgeModule.project(appState(), { lineConfiguration: null });
  assert.equal(snapshot.line.linked, false);
  assert.equal(snapshot.line.lineNumber, null);
  assert.equal(snapshot.line.layerAPosition, null);
  assert.equal(snapshot.line.hopperGeometry, null);
  // The layer count still comes through - it is the session's own.
  assert.equal(snapshot.line.layerCount, 3);
});

test("effective weight comes from the application's own resolver, separately from entered weight", () => {
  const snapshot = bridgeModule.project(appState(), {
    resolveHopperWeight: hopper => (hopper.usableHeight > 0 ? 777 : 0)
  });
  const hopper = snapshot.layers[0].hoppers[0];
  assert.equal(hopper.weight, 420, "the operator's entered weight must survive");
  assert.equal(hopper.effectiveWeight, 777, "the run-down weight must come from the resolver");
});

test("without a resolver, effective weight falls back to the entered weight", () => {
  const snapshot = bridgeModule.project(appState(), {});
  assert.equal(snapshot.layers[0].hoppers[0].effectiveWeight, 420);
});

test("hopper runtime state and recipe assignment both come through, per physical slot", () => {
  const snapshot = bridgeModule.project(appState(), {});
  assert.equal(snapshot.layers[0].hoppers[0].track, true);
  assert.equal(snapshot.layers[0].hoppers[0].resinName, "RESIN-A");
  assert.equal(snapshot.layers[1].hoppers[0].pumpOff, true);
  assert.deepEqual(snapshot.layers[0].hoppers.map(h => h.index), [0, 1]);
});

test("a malformed state is described as empty rather than throwing", () => {
  assert.equal(bridgeModule.project(null, {}), null);
  assert.equal(bridgeModule.project("nonsense", {}), null);
  const snapshot = bridgeModule.project({ lineType: "x", layers: "not an array" }, {});
  assert.equal(snapshot.line.layerCount, null);
  assert.deepEqual(snapshot.layers, []);
  assert.equal(snapshot.job.lineRate, 0);
});

test("every projected value is JSON-safe, so the clone is complete rather than lossy", () => {
  const snapshot = bridgeModule.project(appState(), {});
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

/* ----------------------------------------------------------------------
 *   Smart Hoppers
 * -------------------------------------------------------------------- */

test("the alarm block carries this device's pump-off alarm switch, a boolean, off at rest", () => {
  const unset = appState();
  delete unset.mobileTimelineAlarm;
  assert.deepEqual(bridgeModule.project(unset, {}).alarm, { enabled: false });
  assert.deepEqual(bridgeModule.project(appState({ mobileTimelineAlarm: false }), {}).alarm, { enabled: false });
  assert.deepEqual(bridgeModule.project(appState({ mobileTimelineAlarm: true }), {}).alarm, { enabled: true });
});

test("the smartHoppers block carries this device's switch, the line's geometry mode as the application resolves it, and the shared circumference - at rest when nothing is handed in", () => {
  const rest = bridgeModule.project(appState(), {});
  assert.deepEqual(rest.smartHoppers, { enabled: false, geometryMode: null, circumference: 0 });
  const on = bridgeModule.project(appState({ smartHoppersEnabled: true, hopperCircumference: "40.5" }), { smartHopperGeometryMode: "cylindrical" });
  assert.deepEqual(on.smartHoppers, { enabled: true, geometryMode: "cylindrical", circumference: 40.5 });
  assert.equal(bridgeModule.project(appState(), { smartHopperGeometryMode: "volume" }).smartHoppers.geometryMode, "volume");
  // Never guessed: an unknown mode is no mode, a line number is not asked for.
  assert.equal(bridgeModule.project(appState(), { smartHopperGeometryMode: "spherical", lineConfiguration: { lineNumber: 9, hopperGeometry: "cylindrical" } }).smartHoppers.geometryMode, null);
  assert.equal(bridgeModule.project(appState({ smartHoppersEnabled: "yes" }), {}).smartHoppers.enabled, true, "a boolean, as the application stores it");
  assert.equal(bridgeModule.project(appState({ hopperCircumference: "wide" }), {}).smartHoppers.circumference, 0);
});

test("each hopper carries its usable gallons and the application's Smart Hoppers result - value, bulk density, resin code - or null when the entered weight stands", () => {
  const state = appState();
  state.layers[0].hoppers[0].usableGallons = 55;
  const snapshot = bridgeModule.project(state, {
    resolveSmartHopper: hopper => (hopper.usableHeight > 0 ? { value: 812.5, bulkDensity: 35, resin: { resin_code: hopper.resinName, extra: "dropped" } } : null),
    resolveHopperWeight: hopper => (hopper.usableHeight > 0 ? 812.5 : hopper.weight)
  });
  const [a1, a2] = snapshot.layers[0].hoppers;
  assert.equal(a1.usableGallons, 55);
  assert.equal(a2.usableGallons, 0, "not entered");
  assert.deepEqual(a1.smartWeight, { value: 812.5, bulkDensity: 35, resinCode: "RESIN-A" });
  assert.equal(a1.effectiveWeight, 812.5);
  assert.equal(a1.weight, 420, "the entered weight survives beside it");
  assert.equal(a2.smartWeight, null);
  // A result with no positive value is no result; missing parts read as empty.
  assert.equal(bridgeModule.project(state, { resolveSmartHopper: () => ({ value: 0, bulkDensity: 35 }) }).layers[0].hoppers[0].smartWeight, null);
  assert.equal(bridgeModule.project(state, { resolveSmartHopper: () => ({ value: NaN }) }).layers[0].hoppers[0].smartWeight, null);
  assert.deepEqual(bridgeModule.project(state, { resolveSmartHopper: () => ({ value: 10 }) }).layers[0].hoppers[0].smartWeight, { value: 10, bulkDensity: 0, resinCode: "" });
  // Without a resolver nothing is computed.
  assert.equal(bridgeModule.project(state, {}).layers[0].hoppers[0].smartWeight, null);
  // The plan carries none of it.
  assert.ok(snapshot.nextRecipe.layers.every(layer => layer.hoppers.every(h => !("smartWeight" in h) && !("usableGallons" in h))));
  // And a connected consumer holds it frozen.
  const { bridge, handle } = connected(state, { resolveSmartHopper: () => ({ value: 10, bulkDensity: 1, resin: { resin_code: "X" } }) });
  const held = bridge.getSnapshot();
  assert.ok(Object.isFrozen(held.smartHoppers) && Object.isFrozen(held.layers[0].hoppers[0].smartWeight));
  handle.disconnect();
});
