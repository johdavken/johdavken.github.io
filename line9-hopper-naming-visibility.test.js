"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const identity = require("./line-identity.js");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

const line9 = { id:"line-9", name:"  Line   9  ", membership:{ role:"member" } };
const line10 = { id:"line-10", name:"Line 10", membership:{ role:"member" } };
const line90 = { id:"line-90", name:"Line 90", membership:{ role:"member" } };
const snapshot = (workspace, { connected = true } = {}) => workspace
  ? { selectedWorkspaceId:workspace.id, selectedWorkspace:workspace, connected }
  : { selectedWorkspaceId:"", selectedWorkspace:null, connected };

test("structured line identity wins when available and the current schema falls back to normalized exact names", () => {
  assert.equal(identity.isExactLineWorkspace({ id:"structured", name:"Line 90", line_number:9 }, 9), true);
  assert.equal(identity.isExactLineWorkspace({ id:"structured", name:"Line 9", metadata:{ lineNumber:10 } }, 9), false);
  assert.equal(identity.isExactLineWorkspace(line9, 9), true);
  assert.equal(identity.isExactLineWorkspace(line10, 9), false);
  assert.equal(identity.isExactLineWorkspace(line90, 9), false);
  assert.equal(identity.isExactLineWorkspace({ id:"contains", name:"Production Line 9 backup" }, 9), false);
});

test("Line 9 derives Main + 1–5 while other and local states derive 1–6", () => {
  assert.equal(identity.hopperNamingMode(snapshot(line9)), "main");
  assert.equal(identity.hopperNamingMode(snapshot(line10)), "standard");
  assert.equal(identity.hopperNamingMode(snapshot(line90)), "standard");
  assert.equal(identity.hopperNamingMode(snapshot(null)), "standard");
  assert.deepEqual(Array.from({ length:6 }, (_, index) => identity.hopperPositionLabel(index, snapshot(line9))), ["Main", "1", "2", "3", "4", "5"]);
  assert.deepEqual(Array.from({ length:6 }, (_, index) => identity.hopperPositionLabel(index, snapshot(line10))), ["1", "2", "3", "4", "5", "6"]);
});

test("offline cached membership retains Line 9 naming and switching updates immediately", () => {
  const sequence = [
    snapshot(line9),
    snapshot(line10),
    snapshot(line9, { connected:false })
  ];
  assert.deepEqual(sequence.map(identity.hopperNamingMode), ["main", "standard", "main"]);
  assert.equal(identity.hopperBadgeLabel("A", 0, sequence[0]), "AM");
  assert.equal(identity.hopperBadgeLabel("A", 0, sequence[1]), "A1");
  assert.equal(identity.hopperBadgeLabel("E", 5, sequence[2]), "E5");
});

test("label transitions preserve recipe and receiver values by stable indexes", () => {
  const layers = ["A", "B", "C", "D", "E"].map((name, layerIndex) => ({
    name,
    layerPct:20,
    hoppers:Array.from({ length:6 }, (_, hopperIndex) => ({
      pct:layerIndex * 10 + hopperIndex,
      resinName:`R-${layerIndex}-${hopperIndex}`,
      weight:90 + hopperIndex,
      usableHeight:40 + hopperIndex,
      track:hopperIndex === 2
    }))
  }));
  const original = structuredClone(layers);
  for (const syncState of [snapshot(line9), snapshot(line10), snapshot(line9), snapshot(null)]){
    layers.forEach(layer=>layer.hoppers.forEach((hopper, index)=>identity.hopperBadgeLabel(layer.name, index, syncState)));
    assert.deepEqual(layers, original);
  }
});

test("the app derives labels from sync state without exposing or persisting a selector action", () => {
  assert.match(app, /function derivedHopperNamingMode\(syncState = lineSync\?\.getState\?\.\(\)\)/);
  assert.match(app, /syncDerivedHopperNaming\(syncState\);/);
  assert.match(app, /renderWeightsArea\(\);\s*\n\s*renderSplitsArea\(\);/);
  assert.match(app, /class="desktopWeightVisualId">\$\{hopperBadgeLabel\(L\.name, hi\)\}/);
  assert.match(app, /label\.textContent = hopperBadgeLabel\(L\.name, hi\)/);
  assert.doesNotMatch(html, /hopperNamingToggle|data-hopper-naming|Line 9 hopper names/);
  assert.doesNotMatch(app, /notifyActiveJobMutation\(\{ immediate: true, kind: "hopper-naming" \}\)/);
  assert.match(app, /Legacy compatibility only/);
});
