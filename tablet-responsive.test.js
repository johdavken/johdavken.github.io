"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktopCss = fs.readFileSync("desktop.css", "utf8");
const DESKTOP_QUERY = "(min-width: 901px) and (pointer: fine)";

function functionBody(name){
  const start = app.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name} in app.js`);
  const end = app.indexOf("\n    function ", start + 1);
  return app.slice(start, end === -1 ? undefined : end);
}

function queryMatches(query, { width, pointer }){
  const minWidth = query.match(/min-width:\s*(\d+)px/);
  const maxWidth = query.match(/max-width:\s*(\d+)px/);
  const pointerCond = query.match(/pointer:\s*(\w+)/);
  if (minWidth && width < Number(minWidth[1])) return false;
  if (maxWidth && width > Number(maxWidth[1])) return false;
  if (pointerCond && pointer !== pointerCond[1]) return false;
  return true;
}

function presentationState(width, pointer){
  if (queryMatches(DESKTOP_QUERY, { width, pointer })) return "Desktop";
  return width <= 700 ? "Compact Touch" : "Wide Touch";
}

function mediaBlockContaining(marker){
  const markerIndex = styles.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected CSS marker: ${marker}`);
  const start = styles.lastIndexOf("@media ", markerIndex);
  assert.notEqual(start, -1, `Expected ${marker} inside a media query`);
  const open = styles.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < styles.length; index += 1){
    if (styles[index] === "{") depth += 1;
    if (styles[index] === "}") depth -= 1;
    if (depth === 0) return styles.slice(start, index + 1);
  }
  assert.fail(`Unclosed media query containing ${marker}`);
}

/* Structural shell and runtime synchronization. */

