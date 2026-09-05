"use strict";

// The values/Apply row and the toolbar row used to stack; merged into one
// row here: [Resin][%][Apply] (left group) - [Undo][Redo] (fixed-size,
// sits right after the left group) - a flexible gap (margin-left:auto on
// the pill) - [Clear][Empty][Reset][Rearrange] (right group, pinned to the
// far-right edge). Nothing on this row shrinks to fit anymore - every
// control keeps a deliberate, explicit min-width/min-height (~40px tall
// throughout) instead of compressing, per an explicit redesign spec after
// the earlier shrink-to-fit approach broke on a narrow desktop window
// (pointer:fine, not pointer:coarse - see the grid-vs-flex history below).
//
// Undo/Redo were pulled out of the pill earlier (they "looked odd" joined
// into it) and live as plain, fixed-size (38px) circular icon buttons
// between the left group and the pill - not joined to either. Clear
// selection is the pill's leftmost (and therefore rounded) segment as a
// result - see recipe-header-action-pill.test.js for the
// #recipeHeaderActionPill pattern this pill still follows for everything
// else (Reset Recipe's red fill, hairline dividers, no-:has()-needed
// since nothing here is ever [hidden]).
//
// Bugs caught and fixed while building this, worth guarding against
// regressing:
// 1. #splitsArea > .splitsBulkBar (styles.css, pre-existing) is what made
//    the toolbar a block box in the first place, specifically for "two
//    stacked rows that each manage their own flex flow" - the exact layout
//    being replaced. #splitsArea #splitsBulkBar (two real ids) beats its
//    (1,1,0) specificity outright rather than tying it.
// 2. Undo/Redo still need .recipeHistoryAction's padding:0 fix from an
//    earlier round (data-button-size="small"'s own padding rule outranks a
//    plain class), just relocated to their #splitsBulkBar-scoped home.
// 3. The mobile Redo-hiding rule required #recipeRedo to be a descendant of
//    .splitsEditRowSecondary - it no longer is, so it needed repointing to
//    a bare #recipeRedo (a unique id needs no ancestor scoping).
// 4. A narrow *desktop* browser window (a mouse, so pointer:fine) never
//    matches the pointer:coarse tablet-density block - .splitsEditRowPrimary
//    stayed a wrapping flex row there (Apply wrapping to its own line,
//    Percentage's input overlapping its own "%" suffix) until its layout
//    moved into the shared >=701px block, reachable regardless of pointer.
// 5. Selecting cells used to grow Apply's label to "Apply to N hoppers",
//    which - on this row's now-fixed-width layout - pushed the whole
//    toolbar past its available width. Apply's label is fixed now;
//    selection count is still announced via #splitSelectionStatus.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");

function pillBlock(){
  const start = styles.indexOf("#splitsArea #splitsBulkBar .splitsEditRowSecondary{");
  assert.notEqual(start, -1, "expected the edit-toolbar pill rule");
  return styles.slice(start, styles.indexOf("\n}\n\n@media (min-width: 901px)", start));
}

