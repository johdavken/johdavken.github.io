"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("styles.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

const renderResinCalculator = functionBody("renderResinCalculator");
const renderProductionEstimate = functionBody("renderProductionEstimate");
const renderProductionEstimateHome = functionBody("renderProductionEstimateHome");

test("new calculator result creates a local estimate record in app storage", () => {
  assert.match(app, /const LS_PRODUCTION_ESTIMATE_KEY = "resinTimer\.productionEstimate\.v0\.01";/);
  assert.match(app, /localStorage\.setItem\(LS_PRODUCTION_ESTIMATE_KEY, JSON\.stringify\(payload\)\)/);
  assert.match(app, /persistProductionEstimate\(productionEstimate\)/);
});

test("initial counts are set from the accepted calculator values, not from a repeated decrementing counter", () => {
  assert.match(app, /const totalMinutesRemaining = currentSetMinutesRemaining \+ futureSets \* minutesPerSet;/);
  assert.match(app, /const remainingRolls = Math\.max\(0, Math\.ceil\(\(remainingMinutes \/ estimate\.minutesPerSet\) \* estimate\.rollsPerSet\)\);/);
  assert.match(app, /const sets = Math\.max\(1, Math\.ceil\(remainingRolls \/ estimate\.rollsPerSet\)\);/);
});

test("the display uses the compact wording without any extra heading or icon", () => {
  assert.match(renderProductionEstimate, /Est\. \$\{current\.sets\} \$\{current\.sets === 1 \? "set" : "sets"\} · \$\{current\.remainingRolls\} \$\{current\.remainingRolls === 1 \? "roll" : "rolls"\} remaining/);
  assert.doesNotMatch(renderProductionEstimate, /<h[1-6]|<svg|icon/);
  assert.match(css, /\.productionEstimate\{[^}]*color:var\(--muted\)/);
});

test("the estimate renders on the mobile home row above Workspace & support, not in the expanded Resin Totals panel", () => {
  assert.match(renderResinCalculator, /renderProductionEstimateHome\(\);/);
  assert.match(renderProductionEstimateHome, /const host = \$\("workspaceProductionEstimate"\);/);
  assert.match(renderProductionEstimateHome, /host\.hidden = false;/);
  assert.doesNotMatch(renderResinCalculator, /renderProductionEstimate\(out\);/);
  assert.match(html, /id="workspaceProductionEstimate"/);
});

test("reloading or returning to the foreground recalculates from the saved timestamp", () => {
  assert.match(app, /document\.addEventListener\("visibilitychange", \(\)=>\{\s*if \(document\.visibilityState === "visible"\) renderResinCalculator\(\);/);
  assert.match(app, /window\.addEventListener\("pageshow", \(\)=>renderResinCalculator\(\)\);/);
  assert.match(app, /const elapsedMinutes = Math\.max\(0, \(now - estimate\.startedAt\) \/ 60000\);/);
});

test("expired estimates vanish and are cleared from localStorage", () => {
  assert.match(app, /if \(!current\)\{\s*clearProductionEstimate\(\);\s*host\.querySelector\("\.productionEstimate"\)\?\.remove\(\);\s*return;\s*\}/);
  assert.match(app, /clearProductionEstimate\(\);\s*return null;/);
});

test("new calculator acceptance replaces the previous estimate instead of stacking one", () => {
  assert.match(app, /const productionEstimate = buildProductionEstimateFromWizardAnswers\(\);\s*if \(productionEstimate\)\{\s*persistProductionEstimate\(productionEstimate\);\s*renderResinCalculator\(\);/);
  assert.match(app, /clearProductionEstimate\(\);/);
});

test("the estimate never displays negative values or zero after the changeover point", () => {
  assert.match(app, /Math\.max\(0, Math\.ceil\(\(remainingMinutes \/ estimate\.minutesPerSet\) \* estimate\.rollsPerSet\)\)/);
  assert.match(app, /Math\.max\(1, Math\.ceil\(remainingRolls \/ estimate\.rollsPerSet\)\)/);
  assert.match(app, /if \(remainingMinutes <= 0\) return null;/);
});

test("invalid persisted estimate data is discarded safely without throwing", () => {
  assert.match(app, /catch\(_error\)\{\s*clearProductionEstimate\(\);\s*return null;\s*\}/);
  assert.match(app, /if \(!saved \|\| typeof saved !== "object"\) return null;/);
});

test("the feature is device-local and does not introduce RT Sync, Supabase, or network code", () => {
  const readBody = functionBody("readProductionEstimate");
  assert.doesNotMatch(readBody, /fetch\s*\(|supabase|realtime/i);
  assert.match(app, /localStorage\.getItem\(LS_PRODUCTION_ESTIMATE_KEY\)/);
  assert.match(app, /setInterval\(\(\)=>renderProductionEstimate\(host\), 60000\)/);
});