test("the authoritative structural decision remains >=901px plus a fine primary pointer", () => {
  const block = app.slice(app.indexOf("const layoutModeQueries"), app.indexOf("function isDesktopLayout"));
  assert.ok(block.includes(`desktop: window.matchMedia("${DESKTOP_QUERY}")`));
  assert.match(block, /compactRecipe: window\.matchMedia\("\(max-width: 700px\)"\)/);
  assert.match(block, /Object\.freeze\(/);
  assert.doesNotMatch(block, /tablet/i);
  assert.match(app, /function isDesktopLayout\(\)\{\s*return layoutModeQueries\.desktop\.matches;/);
  assert.doesNotMatch(app, /userAgent[^\n]*(Fold|Samsung|SM-F|Tablet|iPad)/i);
  assert.doesNotMatch(styles, /any-pointer/);
});

test("the complete width and pointer matrix resolves to exactly three presentation states", () => {
  const cases = [
    [390, "coarse", "Compact Touch"], [390, "fine", "Compact Touch"],
    [700, "coarse", "Compact Touch"], [700, "fine", "Compact Touch"],
    [701, "coarse", "Wide Touch"], [701, "fine", "Wide Touch"],
    [800, "coarse", "Wide Touch"], [800, "fine", "Wide Touch"],
    [900, "coarse", "Wide Touch"], [900, "fine", "Wide Touch"],
    [901, "coarse", "Wide Touch"], [901, "fine", "Desktop"],
    [1200, "coarse", "Wide Touch"], [1200, "fine", "Desktop"]
  ];
  for (const [width, pointer, expected] of cases){
    assert.equal(presentationState(width, pointer), expected, `${width}px ${pointer}`);
  }
});

test("one canonical body data-shell attribute mirrors the JS shell decision", () => {
  const fn = functionBody("applyShellAttribute");
  assert.match(fn, /const shell = desktop \? "desktop" : "touch";/);
  assert.match(fn, /document\.body\.dataset\.shell = shell/);
  assert.doesNotMatch(app, /dataset\.(?:layoutMode|touchMode|desktopMode|tabletMode)/);
  assert.doesNotMatch(app, /classList\.(?:add|toggle)\([^\n]*(?:mobile|tablet|desktop)-mode/);
});

test("data-shell is set before initial DOM construction and updated in the existing sync path", () => {
  const initStart = app.indexOf("      applyShellAttribute();");
  const firstInitLayerBuild = app.indexOf("      ensureLayers();", initStart);
  assert.notEqual(initStart, -1);
  assert.ok(firstInitLayerBuild > initStart);
  const sync = functionBody("syncLayoutMode");
  assert.match(sync, /const desktop = isDesktopLayout\(\);/);
  assert.match(sync, /applyShellAttribute\(desktop\);/);
  assert.match(sync, /renderWeightsArea\(\);/);
  assert.match(sync, /renderSplitsArea\(\);/);
});

test("structural renderers share the predicate instead of duplicating media queries", () => {
  const rawCalls = app.match(/window\.matchMedia\("[^"]+"\)/g) || [];
  assert.deepEqual(rawCalls.sort(), [
    `window.matchMedia("${DESKTOP_QUERY}")`,
    `window.matchMedia("(max-width: 700px)")`
  ].sort());
  // renderWeightsArea is the one structural renderer that deliberately
  // does NOT use the pointer-based predicate: Weights follows Recipe's
  // reworked boundary (the compact-mobile breakpoint) so a tablet gets the
  // same wide interface on both pages.
  assert.match(functionBody("renderWeightsArea"), /if \(layoutModeQueries\.compactRecipe\.matches\)\{/);
  assert.match(functionBody("applySurfaceStyle"), /const renderedSurfaceStyle = isDesktopLayout\(\)/);
  assert.match(functionBody("syncWorkspaceForViewport"), /const desktop = isDesktopLayout\(\);/);
});

test("existing listeners stay single-instance and rebuild only across meaningful boundaries", () => {
  const sync = functionBody("syncLayoutMode");
  assert.match(sync, /const changed = desktop !== renderedIsDesktop \|\| compactRecipe !== renderedCompactRecipe;/);
  assert.match(sync, /if \(!changed \|\| !rerender\) return changed;/);
  const watch = functionBody("watchLayoutMode");
  assert.match(watch, /Object\.values\(layoutModeQueries\)\.forEach/);
  assert.match(watch, /query\.addEventListener\("change", onChange\)/);
  assert.match(watch, /query\.addListener\(onChange\)/);
  assert.equal((app.match(/\n    watchLayoutMode\(\);/g) || []).length, 1);
  assert.match(app, /syncLayoutMode\(\{ rerender:false \}\);/);
  assert.doesNotMatch(app, /location\.reload\(\)/);
});

/* Compact Touch and Wide Touch presentation. */

test("Compact Touch keeps the existing <=700px Recipe icon interface", () => {
  const block = mediaBlockContaining("#splitsBlock .recipePageTab .recipeTabLabel{");
  assert.match(block, /^@media \(max-width: 700px\)/);
  assert.match(block, /\.recipeTabLabel\{[\s\S]*?position:absolute;/);
  assert.match(block, /\.recipeTabIcon\{[\s\S]*?display:inline-flex;/);
  assert.match(block, /\.recipeHeaderActions \.recipeActionIcon\{[\s\S]*?display:inline-flex;/);
});

test("Wide Touch is selected by touch shell plus >=701px, with no pointer requirement", () => {
  const block = mediaBlockContaining("Wide Touch intentionally keeps the base text tabs");
  assert.match(block, /^@media \(min-width: 701px\)\{/);
  assert.match(block, /body\[data-shell="touch"\]/);
  assert.doesNotMatch(block, /pointer:\s*(?:coarse|fine)/);
  assert.doesNotMatch(block, /orientation:/);
  assert.doesNotMatch(block, /\.recipeTabLabel\{[\s\S]*?position:absolute/);
  assert.doesNotMatch(block, /\.recipeTabIcon\{[\s\S]*?display:inline-flex/);
  assert.doesNotMatch(block, /font-size:\s*0/);
});

test("Wide Touch keeps the established Recipe chrome and toolbar density", () => {
  const block = mediaBlockContaining("Wide Touch intentionally keeps the base text tabs");
  assert.match(block, /#splitsBlock\.mobile-active > summary\{[\s\S]*?min-height:36px;/);
  assert.match(block, /#splitsBlock \.recipePageTab\{[\s\S]*?min-height:32px;/);
  assert.match(block, /\.splitsEditRowSecondary\{[\s\S]*?flex-wrap:nowrap;/);
  assert.match(block, /\.splitsEditRowSecondary :is\(\.bulkTextAction,button\.danger\)\{[\s\S]*?min-height:28px;/);
  assert.doesNotMatch(block, /\.splitMatrixCell\{[^}]*?(?:height|min-height|max-height):/);
});

test("Wide Touch Line Setup and Weights refinements are shell-and-width scoped", () => {
  const block = mediaBlockContaining("body[data-shell=\"touch\"] #lineSetupBlock .setupLineConfiguration{");
  assert.match(block, /^@media \(min-width: 701px\)\{/);
  assert.doesNotMatch(block, /pointer:/);
  assert.match(block, /grid-template-columns:minmax\(0,1\.35fr\) minmax\(0,1fr\);/);
  assert.match(block, /#weightsBlock \.blockBody\{ max-width:none; \}/);
  assert.doesNotMatch(block, /overflow-x:\s*(auto|scroll)/);
});

test("narrow Wide Touch Recipe cells adapt by width, not orientation or pointer", () => {
  const block = mediaBlockContaining("body[data-shell=\"touch\"] #splitsArea .splitsMatrix tbody td.splitMatrixCell{");
  assert.match(block, /^@media \(min-width: 701px\) and \(max-width: 900px\)\{/);
  assert.doesNotMatch(block, /orientation:/);
  assert.doesNotMatch(block, /pointer:/);
  assert.match(block, /\.splitCellEditor\{[\s\S]*?flex-direction: column;/);
  assert.match(block, /\.splitCellTop\{[\s\S]*?flex-direction: column;/);
  assert.match(block, /\.splitPctControl input\{[\s\S]*?text-align: left;/);
});

test("Wide Touch and Desktop layer headers are disjoint by data-shell", () => {
  const touch = mediaBlockContaining("body[data-shell=\"touch\"] #splitsArea .splitsMatrix thead th{");
  const desktop = mediaBlockContaining("body[data-shell=\"desktop\"] #splitsArea .splitLayerMain{");
  assert.match(touch, /^@media \(min-width: 701px\)\{/);
  assert.match(touch, /body\[data-shell="touch"\]/);
  assert.doesNotMatch(touch, /data-shell="desktop"/);
  assert.match(touch, /\.splitLayerTitle,[\s\S]*?position:static;[\s\S]*?font-size:10px;/);
  assert.match(desktop, /^@media \(min-width: 701px\)\{/);
  assert.match(desktop, /body\[data-shell="desktop"\]/);
  assert.doesNotMatch(desktop, /data-shell="touch"/);
  assert.match(desktop, /\.splitLayerPct input\{[\s\S]*?font-size: 22px;/);
});

test("short-height compaction is limited to Wide Touch and does not alter desktop", () => {
  const chrome = mediaBlockContaining("body[data-shell=\"touch\"] main{");
  const matrix = mediaBlockContaining("body[data-shell=\"touch\"] #splitsArea .splitsMatrix thead th{ padding:2px;");
  for (const block of [chrome, matrix]){
    assert.match(block, /^@media \(min-width: 701px\) and \(max-height: 800px\)\{/);
    assert.match(block, /body\[data-shell="touch"\]/);
    assert.doesNotMatch(block, /pointer:/);
  }
  assert.match(matrix, /\.splitCopyBtn\{[\s\S]*?display:inline-grid;/);
  assert.match(matrix, /td\.splitMatrixCell\{ padding:2px 6px; \}/);
});

test("Recipe state tuning no longer uses a pointer query and continues on very wide touch shells", () => {
  const shared = mediaBlockContaining("--tablet-recipe-cell-bg:transparent;");
  assert.match(shared, /^@media \(min-width: 701px\) and \(max-width: 1200px\)\{/);
  assert.doesNotMatch(shared, /pointer:/);
  assert.match(shared, /\.splitMatrixCell\.selected\{[\s\S]*?box-shadow:inset 0 0 0 1px var\(--focus-border\);/);
  const wideTouch = mediaBlockContaining("body[data-shell=\"touch\"] #splitsArea .splitsMatrix tbody .splitMatrixCell{");
  assert.match(wideTouch, /^@media \(min-width: 1201px\)\{/);
  assert.match(wideTouch, /body\[data-shell="touch"\]/);
  assert.doesNotMatch(wideTouch, /pointer:/);
});

test("the five-column overflow fix applies to every Wide Touch shell", () => {
  const block = mediaBlockContaining("body[data-shell=\"touch\"] .splitsMatrixScroll{");
  assert.match(block, /^@media \(min-width: 701px\)\{/);
  assert.match(block, /body\[data-shell="touch"\] \.splitsMatrixScroll\{[^}]*overflow-x:hidden/);
  assert.match(block, /body\[data-shell="touch"\] \.splitsMatrix\{[\s\S]*?table-layout:fixed;[\s\S]*?width:100%;/);
  assert.match(block, /\.splitsMatrix thead th\{ min-width:0; width:auto; max-width:none; \}/);
  assert.match(block, /\.splitMatrixCell\{ min-width:0; width:auto; max-width:100%; \}/);
  assert.match(block, /\.splitsMatrix th:first-child\{ min-width:52px; width:52px; max-width:52px; \}/);
  assert.match(block, /\.splitCellEditor\{ grid-template-columns:minmax\(0,1fr\) auto; \}/);
  assert.doesNotMatch(block, /pointer:/);
  assert.doesNotMatch(block, /overflow-x:\s*(auto|scroll)/);
  assert.doesNotMatch(block, /transform:\s*scale/);
});

test("the responsive presentation section contains no layout-only pointer or orientation gates", () => {
  const section = styles.slice(styles.indexOf(" *   Responsive model"));
  assert.doesNotMatch(section, /pointer:\s*coarse/);
  assert.doesNotMatch(section, /orientation:\s*(?:portrait|landscape)/);
  assert.match(section, /body\[data-shell="touch"\]/);
  assert.match(section, /body\[data-shell="desktop"\]/);
});

test("pointer queries remain for structural shell and actual hover capability", () => {
  assert.match(styles, /@media \(hover:hover\)/);
  const desktopBlocks = styles.match(/@media \(min-width:\s?901px\)[^{]*\{/g) || [];
  assert.ok(desktopBlocks.length >= 5);
  for (const block of desktopBlocks) assert.match(block, /pointer: fine/);
  const desktopCssBlocks = desktopCss.match(/@media \(min-width:901px\)[^{]*\{/g) || [];
  assert.ok(desktopCssBlocks.length >= 2);
  for (const block of desktopCssBlocks) assert.match(block, /pointer: fine/);
  assert.match(styles, /@media \(max-width: ?900px\), \(min-width: 901px\) and \(pointer: coarse\)/);
});

test("the touch-only changeover wizard follows the canonical shell attribute", () => {
  assert.match(styles, /body\[data-shell="touch"\] \.changeoverWizardTrigger\{display:grid\}/);
  assert.match(styles, /body\[data-shell="touch"\] \.changeoverWizardDialog\{/);
});

/* Footer colour and silhouette. */

test("the text rail keeps one panel-tint background for every theme", () => {
  const refinement = styles.slice(styles.lastIndexOf("/* Footer state refinement"));
  assert.match(refinement, /background:color-mix\(in srgb,var\(--panelOpen\) 96%,transparent\);/);
  assert.doesNotMatch(styles, /body\[data-theme="[^"]+"\] \.footerBar/);
  assert.doesNotMatch(styles, /\.appDockControl[\s\S]{0,40}color:var\(--fg\)/);
});

test("the text rail is 32px tall and drops the old raised-end silhouette", () => {
  assert.match(styles, /:root\{--app-dock-height:32px\}/);
  assert.match(styles, /\.footerBar::before,\.footerBar::after\{display:none\}/);
  const refinement = styles.slice(styles.lastIndexOf("/* Footer state refinement"));
  assert.match(refinement, /\.appDockControl,\.cloudSyncFooterStatus\{[\s\S]*?min-height:32px;/);
});
