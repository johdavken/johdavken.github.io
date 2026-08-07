"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n  function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

function setupBlock(){
  const start = html.indexOf('id="lineSetupBlock"');
  assert.notEqual(start, -1);
  const end = html.indexOf('<!-- 2) RECIPE SETUP -->', start);
  return html.slice(start, end === -1 ? undefined : end);
}

// --- "Current Changeover" / "Line Configuration" headers removed ----------

test("the panel's own subtitle survives - only the two inner section headers are gone", () => {
  assert.match(html, /<div class="layerTitle">Setup<\/div>\s*<div class="layerMeta">Current changeover and line configuration<\/div>/);
  assert.doesNotMatch(setupBlock(), /Current Changeover<\/h3>/);
  assert.doesNotMatch(setupBlock(), /Line Configuration<\/h3>/);
  assert.doesNotMatch(setupBlock(), /class="setupSectionTitle"/);
});

test("the redundant intro paragraphs under each removed header are gone entirely - the section headers already said this", () => {
  const block = setupBlock();
  assert.doesNotMatch(block, /Set the values that determine the Timeline\./);
  assert.doesNotMatch(block, /Equipment values that are normally set once for this line\./);
  assert.doesNotMatch(html, /class="setupSectionIntro"/);
});

test("no dangling aria-labelledby references the removed header ids", () => {
  assert.doesNotMatch(setupBlock(), /aria-labelledby="currentChangeoverTitle"/);
  assert.doesNotMatch(setupBlock(), /aria-labelledby="lineConfigurationTitle"/);
  assert.doesNotMatch(html, /id="currentChangeoverTitle"/);
  assert.doesNotMatch(html, /id="lineConfigurationTitle"/);
});

// --- Layer count: graphic-only tiles, left-aligned above Changeover/Line rate ---

test("the layer count tiles sit above setupPrimaryFields, left-aligned, with no visible label or required text - the graphic is self-explanatory", () => {
  const block = setupBlock();
  const tilesIndex = block.indexOf('id="lineTypeToggle"');
  const fieldsIndex = block.indexOf('class="setupFields setupPrimaryFields mt10"');
  assert.ok(tilesIndex > -1 && fieldsIndex > tilesIndex, "expected lineTypeToggle before setupPrimaryFields");
  const tilesEnd = block.indexOf("</div>\n        <div class=\"setupFields setupPrimaryFields", tilesIndex);
  const tilesBlock = block.slice(tilesIndex, tilesEnd === -1 ? fieldsIndex : tilesEnd);
  assert.doesNotMatch(tilesBlock, />Layer count</);
  assert.doesNotMatch(tilesBlock, /class="fieldRequirement"/);
  assert.doesNotMatch(html, /<select id="lineType">/); // replaced by the lineTypeToggle button group
});

