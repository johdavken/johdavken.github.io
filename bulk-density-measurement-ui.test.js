"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const ui = fs.readFileSync("bulk-density-measurement-ui.js", "utf8");
const admin = fs.readFileSync("resin-admin.js", "utf8");
const css = `${fs.readFileSync("styles.css", "utf8")}\n${fs.readFileSync("desktop.css", "utf8")}`;

test("Bulk Density Measurement is an ordinary operator Tool, not an admin-only Account destination", () => {
  assert.doesNotMatch(html, /id="bulkDensityMeasurementButton"/);
  assert.doesNotMatch(html, /data-workspace-target="bulkDensityMeasurementBlock"/);
  assert.match(html, /id="bulkDensityMeasurementToolTab"[^>]+data-tool-target="bulkDensityMeasurementTool"/);
  assert.match(html, /data-mobile-tool-target="bulkDensityMeasurementTool"/);
  assert.match(html, /id="bulkDensityMeasurementTool" class="toolPanel toolWorkspacePanel"/);
});

test("the calculator itself carries no admin gate - it's wired up unconditionally, not behind admin.getState().isAdmin", () => {
  assert.doesNotMatch(ui, /if \(!admin\.getState\(\)\.isAdmin\) return;/);
  assert.match(ui, /catalog\.subscribe\(\(\) => loadResins\(\)\);/);
  assert.match(ui, /^\s*loadResins\(\);/m);
});

test("measurement UI provides calibration, searchable active resins, compact inputs, and explicit results", () => {
  assert.match(html, /Water calibration[\s\S]+32\.0 lb net/);
  assert.match(html, /id="bulkDensityResinSearch"[^>]+role="combobox"/);
  assert.match(html, /id="bulkDensityPolymerDensity"/);
  assert.match(html, /id="bulkDensityResinWeight"/);
  assert.match(html, /id="bulkDensityResultLbFt3"/);
  assert.match(html, /id="bulkDensityResultGCm3"/);
  assert.match(html, /id="bulkDensityPackingFactor"/);
  assert.match(css, /\.bulkDensityMeasurementForm\{display:grid/);
});

test("resin search reads the shared operator-facing resin catalog service, not the admin-only listing RPC", () => {
  assert.match(ui, /const catalog = root\.PolynResinCatalog;/);
  assert.match(ui, /resins = catalog\.getResins\(\);/);
  assert.doesNotMatch(ui, /admin\.listResins\(\)/);
});

test("selection autofills without writing and save requires a valid selected active resin", () => {
  const selectStart = ui.indexOf("function selectResin(");
  const selectBody = ui.slice(selectStart, ui.indexOf("function renderSuggestions", selectStart));
  assert.match(selectBody, /bulkDensityPolymerDensity/);
  assert.match(selectBody, /resin\.density_g_cm3/);
  assert.doesNotMatch(selectBody, /updateBulkDensity|saveResin/);
  assert.match(ui, /authorized && !!selectedResin\?\.id && selectedResin\.is_active === true/);
  assert.match(ui, /currentMeasurement\.valid && currentMeasurement\.databaseAllowed/);
});

test("save confirmation is field-scoped and concurrency protected", () => {
  assert.match(html, /id="bulkDensitySaveDialog"/);
  assert.match(ui, /Update \$\{selectedResin\.resin_code\} bulk density from \$\{oldValue\} to \$\{newValue\}\?/);
  assert.match(ui, /admin\.updateBulkDensity\(resinId, selectedResin\.updated_at, currentMeasurement\.bulkDensityLbFt3\)/);
  assert.match(admin, /\.update\(\{ bulk_density_lb_ft3:checked\.value \}\)/);
  assert.match(admin, /mutation = mutation\.eq\("updated_at", expectedUpdatedAt\)/);
  assert.doesNotMatch(admin.slice(admin.indexOf("async function updateBulkDensity"), admin.indexOf("async function deleteResin")), /resin_code:|density_g_cm3:|display_description:|information_description:/);
});

test("the Save-to-Resin-Database action stays admin-gated client-side and server-side, even though the calculator around it is not", () => {
  assert.match(ui, /if \(!authorized \|\| !selectedResin \|\| !currentMeasurement\?\.valid \|\| !currentMeasurement\.databaseAllowed\) return;/);
  assert.match(ui, /if \(!selectedResin \|\| !currentMeasurement\?\.valid \|\| !authorized\) return;/);
  assert.match(admin, /if \(!state\.isAdmin\) return \{ ok:false, code:"unauthorized"/);
  assert.match(ui, /if \(!authorized\) hint\.textContent = "Administrator access is required\.";/);
});

test("confirmed saves refresh catalog subscribers and re-run Smart/Reference presentation", () => {
  assert.match(admin, /catalog\?\.acceptConfirmedResin\?\.\(response\.data\)/);
  assert.match(admin, /const refresh = await catalog\?\.refreshResins\?\.\(\)/);
  assert.match(app, /resinCatalog\?\.subscribe\?\.\(resins=>/);
  assert.match(app, /validateAndCompute\(\{ sync:false \}\);/);
  assert.match(app, /if \(\$\("resinLookupInput"\)\?\.value\.trim\(\)\) updateResinLookup\(\);/);
  assert.match(html, /id="resinLookupBulkDensity"/);
  assert.match(ui, /bulk density saved as/);
});
