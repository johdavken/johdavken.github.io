"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

/** The recipe editor's own body - everything the Current/Next pages share. */
function recipeEditor(){
  const start = app.indexOf("    function renderSplitsArea(){");
  const end = app.indexOf("    function renderResinCalculator(){", start);
  assert.ok(start > -1 && end > start, "expected renderSplitsArea");
  return app.slice(start, end);
}

/* ============================================================
 *   One deliberate mobile action bar, replacing the old fixed 4-column
 *   grid and a separate More row.
 * ============================================================ */

test("desktop's header actions stay out of the matrix while the shared Edit toolbar is inline everywhere", () => {
  const editor = recipeEditor();
  assert.match(editor, /const headerActions = \$\("recipeHeaderActions"\);\s*\n\s*headerActions\?\.replaceChildren\(\);/);
  assert.match(editor, /headerActions\?\.append\(printButton\);/);
  assert.doesNotMatch(editor, /area\.append\(recipeUtilityTabs\)/);
  assert.match(editor, /if \(trackingView\) area\.append\(trackingBar\);/);
  assert.match(editor, /area\.append\(toolbar\);/);
  assert.doesNotMatch(editor, /mobileBulkEditSheet/);
  assert.doesNotMatch(editor, /area\.append\(modeBar\)/);
});

test("the mobile action row is built by moving the same real buttons, not rebuilding them - handlers stay exactly as wired", () => {
  const editor = recipeEditor();
  // Bulk edit is gone from the mobile row too - Edit view replaced it.
  // Rearrange is gone from it as well now - it lives in the Edit
  // toolbar's secondary row on every width (see the standalone
  // rearrangeButton append further down renderSplitsArea) - which
  // between the two leaves a row that only ever needed one guaranteed slot.
  assert.match(editor, /mobilePrimaryRow\.append\(savedRecipesButton\);/);
  assert.doesNotMatch(editor, /mobilePrimaryRow\.append\(savedRecipesButton, rearrangeButton\)/);
  assert.doesNotMatch(editor, /document\.createElement\("button"\)[\s\S]{0,80}"Bulk edit"[\s\S]{0,80}mobilePrimaryRow/);
});

/** The if(compactMobileRecipe){...}else{...} block that builds either the
 *  mobile primary/secondary rows or the desktop .recipeUtilityTabs strip -
 *  anchored on the unique `let mobilePrimaryRow` declaration just above it,
 *  since the bare string "if (compactMobileRecipe){" also matches an
 *  earlier, unrelated branch (rearrangeButton's own aria attributes). */
function mobileVsDesktopBlock(editor){
  const start = editor.indexOf("let mobilePrimaryRow = null;");
  const end = editor.indexOf("// Percentage problems are not printed here");
  assert.ok(start > -1 && end > start, "expected the mobile/desktop assembly block");
  return editor.slice(start, end);
}

test("Current's primary row is Recipes, Load Next - only when a plan exists", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  const currentBranch = block.slice(block.indexOf("if (!isNextRecipePage()){"), block.indexOf("}else{"));
  assert.match(currentBranch, /if \(loadNextButton\)\{\s*\n\s*loadNextButton\.textContent = "Load Next";\s*\n\s*mobilePrimaryRow\.append\(loadNextButton\);\s*\n\s*\}/);
});

test("Next's primary row is Recipes, Scan Recipe - promoted out of desktop-only", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  const nextBranch = block.slice(block.indexOf("}else{"), block.indexOf("mobilePrimaryRow.append(mobileMoreButton)"));
  assert.match(nextBranch, /scanRecipeButton\.classList\.remove\("rearrangeDesktopOnly", "recipeScanHideDesktop"\);/);
  assert.match(nextBranch, /mobilePrimaryRow\.append\(scanRecipeButton\);/);
});

test("desktop uses Recipe Book as a page tab and moves recipe actions into the header", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  const desktopBranch = block.slice(block.indexOf("}else{", block.indexOf("mobilePrimaryRow.append(mobileMoreButton)")));
  assert.match(html, /id="recipePageTabSaved" role="tab" aria-selected="false" aria-controls="splitsArea" data-recipe-page="saved" hidden>Recipe Book<\/button>/);
  assert.match(html, /id="recipeHeaderActions" role="group" aria-label="Recipe actions"/);
  assert.match(desktopBranch, /headerActions\?\.append\(printButton\);/);
  assert.doesNotMatch(desktopBranch, /recipeUtilityTabs/);
  assert.doesNotMatch(desktopBranch, /savedRecipesButton/);
  // Bulk edit no longer exists as a desktop tab - Edit view replaced it -
  // so modeButton is never given tab semantics or appended here.
  assert.doesNotMatch(desktopBranch, /modeButton/);
  assert.match(app, /savedRecipesPanel\.id = "splitsSavedRecipesPanel";/);
  assert.match(app, /toolbar\.id = "splitsBulkBar";/);
});

test("Rearrange keeps its real element (and every handler already wired to it), appended into the Edit panel's secondary row unconditionally - no compactMobileRecipe split, since it's the same home on every width now", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  assert.match(block, /toolbar\.querySelector\("\.splitsEditRowSecondary"\)\?\.append\(rearrangeButton\);/);
  // Not nested inside either the mobile or desktop half of the branch -
  // it must run regardless of which one executed.
  const ifDesktopSplit = block.indexOf("}else{", block.indexOf("mobilePrimaryRow.append(mobileMoreButton)"));
  const closingBrace = block.indexOf("\n      }\n", ifDesktopSplit);
  assert.ok(closingBrace > ifDesktopSplit);
  const appendIndex = block.indexOf('toolbar.querySelector(".splitsEditRowSecondary")?.append(rearrangeButton);');
  assert.ok(appendIndex > closingBrace, "the rearrangeButton append must sit after the if/else block closes, not inside either branch");
});

