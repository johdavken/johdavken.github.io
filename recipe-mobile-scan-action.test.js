"use strict";

// Current and Next now share one three-slot mobile primary row: Scan /
// Load Next-or-Current / Print. Scan and Print are fixed-width icon-only
// actions; the middle slot keeps a readable text label since it's the one
// button whose meaning changes with the page. Clear Tracking - previously
// a 4th slot on Current only - is gone from this row entirely: Timeline's
// own Reset tracking control already covered the same action, so mobile
// just hides the duplicate (see clearTrackingButton.hidden). With that and
// Recipe Book's own tab, neither page needs an overflow "More" menu any
// more, so it was deleted rather than left with nothing to hold.
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
  const landmark = styles.indexOf(".splitsMobilePrimaryRow > .mobileScanIconAction,");
  assert.notEqual(landmark, -1);
  const start = styles.lastIndexOf("@media (max-width: 700px){", landmark);
  assert.notEqual(start, -1);
  return styles.slice(start, styles.indexOf("\n}\n", start));
}

/* ============================================================
 *   Current's row: Scan and Print as icon-only primary actions
 * ============================================================ */

test("Scan and Print are promoted out of the row's equal-width columns into fixed 42px icon slots, on both pages", () => {
  const block = mainMobileBlock();
  assert.match(block, /\.splitsMobilePrimaryRow > \.mobileScanIconAction,\s*\n\s*\.splitsMobilePrimaryRow > \.mobilePrintIconAction\{\s*\n\s*flex:0 0 42px;/);
});

test("both icon slots hide their real text label (font-size:0) and show their existing SVG icon instead - the opposite of every other primary-row button", () => {
  const block = mainMobileBlock();
  assert.match(block, /\.splitsMobilePrimaryRow \.mobileScanIconAction > summary,\s*\n\s*\.splitsMobilePrimaryRow button\.mobilePrintIconAction\{\s*\n\s*font-size:0;/);
  assert.match(block, /\.splitsMobilePrimaryRow \.mobileScanIconAction \.recipeActionIcon,\s*\n\s*\.splitsMobilePrimaryRow \.mobilePrintIconAction \.recipeActionIcon\{\s*\n\s*display:block!important;\s*\n\s*width:18px;\s*\n\s*height:18px;/);
});

test("Scan's popup uses the shared left:0 default - it sits leftmost in the row on both pages now, so there's no right edge left to align against", () => {
  const block = mainMobileBlock();
  assert.match(block, /\.splitsMobilePrimaryRow > \.mobileScanIconAction,\s*\n\s*\.splitsMobilePrimaryRow > \.mobilePrintIconAction\{/);
  // The old Next-only right-aligned popup rule is gone - nothing places
  // Scan at the row's right edge any more.
  assert.doesNotMatch(styles, /\.splitsMobilePrimaryRow \.splitsScanShortcut \.statusScanShortcutPanel\{ left:auto; right:0; \}/);
  assert.doesNotMatch(styles, /\.mobileScanIconAction \.statusScanShortcutPanel/);
});

test("Print keeps its own border-right:0 as the row's true last item - the generic :last-child selectors only reach a nested summary, not a bare button", () => {
  const block = mainMobileBlock();
  assert.match(block, /\.splitsMobilePrimaryRow > button\.mobilePrintIconAction\{ border-right:0; \}/);
});

test("one shared branch builds Scan / Load Next-or-Current / Print for both pages - no more separate Current/Next assembly, no mobileMoreButton", () => {
  const editor = recipeEditor();
  const branchStart = editor.indexOf("if (compactMobileRecipe){");
  assert.notEqual(branchStart, -1);
  const branch = editor.slice(branchStart, editor.indexOf("}else{", branchStart));
  assert.match(branch, /scanRecipeButton\.classList\.remove\("rearrangeDesktopOnly", "recipeScanHideDesktop"\);/);
  assert.match(branch, /scanRecipeButton\.classList\.add\("mobileScanIconAction"\);/);
  assert.match(branch, /mobilePrimaryRow\.append\(scanRecipeButton\);/);
  assert.match(branch, /if \(!isNextRecipePage\(\)\)\{\s*\n\s*if \(loadNextButton\)\{\s*\n\s*loadNextButton\.textContent = "Load Next";\s*\n\s*mobilePrimaryRow\.append\(loadNextButton\);/);
  assert.match(branch, /\}else if \(loadCurrentButton\)\{\s*\n\s*loadCurrentButton\.textContent = "Load Current";\s*\n\s*mobilePrimaryRow\.append\(loadCurrentButton\);/);
  assert.match(branch, /printButton\.classList\.remove\("rearrangeDesktopOnly", "recipeActionTertiary"\);/);
  assert.match(branch, /printButton\.classList\.add\("mobilePrintIconAction"\);/);
  assert.match(branch, /mobilePrimaryRow\.append\(printButton\);/);
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
