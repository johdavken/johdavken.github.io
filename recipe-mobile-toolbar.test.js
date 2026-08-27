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
  // rearrangeButton append further down renderSplitsArea). Recipe Book
  // moved out entirely, into the shared tab row (see the desktop-tab
  // test below) - there is no separate savedRecipesButton any more, and
  // Clear Tracking/More are both gone too (see recipe-clear-selection.test.js
  // and recipe-mobile-scan-action.test.js).
  assert.doesNotMatch(editor, /savedRecipesButton/);
  assert.match(editor, /mobilePrimaryRow\.append\(printButton\);/);
  assert.doesNotMatch(editor, /mobileMoreButton|mobileRecipeMore/);
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

test("Scan is promoted and appended once, shared by both pages, before either page's own Load slot", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  const compactBlock = block.slice(block.indexOf("if (compactMobileRecipe){"), block.indexOf("}else{", block.indexOf("mobilePrimaryRow.append(printButton)")));
  assert.match(compactBlock, /scanRecipeButton\.classList\.remove\("rearrangeDesktopOnly", "recipeScanHideDesktop"\);/);
  assert.match(compactBlock, /scanRecipeButton\.classList\.add\("mobileScanIconAction"\);/);
  assert.match(compactBlock, /mobilePrimaryRow\.append\(scanRecipeButton\);/);
  // Appended once, ahead of the if(!isNextRecipePage()) split below it -
  // not duplicated per page.
  const scanIndex = compactBlock.indexOf("mobilePrimaryRow.append(scanRecipeButton);");
  const splitIndex = compactBlock.indexOf("if (!isNextRecipePage()){");
  assert.ok(scanIndex > -1 && splitIndex > scanIndex);
});

test("Current's primary row includes Load Next - only when a plan exists; Next's includes Load Current instead", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  const currentBranch = block.slice(block.indexOf("if (!isNextRecipePage()){"), block.indexOf("}else if (loadCurrentButton){"));
  assert.match(currentBranch, /if \(loadNextButton\)\{\s*\n\s*loadNextButton\.textContent = "Load Next";\s*\n\s*mobilePrimaryRow\.append\(loadNextButton\);\s*\n\s*\}/);
  const nextBranch = block.slice(block.indexOf("}else if (loadCurrentButton){"), block.indexOf("printButton.classList.remove(\"rearrangeDesktopOnly\", \"recipeActionTertiary\");"));
  assert.match(nextBranch, /loadCurrentButton\.textContent = "Load Current";\s*\n\s*mobilePrimaryRow\.append\(loadCurrentButton\);/);
});

test("desktop uses Recipe Book as a page tab and moves recipe actions into the header", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  const desktopBranch = block.slice(block.indexOf("}else{", block.indexOf("mobilePrimaryRow.append(printButton)")));
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
  const ifDesktopSplit = block.indexOf("}else{", block.indexOf("mobilePrimaryRow.append(printButton)"));
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

test("primary-row items share equal width by default and never wrap - however many of them there are (up to 3, on both Current and Next now)", () => {
  const rule = styles.slice(styles.indexOf(".splitsMobilePrimaryRow{"), styles.indexOf("}", styles.indexOf(".splitsMobilePrimaryRow{")));
  assert.match(rule, /display:flex;/);
  const childRule = styles.slice(styles.indexOf(".splitsMobilePrimaryRow > \\*{"), styles.indexOf("}", styles.indexOf(".splitsMobilePrimaryRow > *{")) + 1);
  assert.match(styles, /\.splitsMobilePrimaryRow > \*\{ flex:1 1 0; min-width:0; \}/);
  // Scan/Print's icon slots opt out of that equal split with their own
  // fixed-width override - see recipe-mobile-scan-action.test.js.
  assert.match(styles, /\.splitsMobilePrimaryRow > \.mobileScanIconAction,\s*\n\s*\.splitsMobilePrimaryRow > \.mobilePrintIconAction\{\s*\n\s*flex:0 0 42px;/);
});

test("no overflow:hidden on the mobile action row - it would clip Scan Recipe's popup, which must escape the row's own bounds", () => {
  const strip = block => block.replace(/\/\*[\s\S]*?\*\//g, "");
  const primary = strip(styles.slice(styles.indexOf(".splitsMobilePrimaryRow{"), styles.indexOf(".splitsMobilePrimaryRow > *{")));
  assert.doesNotMatch(primary, /overflow:hidden/);
});

test("the row is one compact outlined surface regardless of how many items it holds", () => {
  const primary = styles.slice(styles.indexOf(".splitsMobilePrimaryRow{"), styles.indexOf("}", styles.indexOf(".splitsMobilePrimaryRow{")));
  assert.match(primary, /border:1px solid var\(--row-border-2\);/);
  assert.match(primary, /border-radius:var\(--control-radius\);/);
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
