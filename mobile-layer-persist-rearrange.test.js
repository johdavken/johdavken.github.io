"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");

// A rearrange move (drag or tap) calls renderSplitsArea() again to redraw
// the table. activeMobileLayer used to be a plain local reinitialized to
// state.layers[0] on every call, so mobile users got bounced back to Layer
// A after every single move instead of staying on the layer they were
// rearranging. lastActiveMobileLayer persists across renders to fix that.

test("lastActiveMobileLayer is declared at module scope, alongside hopperRearrangement, not inside renderSplitsArea", () => {
  const hoisted = app.indexOf("let hopperRearrangement = null;");
  assert.notEqual(hoisted, -1);
  const nearby = app.slice(hoisted, hoisted + 400);
  assert.match(nearby, /let lastActiveMobileLayer = "";/);
});

test("activeMobileLayer is seeded from lastActiveMobileLayer when it's still a valid layer name, not hardcoded back to layer A", () => {
  assert.match(app, /const layerNames = state\.layers\.map\(L=>L\.name\);\s*\n\s*let activeMobileLayer = layerNames\.includes\(lastActiveMobileLayer\) \? lastActiveMobileLayer : \(layerNames\[0\] \|\| ""\);/);
});

test("showMobileLayer writes through to lastActiveMobileLayer so the choice survives the next re-render", () => {
  const start = app.indexOf("function showMobileLayer(layerName){");
  assert.notEqual(start, -1);
  const body = app.slice(start, app.indexOf("\n      }", start));
  assert.match(body, /activeMobileLayer = layerName;\s*\n\s*lastActiveMobileLayer = layerName;/);
});

test("a stale remembered layer (e.g. line type changed and it no longer exists) falls back to the first layer instead of an invalid name", () => {
  const seedLine = app.match(/let activeMobileLayer = layerNames\.includes\(lastActiveMobileLayer\) \? lastActiveMobileLayer : \(layerNames\[0\] \|\| ""\);/);
  assert.ok(seedLine, "expected the fallback ternary guarding against a layer name that no longer exists");
});
