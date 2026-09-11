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
    nextRecipe: { schema_version: 1, line_type: 3 },
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
  const { bridge, handle } = connected(appState());
  const serialized = JSON.stringify(bridge.getSnapshot());
  for (const leaked of ["theme", "density", "timeFormat", "surfaceStyle", "mobileTimelineAlarm",
    "pumpOffAlarmSoundUri", "hopperNamingLine9", "resinLots", "nextRecipe",
    "industrial-slate", "content://alarm", "LOT-9", "next-only-source"]) {
    assert.ok(!serialized.includes(leaked), `the snapshot carries "${leaked}"`);
  }
  handle.disconnect();
});

test("the snapshot's top level is exactly the documented blocks", () => {
  const { bridge, handle } = connected(appState());
  assert.deepEqual(Object.keys(bridge.getSnapshot()).sort(),
    ["job", "layers", "line", "revision", "sources"]);
  handle.disconnect();
});

test("hookup sources cross for the current recipe only, in their own module's shape", () => {
  /* Added when Station's expanded layer view needed to show where a resin came
   * from. Narrow on purpose: `current` only, and carrying the resin alongside
   * the label so hookup-sources' own sourceForPosition() can refuse a label
   * whose resin has since changed. */
  const { bridge, handle } = connected(appState());
  const snapshot = bridge.getSnapshot();
  assert.deepEqual(snapshot.sources, { "A:0": { resin: "", source: "silo 3" } });
  assert.ok(!JSON.stringify(snapshot).includes("next-only-source"));
  handle.disconnect();
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