test("setupPrimaryFields now holds only Changeover deadline and Line rate, in that order, as a two-column grid", () => {
  const start = html.indexOf('class="setupFields setupPrimaryFields mt10"');
  const end = html.indexOf("</div>\n      </section>", start);
  const body = html.slice(start, end);
  const changeoverIndex = body.indexOf('id="changeoverTime"');
  const lineRateIndex = body.indexOf('id="lineRate"');
  assert.ok(changeoverIndex > -1 && lineRateIndex > changeoverIndex, "expected Changeover deadline before Line rate");
  assert.doesNotMatch(body, /data-line-type/);
  assert.match(styles, /\.setupPrimaryFields\{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.doesNotMatch(html, /id="hopperNamingRow"/);
  assert.doesNotMatch(html, /class="setupToggleRow"/);
});

// --- Changeover deadline / Line rate: gauge tiles, no "Required" text ------

test("Changeover deadline and Line rate are gauge tiles with the input and a label caption - no 'Required' text anywhere", () => {
  const start = html.indexOf('class="setupFields setupPrimaryFields mt10"');
  const end = html.indexOf("</div>\n      </section>", start);
  const body = html.slice(start, end);
  assert.doesNotMatch(body, /Required for start-by times/);
  assert.doesNotMatch(body, />Required</);
  assert.doesNotMatch(body, /class="fieldRequirement"/);
  const changeoverStart = body.indexOf('class="gaugeTile"');
  const changeoverTile = body.slice(changeoverStart, body.indexOf("</div>", body.indexOf("</div>", changeoverStart) + 1));
  // No decorative gaugeIcon here - a native <input type="time"> already
  // draws its own clock/picker indicator, so the SVG on top was a second,
  // purely decorative clock duplicating the functional one inside the
  // field. Line rate's gaugeIcon (a gauge glyph, not a clock) is unrelated
  // and stays, checked separately below.
  assert.doesNotMatch(changeoverTile, /class="gaugeIcon"/);
  assert.match(changeoverTile, /<input id="changeoverTime" type="time" \/>/);
  assert.match(changeoverTile, /<label for="changeoverTime">Changeover<\/label>/);
  const lineRateStart = body.indexOf('class="gaugeTile"', changeoverStart + 1);
  const lineRateTile = body.slice(lineRateStart, body.indexOf("</div>", body.indexOf("</div>", lineRateStart) + 1));
  assert.match(lineRateTile, /class="gaugeIcon"/);
  assert.match(lineRateTile, /<input id="lineRate" type="text" inputmode="decimal" placeholder="e\.g\. 1200" value="0" \/>/);
  assert.match(lineRateTile, /<label for="lineRate">Output \(lb\/hr\)<\/label>/);
});

test("on desktop the two gauge tiles sit in a tight flex row instead of the far-apart two-column grid, same gap as .setupTopRow above them", () => {
  const desktopStart = styles.indexOf("@media (min-width: 901px){\n  .setupPrimaryFields{");
  assert.notEqual(desktopStart, -1, "expected a desktop-only override for .setupPrimaryFields");
  const block = styles.slice(desktopStart, styles.indexOf("}\n}", desktopStart) + 3);
  assert.match(block, /display: flex;/);
  assert.match(block, /gap: 16px;/);
  const topRowRule = styles.slice(styles.indexOf(".setupTopRow{"), styles.indexOf("}", styles.indexOf(".setupTopRow{")) + 1);
  assert.match(topRowRule, /gap: 16px;/); // must match the desktop override above, verbatim
});

test("the layer count tiles are three graphic-only buttons for 1/3/5 layers, each with an accessible name since there's no visible text", () => {
  const block = setupBlock();
  const start = block.indexOf('id="lineTypeToggle"');
  const end = block.indexOf('class="setupFields setupPrimaryFields', start);
  const tiles = block.slice(start, end);
  ["1","3","5"].forEach(n=>{
    assert.match(tiles, new RegExp(`data-line-type="${n}"`));
  });
  assert.match(tiles, /aria-label="1 layer"/);
  assert.match(tiles, /aria-label="3 layers"/);
  assert.match(tiles, /aria-label="5 layers"/);
  assert.match(tiles, /role="radiogroup" aria-label="Layer count"/);
  const svgCount = (tiles.match(/<svg/g) || []).length;
  assert.equal(svgCount, 3, "expected one svg glyph per tile");
});

test("the tiles are left-aligned (plain flex row, no centering/justify-content) and stay a fixed small size rather than stretching", () => {
  const ruleStart = styles.indexOf(".layerCountTiles{");
  assert.notEqual(ruleStart, -1);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /display: flex;/);
  assert.doesNotMatch(rule, /justify-content/);
  const tileRuleStart = styles.indexOf(".layerCountTile{");
  const tileRule = styles.slice(tileRuleStart, styles.indexOf("}", tileRuleStart) + 1);
  assert.match(tileRule, /flex: 0 0 auto;/);
});

test("the gauge tiles have a fixed max-width so they don't stretch wide on a roomy desktop column", () => {
  const ruleStart = styles.indexOf(".gaugeTile{");
  assert.notEqual(ruleStart, -1);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /max-width: 200px;/);
});

// --- Layer count logic moved from a <select> change handler to a custom toggle ---

test("syncLineTypeUI mirrors syncHopperNamingUI's pattern - toggles .active/aria-checked/tabIndex on the selected tile", () => {
  const body = functionBody("syncLineTypeUI");
  assert.match(body, /const group = \$\("lineTypeToggle"\);/);
  assert.match(body, /button\.classList\.toggle\("active", selected\)/);
  assert.match(body, /button\.setAttribute\("aria-checked", String\(selected\)\)/);
});

test("hookLineTypeChoice preserves the original <select> change handler's exact confirm-before-removing-configured-layers behavior", () => {
  const body = functionBody("hookLineTypeChoice");
  assert.match(body, /getLayerNamesForType\(nextType\)/);
  assert.match(body, /will remove configured data for/);
  assert.match(body, /state\.lineType = nextType;/);
  assert.match(body, /ensureLayers\(\);/);
  assert.match(body, /notifyActiveJobMutation\(\{ immediate: true, kind: "line-type" \}\);/);
});

