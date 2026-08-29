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
 *   Mobile folds the page actions up into the tab row: Scan + the page's
 *   Load action become icon-only buttons in #recipeHeaderActions, beside
 *   the icon tabs and the Edit/Done pencil. No bar below the matrix, and
 *   no Print on a phone.
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

/** The if(compactMobileRecipe){...}else{...} block that routes the Scan /
 *  Load buttons either into the mobile tab-row cluster or the desktop
 *  header pill - anchored on its own lead comment so the bare
 *  "if (compactMobileRecipe){" (which also matches earlier, unrelated
 *  branches) isn't picked up. */
function mobileVsDesktopBlock(editor){
  const start = editor.indexOf("// Mobile folds the page actions up into the tab row");
  const end = editor.indexOf("// Percentage problems are not printed here");
  assert.ok(start > -1 && end > start, "expected the mobile/desktop assembly block");
  return editor.slice(start, end);
}

function compactBranch(block){
  return block.slice(block.indexOf("if (compactMobileRecipe){"), block.indexOf("}else{"));
}

test("the mobile cluster is built by moving the same real buttons into #recipeHeaderActions, not rebuilding them", () => {
  const editor = recipeEditor();
  const compact = compactBranch(mobileVsDesktopBlock(editor));
  assert.match(compact, /scanRecipeButton\.classList\.remove\("rearrangeDesktopOnly", "recipeScanHideDesktop"\);/);
  assert.match(compact, /scanRecipeButton\.classList\.add\("mobileScanIconAction"\);/);
  assert.match(compact, /headerActions\?\.append\(scanRecipeButton\);/);
  // No lower bar any more, and Print is not part of the mobile cluster.
  assert.doesNotMatch(editor, /mobilePrimaryRow|splitsMobilePrimaryRow/);
  assert.doesNotMatch(compact, /printButton/);
  assert.doesNotMatch(editor, /savedRecipesButton/);
  assert.doesNotMatch(editor, /mobileMoreButton|mobileRecipeMore/);
});

test("Scan is appended ahead of the page's own Load slot", () => {
  const editor = recipeEditor();
  const compact = compactBranch(mobileVsDesktopBlock(editor));
  const scanIndex = compact.indexOf("headerActions?.append(scanRecipeButton);");
  const splitIndex = compact.indexOf("if (!isNextRecipePage()){");
  assert.ok(scanIndex > -1 && splitIndex > scanIndex);
});

test("Current's cluster gets Load Next (icon markup kept); Next's gets Load Current instead - both keyed to recipeHeaderMobileAction", () => {
  const editor = recipeEditor();
  const compact = compactBranch(mobileVsDesktopBlock(editor));
  const currentBranch = compact.slice(compact.indexOf("if (!isNextRecipePage()){"), compact.indexOf("}else if (loadCurrentButton){"));
  assert.match(currentBranch, /if \(loadNextButton\)\{\s*\n\s*loadNextButton\.classList\.add\("recipeHeaderMobileAction"\);\s*\n\s*headerActions\?\.append\(loadNextButton\);\s*\n\s*\}/);
  const nextBranch = compact.slice(compact.indexOf("}else if (loadCurrentButton){"));
  assert.match(nextBranch, /loadCurrentButton\.classList\.add\("recipeHeaderMobileAction"\);\s*\n\s*headerActions\?\.append\(loadCurrentButton\);/);
  // The Load buttons keep their SVG icon markup on mobile now - no
  // textContent reassignment stripping it back to plain text.
  assert.doesNotMatch(compact, /\.textContent = "Load Next"|\.textContent = "Load Current"/);
});

test("the accessible name on the Load buttons stays the full 'Load Next/Current Recipe'", () => {
  assert.match(app, /loadNextButton\.setAttribute\("aria-label", "Load Next Recipe"\);/);
  assert.match(app, /loadCurrentButton\.setAttribute\("aria-label", "Load Current Recipe"\);/);
  const editor = recipeEditor();
  assert.match(editor, /loadNextButton\.innerHTML = `<svg class="recipeActionIcon"[\s\S]*?Load Next Recipe`;/);
});

test("desktop keeps Recipe Book as a page tab and moves recipe actions (incl. Print) into the header pill", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  const desktopBranch = block.slice(block.indexOf("}else{"));
  assert.match(html, /id="recipePageTabSaved"[^>]*data-recipe-page="saved" hidden>/);
  assert.match(html, /<span class="recipeTabLabel">Recipe Book<\/span>/);
  assert.match(html, /id="recipeHeaderActions" role="group" aria-label="Recipe actions"/);
  assert.match(desktopBranch, /headerActions\?\.append\(printButton\);/);
  assert.doesNotMatch(desktopBranch, /recipeUtilityTabs/);
  assert.doesNotMatch(desktopBranch, /savedRecipesButton/);
  assert.doesNotMatch(desktopBranch, /modeButton/);
  assert.match(app, /savedRecipesPanel\.id = "splitsSavedRecipesPanel";/);
  assert.match(app, /toolbar\.id = "splitsBulkBar";/);
});

test("Rearrange keeps its real element, appended into the Edit panel's secondary row after the if/else block closes", () => {
  const editor = recipeEditor();
  const block = mobileVsDesktopBlock(editor);
  assert.match(block, /toolbar\.querySelector\("\.splitsEditRowSecondary"\)\?\.append\(rearrangeButton\);/);
  const desktopSplit = block.indexOf("}else{");
  const closingBrace = block.indexOf("\n      }\n", desktopSplit);
  assert.ok(closingBrace > desktopSplit);
  const appendIndex = block.indexOf('toolbar.querySelector(".splitsEditRowSecondary")?.append(rearrangeButton);');
  assert.ok(appendIndex > closingBrace, "the rearrangeButton append must sit after the if/else block closes, not inside either branch");
});

test("the mobile action tray no longer holds a primary row - only the rearrange context row (+ tracking bar)", () => {
  const editor = recipeEditor();
  assert.match(editor, /actionTray\.append\(mobileRearrangeContext\);/);
  assert.doesNotMatch(editor, /actionTray\.append\(mobilePrimaryRow/);
});

/* ============================================================
 *   The tab-row icon cluster styling (<=700px)
 * ============================================================ */

test("Scan and Load render as icon-only square buttons in #recipeHeaderActions on phone", () => {
  assert.match(styles, /#splitsBlock \.recipeHeaderActions > \.mobileScanIconAction > summary,\s*\n\s*#splitsBlock \.recipeHeaderActions > \.recipeHeaderMobileAction\{[\s\S]*?font-size:0;/);
  assert.match(styles, /#splitsBlock \.recipeHeaderActions \.recipeActionIcon\{\s*\n\s*display:block;/);
});

test("a hidden Load button in the cluster still collapses - [hidden] override present", () => {
  assert.match(styles, /#splitsBlock \.recipeHeaderRow \.recipeHeaderActions \[hidden\]\{ display:none!important; \}/);
});

test("the cluster is pulled left of the Edit/Done pencil with order:-1", () => {
  assert.match(styles, /#splitsBlock \.recipeHeaderRow \.recipeHeaderActions\{[\s\S]*?order:-1;/);
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
