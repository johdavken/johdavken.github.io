"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const ui = fs.readFileSync("recipe-scan-ui.js", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n  function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

// Recipe Setup's Scan Recipe button: sits between Rearrange and Print
// Recipe, pops the same three-option menu as the mobile status-bar scan
// shortcut, and does NOT join the Bulk edit/Rearrange/Saved Recipes
// mutually-exclusive panel group - it's a small popup, not a dropped panel.

test("Rearrange Hoppers was renamed to just Rearrange", () => {
  assert.match(app, /rearrangeButton\.innerHTML=`<svg class="recipeEditActionIcon"[\s\S]*?<span>\$\{hopperRearrangement\?\.active\?"Done Rearranging":"Rearrange"\}<\/span>`;/);
  assert.doesNotMatch(app, /"Rearrange Hoppers"/);
});

test("Rearrange carries one label on every width now that it lives in the Edit toolbar's wrapping pill row rather than a rigid four-item primary row - no compactMobileRecipe split needed to avoid the overflow that forced one", () => {
  assert.doesNotMatch(app, /compactMobileRecipe\?"Done":"Done Rearranging"/);
});

test("the Scan Recipe button leads modeBar's own append order, ahead of Print Recipe - Rearrange moved out into .recipeUtilityTabs and is no longer appended into modeBar at all", () => {
  const modeBarStart = app.indexOf('modeBar.className = "splitsBulkModeBar"');
  const modeBar = app.slice(modeBarStart, app.indexOf("const toolbar = document.createElement", modeBarStart));
  assert.doesNotMatch(modeBar, /modeBar\.appendChild\(rearrangeButton\)/);
  const scanAppend = modeBar.indexOf("modeBar.appendChild(scanRecipeButton)");
  const printAppend = modeBar.indexOf("modeBar.appendChild(printButton)");
  assert.ok(scanAppend > -1 && printAppend > scanAppend,
    "expected append order: scanRecipeButton, then printButton");
});

test("Scan Recipe carries rearrangeDesktopOnly like Print Recipe (hidden in the 701-900px band) plus its own recipeScanHideDesktop class", () => {
  assert.match(app, /scanRecipeButton\.className = "splitsScanShortcut rearrangeDesktopOnly recipeScanHideDesktop";/);
});

test("Scan Recipe is hidden specifically on real desktop widths - it's a mobile-capture workflow, unlike Print Recipe right next to it which stays visible on desktop", () => {
  const ruleStart = styles.indexOf("@media(min-width:901px) and (pointer: fine){.recipeScanHideDesktop{display:none!important}}");
  assert.notEqual(ruleStart, -1, "expected a desktop-width media query hiding .recipeScanHideDesktop");
});

test("Next's mobile promotion strips both hiding classes, not just rearrangeDesktopOnly, so the promoted button isn't left hidden on desktop-width devices", () => {
  assert.match(app, /scanRecipeButton\.classList\.remove\("rearrangeDesktopOnly", "recipeScanHideDesktop"\);/);
});

test("Scan Recipe is a <details> popup, not one of the three mutually-exclusive expandable panels - it isn't added to splitsBulkModeActive/splitsSavedRecipesOpen/hopperRearrangement's coordination", () => {
  const start = app.indexOf("const scanRecipeButton = document.createElement(\"details\")");
  assert.notEqual(start, -1);
  const end = app.indexOf("modeBar.appendChild(scanRecipeButton);", start);
  const body = app.slice(start, end);
  assert.doesNotMatch(body, /splitsBulkModeActive|splitsSavedRecipesOpen|hopperRearrangement/);
});

test("the popup offers the same three scan sources, same labels, as the mobile status-bar shortcut", () => {
  const start = app.indexOf("scanRecipeButton.innerHTML = `");
  const body = app.slice(start, app.indexOf("`;", start));
  assert.match(body, /data-scan-source="job_traveler"[^>]*>Scan Job Traveler</);
  assert.match(body, /data-scan-source="dosing_screen"[^>]*>Scan Dosing Screen</);
  assert.match(body, /data-scan-source="heat_sheet"[^>]*>Scan Heat Sheet</);
  assert.match(body, /class="statusScanShortcutPanel"/, "reuses the mobile shortcut's own panel styling");
});

