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

test("main menu keeps its primary grid while Sudo access lives under Workspace & Support", () => {
  const nav = html.slice(html.indexOf('<nav class="workspaceNav"'),html.indexOf('</nav>',html.indexOf('<nav class="workspaceNav"')));
  // 10, not 9: the Play Store banner (Help's old slot) isn't a workspaceNavButton -
  // it's three mutually exclusive states, so it only carries workspaceNavExtra.
  // Changelog is a normal button, so it counts (RT Sync, Notes, Tools,
  // Changelog, Sudo access + the 4 pinned sections). Notes is mobile-only and
  // hidden on desktop by CSS, but it is still a real workspaceNavButton here -
  // and Dashboard is the desktop-only mirror image, hidden on mobile because
  // the whole rail is (see .workspaceNav{display:none} at mobile widths), but
  // likewise still a real workspaceNavButton in the shared markup.
  assert.equal((nav.match(/class="workspaceNavButton/g) || []).length,10);
  assert.match(nav,/data-workspace-target="productionSummaryBlock"/, "Production Summary is a first-class section, between Timeline and RT Sync");
  assert.match(nav,/id="workspaceNavSudo"[^>]*data-workspace-target="sudoAccessBlock"/);
  assert.doesNotMatch(nav,/Appearance|Admin Login|Resin Database|Workspace Management/);
  assert.match(styles,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test("the shared receiver-weight guidance explains conservative usable weight and Smart Hopper inputs", () => {
  assert.match(html, /Enter a conservative usable weight, or use Smart Hoppers to calculate resin-specific hopper capacity from hopper size and bulk density\./);
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
  assert.match(app, /area\.append\(bulkBar, matrix, selectionHint\);/);
  assert.match(app, /mobileWeightProfilesButton/);
  assert.match(app, /ensureMobileWeightProfilesSheet\(profilesAction\)/);
  assert.match(styles, /#lineSetupBlock #setupWeightProfilesBlock\{display:none!important\}/);
});
