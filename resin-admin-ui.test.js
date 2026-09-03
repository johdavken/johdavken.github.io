const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const index = fs.readFileSync("index.html", "utf8");
const ui = fs.readFileSync("resin-admin-ui.js", "utf8");

test("admin navigation is explicitly hidden during initialization and rendered from verified state", () => {
  assert.match(index, /id="resinDatabaseButton"[^>]*hidden/);
  assert.match(ui, /const initializing = !state\?\.ready/);
  assert.match(ui, /adminLoginButton"\)\.hidden = initializing \|\| adminAccess/);
  assert.match(index, /id="sudoAccessBlock"[\s\S]*?id="adminLoginButton"[\s\S]*?Admin Login/);
  assert.match(ui, /resinDatabaseButton"\)\.hidden = !adminAccess/);
  assert.match(ui, /renderAccess\(admin\.getState\(\)\)/);
  assert.match(ui,/const sudoStatus = \$\("sudoAccessStatus"\);/);
  assert.match(ui,/sudoStatus\) sudoStatus\.textContent = initializing/);
  assert.match(fs.readFileSync("styles.css", "utf8"), /\.sudoAccessActions \[hidden\]\{display:none!important\}/);
});

test("Sudo access presents administrator destinations as icon-led action rows", () => {
  assert.match(index, /id="sudoAccessBlock"[\s\S]*?class="mobileSectionHeaderIcon"/);
  assert.match(index, /id="resinDatabaseButton" class="footerAdminDestination sudoAccessAction"[\s\S]*?<strong>Resin database<\/strong>/);
  assert.match(index, /id="workspaceManagementButton" class="footerAdminDestination sudoAccessAction"[\s\S]*?<strong>Workspace management<\/strong>/);
  assert.match(index, /id="betaApplicantsButton" class="footerAdminDestination sudoAccessAction"[\s\S]*?<strong>Beta applicants<\/strong>/);
  assert.match(index, /id="databaseHealthButton" class="footerAdminDestination sudoAccessAction"[\s\S]*?<strong>Database health<\/strong>/);
  const styles = fs.readFileSync("styles.css", "utf8");
  assert.match(styles, /\.sudoAccessAction\{[\s\S]*?grid-template-columns:30px minmax\(0,1fr\) auto;/);
  assert.match(styles, /\.sudoAccessBody\{display:grid;align-content:start;gap:12px\}/);
});

test("admin UI includes login, editing, active state, deletion, and catalog refresh flow", () => {
  assert.match(index, /id="adminLoginForm"/);
  assert.match(index, /id="adminResinActive"/);
  assert.match(index, /<option value="false">Inactive<\/option>/);
  assert.match(ui, /duplicateCode/);
  assert.match(ui, /admin\.saveResin/);
  assert.match(ui, /admin\.listResins/);
  assert.match(ui, /if \(!admin\.getState\(\)\.isAdmin\) return;/);
  assert.match(ui, /resin\?\.is_active \?\? true/);
  assert.match(ui, /value === "true"/);
  assert.match(index, /id="adminResinDelete"[^>]*class="danger"[^>]*hidden/);
  assert.match(ui, /admin\.deleteResin/);
  assert.match(ui, /Permanently delete/);
});

test("admin form includes bulk density (lb/ft³), populated on edit and submitted alongside density - not yet used by Smart Hoppers, just an entry field for now", () => {
  assert.match(index, /id="adminResinBulkDensity"/);
  assert.match(index, /Bulk density \(lb\/ft³\)/);
  assert.match(ui, /\$\("adminResinBulkDensity"\)\.value = resin\?\.bulk_density_lb_ft3 \?\? "";/);
  assert.match(ui, /bulk_density_lb_ft3: \$\("adminResinBulkDensity"\)\.value,/);
});

test("Resin Database no longer stores, edits, or searches by display description or information description - only code, both densities, and status remain", () => {
  assert.doesNotMatch(index, /id="adminResinDescription"/);
  assert.doesNotMatch(index, /id="adminResinInformation"/);
  assert.doesNotMatch(ui, /display_description|information_description/);
  assert.match(index, /id="adminResinCode"/);
  assert.match(index, /id="adminResinDensity"/);
  assert.match(index, /id="adminResinBulkDensity"/);
  assert.match(index, /id="adminResinActive"/);
});

test("the record list and search are code-only now that description is not stored", () => {
  const filteredStart = ui.indexOf("function filteredResins(");
  const filteredBody = ui.slice(filteredStart, ui.indexOf("\n  }", filteredStart));
  assert.doesNotMatch(filteredBody, /description/);
  assert.match(filteredBody, /resin\.resin_code\.toLocaleLowerCase\(\)\.includes\(query\)/);
  assert.match(ui, /row\.textContent = `\$\{resin\.resin_code\}\$\{resin\.is_active \? "" : " \(inactive\)"\}`;/);
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

test("the desktop panel body packs its rows at the top, so filtering the list cannot slide the toolbar down the page", () => {
  const desktop = fs.readFileSync("desktop.css", "utf8");
  assert.match(desktop, /\.adminResinPanel > \.blockBody\{ align-content:start; \}/);
  // The stretch this defends against comes from the panel body filling the
  // desktop viewport; if that rule ever stops applying, the pack is moot.
  assert.match(desktop, /\.workspaceContent > \.workspacePanel > \.blockBody\{[\s\S]*?height:100%/);
});

test("Resin Database's search field and Add resin sit together at the left, not a full-width field with a stranded button", () => {
  const styles = fs.readFileSync("styles.css", "utf8");
  assert.match(styles, /#resinAdminBlock \.adminToolbar\{ grid-template-columns:minmax\(0,320px\) auto; justify-content:start; \}/);
  // The shared .adminToolbar keeps its header-bar behaviour for the other
  // admin sub-panels, which do want their buttons pushed to the right edge.
  assert.match(styles, /\.adminToolbar,\.adminFieldGrid\{ display: grid; grid-template-columns: 1fr auto;/);
  // Narrow widths still stack, and the id rule has to be overridden there or
  // it would out-specify the shared mobile rule.
  assert.match(styles, /@media \(max-width: 760px\)\{[\s\S]*#resinAdminBlock \.adminToolbar\{ grid-template-columns:1fr; justify-content:stretch; \}/);
});
