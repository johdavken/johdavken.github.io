"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
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

test("desktop's own tab strip and action row only exist when not on the compact mobile layout", () => {
  const editor = recipeEditor();
  assert.match(editor, /if \(!compactMobileRecipe\)\{\s*\n\s*area\.append\(recipeUtilityTabs\);\s*\n\s*area\.append\(toolbar\);\s*\n\s*\}/);
  assert.match(editor, /if \(!compactMobileRecipe\)\{\s*\n\s*area\.append\(modeBar\);\s*\n\s*\}/);
});

test("the mobile action row is built by moving the same real buttons, not rebuilding them - handlers stay exactly as wired", () => {
  const editor = recipeEditor();
  // Bulk edit is gone from the mobile row too - Edit view replaced it -
  // which buys back a slot in a row that was already full at four items.
  assert.match(editor, /mobilePrimaryRow\.append\(savedRecipesButton, rearrangeButton\);/);
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

test("Current's primary row is Recipes, Bulk edit, Rearrange, Load Next - only when a plan exists", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  const currentBranch = block.slice(block.indexOf("if (!isNextRecipePage()){"), block.indexOf("}else{"));
  assert.match(currentBranch, /if \(loadNextButton\)\{\s*\n\s*loadNextButton\.textContent = "Load Next";\s*\n\s*mobilePrimaryRow\.append\(loadNextButton\);\s*\n\s*\}/);
});

test("Next's primary row is Recipes, Bulk edit, Rearrange, Scan Recipe - promoted out of desktop-only", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  const nextBranch = block.slice(block.indexOf("}else{"), block.indexOf("mobilePrimaryRow.append(mobileMoreButton)"));
  assert.match(nextBranch, /scanRecipeButton\.classList\.remove\("rearrangeDesktopOnly", "recipeScanHideDesktop"\);/);
  assert.match(nextBranch, /mobilePrimaryRow\.append\(scanRecipeButton\);/);
});

test("desktop's own branch keeps Saved recipes as a role=tab in a role=tablist, controlled by aria-controls pointing at its real panel id, and relocates Rearrange into the Edit panel", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  const desktopBranch = block.slice(block.indexOf("}else{", block.indexOf("mobilePrimaryRow.append(mobileMoreButton)")));
  assert.match(desktopBranch, /recipeUtilityTabs\.setAttribute\("role", "tablist"\);/);
  assert.match(desktopBranch, /savedRecipesButton\.setAttribute\("role", "tab"\);/);
  assert.match(desktopBranch, /savedRecipesButton\.setAttribute\("aria-controls", savedRecipesPanel\.id\);/);
  assert.match(desktopBranch, /recipeUtilityTabs\.append\(savedRecipesButton\);/);
  // Bulk edit no longer exists as a desktop tab - Edit view replaced it -
  // so modeButton is never given tab semantics or appended here.
  assert.doesNotMatch(desktopBranch, /modeButton/);
  // Rearrange keeps its real element (and every handler already wired to
  // it); only its home moves, into the Edit panel's secondary row.
  assert.match(desktopBranch, /toolbar\.querySelector\("\.splitsEditRowSecondary"\)\?\.append\(rearrangeButton\);/);
  assert.match(app, /savedRecipesPanel\.id = "splitsSavedRecipesPanel";/);
  assert.match(app, /toolbar\.id = "splitsBulkBar";/);
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

test("primary-row items share equal width and never wrap - however many of them there are (3 on Next, 3 or 4 on Current)", () => {
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
