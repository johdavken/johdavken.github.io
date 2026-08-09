const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const index = fs.readFileSync("index.html", "utf8");
const ui = fs.readFileSync("resin-admin-ui.js", "utf8");

test("admin navigation is explicitly hidden during initialization and rendered from verified state", () => {
  assert.match(index, /id="resinDatabaseButton"[^>]*hidden/);
  assert.match(ui, /const initializing = !state\?\.ready/);
  assert.match(ui, /adminLoginButton"\)\.hidden = initializing \|\| adminAccess/);
  assert.match(index, /id="adminLoginButton"[\s\S]*?class="workspaceTileIcon"[\s\S]*?Admin Login/);
  assert.match(ui, /resinDatabaseButton"\)\.hidden = !adminAccess/);
  assert.match(ui, /renderAccess\(admin\.getState\(\)\)/);
  assert.match(fs.readFileSync("styles.css", "utf8"), /\.adminNavButton\[hidden\]\{ display: none !important; \}/);
});

test("admin UI includes login, editing, active state, and catalog refresh flow", () => {
  assert.match(index, /id="adminLoginForm"/);
  assert.match(index, /id="adminResinActive"/);
  assert.match(index, /<option value="false">Inactive<\/option>/);
  assert.match(ui, /duplicateCode/);
  assert.match(ui, /admin\.saveResin/);
  assert.match(ui, /admin\.listResins/);
  assert.match(ui, /if \(!admin\.getState\(\)\.isAdmin\) return;/);
  assert.match(ui, /resin\?\.is_active \?\? true/);
  assert.match(ui, /value === "true"/);
});

test("admin form includes bulk density (lb/ft³), populated on edit and submitted alongside density - not yet used by Smart Hoppers, just an entry field for now", () => {
  assert.match(index, /id="adminResinBulkDensity"/);
  assert.match(index, /Bulk density \(lb\/ft³\)/);
  assert.match(ui, /\$\("adminResinBulkDensity"\)\.value = resin\?\.bulk_density_lb_ft3 \?\? "";/);
  assert.match(ui, /bulk_density_lb_ft3: \$\("adminResinBulkDensity"\)\.value,/);
});

test("Resin Database is an in-app workspace panel with a two-column responsive editor", () => {
  assert.match(index, /id="resinDatabaseButton"[^>]*data-workspace-target="resinAdminBlock"/);
  assert.match(index, /<details class="block card workspacePanel adminResinPanel" id="resinAdminBlock">/);
  assert.match(index, /class="adminResinColumns"/);
  assert.doesNotMatch(index, /id="resinAdminDialog"/);
  assert.doesNotMatch(ui, /resinAdminDialog/);
  const styles = fs.readFileSync("styles.css", "utf8");
  assert.match(styles, /\.adminResinColumns\{ display:grid; grid-template-columns:/);
  assert.match(styles, /@media \(max-width: 760px\)\{[\s\S]*\.adminResinColumns\{ grid-template-columns: 1fr; \}/);
  assert.doesNotMatch(styles, /\.adminResinPanel\{ display:none!important; \}/);
});

test("selected inactive rows remain visible and sign-out exits the admin panel", () => {
  assert.match(ui, /let selectedResinId = ""/);
  assert.match(ui, /" selected"/);
  assert.match(ui, /" inactive"/);
  assert.match(ui, /data-workspace-target="resultsBlock"/);
  assert.match(ui, /selectedResinId = result\.resin\.id/);
  assert.match(ui, /adminResinSave/);
  assert.match(ui, /adminResinCancel/);
});
