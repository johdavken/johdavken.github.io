const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");

test("Recipe's desktop rail receives the existing production and layer controls", () => {
  assert.match(html, /id="desktopRailRecipeSetupControls" aria-label="Recipe production settings"/);
  assert.match(app, /function placeProductionControlsForLayout\(\)[\s\S]*?desktopHost\.prepend\(layerCount\)/);
  assert.match(desktop, /\.desktopRailRecipeSetupControls \.setupPrimaryFields/);
});

test("Option A places the same live production fields in a two-cell mobile home band", () => {
  assert.match(html, /class="mobileProductionControls" id="mobileProductionControls" aria-label="Production controls"/);
  assert.match(app, /const productionHost = isDesktopLayout\(\) \? desktopHost : mobileHost;/);
  assert.match(app, /productionHost\.append\(production\)/);
  assert.match(styles, /body\[data-mobile-workspace="home"\] \.mobileProductionControls\{[\s\S]*?display:block;/);
  assert.match(styles, /body\[data-mobile-workspace="home"\] \.mobileProductionControls\{[\s\S]*?grid-template-columns:38px repeat\(2,minmax\(0,1fr\)\)/);
});

test("mobile production values are readouts that reveal native inputs on demand", () => {
  assert.match(html, /id="mobileLineRateReadout" class="mobileLineRateReadout" type="button" aria-label="Edit output">Not set<\/button>/);
  assert.match(app, /mobileLineRateReadout\?\.addEventListener\("click"[\s\S]*?classList\.add\("mobileOutputEditing"\)[\s\S]*?lineRateInput\?\.focus\(\)/);
  assert.match(app, /lineRateInput\?\.addEventListener\("blur"[\s\S]*?classList\.remove\("mobileOutputEditing"\)/);
  assert.match(styles, /\.gaugeTile\.mobileOutputEditing input:not\(\[type="time"\]\)\{display:block\}/);
});

test("the production band exposes RT Sync between Output and Changeover", () => {
  assert.match(html, /id="mobileProductionSyncShortcut" type="button" aria-label="Open RT Sync"/);
  assert.match(app, /\$\("mobileProductionSyncShortcut"\)\?\.addEventListener\("click",\(\)=>\{\s*setWorkspacePanel\("lineSyncBlock", \{ reveal:true \}\);/);
  assert.match(styles, /\.mobileProductionSyncShortcut\{order:1\}[\s\S]*?\.setupPrimaryFields > div:first-child\{order:2\}[\s\S]*?\.setupPrimaryFields > div:last-child\{order:3\}/);
});

test("Line Setup is retired as a visible workspace destination", () => {
  assert.match(styles, /\.workspaceNavButton\[data-workspace-target="lineSetupBlock"\],[\s\S]*?#lineSetupBlock\{ display:none!important; \}/);
  assert.match(app, /if \(activeWorkspaceId === "lineSetupBlock"\) activeWorkspaceId = "splitsBlock";/);
});

test("mobile status reports the active workspace name", () => {
  assert.match(html, /class="workspaceStatusItem mobileWorkspaceStatus"[\s\S]*?id="mobileStatusWorkspaceName"/);
  assert.match(app, /mobileStatusWorkspace\.textContent = syncState\.connected && syncState\.selectedWorkspace\?\.name/);
  assert.match(styles, /\.workspaceStatusBar \.workspaceStatusItem\.mobileWorkspaceStatus\{[\s\S]*?display:flex;/);
});
