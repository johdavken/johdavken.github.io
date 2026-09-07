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

test("the accessible name on the page-action buttons stays the full visible label", () => {
  // Both page-action buttons are named for the recipe they load.
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
  assert.match(block, /editSecondaryRow\?\.prepend\(rearrangeButton\);/);
  const desktopSplit = block.indexOf("}else{");
  const closingBrace = block.indexOf("\n      }\n", desktopSplit);
  assert.ok(closingBrace > desktopSplit);
  const placeIndex = block.indexOf("editSecondaryRow?.prepend(rearrangeButton);");
  assert.ok(placeIndex > closingBrace, "the rearrangeButton placement must sit after the if/else block closes, not inside either branch");
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
 *   ux-mobile-touch: the Scan / Load / Edit cluster and Apply become
 *   generous station-console keys on the compact Recipe screen. Bigger tap
 *   targets, same station-console visual language as desktop (the
 *   --btnstyle-* tokens), icons unchanged.
 * ============================================================ */

test("Scan and Load are ~48x44 station-console keys on phone (target grew, not the icon)", () => {
  assert.match(styles, /#splitsBlock \.recipeHeaderActions > \.mobileScanIconAction > summary,\s*\n\s*#splitsBlock \.recipeHeaderActions > \.recipeHeaderMobileAction\{[\s\S]*?width:48px;[\s\S]*?min-height:44px;[\s\S]*?background:var\(--btnstyle-surface\);[\s\S]*?box-shadow:0 1px 0 var\(--btnstyle-edge\);/);
  // The glyph inside was untouched by this pass; ux-mobile-update1 later took
  // it 16px -> 20px, still without resizing the key.
  assert.match(styles, /#splitsBlock \.recipeHeaderActions \.recipeActionIcon\{[\s\S]*?display:block;[\s\S]*?width:20px;/);
});

test("the three console keys sit ~7px apart, not as a segmented group", () => {
  assert.match(styles, /#splitsBlock \.recipeHeaderRow #recipeHeaderActionPill\{ gap:7px; \}/);
  assert.match(styles, /#splitsBlock \.recipeHeaderRow \.recipeHeaderActions\{[\s\S]*?gap:7px;/);
});

test("the Edit pencil is a 48x44 square console key that inverts (does not resize) when latched", () => {
  assert.match(styles, /#splitsBlock #recipeHeaderActionPill \.recipeViewToggle button\[data-recipe-view="edit"\],[\s\S]*?min-width:48px;[\s\S]*?min-height:44px;[\s\S]*?border-radius:var\(--control-radius\);[\s\S]*?background:var\(--btnstyle-surface\);/);
  // Latched = the inverted console key, size unchanged so it does not move.
  assert.match(styles, /#splitsBlock #recipeHeaderActionPill \.recipeViewToggle button\[data-recipe-view="edit"\]\[aria-pressed="true"\],[\s\S]*?\{\s*\n[\s\S]*?background:var\(--btnstyle-ink\);\s*\n\s*color:var\(--panel\);/);
});

test("Apply on the compact Recipe screen is a 48px station-console key with quiet-disabled / armed-enabled states", () => {
  assert.match(styles, /#splitsArea #splitsBulkBar #applyBulkSplit\{[\s\S]*?min-height:48px;[\s\S]*?background:var\(--btnstyle-surface\);[\s\S]*?text-transform:uppercase;/);
  assert.match(styles, /#splitsArea #splitsBulkBar #applyBulkSplit:disabled\{[\s\S]*?color:var\(--muted\);[\s\S]*?box-shadow:none;/);
  assert.match(styles, /#splitsArea #splitsBulkBar #applyBulkSplit:not\(:disabled\)\{[\s\S]*?var\(--btnstyle-accent\)/);
});

/* ============================================================
 *   Mobile Recipe toolbar: the shared history and structural actions flatten
 *   into one six-control icon rail. It must not wrap on narrow phones.
 * ============================================================ */

test("on phone, Undo/Redo and the four Recipe actions form one compact icon toolbar", () => {
  const start = styles.indexOf("@media (max-width:700px){");
  assert.notEqual(start, -1);
  const compact = styles.slice(start, styles.indexOf("\n}\n\n@media (max-width: 720px)", start));
  assert.match(compact, /#splitsArea > #splitsBulkBar \.recipeEditHistory,[\s\S]*?display:contents;/);
  assert.match(compact, /#recipeUndo\{ order:1; \}[\s\S]*?#recipeRedo\{ order:2; \}[\s\S]*?#clearSplitSelection\{ order:3; \}[\s\S]*?#clearSelectedCells\{ order:4; \}[\s\S]*?#copySelectedCells\{ order:5; \}[\s\S]*?#pasteSelectedCells\{ order:6; \}[\s\S]*?\.splitsRearrangeAction\{ order:7; \}[\s\S]*?#resetAllSplits\{[\s\S]*?order:8;/);
  // The eight keys flex with the panel width, capped at 46px (their old
  // fixed size), and never wrap - flex-basis:0 + min-width:0 keeps their
  // combined minimum far under any viewport. Height stays fixed.
  assert.match(compact, /:is\(\.recipeHistoryAction[\s\S]*?\{[\s\S]*?flex:1 1 0;[\s\S]*?min-width:0;[\s\S]*?max-width:46px;[\s\S]*?height:46px;/);
  assert.match(compact, /#resetAllSplits\{[\s\S]*?flex:1 1 0;[\s\S]*?max-width:46px;[\s\S]*?border-left-color:/);
  assert.match(compact, /#splitsArea > #splitsBulkBar\{[\s\S]*?justify-content:space-between;/);
  assert.match(compact, /\.recipeEditActionIcon\{ display:block; \}/);
  assert.match(compact, /\.splitsEditRowSecondary button > span\{ display:none; \}/);

  const editor = recipeEditor();
  for (const [id, label] of [
    ["recipeUndo", "Undo recipe change"],
    ["recipeRedo", "Redo recipe change"],
    ["clearSplitSelection", "Clear selection"],
    ["clearSelectedCells", "Empty selected cells"],
    ["resetAllSplits", "Reset recipe"]
  ]) assert.match(editor, new RegExp(`id="${id}"[^>]*aria-label="${label}"[^>]*`));
  assert.match(editor, /rearrangeButton\.setAttribute\("aria-label", hopperRearrangement\?\.active \? "Done rearranging recipe" : "Rearrange recipe"\);/);
});

/* ============================================================
 *   ux-mobile-touch2: per-layer "Match X" is dropped on the compact Recipe
 *   screen; the Edit toolbar gains Copy hoppers / Paste hoppers, phone-only,
 *   sitting between Empty cells and Rearrange.
 * ============================================================ */

test("the per-layer Match X button is hidden on the compact Recipe grid (desktop/tablet keep it)", () => {
  assert.match(styles, /\.splitsMatrix\.compactMobileRecipe \.splitCopyBtn\{ display:none; \}/);
  // The desktop layer-match operation is untouched.
  const editor = recipeEditor();
  assert.match(editor, /copyButton\.textContent = `Match \$\{copyFrom\}`;/);
  assert.match(editor, /else copyLayer\(copyFrom, L\.name\);/);
});

test("Copy hoppers / Paste hoppers render between Empty cells and Reset, phone-only, disabled until usable", () => {
  const editor = recipeEditor();
  assert.match(editor, /id="clearSelectedCells"[\s\S]*?id="copySelectedCells"[\s\S]*?id="pasteSelectedCells"[\s\S]*?id="resetAllSplits"/);
  assert.match(editor, /id="copySelectedCells"[^>]*class="bulkTextAction recipeCellClipboardAction"[^>]*aria-label="Copy selected hoppers"[^>]*disabled/);
  assert.match(editor, /id="pasteSelectedCells"[^>]*class="bulkTextAction recipeCellClipboardAction"[^>]*aria-label="Paste hoppers"[^>]*disabled/);
  // Both carry the shared icon so the compact rail renders them icon-only.
  assert.match(editor, /id="copySelectedCells"[\s\S]*?<svg class="recipeEditActionIcon"[\s\S]*?<span>Copy hoppers<\/span>/);
  assert.match(editor, /id="pasteSelectedCells"[\s\S]*?<svg class="recipeEditActionIcon"[\s\S]*?<span>Paste hoppers<\/span>/);
  // Phone-only: hidden by default, re-shown only inside the compact block.
  assert.match(styles, /#splitsArea #splitsBulkBar \.recipeCellClipboardAction\{ display:none; \}/);
  assert.match(styles, /#splitsArea > #splitsBulkBar #copySelectedCells\{ order:5; \}/);
  assert.match(styles, /#splitsArea > #splitsBulkBar #pasteSelectedCells\{ order:6; \}/);
});

test("Copy snapshots the selected hoppers; Paste writes the buffer back positionally as one undo step", () => {
  const editor = recipeEditor();
  // Module-scoped runtime buffer, not persisted.
  assert.match(app, /let recipeCellClipboard = null;/);
  // Copy: ordered by layer then hopper, captures resinName + pct.
  assert.match(editor, /function copySelectedHoppers\(\)\{[\s\S]*?recipeCellClipboard = keys\.map\(key=>\{[\s\S]*?resinName: normName\([\s\S]*?pct: [\s\S]*?clampNum/);
  // Paste: positional, clamped to the shorter of buffer / selection.
  assert.match(editor, /function pasteHoppersIntoSelection\(\)\{[\s\S]*?Math\.min\(keys\.length, recipeCellClipboard\.length\)/);
  // Paste is one undo step and repaints each touched layer's automatic H1.
  assert.match(editor, /function pasteHoppersIntoSelection\(\)\{[\s\S]*?snapshotRecipeEdit\(\)[\s\S]*?recomputeAutoH1\(L\)[\s\S]*?recordRecipeEdit\(historyBefore\)/);
  // Wiring + enable/disable rules.
  assert.match(editor, /copyCellsButton\?\.addEventListener\("click", copySelectedHoppers\);/);
  assert.match(editor, /pasteCellsButton\?\.addEventListener\("click", pasteHoppersIntoSelection\);/);
  assert.match(editor, /copyCellsButton\.disabled = rearrangingNow \|\| selected\.size === 0;/);
  assert.match(editor, /pasteCellsButton\.disabled = rearrangingNow \|\| selected\.size === 0 \|\| !\(recipeCellClipboard && recipeCellClipboard\.length\);/);
});

test("Rearrange latches on the button itself while the mode is active - the Cancel/Done row below the matrix is not the only cue", () => {
  const editor = recipeEditor();
  assert.match(editor, /rearrangeButton\.classList\.toggle\("active", !!hopperRearrangement\?\.active\);/);
  assert.match(editor, /rearrangeButton\.setAttribute\("aria-pressed", String\(!!hopperRearrangement\?\.active\)\);/);
  // Two groups so the left/right arrows can travel independently. Same
  // paths as the previous single-path glyph.
  assert.match(editor, /<g class="rearrangeArrowDown"><path d="M8 4v16m0 0-3-3m3 3 3-3"\/><\/g><g class="rearrangeArrowUp"><path d="M16 20V4m0 0-3 3m3-3 3 3"\/><\/g>/);
  // The label stays (visible on tablet/desktop); phone hides it with
  // font-size:0, so motion has to carry the state. It reads just "Done" now
  // that Cancel sits beside it and the pair needs no disambiguation.
  assert.match(editor, /hopperRearrangement\?\.active\?"Done":"Rearrange"/);

  const start = styles.indexOf("@media (max-width:700px){");
  const compact = styles.slice(start, styles.indexOf("\n}\n\n@media (max-width: 720px)", start));
  assert.match(compact, /animation:rearrangeOpposingDown 1\.8s ease-in-out infinite/);
  assert.match(compact, /animation:rearrangeOpposingUp 1\.8s ease-in-out infinite/);
  assert.match(compact, /@keyframes rearrangeOpposingDown\{[\s\S]*?translateY\(-14%\)/);
  assert.match(compact, /@keyframes rearrangeOpposingUp\{[\s\S]*?translateY\(14%\)/);
  // Default active state is unfilled - motion is the on-cue, not a latch.
  const reduceStart = compact.indexOf("@media (prefers-reduced-motion:reduce)");
  assert.notEqual(reduceStart, -1);
  const beforeReduce = compact.slice(0, reduceStart);
  assert.match(beforeReduce, /:is\(\.splitsRearrangeAction\.active, \.splitsRearrangeAction\[aria-pressed="true"\]\)[\s\S]*?background:transparent;/);
  assert.doesNotMatch(beforeReduce, /splitsRearrangeAction\.active[\s\S]{0,400}55%/);
  // Without motion, the 55% fill comes back so the mode still reads as on.
  const reduce = compact.slice(reduceStart);
  assert.match(reduce, /animation:none/);
  assert.match(reduce, /background:color-mix\(in srgb, var\(--recipe-pill-accent\) 55%, var\(--panel2\)\);/);
  // Idle Clear/Empty/Rearrange stay the quieter 10% tint.
  const quietStart = compact.indexOf("#splitsArea .splitsEditRowSecondary .bulkTextAction{");
  const quietRule = compact.slice(quietStart, compact.indexOf("}", quietStart) + 1);
  assert.match(quietRule, /background:color-mix\(in srgb, var\(--recipe-pill-accent\) 10%, transparent\);/);
  assert.doesNotMatch(quietRule, /55%/);
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

test("phone Recipe matrices stay in document flow instead of becoming a shrinkable internal scroll region", () => {
  const start = styles.indexOf("@media (max-width:700px){");
  const blockEnd = styles.indexOf("\n}\n\n@media (max-width: 720px)", start);
  const block = styles.slice(start, blockEnd);
  assert.doesNotMatch(block, /#splitsBlock\.mobile-active #splitsArea\{[^}]*flex-direction:column/);
  assert.doesNotMatch(block, /#splitsBlock\.mobile-active \.splitsMobileLayerLayout \.splitsMatrixScroll\{[^}]*overflow-y:\s*auto/);
  assert.match(block, /\.splitsMatrixScroll\{\s*\n\s*height:auto;\s*\n\s*min-height:auto;[\s\S]*?overflow:visible;/);
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
  assert.match(styles, /\.splitsEditRowSecondary \.bulkTextAction,\s*\n\s*\.splitsEditRowSecondary \.splitsRearrangeAction,\s*\n\s*\.splitsEditRowSecondary \.recipeHistoryAction\{[\s\S]*?border: 0;\s*\n\s*background: color-mix\(in srgb, var\(--recipe-pill-accent\) 28%, var\(--panel2\)\);\s*\n\s*color: var\(--text\);/);
});