test("hookLineTypeChoice is wired from hookCustomToggles, same as hookHopperNamingChoice", () => {
  const body = functionBody("hookCustomToggles");
  assert.match(body, /hookHopperNamingChoice\(\);\s*\n\s*hookLineTypeChoice\(\);/);
});

test("every former DOM write to the old <select id=\"lineType\"> now goes through syncLineTypeUI instead", () => {
  assert.doesNotMatch(app, /\$\("lineType"\)/);
  assert.doesNotMatch(app, /\$\("lineType"\)\?\.addEventListener\("change"/);
});

test("the hopper naming toggle no longer lives inside the Receiver Hopper Weights <summary> - it moved up next to the layer count tiles", () => {
  const block = setupBlock();
  const weightsSummaryStart = block.indexOf('id="weightsBlock"');
  const weightsSummaryEnd = block.indexOf("</summary>", weightsSummaryStart);
  const summary = block.slice(weightsSummaryStart, weightsSummaryEnd);
  assert.doesNotMatch(summary, /hopperNamingToggle/);
  assert.match(summary, /<span class="pill">Weights<\/span>/);
});

test("the hopper naming toggle sits in .setupTopRow right after the layer count tiles, same height, same row", () => {
  const block = setupBlock();
  const rowStart = block.indexOf('class="setupTopRow"');
  assert.notEqual(rowStart, -1);
  const rowEnd = block.indexOf("</div>\n        <div class=\"setupFields setupPrimaryFields", rowStart);
  const row = block.slice(rowStart, rowEnd);
  const tilesIndex = row.indexOf('id="lineTypeToggle"');
  const namingIndex = row.indexOf('id="hopperNamingToggle"');
  assert.ok(tilesIndex > -1 && namingIndex > tilesIndex, "expected lineTypeToggle before hopperNamingToggle, both inside setupTopRow");
  assert.match(row, /data-hopper-naming="standard"/);
  assert.match(row, /data-hopper-naming="main"/);
  assert.match(app, /const group = \$\("hopperNamingToggle"\);/);
});

test(".setupTopRow pairs the two controls with a plain gap, not space-between, and wraps rather than overflowing on narrow screens", () => {
  const ruleStart = styles.indexOf(".setupTopRow{");
  assert.notEqual(ruleStart, -1);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /display: flex;/);
  assert.match(rule, /flex-wrap: wrap;/);
  assert.doesNotMatch(rule, /justify-content/);
});

test("the naming toggle's click handler no longer needs to guard against toggling an enclosing <summary> - that guard only made sense while it lived inside one", () => {
  const body = functionBody("hookHopperNamingChoice");
  const clickHandlerStart = body.indexOf('group.addEventListener("click"');
  const clickHandlerEnd = body.indexOf("});", clickHandlerStart);
  const clickHandler = body.slice(clickHandlerStart, clickHandlerEnd);
  assert.doesNotMatch(clickHandler, /event\.preventDefault\(\)/);
  assert.doesNotMatch(clickHandler, /event\.stopPropagation\(\)/);
  assert.match(clickHandler, /choose\(button\.dataset\.hopperNaming\)/);
});

// --- Receiver hopper weights: bulk toolbar moved below the table ----------

test("the weights bulk toolbar is appended after the table, not before it", () => {
  const body = functionBody("renderWeightsArea");
  const scrollAppend = body.indexOf("area.appendChild(scroll);");
  const toolbarAppend = body.indexOf("area.appendChild(toolbar);");
  assert.ok(scrollAppend > -1 && toolbarAppend > scrollAppend, "expected area.appendChild(scroll) before area.appendChild(toolbar)");
});

// --- Receiver Weight Profiles panel added under Setup ----------------------

test("a new Receiver Weight Profiles block sits right after the weights block, inside the same section", () => {
  const block = setupBlock();
  const weightsBlockEnd = block.indexOf("</details>", block.indexOf('id="weightsBlock"'));
  const profilesBlockStart = block.indexOf('id="setupWeightProfilesBlock"');
  assert.ok(weightsBlockEnd > -1 && profilesBlockStart > weightsBlockEnd);
});

