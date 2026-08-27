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

/* ============================================================
 *   Regression: Undo stranded alone between the fields row and the
 *   toolbar row once .recipeEditHistory moved out from inside
 *   .splitsEditRowSecondary (for the desktop pill merge)
 * ============================================================ */

test("on phone, Undo and the Clear selection/Empty cells/Reset Recipe/Rearrange toolbar share one flex-wrapped row instead of Undo sitting alone on its own line", () => {
  // #splitsBulkBar's three children (in DOM order: .splitsEditRowPrimary,
  // .recipeEditHistory, .splitsEditRowSecondary) are siblings, not nested -
  // .recipeEditHistory stopped being a descendant of .splitsEditRowSecondary
  // when Undo/Redo were pulled out for the desktop pill merge. A `display:
  // block` parent stacks every child on its own line regardless of that
  // history, which is exactly what stranded Undo alone between the fields
  // row and the toolbar row. display:flex + flex-wrap here, with Primary
  // forced to its own full-width line (flex:1 1 100%), lets Undo
  // (.recipeEditHistory's own flex:0 0 auto, styles.css base rule) and the
  // toolbar (flex:1 1 auto) flow onto the shared row after it.
  const start = styles.indexOf("@media (max-width:700px){");
  assert.notEqual(start, -1);
  const barStart = styles.indexOf("#splitsArea > .splitsBulkBar{", start);
  const barRule = styles.slice(barStart, styles.indexOf("}", barStart) + 1);
  assert.match(barRule, /display:flex;/);
  assert.match(barRule, /flex-wrap:wrap;/);
  assert.doesNotMatch(barRule, /display:block;/);

  const primaryStart = styles.indexOf("#splitsArea .splitsEditRowPrimary{", start);
  const primaryRule = styles.slice(primaryStart, styles.indexOf("}", primaryStart) + 1);
  assert.match(primaryRule, /flex:1 1 100%;/, "expected Primary to force its own full-width line, pushing Undo and the toolbar onto the next one together");

  const secondaryStart = styles.indexOf("#splitsArea .splitsEditRowSecondary{", start);
  const secondaryRule = styles.slice(secondaryStart, styles.indexOf("}", secondaryStart) + 1);
  assert.match(secondaryRule, /flex:1 1 auto;/);
  // The old margin-top/padding-top divider assumed this row always started
  // below Undo on its own line - no longer true once they can share one.
  assert.doesNotMatch(secondaryRule, /margin-top:8px|padding-top:8px/);
});

/* ============================================================
 *   Mobile Recipe toolbar cleanup: no enclosing panel, no
 *   shrink-driven overlap, lighter Clear/Empty/Rearrange
 * ============================================================ */

