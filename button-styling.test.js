"use strict";

// Station console: the desktop button treatment. It was trialled as a
// Display setting with seven options; the picker is gone and the one kept
// treatment is now simply how desktop buttons look - unconditional inside
// the desktop media query, with no attribute gate and no state to persist.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const buttonCss = fs.readFileSync("button-styling.css", "utf8");

const selectorLines = buttonCss
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.startsWith("body "));

// The tablet (Wide Touch) mirror: identical selector chains with `body`
// swapped for `body[data-shell="touch"]` - see the file comment above the
// desktop media query for why. These lines never satisfy the "body " filter
// above (the very next character is "[", not a space), so the two sets
// never overlap.
const touchSelectorLines = buttonCss
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.startsWith('body[data-shell="touch"] '));

test("the picker, its preference and its attribute gate are all gone", () => {
  // no <select>, no field, no label
  assert.doesNotMatch(html, /buttonStyleSel|buttonStyleField|Button Styling/);
  assert.doesNotMatch(styles, /\.buttonStyleField/);
  // no state, no apply function, no listener, no payload field
  assert.doesNotMatch(app, /buttonStyle|applyButtonStyle/);
  // no attribute anywhere - the treatment is unconditional
  assert.doesNotMatch(buttonCss, /data-button-style/);
});

test("the stylesheet is still loaded, after the existing three", () => {
  assert.match(html, /<link rel="stylesheet" href="styles\.css[^>]*>\s*<link rel="stylesheet" href="theme\.css[^>]*>\s*<link rel="stylesheet" href="desktop\.css[^>]*>\s*<link rel="stylesheet" href="button-styling\.css/);
});

test("every desktop rule stays inside the desktop media query, and every tablet rule inside the tablet one", () => {
  assert.match(buttonCss, /@media \(min-width: 901px\) and \(pointer: fine\)\{/);
  assert.match(buttonCss, /@media \(min-width: 701px\)\{/);
  // exactly two media blocks: desktop, then its tablet mirror
  assert.equal((buttonCss.match(/@media/g) || []).length, 2);
  const desktopOpen = buttonCss.indexOf("@media (min-width: 901px)");
  const tabletOpen = buttonCss.indexOf("@media (min-width: 701px)");
  assert.ok(desktopOpen < tabletOpen, "desktop block should come first");
  for (const line of selectorLines) {
    const at = buttonCss.indexOf(line);
    assert.ok(at > desktopOpen && at < tabletOpen, `desktop selector outside the desktop media query: ${line}`);
  }
  for (const line of touchSelectorLines) {
    assert.ok(buttonCss.indexOf(line) > tabletOpen, `tablet selector outside the tablet media query: ${line}`);
  }
});

test("the tablet block is an exact mirror of the desktop block, body-for-body", () => {
  // Guards against drift: strip comments from both blocks and diff them
  // after undoing the one deliberate substitution (`body` <->
  // `body[data-shell="touch"]`). Anything else different between the two
  // blocks is a bug, not a tablet-specific tweak.
  const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*\n+/g, "\n").trim();
  const desktopOpen = buttonCss.indexOf("@media (min-width: 901px)");
  const tabletOpen = buttonCss.indexOf("@media (min-width: 701px)");
  // The raw slice runs past the desktop block's own closing brace and
  // through the header comment introducing the tablet block below it, so
  // comments are stripped first and the leftover trailing "}" (the desktop
  // block's own) removed after - stripping in the other order leaves that
  // brace behind, since the regex only matches a string that *ends* in "}".
  const desktopBody = stripComments(
    buttonCss.slice(buttonCss.indexOf("{", desktopOpen) + 1, tabletOpen)
  ).replace(/\}\s*$/, "").trim();
  const tabletBlockEnd = buttonCss.lastIndexOf("}");
  const tabletBody = stripComments(
    buttonCss.slice(buttonCss.indexOf("{", tabletOpen) + 1, tabletBlockEnd)
  );
  assert.notEqual(desktopBody.length, 0);
  assert.notEqual(tabletBody.length, 0);
  assert.equal(tabletBody, desktopBody.split("body ").join('body[data-shell="touch"] '));
});

