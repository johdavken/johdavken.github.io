const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");

test("the Layers (1/3/5) picker moved out of the retired Line Setup page into Recipe's own header, desktop-only", () => {
  assert.match(html, /<div class="recipeLayerCountHost" id="recipeLayerCountHost" aria-label="Line layer count"><\/div>/);
  assert.match(app, /function placeProductionControlsForLayout\(\)[\s\S]*?const layerHost = \$\("recipeLayerCountHost"\);[\s\S]*?layerHost\.append\(layerCount\)/);
  assert.match(styles, /\.recipeLayerCountHost\{ display:none; \}/);
  assert.match(desktop, /#recipeHeaderControls \.recipeLayerCountHost\{display:flex;/);
});

test("Output/Changeover's canonical #lineRate/#changeoverTime inputs park back in their original (hidden) Line Setup home on desktop, not a visible rail panel", () => {
  assert.match(app, /const desktopProductionHost = \$\("lineSetupBlock"\)\?\.querySelector\("\.setupLineConfiguration"\);/);
  assert.doesNotMatch(app, /desktopRailRecipeSetupControls/);
});

test("clicking anywhere on the Changeover tile opens the native time picker, not just its tiny built-in indicator icon", () => {
  assert.match(app, /\$\("changeoverTime"\)\?\.addEventListener\("click",\(e\)=>\{\s*\n\s*if \(typeof e\.currentTarget\.showPicker !== "function"\) return;\s*\n\s*try \{ e\.currentTarget\.showPicker\(\); \} catch \{\}/);
});

test("Option A places the same live production fields in a two-cell mobile home band", () => {
  assert.match(html, /class="mobileProductionControls" id="mobileProductionControls" aria-label="Production controls"/);
  assert.match(app, /const productionHost = isDesktopLayout\(\) \? desktopProductionHost : mobileHost;/);
  assert.match(app, /productionHost\.append\(production\)/);
  assert.match(styles, /body\[data-mobile-workspace="home"\] \.mobileProductionControls\{[\s\S]*?display:flex;/);
});

test("mobile production values are readouts that reveal native inputs on demand", () => {
  assert.match(html, /id="mobileLineRateReadout" class="mobileLineRateReadout" type="button" aria-label="Edit output">Not set<\/button>/);
  assert.match(app, /mobileLineRateReadout\?\.addEventListener\("click"[\s\S]*?classList\.add\("mobileOutputEditing"\)[\s\S]*?lineRateInput\?\.focus\(\)/);
  assert.match(app, /lineRateInput\?\.addEventListener\("blur"[\s\S]*?classList\.remove\("mobileOutputEditing"\)/);
  assert.match(styles, /\.gaugeTile\.mobileOutputEditing input:not\(\[type="time"\]\)\{display:block\}/);
});

test("the production band has no RT Sync shortcut of its own - that action already lives on the workspace identity bar directly above it", () => {
  assert.doesNotMatch(html, /mobileProductionSyncShortcut/);
  assert.doesNotMatch(app, /mobileProductionSyncShortcut/);
  assert.doesNotMatch(styles, /mobileProductionSyncShortcut/);
  assert.match(app, /\$\("workspaceIdentityButton"\)\?\.addEventListener\("click",\(\)=>\{\s*setWorkspacePanel\("lineSyncBlock", \{ reveal:true \}\);/);
});

test("Changeover and Output are large, left/right-aligned readouts in a centered, width-capped band on mobile/tablet", () => {
  assert.match(styles, /body\[data-mobile-workspace="home"\] \.mobileProductionControls\{[\s\S]*?justify-content:space-between;[\s\S]*?max-width:440px;[\s\S]*?margin:10px auto 16px;/);
  assert.match(styles, /\.mobileProductionControls \.setupPrimaryFields > div:last-child\{text-align:right\}/);
  assert.match(styles, /\.mobileProductionControls \.mobileLineRateReadout\{display:flex;align-items:center;justify-content:flex-end;text-align:right\}/);
  assert.match(styles, /\.mobileProductionControls \.gaugeTimeValue,\n  \.mobileProductionControls \.mobileLineRateReadout\{[\s\S]*?font-size:clamp\(24px,7\.5vw,32px\);/);
});

test("Line Setup is retired as a visible workspace destination", () => {
  assert.match(styles, /\.workspaceNavButton\[data-workspace-target="lineSetupBlock"\],[\s\S]*?#lineSetupBlock\{ display:none!important; \}/);
  assert.match(app, /if \(activeWorkspaceId === "lineSetupBlock"\) activeWorkspaceId = "splitsBlock";/);
});

test("the crowded status bar drops the workspace name and next action items - both moved elsewhere (the workspace identity bar and the Timeline nav button)", () => {
  assert.doesNotMatch(html, /class="workspaceStatusItem mobileWorkspaceStatus"/);
  assert.doesNotMatch(html, /class="workspaceStatusItem workspaceNextAction"/);
  assert.doesNotMatch(app, /mobileStatusWorkspaceName|workspaceNextStatus|workspaceNextDetail/);
  assert.doesNotMatch(styles, /mobileWorkspaceStatus/);
  assert.doesNotMatch(desktop, /workspaceNextAction/);
});

test("the status bar's Output and Changeover are click-to-edit readouts, not just display text - editable without expanding the Recipe rail stage", () => {
  // Plain divs, not nested inside a workspaceNavButton, so - unlike a
  // readout dropped into the Recipe nav button itself - these can host a
  // real interactive control.
  assert.match(html, /<div class="workspaceStatusItem statusEditableItem">\s*\n\s*<span>Output<\/span>\s*\n\s*<button type="button" id="workspaceOutputStatus" class="mono statusReadout" aria-label="Edit output">Not set<\/button>\s*\n\s*<input type="number" id="workspaceOutputInput" class="statusEditInput"[\s\S]*?hidden>/);
  assert.match(html, /<div class="workspaceStatusItem statusEditableItem">\s*\n\s*<span>Changeover<\/span>\s*\n\s*<button type="button" id="workspaceChangeoverStatus" class="mono statusReadout" aria-label="Edit changeover time">Not set<\/button>\s*\n\s*<input type="time" id="workspaceChangeoverInput" class="statusEditInput"/);
  // Both write straight into state.lineRate/state.changeoverTime - the same
  // fields the Recipe gauge tiles read and write - and mirror the commit
  // back onto #lineRate/#changeoverTime so the two locations can't disagree.
  assert.match(app, /\$\("workspaceOutputStatus"\)\?\.addEventListener\("click",\(\)=>\{[\s\S]*?workspaceOutputInput\.focus\(\);/);
  assert.match(app, /workspaceOutputInput\?\.addEventListener\("input",\(e\)=>\{\s*\n\s*if \(!acceptNumericInput\(e\.target, \{ min: 0, label: "Output" \}, value => \{ state\.lineRate = value; \}\)\) return;\s*\n\s*const lineRateEl = \$\("lineRate"\);\s*\n\s*if \(lineRateEl\) lineRateEl\.value = String\(state\.lineRate\);/);
  assert.match(app, /\$\("workspaceChangeoverStatus"\)\?\.addEventListener\("click",\(\)=>\{[\s\S]*?showPicker/);
  assert.match(app, /workspaceChangeoverInput\?\.addEventListener\("input",\(e\)=>\{\s*\n\s*state\.changeoverTime = e\.target\.value \|\| "";[\s\S]*?const changeoverEl = \$\("changeoverTime"\);\s*\n\s*if \(changeoverEl\) changeoverEl\.value = state\.changeoverTime;/);
  // Desktop-only (min-width:901px and pointer:fine) - same scope as the
  // rest of the status bar it lives in.
  assert.match(styles, /\.statusEditableItem\.editing \.statusReadout\{ display:none; \}/);
  assert.match(styles, /\.statusEditableItem\.editing \.statusEditInput\{/);
});
