const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ACTIVE_JOB_FIELDS,
  snapshotActiveJob,
  canonicalActiveJob,
  activeJobsEqual,
  hasMeaningfulActiveJob
} = require("./active-job.js");

function stateFixture(){
  return {
    lineRate: 900,
    lineType: 1,
    gauge: 2,
    changeoverTime: "13:30",
    offsets: { A: 4 },
    layers: [{
      name: "A",
      layerPct: 100,
      hoppers: Array.from({ length: 6 }, (_, index) => ({
        pct: index === 0 ? 100 : 0,
        weight: index === 0 ? 300 : 0,
        resinName: index === 0 ? "MS0440" : "",
        track: index === 0,
        pumpOff: false
      }))
    }],
    prodResinLb: 10,
    scrapResinLb: 2,
    hopperNamingLine9: "main",
    theme: "dark",
    density: "dense",
    uiMode: "advanced",
    showPumpOffTracked: true
  };
}

test("active-job snapshot includes shared job state and excludes device UI state", () => {
  const snapshot = snapshotActiveJob(stateFixture(), "0.17");
  assert.equal(snapshot.layers[0].hoppers[0].track, true);
  assert.equal(snapshot.layers[0].hoppers[0].weight, 300);
  assert.equal(snapshot.theme, undefined);
  assert.equal(snapshot.density, undefined);
  assert.equal(snapshot.uiMode, undefined);
  assert.equal(snapshot.showPumpOffTracked, undefined);
});

test("active-job snapshots are detached from mutable application state", () => {
  const state = stateFixture();
  const snapshot = snapshotActiveJob(state, "0.17");
  state.layers[0].hoppers[0].resinName = "CHANGED";
  assert.equal(snapshot.layers[0].hoppers[0].resinName, "MS0440");
});

test("active-job equality ignores device-only fields", () => {
  const first = snapshotActiveJob(stateFixture(), "0.17");
  const second = { ...first, theme: "light", blocksOpen: { resultsBlock: true } };
  assert.equal(activeJobsEqual(first, second), true);
});

test("active-job equality ignores nested layer, hopper, and offset key order while preserving their values", () => {
  const first = {
    version: "0.18", lineRate: 100, lineType: 5, gauge: 2, changeoverTime: "10:00",
    offsets: { B: 2, A: 1 },
    layers: [{ name: "A", layerPct: 100, hoppers: [{ pct: 100, weight: 240, resinName: "MS0440", track: true, pumpOff: false, usableHeight: 24, circumference: 40 }] }],
    prodResinLb: 0, scrapResinLb: 0, hopperNamingLine9: "standard"
  };
  const second = {
    hopperNamingLine9: "standard", scrapResinLb: 0, prodResinLb: 0,
    layers: [{ hoppers: [{ circumference: 40, usableHeight: 24, pumpOff: false, track: true, resinName: "MS0440", weight: 240, pct: 100 }], layerPct: 100, name: "A" }],
    offsets: { A: 1, B: 2 }, changeoverTime: "10:00", gauge: 2, lineType: 5, lineRate: 100, version: "0.18"
  };
  assert.equal(activeJobsEqual(first, second), true);
  assert.equal(canonicalActiveJob(first), canonicalActiveJob(second));
});

test("active-job equality still distinguishes a real nested hopper value change", () => {
  const first = snapshotActiveJob(stateFixture(), "0.18");
  const second = JSON.parse(JSON.stringify(first));
  second.layers[0].hoppers[0].usableHeight = 24;
  assert.equal(activeJobsEqual(first, second), false);
});

test("active-job snapshots carry the shared workspace hopper circumference", () => {
  const state = stateFixture();
  state.hopperCircumference = 42;
  const snapshot = snapshotActiveJob(state, "0.18");
  assert.equal(snapshot.hopperCircumference, 42);
  assert.ok(canonicalActiveJob(snapshot).includes('"hopperCircumference":42'));
});

test("meaningful active-job detection recognizes production state", () => {
  assert.equal(hasMeaningfulActiveJob(snapshotActiveJob(stateFixture(), "0.17")), true);
  assert.equal(hasMeaningfulActiveJob({ lineRate: 0, gauge: 0, changeoverTime: "", layers: [] }), false);
});

