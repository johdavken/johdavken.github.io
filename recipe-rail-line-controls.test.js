const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");

test("the Layers (1/3/5) picker moved out of Recipe's header (it sat there \"in the way\" on every visit) into Display settings, shared by desktop and mobile - the same #displaySheet both platforms already open", () => {
  assert.match(html, /<div class="displaySheetLayerHost" id="displaySheetLayerHost" aria-label="Layer configuration"><\/div>/);
  // Inside #displaySheet's own form, not the Recipe header - no
  // #recipeLayerCountHost/#recipeHeaderControls host survives anywhere.
  const sheetStart = html.indexOf('<dialog id="displaySheet"');
  assert.notEqual(sheetStart, -1);
  const sheetEnd = html.indexOf("</dialog>", sheetStart);
  const sheetHtml = html.slice(sheetStart, sheetEnd);
  assert.match(sheetHtml, /id="displaySheetLayerHost"/);
  assert.doesNotMatch(html, /recipeLayerCountHost/);
  assert.match(app, /function placeProductionControlsForLayout\(\)[\s\S]*?const layerHost = \$\("displaySheetLayerHost"\);[\s\S]*?layerHost\.append\(layerCount\)/);
  // Not gated by isDesktopLayout() like the production fields just below it
  // in the same function - #displaySheet is one shared dialog with two open
  // triggers (desktop's #desktopDisplayToggle, mobile's #appFooterDisplay),
  // so the same relocated node reaches both without a platform branch.
  const fnStart = app.indexOf("function placeProductionControlsForLayout(){");
  const fnBody = app.slice(fnStart, app.indexOf("\n    }", fnStart));
  assert.doesNotMatch(fnBody, /isDesktopLayout\(\) \? layerHost/);
  assert.doesNotMatch(styles, /\.recipeLayerCountHost/);
  assert.doesNotMatch(desktop, /recipeLayerCountHost/);
  // The label text now reads as a settings-sheet heading, not the old
  // header-caption "Layers".
  assert.match(html, /<span class="setupControlLabel">Layer Configuration<\/span>/);
});

test("applyLayerCountLock's existing hide-while-RT-Sync-dictates-the-count behavior still works once relocated - nothing in this file redeclares display for .setupControlGroup/.setupLayerCountGroup outside #lineSetupBlock to fight the native [hidden] default", () => {
  assert.doesNotMatch(styles, /^\.setupControlGroup\{|^\.setupLayerCountGroup\{/m);
  assert.match(app, /const layerCountGroup = \$\("setupLayerCountGroup"\);\s*\n\s*if \(layerCountGroup\) layerCountGroup\.hidden = required !== null;/);
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

test("the mobile Output readout shows the bare number, not a repeated unit - its own label ('Output (lb/hr)') already carries it", () => {
  const body = app.slice(app.indexOf("function syncMobileLineRateReadout(){"), app.indexOf("function syncMobileLineRateReadout(){") + 400);
  assert.match(body, /readout\.textContent = state\.lineRate > 0\s*\n\s*\? state\.lineRate\.toLocaleString\(\[\], \{ maximumFractionDigits:2 \}\)\s*\n\s*: "Not set";/);
  assert.doesNotMatch(body, /`\$\{state\.lineRate[^`]*lb\/hr/);
  // The gauge tile's caption is untouched - it is the only place the unit
  // still appears on this surface.
  assert.match(html, /<label for="lineRate">Output \(lb\/hr\)<\/label>/);
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

test("Output (a <button>) matches Changeover time (a <span>) in weight, not just declared font-size/font-weight - a <button>'s own UA-default font-family renders the identical font-weight thinner than the app's font stack does", () => {
  const block = styles.slice(
    styles.indexOf(".mobileProductionControls .gaugeTimeValue,\n  .mobileProductionControls .mobileLineRateReadout{"),
    styles.indexOf("\n  }", styles.indexOf(".mobileProductionControls .gaugeTimeValue,\n  .mobileProductionControls .mobileLineRateReadout{"))
  );
  assert.match(block, /font-family:inherit;/);
  assert.match(block, /font-weight:850;/);
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
