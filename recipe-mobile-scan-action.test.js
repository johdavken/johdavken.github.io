"use strict";

// On phones the page actions fold up into the tab row itself: Scan and the
// page's own Load action become icon-only square buttons in
// #recipeHeaderActions, beside the icon tabs and the Edit/Done pencil.
// There is no bar below the matrix any more, and Print is desktop-only.
// Clear Tracking is gone from mobile entirely - Timeline's own Reset
// tracking control already covers it - and neither page needs an overflow
// "More" menu.
//
// A companion Display setting (mobile/touch only - scanning has no desktop
// entry point) lets an operator skip the 3-source popup on a Scan tap and
// go straight to one source every time.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function recipeEditor(){
  const start = app.indexOf("    function renderSplitsArea(){");
  const end = app.indexOf("    function renderResinCalculator(){", start);
  assert.ok(start > -1 && end > start, "expected renderSplitsArea");
  return app.slice(start, end);
}

function mainMobileBlock(){
  const landmark = styles.indexOf("#splitsBlock .recipeHeaderActions > .mobileScanIconAction > summary,");
  assert.notEqual(landmark, -1);
  const start = styles.lastIndexOf("@media (max-width: 700px){", landmark);
  assert.notEqual(start, -1);
  return styles.slice(start, styles.indexOf("\n}\n", start));
}

/* ============================================================
 *   Scan and Load as icon-only buttons in the tab-row cluster
 * ============================================================ */

