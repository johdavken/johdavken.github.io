"use strict";

// Smart Hoppers' cylindrical-vs-volume geometry mode is resolved from the
// connected line, never asked of the operator. This is the one place that
// decision is written down (line-identity.js's getSmartHopperGeometryMode/
// getSmartHopperGeometryModeForSync) - app.js's rendering, editing, and
// calculation all resolve from here so they can never disagree. Lines 1, 2,
// 3, 4, 7, and 8 have irregular, non-cylindrical receiver hoppers rated
// only in usable gallons; every other identified line keeps the existing
// cylindrical behavior (shared circumference + per-hopper usable height).

const test = require("node:test");
const assert = require("node:assert/strict");
const identity = require("./line-identity.js");

const workspace = (name, extra = {}) => ({ id: `ws-${name}`, name, membership: { role: "member" }, ...extra });
const linked = (ws, { connected = true } = {}) => ws
  ? { selectedWorkspaceId: ws.id, selectedWorkspace: ws, connected }
  : { selectedWorkspaceId: "", selectedWorkspace: null, connected: false };
const modeForLine = (name, options) => identity.getSmartHopperGeometryModeForSync(linked(workspace(name), options));

test("Lines 1, 2, 3, and 4 resolve to volume mode", () => {
  assert.equal(modeForLine("Line 1"), "volume");
  assert.equal(modeForLine("Line 2"), "volume");
  assert.equal(modeForLine("Line 3"), "volume");
  assert.equal(modeForLine("Line 4"), "volume");
});

test("Lines 7 and 8 resolve to volume mode", () => {
  assert.equal(modeForLine("Line 7"), "volume");
  assert.equal(modeForLine("Line 8"), "volume");
});

test("every other identified line (5, 6, 9-15) resolves to cylindrical mode", () => {
  [5, 6, 9, 10, 11, 12, 13, 14, 15].forEach(n => assert.equal(modeForLine(`Line ${n}`), "cylindrical", `Line ${n}`));
});

test("an unmapped line number resolves to null - never guessed at", () => {
  assert.equal(identity.getSmartHopperGeometryMode(16), null);
  assert.equal(identity.getSmartHopperGeometryMode(0), null);
  assert.equal(identity.getSmartHopperGeometryMode(-1), null);
  assert.equal(identity.getSmartHopperGeometryMode(1.5), null);
  assert.equal(identity.getSmartHopperGeometryMode(null), null);
  assert.equal(identity.getSmartHopperGeometryMode(undefined), null);
});

test("no linked workspace resolves to null - Smart Hoppers cannot be presented as usable", () => {
  assert.equal(identity.getSmartHopperGeometryModeForSync(linked(null)), null);
  assert.equal(identity.getSmartHopperGeometryModeForSync(undefined), null);
});

test("a disconnected sync (operator's own unlink action) resolves to null even if a workspace was previously selected", () => {
  assert.equal(modeForLine("Line 1", { connected: false }), null);
  assert.equal(modeForLine("Line 5", { connected: false }), null);
});

test("a workspace whose name cannot be mapped confidently to a known line resolves to null, same as requiredLayerCountForSync", () => {
  assert.equal(identity.getSmartHopperGeometryModeForSync(linked(workspace("Extruder 3"))), null);
});

test("getSmartHopperGeometryMode and getSmartHopperGeometryModeForSync are exported from line-identity.js's public API", () => {
  assert.equal(typeof identity.getSmartHopperGeometryMode, "function");
  assert.equal(typeof identity.getSmartHopperGeometryModeForSync, "function");
});
