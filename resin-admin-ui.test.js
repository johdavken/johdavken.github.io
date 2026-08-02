const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const index = fs.readFileSync("index.html", "utf8");
const ui = fs.readFileSync("resin-admin-ui.js", "utf8");

test("admin navigation is hidden by default and rendered only from verified admin state", () => {
  assert.match(index, /id="resinDatabaseButton"[^>]*hidden/);
  assert.match(ui, /\.hidden = !state\.isAdmin/);
  assert.match(ui, /\.hidden = !!state\.isAdmin/);
});

test("admin UI includes login, editing, active state, and catalog refresh flow", () => {
  assert.match(index, /id="adminLoginForm"/);
  assert.match(index, /id="adminResinActive"/);
  assert.match(ui, /duplicateCode/);
  assert.match(ui, /admin\.saveResin/);
  assert.match(ui, /admin\.listResins/);
});