test("the visible mobile label shortens to Load Next (dropping the desktop icon along with the full label), but the accessible name stays Load Next Recipe", () => {
  assert.match(app, /loadNextButton\.setAttribute\("aria-label", "Load Next Recipe"\);/);
  const editor = recipeEditor();
  // Mobile's plain textContent reassignment replaces the whole icon+label
  // innerHTML wholesale, which is exactly why mobile never shows the icon -
  // see the .splitsMobilePrimaryRow .recipeActionIcon{display:none} belt-
  // and-braces rule below too, covering Scan Recipe's icon (its content
  // isn't reassigned on mobile the way loadNextButton's is).
  assert.match(editor, /loadNextButton\.textContent = "Load Next";/);
  // Desktop's own icon+label assignment (unconditional, earlier in the
  // function) is untouched - only the mobile branch shortens it.
  assert.match(editor, /loadNextButton\.innerHTML = `<svg class="recipeActionIcon"[\s\S]*?Load Next Recipe`;/);
});

test("primary-row items share equal width and never wrap - however many of them there are (3 on Next, 2 or 3 on Current)", () => {
  const rule = styles.slice(styles.indexOf(".splitsMobilePrimaryRow{"), styles.indexOf("}", styles.indexOf(".splitsMobilePrimaryRow{")));
  assert.match(rule, /display:flex;/);
  const childRule = styles.slice(styles.indexOf(".splitsMobilePrimaryRow > \\*{"), styles.indexOf("}", styles.indexOf(".splitsMobilePrimaryRow > *{")) + 1);
  assert.match(styles, /\.splitsMobilePrimaryRow > \*\{ flex:1 1 0; min-width:0; \}/);
});

test("no overflow:hidden on the mobile action row - it would clip the Scan Recipe and More menu popups, which must escape the row's own bounds", () => {
  const strip = block => block.replace(/\/\*[\s\S]*?\*\//g, "");
  const primary = strip(styles.slice(styles.indexOf(".splitsMobilePrimaryRow{"), styles.indexOf(".splitsMobilePrimaryRow > *{")));
  assert.doesNotMatch(primary, /overflow:hidden/);
});

test("More joins the primary action row, which remains one compact outlined surface", () => {
  const primary = styles.slice(styles.indexOf(".splitsMobilePrimaryRow{"), styles.indexOf("}", styles.indexOf(".splitsMobilePrimaryRow{")));
  assert.match(primary, /border:1px solid var\(--row-border-2\);/);
  assert.match(primary, /border-radius:var\(--control-radius\);/);
  assert.match(app, /mobilePrimaryRow\.append\(mobileMoreButton\);/);
});

/* ============================================================
 *   Secondary tier: the existing More menu, page-aware contents
 * ============================================================ */

test("Current's More menu keeps its existing 3 scan sources plus Print", () => {
  const editor = recipeEditor();
  const menuStart = editor.indexOf("mobileMoreButton.innerHTML=`");
  const menuHtml = editor.slice(menuStart, editor.indexOf("`;", menuStart));
  assert.match(menuHtml, /isNextRecipePage\(\) \? "" : `/);
  assert.match(menuHtml, /data-mobile-recipe-scan="job_traveler"/);
  assert.match(menuHtml, /data-mobile-recipe-scan="dosing_screen"/);
  assert.match(menuHtml, /data-mobile-recipe-scan="heat_sheet"/);
  assert.match(menuHtml, /data-mobile-recipe-print/);
});

test("Next's More menu drops the 3 scan sources, redundant with the promoted primary Scan Recipe", () => {
  const editor = recipeEditor();
  const block = editor.slice(editor.indexOf("if (compactMobileRecipe){"), editor.indexOf("// Percentage problems are not printed here"));
  assert.match(block, /mobilePrimaryRow\.append\(mobileMoreButton\);/);
});

/* ============================================================
 *   Popup positioning: both popups must stay inside the viewport
 *   regardless of where their trigger sits in the row
 * ============================================================ */

test("Scan Recipe's popup is right-aligned to its trigger in the mobile primary row, not left-aligned off the edge", () => {
  // The shared .statusScanShortcutPanel default (left:0) is correct when
  // the trigger is near the left edge, but Scan Recipe is the rightmost
  // primary item on Next - left:0 there pushes a fixed-width popup off the
  // right of a narrow viewport.
  assert.match(styles, /\.splitsMobilePrimaryRow \.splitsScanShortcut \.statusScanShortcutPanel\{ left:auto; right:0; \}/);
});

/* ============================================================
 *   Regression: [hidden] must survive being placed inside the
 *   mobile primary row
 * ============================================================ */

test("Load Next's hidden attribute isn't silently defeated by the row's own display:flex rule", () => {
  // Found live: button.secondary{display:flex} is an author rule, which -
  // regardless of specificity - always beats the UA stylesheet's own
  // [hidden]{display:none}. Without an explicit override, an unplanned
  // Load Next Recipe would render as an empty, always-visible 4th slot.
  assert.match(styles, /\.splitsMobilePrimaryRow \[hidden\]\{ display:none!important; \}/);
});