test("phone drops the enclosing bordered/filled panel the tablet/desktop toolbar keeps - the base card rule (border/background/radius) is explicitly zeroed, not just left unaddressed", () => {
  const start = styles.indexOf("@media (max-width:700px){");
  assert.notEqual(start, -1);
  const barStart = styles.indexOf("#splitsArea > .splitsBulkBar{", start);
  const barRule = styles.slice(barStart, styles.indexOf("}", barStart) + 1);
  assert.match(barRule, /border:0;/);
  assert.match(barRule, /border-radius:0;/);
  assert.match(barRule, /background:none;/);
  // The base (mobile-inclusive) card rule stays intact - tablet/desktop
  // still wants it, per recipe-edit-toolbar-pill.test.js.
  assert.match(styles, /\.splitsBulkBar\{[\s\S]*?border:1px solid var\(--row-border\);[\s\S]*?border-radius: var\(--radius-row\);[\s\S]*?background: var\(--readonly-bg\);/);
});

test("phone never fixes a height to solve the overlap - no max-height/height on #splitsBulkBar, just a flex-shrink floor", () => {
  const start = styles.indexOf("@media (max-width:700px){");
  const barStart = styles.indexOf("#splitsArea > .splitsBulkBar{", start);
  const barRule = styles.slice(barStart, styles.indexOf("}", barStart) + 1);
  assert.match(barRule, /flex-shrink:0;/, "expected a flex-shrink floor, not a fixed height, to stop this row from compressing");
  assert.doesNotMatch(barRule, /(?:^|[^-])height:|max-height:/, "no fixed/max height - the row should size to its own content");
});

test("only .splitsMobileLayerLayout (the matrix, which has its own internal scroll) is left shrinkable in the phone column - the toolbar and action tray both opt out", () => {
  const start = styles.indexOf("@media (max-width:700px){");
  const columnStart = styles.indexOf("#splitsBlock.mobile-active #splitsArea{", start);
  assert.notEqual(columnStart, -1);
  const columnRule = styles.slice(columnStart, styles.indexOf("}", columnStart) + 1);
  assert.match(columnRule, /flex-direction:column;/);
  const matrixStart = styles.indexOf("#splitsBlock.mobile-active #splitsArea > .splitsMobileLayerLayout{", start);
  const matrixRule = styles.slice(matrixStart, styles.indexOf("}", matrixStart) + 1);
  assert.match(matrixRule, /flex:0 1 auto;/, "expected the matrix to remain the one shrinkable child");
  const trayStart = styles.indexOf("#splitsBlock.mobile-active #splitsArea > .mobileRecipeActionTray{", start);
  const trayRule = styles.slice(trayStart, styles.indexOf("}", trayStart) + 1);
  assert.match(trayRule, /flex:0 0 auto;/);
});

test("Clear selection/Empty cells/Rearrange get a faint theme-tinted border and a whisper of background on phone, not desktop/tablet's stronger tinted-surface fill", () => {
  const start = styles.indexOf("@media (max-width:700px){");
  const sharedStart = styles.indexOf('#splitsArea .splitsEditRowSecondary :is(.bulkTextAction,button.danger){', start);
  const sharedRule = styles.slice(sharedStart, styles.indexOf("}", sharedStart) + 1);
  // Sizing/typography only now - no color left in the combined selector.
  assert.doesNotMatch(sharedRule, /border:|background:|color:/);
  const quietStart = styles.indexOf("#splitsArea .splitsEditRowSecondary .bulkTextAction{", start);
  const quietRule = styles.slice(quietStart, styles.indexOf("}", quietStart) + 1);
  assert.match(quietRule, /border:1px solid color-mix\(in srgb, var\(--recipe-pill-accent\) 25%, var\(--border\)\);/);
  assert.match(quietRule, /background:color-mix\(in srgb, var\(--recipe-pill-accent\) 10%, transparent\);/);
  // Lighter than desktop/tablet's 28%-strength fill (recipe-edit-toolbar-pill.test.js).
  assert.doesNotMatch(quietRule, /28%|45%/);
});

test("Reset Recipe keeps its own stronger red border/text on phone, unchanged in strength - it must still read as the row's one destructive action next to the three quieter buttons", () => {
  const start = styles.indexOf("@media (max-width:700px){");
  const dangerStart = styles.indexOf("#splitsArea .splitsEditRowSecondary button.danger{", start);
  const dangerRule = styles.slice(dangerStart, styles.indexOf("}", dangerStart) + 1);
  assert.match(dangerRule, /border:1\.5px solid color-mix\(in srgb, var\(--bad\) 55%, var\(--btn-secondary-border\)\);/);
  assert.match(dangerRule, /background:transparent;/);
  assert.match(dangerRule, /color:var\(--bad\);/);
});

test("Empty cells still dims via the shared :disabled rule when unavailable - untouched by the border/background split above", () => {
  assert.match(styles, /\.splitsEditRowSecondary \.bulkTextAction:disabled\{\s*\n\s*opacity: \.5;\s*\n\s*\}/);
});

test("Done keeps its filled primary treatment on phone - only Clear/Empty/Rearrange were asked to get quieter, not the view toggle", () => {
  assert.doesNotMatch(styles, /@media \(max-width:700px\)\{[\s\S]*?\.recipeViewToggle button\[data-recipe-view="edit"\]\{[^}]*background:\s*(?:none|transparent)/);
});

test("desktop/tablet toolbar sizing, positioning and colors are untouched by the phone-only changes above", () => {
  // The >=701px merged-row layout (margin-left:auto pill, flex:1 1 auto
  // secondary row, tinted-surface fill) still exists verbatim.
  assert.match(styles, /#splitsArea #splitsBulkBar \.splitsEditRowSecondary \.bulkTextAction,\s*\n\s*#splitsArea #splitsBulkBar \.splitsEditRowSecondary \.splitsRearrangeAction,\s*\n\s*\.splitsEditRowSecondary #resetAllSplits\.danger\{\s*\n\s*min-height: 40px;\s*\n\s*\}/);
  assert.match(styles, /\.splitsEditRowSecondary \.bulkTextAction,\s*\n\s*\.splitsEditRowSecondary \.splitsRearrangeAction\{[\s\S]*?border: 0;\s*\n\s*background: color-mix\(in srgb, var\(--recipe-pill-accent\) 28%, var\(--panel2\)\);\s*\n\s*color: var\(--text\);/);
});
