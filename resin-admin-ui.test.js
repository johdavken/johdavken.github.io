const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const index = fs.readFileSync("index.html", "utf8");
const ui = fs.readFileSync("resin-admin-ui.js", "utf8");

test("admin navigation is explicitly hidden during initialization and rendered from verified state", () => {
  assert.match(index, /id="resinDatabaseButton"[^>]*hidden/);
  assert.match(ui, /const initializing = !state\?\.ready/);
  assert.match(ui, /adminLoginButton"\)\.hidden = initializing \|\| adminAccess/);
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
