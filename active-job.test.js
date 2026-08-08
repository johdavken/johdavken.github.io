const test = require("node:test");
const assert = require("node:assert/strict");
const {
  snapshotActiveJob,
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

test("meaningful active-job detection recognizes production state", () => {
  assert.equal(hasMeaningfulActiveJob(snapshotActiveJob(stateFixture(), "0.17")), true);
  assert.equal(hasMeaningfulActiveJob({ lineRate: 0, gauge: 0, changeoverTime: "", layers: [] }), false);
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
