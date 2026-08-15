"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const sync = fs.readFileSync("cloud-sync.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("mobile tile icons are 25% larger in both normal and minimal tile treatments", () => {
  assert.match(styles, /\.workspaceTileIcon\{\s*width:calc\(34px \* 1\.25\);\s*height:calc\(34px \* 1\.25\);/);
  assert.match(styles, /mobile-tile-style="minimal"\] \.workspaceTileIcon\{ width:calc\(30px \* 1\.25\); height:calc\(30px \* 1\.25\);/);
});

test("main menu is a stable seven-destination grid with no cosmetic or admin tiles", () => {
  const nav = html.slice(html.indexOf('<nav class="workspaceNav"'),html.indexOf('</nav>',html.indexOf('<nav class="workspaceNav"')));
  assert.equal((nav.match(/class="workspaceNavButton/g) || []).length,7);
  assert.match(nav,/data-workspace-target="productionSummaryBlock"/, "Production Summary is a first-class section, between Timeline and RT Sync");
  assert.doesNotMatch(nav,/Appearance|Admin Login|Resin Database|Workspace Management/);
  assert.match(styles,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test("the shared receiver-weight guidance explains conservative usable weight and Smart Hopper inputs", () => {
  assert.match(html, /Enter a conservative usable weight, or use Smart Hoppers to calculate capacity from hopper dimensions and resin density\./);
  assert.match(html, /How Smart Hoppers work/);
  assert.match(html, /shared hopper circumference/);
});

test("mobile RT Sync explains joining only, while desktop retains its create-or-join guidance", () => {
  assert.match(sync, /\? "Join a line when ready\."\s*:\s*"Create or join a line when ready\."/);
});

test("on mobile Recipe Setup, the Smart badge follows the resin input rather than the hopper number", () => {
  assert.match(app, /if \(!isDesktopLayout\(\)\) \{\s*cellTop\.appendChild\(smartBadge\);/);
  assert.match(styles, /\.splitCellTop \.splitSmartBadge\{ flex:0 0 auto; \}/);
});

test("mobile weights keep the grid compact and open receiver profiles in a shared sheet", () => {
  assert.match(app, /area\.appendChild\(matrix\);/);
  assert.match(app, /mobileWeightProfilesButton/);
  assert.match(app, /ensureMobileWeightProfilesSheet\(profilesAction\)/);
  assert.match(styles, /#lineSetupBlock #setupWeightProfilesBlock\{display:none!important\}/);
});