test("choosing a source closes the popup and calls the exact same startScan flow as every other scan entry point, via the exported window.PolynRecipeScanUI - not a duplicated implementation", () => {
  const start = app.indexOf("scanRecipeButton.querySelectorAll(\"[data-scan-source]\")");
  const end = app.indexOf("modeBar.appendChild(scanRecipeButton);", start);
  const body = app.slice(start, end);
  assert.match(body, /scanRecipeButton\.open = false;/);
  assert.match(body, /window\.PolynRecipeScanUI\?\.startScan\(button\.dataset\.scanSource\);/);
});

test("recipe-scan-ui.js exports startScan precisely so this button can call it", () => {
  assert.match(ui, /root\.PolynRecipeScanUI = \{ startScan \};/);
});

test("splitsScanShortcut is reassigned to the current instance on every render, so the outside-click/Escape handlers below always check the live element", () => {
  assert.match(app, /splitsScanShortcut = scanRecipeButton;/);
});

test("the outside-click and Escape handlers are registered once at module scope, not inside renderSplitsArea, so they never stack across repeated renders", () => {
  const renderSplitsAreaStart = app.indexOf("function renderSplitsArea(){");
  const moduleScopeSection = app.slice(0, renderSplitsAreaStart);
  assert.match(moduleScopeSection, /let splitsScanShortcut = null;/);
  assert.match(moduleScopeSection, /document\.addEventListener\("click", event=>\{\s*\n\s*if \(splitsScanShortcut\?\.open && !splitsScanShortcut\.contains\(event\.target\)\) splitsScanShortcut\.open = false;/);
  assert.match(moduleScopeSection, /document\.addEventListener\("keydown", event=>\{\s*\n\s*if \(event\.key === "Escape" && splitsScanShortcut\?\.open\)\{/);
  // And renderSplitsArea itself must not register a second copy.
  const splitsAreaBody = functionBody("renderSplitsArea");
  assert.doesNotMatch(splitsAreaBody, /document\.addEventListener\("click"/);
  assert.doesNotMatch(splitsAreaBody, /document\.addEventListener\("keydown"/);
});

test("the base summary rule is an unstyled shared fallback - both real contexts (desktop's Recipe Actions row, mobile's primary row) override it, so this rule never actually renders on its own", () => {
  const ruleStart = styles.indexOf(".splitsScanShortcut > summary{");
  assert.notEqual(ruleStart, -1);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /background: transparent;/);
  assert.match(rule, /list-style: none;/);
});

test("on desktop, Scan Recipe's summary gets the primary button.primary treatment - the same gradient used everywhere else in the app, so it reads as the row's primary action", () => {
  const ruleStart = styles.indexOf(".splitsBulkModeBar .splitsScanShortcut > summary{");
  assert.notEqual(ruleStart, -1, "expected a desktop-specific override scoped under .splitsBulkModeBar");
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /background: linear-gradient\(180deg, var\(--btn-primary-a\), var\(--btn-primary-b\)\);/);
  assert.match(rule, /font-weight: 800;/);
});

test("the dropdown panel reuses .statusScanShortcutPanel's own styling (border/background/shadow/width) rather than a second copy, only overriding position", () => {
  assert.doesNotMatch(styles, /\.splitsScanShortcut\s+\.statusScanShortcutPanel\{[^}]*background:/);
  assert.match(styles, /\.statusScanShortcutPanel\{ position:absolute;/);
});

test("the panel opens upward, not downward - this row sits at the bottom of the panel, so opening downward would clip against the viewport, same reasoning as the ⓘ info panel", () => {
  const ruleStart = styles.indexOf(".splitsScanShortcut .statusScanShortcutPanel{");
  assert.notEqual(ruleStart, -1);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /top: auto;/);
  assert.match(rule, /bottom: calc\(100% \+ 6px\);/);
});
