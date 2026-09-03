"use strict";

// Button Styling: a desktop-only Display setting that swaps the Recipe /
// Weights panel toolbar buttons between the shipped look ("Default") and
// "Station console" - the one treatment kept from a seven-way trial. Same
// shape as the Side Rail Style preference: one <body> data attribute, local
// across an RT Sync job, restored through the standard payload path.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const buttonCss = fs.readFileSync("button-styling.css", "utf8");

test("Display sheet exposes a Button Styling picker: Default + Station console only", () => {
  assert.match(html, /<label for="buttonStyleSel" class="buttonStyleField">Button Styling/);
  const select = html.slice(html.indexOf('<select id="buttonStyleSel">'), html.indexOf("</select>", html.indexOf('id="buttonStyleSel"')));
  assert.match(select, /<option value="default" selected>Default<\/option>/);
  assert.match(select, /<option value="console">Station console<\/option>/);
  // the six trialled-then-dropped treatments are gone from this picker
  for (const gone of ["blueprint", "underline", "markers", "ribbons", "dividers", "tiles"]) {
    assert.doesNotMatch(select, new RegExp(`value="${gone}"`));
  }
  assert.match(html, /desktop only<\/small>\s*<\/label>/i);
  assert.match(styles, /\.buttonStyleField\{display:none!important\}/);
});

test("the stylesheet is loaded after the existing three", () => {
  assert.match(html, /<link rel="stylesheet" href="styles\.css[^>]*>\s*<link rel="stylesheet" href="theme\.css[^>]*>\s*<link rel="stylesheet" href="desktop\.css[^>]*>\s*<link rel="stylesheet" href="button-styling\.css/);
});