// --- Scanned lot numbers: same synchronization path as layers/nextRecipe,
// no dedicated channel or write path of their own. ---

test("resinLots and nextRecipeLots are both synchronized fields", () => {
  assert.ok(ACTIVE_JOB_FIELDS.includes("resinLots"));
  assert.ok(ACTIVE_JOB_FIELDS.includes("nextRecipeLots"));
});

test("a snapshot carries both lot maps, detached from mutable state", () => {
  const state = stateFixture();
  state.resinLots = { MS0440: "ABC-123" };
  state.nextRecipeLots = { MS1307: "XYZ-999" };
  const snapshot = snapshotActiveJob(state, "0.17");
  assert.deepEqual(snapshot.resinLots, { MS0440: "ABC-123" });
  assert.deepEqual(snapshot.nextRecipeLots, { MS1307: "XYZ-999" });
  state.resinLots.MS0440 = "CHANGED";
  assert.equal(snapshot.resinLots.MS0440, "ABC-123");
});

test("a legacy state object with no lot maps snapshots to empty objects, not undefined or a crash", () => {
  const state = stateFixture();
  delete state.resinLots;
  delete state.nextRecipeLots;
  const snapshot = snapshotActiveJob(state, "0.17");
  assert.deepEqual(snapshot.resinLots, {});
  assert.deepEqual(snapshot.nextRecipeLots, {});
});

test("changing a scanned lot is a real difference; re-saving the same one is not", () => {
  const first = snapshotActiveJob({ ...stateFixture(), resinLots: { MS0440: "ABC-123" } }, "0.17");
  const same = snapshotActiveJob({ ...stateFixture(), resinLots: { MS0440: "ABC-123" } }, "0.17");
  const changed = snapshotActiveJob({ ...stateFixture(), resinLots: { MS0440: "DEF-456" } }, "0.17");
  assert.equal(activeJobsEqual(first, same), true, "an unchanged lot must not produce a write");
  assert.equal(activeJobsEqual(first, changed), false, "a changed lot must produce exactly one write");
});

test("lot map key order does not defeat equality, same as every other nested object here", () => {
  const first = snapshotActiveJob({ ...stateFixture(), resinLots: { MS0440: "A", MS1307: "B" } }, "0.17");
  const second = snapshotActiveJob({ ...stateFixture(), resinLots: { MS1307: "B", MS0440: "A" } }, "0.17");
  assert.equal(activeJobsEqual(first, second), true);
});

test("Current's and Next's lot maps are independent in the synchronized payload - changing one is not equal to changing the other", () => {
  const baseline = snapshotActiveJob(stateFixture(), "0.17");
  const currentChanged = snapshotActiveJob({ ...stateFixture(), resinLots: { MS0440: "ABC" } }, "0.17");
  const nextChanged = snapshotActiveJob({ ...stateFixture(), nextRecipeLots: { MS0440: "ABC" } }, "0.17");
  assert.equal(activeJobsEqual(currentChanged, nextChanged), false);
  assert.equal(activeJobsEqual(baseline, currentChanged), false);
  assert.equal(activeJobsEqual(baseline, nextChanged), false);
});

test("meaningful active-job detection also recognizes Smart Hoppers geometry (usable height / circumference) on an otherwise-empty hopper", () => {
  const withHeight = { lineRate: 0, gauge: 0, changeoverTime: "", layers: [{
    name: "A", layerPct: 0,
    hoppers: [{ pct: 0, weight: 0, resinName: "", track: false, pumpOff: false, usableHeight: 24, circumference: 0 }]
  }] };
  assert.equal(hasMeaningfulActiveJob(withHeight), true);

  const withCircumference = { lineRate: 0, gauge: 0, changeoverTime: "", layers: [{
    name: "A", layerPct: 0,
    hoppers: [{ pct: 0, weight: 0, resinName: "", track: false, pumpOff: false, usableHeight: 0, circumference: 40 }]
  }] };
  assert.equal(hasMeaningfulActiveJob(withCircumference), true);
});