test("Scan and Load are square icon-only controls in #recipeHeaderActions - text label hidden (font-size:0), SVG icon shown", () => {
  const block = mainMobileBlock();
  assert.match(block, /#splitsBlock \.recipeHeaderActions > \.mobileScanIconAction > summary,\s*\n\s*#splitsBlock \.recipeHeaderActions > \.recipeHeaderMobileAction\{[\s\S]*?font-size:0;/);
  assert.match(block, /#splitsBlock \.recipeHeaderActions \.recipeActionIcon\{\s*\n\s*display:block;\s*\n\s*width:16px;\s*\n\s*height:16px;/);
});

test("the cluster carries no Print - a phone can't print", () => {
  assert.doesNotMatch(styles, /mobilePrintIconAction/);
  const editor = recipeEditor();
  const branch = editor.slice(editor.indexOf("if (compactMobileRecipe){"), editor.indexOf("}else{", editor.indexOf("if (compactMobileRecipe){")));
  assert.doesNotMatch(branch, /printButton/);
});

test("Scan's popup opens downward and right-aligned from the header - it sits near the panel top now", () => {
  const block = mainMobileBlock();
  assert.match(block, /#splitsBlock \.recipeHeaderActions \.splitsScanShortcut \.statusScanShortcutPanel\{\s*\n\s*top:calc\(100% \+ 6px\);\s*\n\s*bottom:auto;\s*\n\s*left:auto;\s*\n\s*right:0;/);
});

test("one shared branch routes Scan + the page's Load button into headerActions for both pages - no separate row, no mobileMoreButton", () => {
  const editor = recipeEditor();
  const branchStart = editor.indexOf("if (compactMobileRecipe){");
  assert.notEqual(branchStart, -1);
  const branch = editor.slice(branchStart, editor.indexOf("}else{", branchStart));
  assert.match(branch, /scanRecipeButton\.classList\.remove\("rearrangeDesktopOnly", "recipeScanHideDesktop"\);/);
  assert.match(branch, /scanRecipeButton\.classList\.add\("mobileScanIconAction"\);/);
  assert.match(branch, /headerActions\?\.append\(scanRecipeButton\);/);
  assert.match(branch, /if \(!isNextRecipePage\(\)\)\{\s*\n\s*if \(loadNextButton\)\{\s*\n\s*loadNextButton\.classList\.add\("recipeHeaderMobileAction"\);\s*\n\s*headerActions\?\.append\(loadNextButton\);/);
  assert.match(branch, /\}else if \(loadCurrentButton\)\{\s*\n\s*loadCurrentButton\.classList\.add\("recipeHeaderMobileAction"\);\s*\n\s*headerActions\?\.append\(loadCurrentButton\);/);
  assert.doesNotMatch(branch, /clearTrackingButton|mobileMoreButton/);
  assert.doesNotMatch(app, /mobileMoreButton|mobileRecipeMore/);
});

/* ============================================================
 *   Default Scan Action (Display settings, mobile/touch only)
 * ============================================================ */

test("the setting lives in the shared Display sheet, under Time format, gated to touch surfaces the same way Scan Recipe itself is", () => {
  const sheet = html.slice(html.indexOf('id="displaySheet"'), html.indexOf("</dialog>", html.indexOf('id="displaySheet"')));
  const timeFormatIndex = sheet.indexOf('for="timeFormatSel"');
  const scanActionIndex = sheet.indexOf('for="defaultScanActionSel"');
  assert.ok(timeFormatIndex > -1 && scanActionIndex > timeFormatIndex, "Default Scan Action must come after Time format");
  assert.match(sheet, /<label for="defaultScanActionSel" class="recipeScanHideDesktop">Default Scan Action/);
  assert.match(sheet, /<option value="ask" selected>Ask each time<\/option>/);
  assert.match(sheet, /<option value="heat_sheet">Heat Sheet<\/option>/);
  assert.match(sheet, /<option value="job_traveler">Job Traveler<\/option>/);
  assert.match(sheet, /<option value="dosing_screen">Dosing Screen<\/option>/);
});

test("defaults to Ask each time, so existing muscle memory doesn't change for anyone who hasn't opened the setting", () => {
  assert.match(app, /defaultScanAction: "ask",/);
  assert.match(app, /function applyDefaultScanAction\(value\)\{[\s\S]*?const allowed = new Set\(\["ask", "heat_sheet", "job_traveler", "dosing_screen"\]\);[\s\S]*?state\.defaultScanAction = defaultScanAction;/);
});

test("is a per-device local preference like theme/timeFormat - persisted in the session payload and preserved across a shared active-job apply", () => {
  assert.match(app, /timeFormat: state\.timeFormat,\s*\n\s*defaultScanAction: state\.defaultScanAction,\s*\n\s*surfaceStyle: state\.surfaceStyle,/g);
});

test("restore path and change listener both apply it the same way timeFormat is applied", () => {
  assert.match(app, /applyTimeFormat\(payload\.timeFormat \|\| "12"\);\s*\n\s*applyDefaultScanAction\(payload\.defaultScanAction \|\| "ask"\);/);
  assert.match(app, /\$\("defaultScanActionSel"\)\?\.addEventListener\("change",\(e\)=>\{\s*\n\s*applyDefaultScanAction\(e\.target\.value\);\s*\n\s*saveSession\(\);\s*\n\s*\}\);/);
});

test("a tap goes straight to the chosen source, skipping the popup - preventDefault on the summary's click stops <details> from toggling open", () => {
  const editor = recipeEditor();
  const hookStart = editor.indexOf('scanRecipeButton.querySelector("summary")?.addEventListener("click"');
  assert.notEqual(hookStart, -1);
  const hook = editor.slice(hookStart, editor.indexOf("modeBar.appendChild(scanRecipeButton);", hookStart));
  assert.match(hook, /const defaultSource = state\.defaultScanAction;/);
  assert.match(hook, /if \(defaultSource && defaultSource !== "ask"\)\{\s*\n\s*event\.preventDefault\(\);\s*\n\s*window\.PolynRecipeScanUI\?\.startScan\(defaultSource\);/);
});

test("\"ask\" leaves the original 3-source popup completely untouched - no preventDefault, <details> toggles open exactly as before", () => {
  const editor = recipeEditor();
  const hookStart = editor.indexOf('scanRecipeButton.querySelector("summary")?.addEventListener("click"');
  const hook = editor.slice(hookStart, editor.indexOf("modeBar.appendChild(scanRecipeButton);", hookStart));
  // "ask" falls through the guard: no branch runs, so the native <details>
  // toggle is never cancelled.
  const guardStart = hook.indexOf("if (defaultSource");
  const guardEnd = hook.indexOf("}", guardStart) + 1;
  assert.doesNotMatch(hook.slice(guardEnd), /event\.preventDefault/);
});