test("Receiver Hopper Weights and Receiver Weight Profiles have a small gap between them instead of sitting flush", () => {
  assert.match(styles, /#weightsBlock \+ #setupWeightProfilesBlock\{ margin-top: var\(--gap\); \}/);
});

test("the profiles block reuses the same consolidated action-bar markup pattern as Recipe Setup's Saved Recipes (Save Current)(Load)(Update)(...), minus a favorite button - profiles don't support favoriting", () => {
  const block = setupBlock();
  const start = block.indexOf('id="setupWeightProfilesBlock"');
  const body = block.slice(start, block.indexOf("</details>", start));
  const saveIndex = body.indexOf('id="setupSaveWeightProfile"');
  const loadIndex = body.indexOf('id="setupLoadWeightProfile"');
  const updateIndex = body.indexOf('id="setupUpdateWeightProfile"');
  const overflowIndex = body.indexOf('id="setupWeightProfileOverflow"');
  assert.ok(saveIndex > -1 && loadIndex > saveIndex && updateIndex > loadIndex && overflowIndex > updateIndex);
  assert.match(body, /class="splitsSavedRecipesActions"/);
  assert.match(body, /id="setupRenameWeightProfile"/);
  assert.match(body, /id="setupDuplicateWeightProfile"/);
  assert.match(body, /id="setupDeleteWeightProfile"[^>]*class="danger"/);
  assert.doesNotMatch(body, /Favorite/);
});

test("Load, Update, and the overflow all start visible-but-disabled, same convention as Saved Recipes", () => {
  const block = setupBlock();
  const start = block.indexOf('id="setupWeightProfilesBlock"');
  const body = block.slice(start, block.indexOf("</details>", start));
  assert.match(body, /id="setupLoadWeightProfile"[^>]*disabled/);
  assert.match(body, /id="setupUpdateWeightProfile"[^>]*disabled/);
  assert.match(body, /class="workspaceConfigurationOverflow overflow-disabled" id="setupWeightProfileOverflow"/);
  assert.doesNotMatch(body, /id="setupWeightProfileOverflow"[^>]*hidden/);
});

test("wireSetupWeightProfileActions mirrors wireSplitsSavedRecipesActions but without a favorite button, and resolves the selected item from the same selectedWorkspaceConfigurationId", () => {
  const body = functionBody("wireSetupWeightProfileActions");
  assert.match(body, /items\.find\(item=>item\.id===selectedWorkspaceConfigurationId\)/);
  assert.match(body, /loadBtn\.onclick = \(\)=>\{ if\(selectedItem\) previewWorkspaceConfiguration\(selectedItem\); \};/);
  assert.match(body, /updateBtn\.onclick = \(\)=>\{ if\(selectedItem\) openWorkspaceConfigurationDialog\("update",selectedItem\); \};/);
  assert.match(body, /mutateWorkspaceConfiguration\("delete",selectedItem\)/);
  assert.doesNotMatch(body, /favorite/i);
});

test("renderSetupWeightProfiles lists receiver weight profiles (not recipes), reuses renderConfigurationList with showRowActions:false, and explains an empty list the same way as the other two surfaces", () => {
  const body = functionBody("renderSetupWeightProfiles");
  assert.match(body, /workspaceConfigurations\.listReceiverWeightProfiles\(workspaceId\)\.items/);
  assert.match(body, /renderConfigurationList\(host,items,"profile",syncState,\{ showRowActions:false \}\)/);
  assert.match(body, /Connect to an RT Sync workspace to view shared weight profiles\./);
  assert.match(body, /Shared configurations service is unavailable\./);
});

test("renderWorkspaceConfigurations refreshes all three surfaces (Line Configurations, Saved Recipes, and now the Setup panel's weight profiles) from its one entry point", () => {
  const body = functionBody("renderWorkspaceConfigurations");
  const lines = body.split("\n").map(line=>line.trim());
  assert.equal(lines[1], "renderSplitsSavedRecipes(syncState);");
  assert.equal(lines[2], "renderSetupWeightProfiles(syncState);");
});

test("the static Save Current Weights button is wired once, alongside the existing Line Configurations save buttons, to the exact same save-profile dialog flow", () => {
  const start = app.indexOf('$("workspaceSaveProfile")?.addEventListener("click"');
  const end = app.indexOf("\n", app.indexOf('$("setupSaveWeightProfile")', start));
  const block = app.slice(start, end);
  assert.match(block, /\$\("setupSaveWeightProfile"\)\?\.addEventListener\("click",\(\)=>openWorkspaceConfigurationDialog\("save-profile"\)\);/);
});