test("#splitsBulkBar becomes the flex row that merges values/Apply and the toolbar - #splitsArea #splitsBulkBar (two real ids) beats #splitsArea > .splitsBulkBar's (1,1,0) specificity, which made it a block box for the old stacked-rows layout", () => {
  assert.match(styles, /#splitsArea #splitsBulkBar\{\s*\n\s*display: flex;[\s\S]*?flex-wrap: wrap;\s*\n\s*align-items: center;\s*\n\s*gap: 8px;\s*\n\s*border: 0;\s*\n\s*border-radius: 0;\s*\n\s*background: transparent;[\s\S]*?padding-inline: 0;\s*\n\s*\}/);
  assert.match(styles, /#splitsArea > \.splitsBulkBar\{ order: -1; display: block;/);
});

test("the bar wraps between its groups (not nowrap) as the last resort, and carries no horizontal padding - the padding was invisible while the bar had a card background, but once transparent it inset the right action pill from the rail, so the Edit toolbar's right edge no longer matched the header's and the grid's", () => {
  // wrap is the fallback AFTER shrinking: each group keeps its own nowrap, so
  // a group never breaks apart internally - only the pill drops to line 2.
  assert.match(styles, /#splitsArea #splitsBulkBar\{[\s\S]*?flex-wrap: wrap;/);
  assert.match(styles, /#splitsArea #splitsBulkBar\{[\s\S]*?padding-inline: 0;/);
  assert.match(styles, /#splitsArea #splitsBulkBar \.splitsEditRowPrimary\{[\s\S]*?flex-wrap: nowrap;/);
});

test("the merged row drops the base .splitsBulkBar card (border/background) instead of inheriting it - on a real tablet the outer rectangle behind just Resin/%/Apply/Undo/Redo read as a mismatched box next to the pill's own rounded shape", () => {
  assert.match(styles, /border: 1px solid var\(--row-border\);\s*\n\s*border-radius: var\(--radius-row\);\s*\n\s*background: var\(--readonly-bg\);\s*\n\}/, "expected the base card rule (mobile's stacked layout still wants it)");
  assert.match(styles, /#splitsArea #splitsBulkBar\{[\s\S]*?border: 0;\s*\n\s*border-radius: 0;\s*\n\s*background: transparent;/);
});

test(".splitsEditRowPrimary (Resin/%/Apply) is the row's designated shrink absorber, advertising min-content so the bar shrinks it BEFORE wrapping - a flex container picks line breaks from each item's hypothetical size (flex-basis) before flex-shrink runs, so the old flex:0 0 auto advertised max-content (~416px) and the pill wrapped to a second line while the fields still had room to give. It is still capped so it never grows past the spec's 180/150/70 layout on a wide desktop", () => {
  assert.match(styles, /#splitsArea #splitsBulkBar \.splitsEditRowPrimary\{\s*\n\s*display: flex;\s*\n\s*flex-wrap: nowrap;\s*\n\s*align-items: center;[\s\S]*?flex: 1 1 min-content;\s*\n\s*max-width: 416px;\s*\n\s*min-width: 0;\s*\n\s*gap: 8px;\s*\n\s*\}/);
  // max-content would NOT serve as the cap: each field's own max-content
  // (~150/125) is below its preferred width, so the group would settle
  // narrower than the spec even with room to spare.
  assert.doesNotMatch(styles, /#splitsArea #splitsBulkBar \.splitsEditRowPrimary\{[\s\S]*?max-width: max-content;/);
});

test("Primary's gap is double-id guaranteed, not left to tie against .splitsEditRow{gap:...} overrides in the pointer:coarse and max-height:800px blocks - a real tablet that's also short/landscape matches both, and the later one silently shrank this row's gap from 8px to 6px before the fix", () => {
  assert.match(styles, /#splitsArea \.splitsEditRow\{ gap:6px 8px; \}/, "expected the pointer:coarse block's own .splitsEditRow gap override to still exist");
  assert.match(styles, /#splitsArea \.splitsEditRow\{ gap:3px 6px; \}/, "expected the max-height:800px block's own .splitsEditRow gap override to still exist");
  assert.doesNotMatch(styles, /(?<!#splitsBulkBar )\.splitsEditRowPrimary\{[^}]*gap: 8px;[^}]*\}/, "Primary's own gap rule must not appear at single-id specificity, or it ties (and can lose) against the two overrides above");
});

test("the pill (not Undo/Redo) carries margin-left:auto - the flexible spacer sits between Undo/Redo and the pill, so Undo/Redo land right after Apply instead of being dragged to the far-right edge with the pill", () => {
  const block = pillBlock();
  assert.match(block, /margin-left: auto;/);
  assert.doesNotMatch(styles, /\.recipeEditHistory\{\s*\n\s*flex-shrink: 0;\s*\n\s*margin-left: auto;/);
  assert.match(styles, /\.recipeEditHistory\{\s*\n\s*flex-shrink: 0;\s*\n\s*\}/);
});

test("Undo/Redo are a fixed 38x38px circle (was 26px, sized for an earlier 28px row target) and keep the padding:0 fix at their #splitsBulkBar-scoped home", () => {
  assert.match(styles, /#splitsBulkBar \.recipeHistoryAction\{\s*\n\s*width: 38px;\s*\n\s*min-width: 38px;\s*\n\s*height: 38px;\s*\n\s*min-height: 38px;\s*\n\s*padding: 0;\s*\n\s*\}/);
});

test("every control on this row shares one consolidated ~40px min-height rule - the single source of truth, superseding the three separate pointer/height-gated 28px copies this used to need", () => {
  assert.match(styles, /#splitsArea #splitsBulkBar \.splitsEditRowPrimary > button,\s*\n\s*#splitsArea #splitsBulkBar \.splitsEditRowSecondary \.bulkTextAction,\s*\n\s*#splitsArea #splitsBulkBar \.splitsEditRowSecondary \.splitsRearrangeAction,\s*\n\s*\.splitsEditRowSecondary #resetAllSplits\.danger\{\s*\n\s*min-height: 40px;\s*\n\s*\}/);
});

test("Resin/Percentage fields get an explicit height:40px (not left to min-height alone, which - combined with the field's own padding - summed to 52px) and tightened padding so label+input center inside cleanly", () => {
  assert.match(styles, /#splitsArea #splitsBulkBar \.splitsEditRowPrimary > \.splitsBulkField\{\s*\n\s*height: 40px;\s*\n\s*padding: 0 8px;\s*\n\s*\}/);
});

test("explicit widths match the redesign spec: Resin 180px, % 170px, Apply 70px, Clear/Empty 70px, Reset 65px, Rearrange 95px", () => {
  // Resin/% hold the spec's 180/170 as flex-basis + max-width rather than as
  // min-width. As a min-width they were an absolute floor that made the row
  // unable to fit a panel narrower than its own content - which is what
  // pushed the Edit toolbar past the Recipe rail and made opening Edit look
  // like it widened the panel. The min-widths that remain are readability
  // floors (measured: below these the label and input stop fitting side by
  // side), far below the preferred size. The % floor (and its own inner
  // grid track, .splitsBulkFieldPct's grid-template-columns) was widened
  // from 96/72px to 130/96px after the narrower floor let the field shrink
  // to a width that clipped its own "No change" placeholder on a real
  // touch-shell tablet (860-930px wide) - 72px left no margin over the
  // placeholder's own measured width in a bold 14px system-ui fallback.
  assert.match(styles, /#splitsArea #splitsBulkBar \.splitsEditRowPrimary > label\[for="bulkResinName"\]\{\s*\n\s*flex: 1 1 180px;\s*\n\s*min-width: 120px;\s*\n\s*max-width: 180px;\s*\n\s*\}/);
  assert.match(styles, /#splitsArea #splitsBulkBar \.splitsEditRowPrimary > \.splitsBulkFieldPct\{\s*\n\s*flex: 1 1 170px;\s*\n\s*min-width: 130px;\s*\n\s*max-width: 170px;\s*\n\s*\}/);
  assert.match(styles, /#splitsArea #splitsBulkBar \.splitsEditRowPrimary > button\{\s*\n\s*min-width: 70px;\s*\n\s*\}/);
  assert.match(styles, /#splitsArea #splitsBulkBar #clearSplitSelection\{ min-width: 70px; \}/);
  assert.match(styles, /#splitsArea #splitsBulkBar #clearSelectedCells\{ min-width: 70px; \}/);
  assert.match(styles, /#splitsArea #splitsBulkBar #resetAllSplits\{ min-width: 65px; \}/);
  assert.match(styles, /#splitsArea #splitsBulkBar \.splitsRearrangeAction\{ min-width: 95px; \}/);
});

test("Undo/Redo moved out of .splitsEditRowSecondary in the markup - .recipeEditHistory sits between the values/Apply row and the pill row as its own sibling, not nested inside the pill", () => {
  const start = app.indexOf("    function renderSplitsArea(){");
  const end = app.indexOf("    function renderResinCalculator(){", start);
  const body = app.slice(start, end);
  const primaryStart = body.indexOf('<div class="splitsEditRow splitsEditRowPrimary">');
  const historyStart = body.indexOf('<div class="recipeEditHistory" role="group" aria-label="Recipe edit history">');
  const secondaryStart = body.indexOf('<div class="splitsEditRow splitsEditRowSecondary">');
  assert.ok(primaryStart > -1 && historyStart > primaryStart && secondaryStart > historyStart);
  const secondaryRow = body.slice(secondaryStart, body.indexOf("</div>\n      `;", secondaryStart));
  assert.doesNotMatch(secondaryRow, /recipeEditHistory/);
});

test("Undo/Redo are no longer part of the pill's gradient/hover/disabled/divider rules - they fall back to their own original circular, transparent, un-joined look", () => {
  assert.doesNotMatch(styles, /\.splitsEditRowSecondary \.recipeHistoryAction,/);
  assert.doesNotMatch(styles, /\.recipeEditHistory > \.recipeHistoryAction:not\(:last-child\)/);
});

test("the mobile history group is hidden as a whole, omitting both Undo and Redo without changing desktop/tablet history", () => {
  assert.match(styles, /#splitsArea \.recipeEditHistory\{\s*\n\s*display:none;\s*\n\s*\}/);
  assert.doesNotMatch(styles, /#splitsArea \.splitsEditRowSecondary #recipeRedo/);
});

test("every non-danger pill segment (Clear selection/Empty cells/Rearrange) shares the identical tinted-surface fill the header pill uses, matching Print Recipe's font treatment", () => {
  assert.match(styles, /\.splitsEditRowSecondary \.bulkTextAction,\s*\n\s*\.splitsEditRowSecondary \.splitsRearrangeAction\{[\s\S]*?border: 0;\s*\n\s*background: color-mix\(in srgb, var\(--recipe-pill-accent\) 28%, var\(--panel2\)\);\s*\n\s*color: var\(--text\);[\s\S]*?font-size: var\(--font-small\);\s*\n\s*text-transform: none;\s*\n\s*letter-spacing: normal;/);
});

test("desktop/tablet Apply uses the same filled non-destructive action styling as Empty, while mobile retains its compact secondary treatment", () => {
  assert.match(styles, /#splitsArea #splitsBulkBar #applyBulkSplit\{\s*\n\s*border:0;\s*\n\s*border-radius:var\(--control-radius\);\s*\n\s*background:color-mix\(in srgb,var\(--recipe-pill-accent\) 28%,var\(--panel2\)\);\s*\n\s*color:var\(--text\);\s*\n\s*font-size:var\(--font-small\);\s*\n\s*text-transform:none;\s*\n\s*letter-spacing:normal;\s*\n\s*\}/);
});

test("the fill/color/radius rule reaches #clearSplitSelection via a descendant combinator, not a direct-child one that would skip it - it's now the pill's leftmost segment", () => {
  assert.doesNotMatch(styles, /\.splitsEditRowSecondary > \.bulkTextAction\{\s*\n\s*border-radius: var\(--control-radius\);/);
});

test("Reset Recipe keeps a red-tinted fill - same var(--recipe-pill-danger) token, not the shared blue var(--recipe-pill-accent)", () => {
  // .splitsEditRowSecondary #resetAllSplits.danger{ also appears earlier as
  // one of several selectors in the plain min-height:40px sizing rule -
  // anchor on the fill rule's own border-radius declaration to land on the
  // right occurrence.
  const landmark = styles.indexOf(".splitsEditRowSecondary #resetAllSplits.danger{\n    border-radius: var(--control-radius);");
  assert.notEqual(landmark, -1, "expected the danger fill rule");
  const resetRule = styles.slice(landmark, styles.indexOf("background: color-mix(in srgb, var(--recipe-pill-danger)", landmark) + 250);
  assert.match(resetRule, /border: 0;\s*\n\s*background: color-mix\(in srgb, var\(--recipe-pill-danger\) 28%, var\(--panel2\)\);\s*\n\s*color: var\(--text\);/);
  assert.doesNotMatch(resetRule, /var\(--recipe-pill-accent\)|var\(--focus-border\)/);
});

test("neither pill segment fill is a gradient anymore - a vertical gradient looked good in some themes but read as a mismatched glossy skin in others; a tinted color-mix(var(--recipe-pill-accent)/var(--recipe-pill-danger), var(--panel2)) fill (styles.css :root, retuned per-theme) replaced both - see recipe-pill-theme-colors.test.js", () => {
  const block = pillBlock();
  assert.doesNotMatch(block, /linear-gradient/);
});

test("disabled segments dim to the shared .5 opacity", () => {
  assert.match(styles, /\.splitsEditRowSecondary \.bulkTextAction:disabled\{\s*\n\s*opacity: \.5;\s*\n\s*\}/);
});

test("Rearrange latches to the same 55% accent fill Edit/Done uses, including on hover so the idle 28% hover rule cannot drop it back", () => {
  const block = pillBlock();
  assert.match(block, /#splitsArea #splitsBulkBar \.splitsEditRowSecondary \.splitsRearrangeAction\.active,\s*\n\s*#splitsArea #splitsBulkBar \.splitsEditRowSecondary \.splitsRearrangeAction\[aria-pressed="true"\]\{\s*\n\s*background: color-mix\(in srgb, var\(--recipe-pill-accent\) 55%, var\(--panel2\)\);\s*\n\s*color: var\(--title\);\s*\n\s*\}/);
  assert.match(block, /#splitsArea #splitsBulkBar \.splitsEditRowSecondary \.splitsRearrangeAction\.active:hover:not\(:disabled\),\s*\n\s*#splitsArea #splitsBulkBar \.splitsEditRowSecondary \.splitsRearrangeAction\[aria-pressed="true"\]:hover:not\(:disabled\)\{\s*\n\s*background: color-mix\(in srgb, var\(--recipe-pill-accent\) 55%, var\(--panel2\)\);\s*\n\s*color: var\(--title\);\s*\n\s*filter: brightness\(1\.08\);\s*\n\s*\}/);
  // Idle siblings stay at 28% - the latch is Rearrange-only.
  assert.match(block, /\.splitsEditRowSecondary \.bulkTextAction,\s*\n\s*\.splitsEditRowSecondary \.splitsRearrangeAction\{[\s\S]*?background: color-mix\(in srgb, var\(--recipe-pill-accent\) 28%, var\(--panel2\)\);/);
});

test("Clear/Empty/Rearrange keep their fill on hover, double-id guaranteed against an old unscoped hover rule (still needed for Weights' own separate bulk-actions row) that sets background:transparent - that rule only tied our old hover rule's specificity for `color`, and since our old rule never redeclared `background` at all, the leftover rule's transparent background applied uncontested on hover, silently dropping the fill for every segment except Reset (safe only because its own selector happens to include an id)", () => {
  assert.match(styles, /\.splitsBulkActions \.bulkTextAction:hover,\s*\n\.weightsBulkActions \.bulkTextAction:hover,\s*\n\.splitsEditRowSecondary > \.bulkTextAction:hover:not\(:disabled\)\{color:var\(--title\);border-color:var\(--title\);background:transparent;text-decoration:none\}/, "expected the old leftover rule to still exist - it's shared with Weights, not deletable");
  const block = pillBlock();
  assert.match(block, /#splitsArea #splitsBulkBar \.splitsEditRowSecondary \.bulkTextAction:hover:not\(:disabled\),\s*\n\s*#splitsArea #splitsBulkBar \.splitsEditRowSecondary \.splitsRearrangeAction:hover:not\(:disabled\)\{\s*\n\s*background: color-mix\(in srgb, var\(--recipe-pill-accent\) 28%, var\(--panel2\)\);\s*\n\s*color: var\(--text\);\s*\n\s*filter: brightness\(1\.08\);\s*\n\s*\}/, "expected the double-id hover rule to explicitly reassert the fill, not just color/filter");
});

test("segments are separated by a real 2px gap, not a border-right divider - a divider line needs contrast tuning per theme/state and still read as too faint once tried in both white and black; a gap is always visible since it's just page background showing through, and needs no per-theme tuning at all", () => {
  const block = pillBlock();
  assert.match(block, /gap: 2px;/, "expected the pill container's own gap to separate segments");
  assert.doesNotMatch(styles, /\.splitsEditRowSecondary > \*:not\(:last-child\)\{/, "the old border-right divider rule should be fully removed, not just recolored");
  // Scoped to this pill's own block - the header pill (a separate row) still
  // legitimately keeps its own black-based divider (recipe-header-action-pill.test.js).
  assert.doesNotMatch(block, /color-mix\(in srgb, (white|black) 30%, transparent\)/, "no leftover divider color formula should remain on this row");
});

test("segments pick up the app's standard control-radius now that a real gap separates them, instead of the flat border-radius:0 that fit a seamless touching pill", () => {
  assert.match(styles, /\.splitsEditRowSecondary \.bulkTextAction,\s*\n\s*\.splitsEditRowSecondary \.splitsRearrangeAction\{[\s\S]*?border-radius: var\(--control-radius\);/);
  assert.match(styles, /\.splitsEditRowSecondary #resetAllSplits\.danger\{\s*\n\s*border-radius: var\(--control-radius\);/);
});

test("Rearrange is still appended to the same element, unmoved - no DOM/JS restructuring beyond relocating .recipeEditHistory", () => {
  assert.match(app, /editSecondaryRow\?\.prepend\(rearrangeButton\);/);
});

test(".srOnly is a true global utility, not mobile-only", () => {
  const matches = [...styles.matchAll(/\.srOnly\{position:absolute!important/g)];
  assert.equal(matches.length, 1, "expected exactly one .srOnly definition");
  const idx = matches[0].index;
  const mediaBefore = styles.lastIndexOf("@media", idx);
  const blockCloseBefore = styles.lastIndexOf("\n}\n", idx);
  assert.ok(mediaBefore < blockCloseBefore, ".srOnly must sit at unconditional/global scope");
});

test("the pill rule lives inside the >=701px block, not a mobile one - mobile keeps its own separate stacked layout untouched", () => {
  const start = styles.indexOf("#splitsArea #splitsBulkBar .splitsEditRowSecondary{");
  const mediaStart = styles.lastIndexOf("@media", start);
  assert.match(styles.slice(mediaStart, styles.indexOf("{", mediaStart)), /min-width:\s*701px/);
});

// Labels shortened for tablet/desktop's fixed-width toolbar, full length on
// mobile (which never joined this merged row): "Apply to selected" ->
// "Apply", "Reset Recipe" -> "Reset", "Resin name" -> "Resin",
// "Percentage" -> "%", "Clear selection" -> "Clear", "Empty cells" ->
// "Empty".

test("Apply's static markup default is the short \"Apply\"", () => {
  assert.match(app, /<button id="applyBulkSplit"[^>]*>Apply<\/button>/);
});

test("Apply's label is fixed - no longer grows to \"Apply to N hoppers\" on selection, which used to push the fixed-width toolbar past its available width. Selection count is still announced via #splitSelectionStatus", () => {
  // Scoped to renderSplitsArea (Recipe's own editor) - Weights has its own,
  // separate "Apply to N hopper(s)" bulk-apply text that is out of scope
  // and must stay untouched.
  const start = app.indexOf("    function renderSplitsArea(){");
  const end = app.indexOf("    function renderResinCalculator(){", start);
  const body = app.slice(start, end);
  assert.doesNotMatch(body, /Apply to \$\{selected\.size\} hopper/);
  assert.match(body, /applyButton\.disabled = selected\.size === 0 \|\| !hasBulkValue\(\);/);
});

test("Reset Recipe's label is set from JS based on compactMobileRecipe - \"Reset\" on tablet/desktop, \"Reset Recipe\" in full on mobile", () => {
  assert.match(app, /const resetButton = toolbar\.querySelector\("#resetAllSplits"\);/);
  assert.match(app, /setToolbarActionText\(resetButton, compactMobileRecipe \? "Reset Recipe" : "Reset"\);/);
});

test("Clear selection and Empty cells shorten to \"Clear\"/\"Empty\" on tablet/desktop, full length on mobile", () => {
  assert.match(app, /const clearSelectionButton = toolbar\.querySelector\("#clearSplitSelection"\);/);
  assert.match(app, /setToolbarActionText\(clearSelectionButton, compactMobileRecipe \? "Clear selection" : "Clear"\);/);
  assert.match(app, /setToolbarActionText\(clearCellsButton, compactMobileRecipe \? "Empty cells" : "Empty"\);/);
});

test("the Resin name label shortens to \"Resin\" on tablet/desktop only", () => {
  assert.match(app, /const resinNameLabel = toolbar\.querySelector\('label\[for="bulkResinName"\] span'\);/);
  assert.match(app, /if \(resinNameLabel\) resinNameLabel\.textContent = compactMobileRecipe \? "Resin name" : "Resin";/);
});

test("the Percentage label shortens to \"%\" on tablet/desktop only, targeting the field's own label span (not the nested %-suffix span beside the input)", () => {
  assert.match(app, /const percentageLabel = toolbar\.querySelector\('label\[for="bulkResinPct"\] > span:first-child'\);/);
  assert.match(app, /if \(percentageLabel\) percentageLabel\.textContent = compactMobileRecipe \? "Percentage" : "%";/);
});