test("applyButtonStyle mirrors applyDesktopRailStyle: one body attribute, echoed to the select", () => {
  assert.match(app, /function applyButtonStyle\(value\)\{/);
  assert.match(app, /document\.body\.dataset\.buttonStyle = style;/);
  assert.match(app, /const select = \$\("buttonStyleSel"\);\s*\n\s*if \(select\) select\.value = style;/);
  // only "default" and "console" survive; every other value falls back
  assert.match(app, /new Set\(\["default", "console"\]\)/);
  assert.match(app, /allowed\.has\(String\(value\)\) \? String\(value\) : "default"/);
});

test("the preference persists locally and restores through the standard payload path", () => {
  assert.match(app, /buttonStyle: "default"/);
  const snapshots = app.match(/buttonStyle: state\.buttonStyle/g) || [];
  assert.equal(snapshots.length, 2, "buttonStyle should be in snapshotPayload and applySharedActiveJob");
  assert.match(app, /applyButtonStyle\(payload\.buttonStyle \|\| "default"\)/);
  assert.match(app, /applyButtonStyle\(state\.buttonStyle \|\| "default"\)/);
  assert.match(app, /\$\("buttonStyleSel"\)\?\.addEventListener\("change",\(e\)=>\{\s*\n\s*applyButtonStyle\(e\.target\.value\);/);
});

test("the treatment is desktop-scoped and every selector stays inside a treated panel", () => {
  assert.match(buttonCss, /@media \(min-width: 901px\) and \(pointer: fine\)\{/);
  const PANELS = ["#splitsBlock", "#splitsArea", "#resultsBlock", "#lineSyncBlock", "#toolsBlock", ".adminResinPanel", "#dashboardPanel", "#changeoverWizardDialog"];
  const ruleLines = buttonCss
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith('body[data-button-style="'));
  assert.ok(ruleLines.length >= 5, "expected the console selectors");
  for (const line of ruleLines) {
    assert.ok(PANELS.some(p => line.includes(p)), `selector escapes the panels: ${line.trim()}`);
    assert.ok(line.includes('"console"'), `stray non-console selector: ${line.trim()}`);
  }
});

test("console covers every treated button and neutralises the pill container", () => {
  // header pill + Edit/Done toggle
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsBlock #recipeHeaderActionPill \.recipeHeaderAction/);
  assert.match(buttonCss, /button\[data-recipe-view="edit"\]/);
  // bulk .bulkTextAction (catches Clear / Empty cells / Rearrange)
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsBlock \.splitsBulkBar \.bulkTextAction/);
  // danger keeps a distinct fill
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsBlock #resetAllSplits\{[\s\S]*?background: var\(--btnstyle-danger\)/);
  // Apply + Undo/Redo radius match, scoped past the 3-id styles.css rule
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsArea #splitsBulkBar #applyBulkSplit/);
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsArea #splitsBulkBar \.recipeHistoryAction/);
  // the border-radius:999px bulk-row pill-clip is overridden
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsArea #splitsBulkBar \.splitsEditRowSecondary/);
});

test("console reaches the recipe grid's Edit-mode layer Match buttons", () => {
  // scoped to Edit view - they don't exist in Summary
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsArea\[data-recipe-view="edit"\] \.splitCopyBtn\{[\s\S]*?border-radius: 4px[\s\S]*?background: var\(--btnstyle-surface\)/);
});

test("console reaches the shared Recipe Book / Weight Profiles toolbar: bay, chips, primary, danger", () => {
  // one bay rule, panel-agnostic (both panels share .splitsSavedRecipesActions)
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsBlock \.splitsSavedRecipesActions\{[\s\S]*?border-radius: 7px/);
  // the bar's buttons + the overflow trigger + the overflow menu items take the chip
  assert.match(buttonCss, /#splitsBlock \.splitsSavedRecipesActions > button,[\s\S]*?\.workspaceConfigurationOverflow > summary,[\s\S]*?\.workspaceConfigurationOverflowMenu button\{/);
  // Load (either panel's) is the inverted primary, but only while armed - by class, not id
  assert.match(buttonCss, /\.splitsSavedRecipesActions > button\.primary:not\(:disabled\)\{[\s\S]*?background: var\(--btnstyle-ink\)/);
  // Delete (either panel's) is solid danger - by class, not id
  assert.match(buttonCss, /\.workspaceConfigurationOverflowMenu button\.danger\{[\s\S]*?background: var\(--btnstyle-danger\)/);
  assert.doesNotMatch(buttonCss, /#splitsDeleteRecipe|#setupDeleteWeightProfile|#splitsLoadRecipe|#setupLoadWeightProfile/);
});

test("console reaches the relocated Hopper Weights Summary/Edit toggle", () => {
  // it lives in #recipeHeaderControls (not the action pill) on the Weights page
  assert.match(buttonCss, /#splitsBlock #recipeHeaderControls \.weightsHeaderViewToggle button\[data-weight-view="edit"\]\{[\s\S]*?background: var\(--btnstyle-ink\)/);
});

test("console reaches the Timeline panel control bar: bay + chips, Show all as a pressed key", () => {
  assert.match(buttonCss, /body\[data-button-style="console"\] #resultsBlock #timelinePane \.timelineControlBar\{[\s\S]*?border-radius: 7px/);
  assert.match(buttonCss, /#timelinePane \.timelineControlBar #showPumpOffToggle,[\s\S]*?#resetTrackingBtn,[\s\S]*?#timelineDisplayToggle\{/);
  assert.match(buttonCss, /#showPumpOffToggle\[aria-pressed="true"\]\{[\s\S]*?background: var\(--btnstyle-ink\)/);
  // the row ribbon / pump toggles / NEEDS WEIGHT group are not touched
  assert.doesNotMatch(buttonCss, /\.pumpToggle|\.resultRow|\.resultNeedsWeight|#resultsArea/);
});

test("console reaches RT Sync's desktop CTAs + the generate-code bay", () => {
  assert.match(buttonCss, /body\[data-button-style="console"\] #lineSyncBlock \.lineSyncGeneratedCodePanel\{[\s\S]*?border-radius: 7px/);
  assert.match(buttonCss, /#lineSyncBlock #desktopLineSyncSetupBtn,[\s\S]*?#lineSyncRetryBtn,[\s\S]*?#lineSyncGenerateCodeBtn,[\s\S]*?#lineSyncCopyCodeBtn\{/);
  // primary CTAs become the inverted key, but only while armed
  assert.match(buttonCss, /#desktopLineSyncSetupBtn:not\(:disabled\),[\s\S]*?#lineSyncGenerateCodeBtn:not\(:disabled\)\{[\s\S]*?background: var\(--btnstyle-ink\)/);
  // desktop-only: no mobile RT Sync buttons pulled in
  assert.doesNotMatch(buttonCss, /#lineSyncLeaveBtn|#lineSyncRetryMobileBtn|#lineSyncJoinBtn/);
});

test("console reaches the Tools section's per-tool action buttons", () => {
  // Scan Recipe + Bulk Density save bar become bays
  assert.match(buttonCss, /body\[data-button-style="console"\] #toolsBlock \.recipeScanOptions,[\s\S]*?\.bulkDensitySaveBar\{[\s\S]*?border-radius: 7px/);
  // Copy + Scan X + Save chips
  assert.match(buttonCss, /#toolsBlock \.resinLookupCopyButton,[\s\S]*?\.recipeScanOptionRow > button,[\s\S]*?#bulkDensitySaveButton\{/);
  // Save to Resin Database is the inverted key while enabled
  assert.match(buttonCss, /#toolsBlock #bulkDensitySaveButton:not\(:disabled\)\{[\s\S]*?background: var\(--btnstyle-ink\)/);
  // the tool tab list / mobile tiles are left alone - no selector targets them
  const selectorLines = buttonCss.split("\n").map(l => l.trim()).filter(l => l.startsWith('body[data-button-style="'));
  for (const line of selectorLines) {
    assert.ok(!/\.toolsIndexButton|\.mobileToolTile/.test(line), `styles a tool tab / tile: ${line}`);
  }
});

test("console reaches the Dashboard's one action button (not the back button)", () => {
  assert.match(buttonCss, /body\[data-button-style="console"\] #dashboardPanel \.dashboardChangeoverRefresh\{[\s\S]*?background: var\(--btnstyle-surface\)/);
  assert.doesNotMatch(buttonCss, /\.dashboardBackButton/);
});

test("console reaches the changeover wizard: action bar bay, chips, Next/Use + picked tile inverted", () => {
  assert.match(buttonCss, /body\[data-button-style="console"\] #changeoverWizardDialog \.changeoverWizardActions\{[\s\S]*?border-radius: 7px/);
  assert.match(buttonCss, /#changeoverWizardDialog \.changeoverWizardActions button,[\s\S]*?\.changeoverWizardChoices button\{/);
  assert.match(buttonCss, /\.changeoverWizardActions button\.primary,[\s\S]*?\.changeoverWizardChoices button\.selected\{[\s\S]*?background: var\(--btnstyle-ink\)/);
  // dialog chrome (close X, grab handle) left alone
  assert.doesNotMatch(buttonCss, /\.changeoverWizardClose|\.changeoverWizardGrabber/);
});

test("console reaches the Sudo Access sub-panels, but not their nav rows or dialogs", () => {
  // shared .adminToolbar -> bay
  assert.match(buttonCss, /body\[data-button-style="console"\] \.adminResinPanel \.adminToolbar\{[\s\S]*?border-radius: 7px/);
  // action buttons chipped by class, so list rows (.adminResinRow, .workspaceRecoveryRow) are untouched
  assert.match(buttonCss, /\.adminResinPanel button\.primary,[\s\S]*?button\.secondary,[\s\S]*?button\.danger,[\s\S]*?button\[data-button-variant="primary"\]\{/);
  assert.match(buttonCss, /\.adminResinPanel button\.primary:not\(:disabled\),[\s\S]*?background: var\(--btnstyle-ink\)/);
  assert.match(buttonCss, /\.adminResinPanel button\.danger:not\(:disabled\)\{[\s\S]*?background: var\(--btnstyle-danger\)/);
  const selectorLines = buttonCss.split("\n").map(l => l.trim()).filter(l => l.startsWith('body[data-button-style="'));
  for (const line of selectorLines) {
    // never the nav-row list buttons, never a raw admin dialog
    assert.ok(!/\.adminResinRow|\.workspaceRecoveryRow|\.sudoAccessAction|adminDialog|#adminLogin/.test(line), `admin selector too broad: ${line}`);
  }
});

test("the treatment reuses existing theme tokens, not hard-coded colours", () => {
  assert.match(buttonCss, /--btnstyle-accent: var\(--recipe-pill-accent/);
  assert.match(buttonCss, /--btnstyle-danger: var\(--recipe-pill-danger/);
  const hexes = buttonCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual([...new Set(hexes)], ["#fff"]);
});