test("every tablet selector carries body[data-shell=\"touch\"] - none quietly fell back to bare `body`", () => {
  assert.ok(touchSelectorLines.length >= selectorLines.length, "expected a tablet line for every desktop line");
  const tabletOpen = buttonCss.indexOf("@media (min-width: 701px)");
  const tabletBlock = buttonCss.slice(tabletOpen);
  assert.doesNotMatch(tabletBlock, /\n\s*body #/);
  assert.doesNotMatch(tabletBlock, /\n\s*body \./);
});

test("every selector keeps its leading `body` so the tuned styles.css rules stay outranked", () => {
  // #applyBulkSplit is pinned by a 3-id rule and .timelineControlBar by a
  // 2-id one; without the extra element in the selector these would only
  // win on source order. Guard that the prefix is never dropped.
  assert.ok(selectorLines.length >= 40, "expected the console selectors");
  assert.match(buttonCss, /body #splitsArea #splitsBulkBar #applyBulkSplit/);
  assert.match(buttonCss, /body #resultsBlock #timelinePane \.timelineControlBar/);
  assert.doesNotMatch(buttonCss, /\n\s*#splitsArea #splitsBulkBar #applyBulkSplit/);
  // no declaration leans on !important (the phrase appears only in a comment)
  assert.doesNotMatch(buttonCss, /!important\s*;/);
});

test("every selector stays inside a treated panel - nothing styles buttons app-wide", () => {
  const PANELS = [
    "#splitsBlock", "#splitsArea", "#resultsBlock", "#lineSyncBlock",
    "#toolsBlock", ".adminResinPanel", "#dashboardPanel", "#changeoverWizardDialog"
  ];
  for (const line of [...selectorLines, ...touchSelectorLines]) {
    assert.ok(PANELS.some(p => line.includes(p)), `selector escapes the panels: ${line}`);
  }
});

test("navigation and list rows are never restyled", () => {
  // Recipe and Timeline page tabs are intentionally panel-local console
  // controls; broader workspace navigation and list rows remain untouched.
  for (const line of [...selectorLines, ...touchSelectorLines]) {
    assert.ok(
      !/\.toolsIndexButton|\.mobileToolTile|\.adminResinRow|\.workspaceRecoveryRow|\.sudoAccessAction|\.dashboardBackButton|\.workspaceNavButton/.test(line),
      `styles a nav / list row: ${line}`
    );
  }
});

/* ----------------------------------------------------------------------
 *   The treatment itself, surface by surface
 * -------------------------------------------------------------------- */

test("Recipe / Weights: bays, chips, inverted Edit-Done key, danger Reset", () => {
  assert.match(buttonCss, /body #splitsBlock #recipeHeaderActionPill,[\s\S]*?border-radius: 7px/);
  assert.match(buttonCss, /body #splitsBlock \.splitsBulkBar \.bulkTextAction/);
  assert.match(buttonCss, /button\[data-recipe-view="edit"\],[\s\S]*?button\[data-weight-view="edit"\],[\s\S]*?\.weightsHeaderViewToggle button\[data-weight-view="edit"\]\{[\s\S]*?background: var\(--btnstyle-ink\)/);
  assert.match(buttonCss, /body #splitsBlock #resetAllSplits\{[\s\S]*?background: var\(--btnstyle-danger\)/);
  // the bulk row's border-radius:999px pill-clip is overridden
  assert.match(buttonCss, /body #splitsArea #splitsBulkBar \.splitsEditRowSecondary/);
  // Edit-mode layer Match buttons
  assert.match(buttonCss, /body #splitsArea\[data-recipe-view="edit"\] \.splitCopyBtn\{[\s\S]*?border-radius: 4px/);
});

test("Recipe Book + Weight Profiles share one bar treatment, keyed by class not id", () => {
  assert.match(buttonCss, /body #splitsBlock \.splitsSavedRecipesActions\{[\s\S]*?border-radius: 7px/);
  assert.match(buttonCss, /\.splitsSavedRecipesActions > button\.primary:not\(:disabled\)\{[\s\S]*?background: var\(--btnstyle-ink\)/);
  assert.match(buttonCss, /\.workspaceConfigurationOverflowMenu button\.danger\{[\s\S]*?background: var\(--btnstyle-danger\)/);
});

test("Timeline control bar: bay + chips, Show all as a pressed key", () => {
  assert.match(buttonCss, /body #resultsBlock #timelinePane \.timelineControlBar\{[\s\S]*?border-radius: 7px/);
  assert.match(buttonCss, /#showPumpOffToggle\[aria-pressed="true"\]\{[\s\S]*?background: var\(--btnstyle-ink\)/);
  // the row ribbon / pump toggles / NEEDS WEIGHT group stay untouched
  assert.doesNotMatch(buttonCss, /\.pumpToggle|\.resultRow|\.resultNeedsWeight|#resultsArea/);
});

test("Recipe and Timeline tabs use the console bay with visible resting keys", () => {
  assert.match(buttonCss, /body #splitsBlock \.recipePageTabs,[\s\S]*?body #resultsBlock \.timelineViewTabs\{[\s\S]*?padding: 5px[\s\S]*?border-radius: 7px/);
  assert.match(buttonCss, /body #splitsBlock \.recipePageTab,[\s\S]*?body #resultsBlock \.timelineViewTab\{[\s\S]*?border-radius: 4px[\s\S]*?background: var\(--btnstyle-surface\)/);
  assert.match(buttonCss, /body #splitsBlock \.recipePageTab\.active,[\s\S]*?body #resultsBlock \.timelineViewTab\.active\{[\s\S]*?background: var\(--btnstyle-ink\)/);
  // The fine-pointer desktop override removes only Timeline's old tab-to-pane
  // seam; the Recipe panel keeps its own existing workspace layout intact.
  assert.match(buttonCss, /body #resultsBlock :is\(#timelinePane, #timelineHookupsArea\)\{ border-top: 0; \}/);
});

test("Recipe's console tab bay keeps a steady desktop footprint across pages", () => {
  assert.match(buttonCss, /body #splitsBlock \.recipePageTabs\{[\s\S]*?flex: 0 1 396px;[\s\S]*?inline-size: 396px;[\s\S]*?block-size: 42px;[\s\S]*?min-width: 0;/);
  assert.match(buttonCss, /body #splitsBlock \.recipeHeaderRow\{ align-items: flex-start; \}/);
  assert.match(buttonCss, /body #splitsBlock \.recipeHeaderRow > \.recipePageTabs\{ align-self: flex-start; \}/);
  assert.match(buttonCss, /body #splitsBlock \.recipePageTab\{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
});

test("RT Sync, Tools, Sudo Access, Dashboard and the changeover wizard are covered", () => {
  assert.match(buttonCss, /body #lineSyncBlock \.lineSyncGeneratedCodePanel\{[\s\S]*?border-radius: 7px/);
  assert.match(buttonCss, /body #toolsBlock \.recipeScanOptions,[\s\S]*?\.bulkDensitySaveBar\{[\s\S]*?border-radius: 7px/);
  assert.match(buttonCss, /body \.adminResinPanel \.adminToolbar\{[\s\S]*?border-radius: 7px/);
  assert.match(buttonCss, /body \.adminResinPanel button\.danger:not\(:disabled\)\{[\s\S]*?background: var\(--btnstyle-danger\)/);
  assert.match(buttonCss, /body #dashboardPanel \.dashboardChangeoverRefresh\{[\s\S]*?background: var\(--btnstyle-surface\)/);
  assert.match(buttonCss, /body #changeoverWizardDialog \.changeoverWizardActions\{[\s\S]*?border-radius: 7px/);
});

test("the treatment reuses existing theme tokens, not hard-coded colours", () => {
  assert.match(buttonCss, /--btnstyle-accent: var\(--recipe-pill-accent/);
  assert.match(buttonCss, /--btnstyle-danger: var\(--recipe-pill-danger/);
  const hexes = buttonCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual([...new Set(hexes)], ["#fff"]);
});

test("the base button rules phones still render are left in place", () => {
  // Compact Touch (<=700px, phones) is covered by neither media block above,
  // so these styles.css rules are still the live ones there. Tablet
  // (>=701px touch) now outranks them via the tablet block's added
  // body[data-shell="touch"] specificity rather than removing them - see
  // "the tablet block is an exact mirror..." above.
  assert.match(styles, /\.splitCopyBtn\{[\s\S]*?border-radius:999px/);
  assert.match(styles, /#splitsArea #splitsBulkBar \.splitsEditRowSecondary\{/);
  assert.match(styles, /\.changeoverWizardActions\{/);
  assert.match(styles, /\.timelineControlBar\{/);
});

test("phones (Compact Touch, <=700px) are outside both media blocks", () => {
  // Neither block's condition can ever be true at <=700px: 901px+fine
  // requires desktop width, and 701px is Wide Touch's own lower bound.
  assert.match(buttonCss, /@media \(min-width: 701px\)\{/);
  assert.doesNotMatch(buttonCss, /max-width:\s*700px/);
});
