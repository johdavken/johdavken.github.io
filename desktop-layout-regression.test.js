"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("desktop layout rules are isolated in a stylesheet loaded after the shared theme", () => {
  const theme = html.indexOf('href="theme.css');
  const desktopLink = html.indexOf('href="desktop.css');
  assert.ok(theme > -1 && desktopLink > theme);
  assert.match(desktop, /@media \(min-width:901px\)/);
  assert.match(desktop, /grid-template-rows:40px minmax\(0,1fr\)/);
  assert.match(desktop, /workspacePanel\.desktop-active::details-content\{flex:1 1 0;min-height:0;overflow:hidden\}/);
});

test("desktop Changeover exposes the native time field without clipping its period or picker", () => {
  assert.match(desktop, /#lineSetupBlock \.gaugeTile input\[type="time"\]\{position:static;min-width:0;width:100%;height:32px;opacity:1;cursor:text;/);
  assert.match(desktop, /font-size:18px!important;line-height:normal/);
  assert.match(desktop, /::-webkit-calendar-picker-indicator\{width:17px;height:17px;margin:0 0 0 4px;padding:0\}/);
  assert.match(desktop, /#lineSetupBlock \.gaugeTimeValue\{display:none\}/);
  assert.match(html, /<input id="changeoverTime" type="time" \/>\s*<span class="gaugeTimeValue"/);
});

test("desktop Setup is a two-region workspace with a compact five-column receiver matrix", () => {
  assert.match(desktop, /#lineSetupBlock > \.blockBody\{[\s\S]*?grid-template-columns:minmax\(214px,220px\) minmax\(0,1fr\)/);
  assert.match(desktop, /#lineSetupBlock \.setupPrimaryFields\{display:grid;grid-template-columns:180px;justify-items:start;gap:10px/);
  assert.match(desktop, /#lineSetupBlock \.gaugeTile\{position:relative;width:180px;max-width:180px/);
  assert.match(desktop, /\.weightsMatrix\{width:100%;min-width:620px;table-layout:fixed\}/);
  assert.match(desktop, /\.weightsMatrixCell\{height:54px;/);
  assert.doesNotMatch(app, /desktopWeightVisualReadout[\s\S]{0,300}<svg/);
  assert.match(app, /desktopSummaryWeightId/);
  assert.match(app, /desktopWeightSummaryWeight.*smart/);
});

test("desktop canvas and receiver typography use the shared theme and desktop tokens", () => {
  const theme = fs.readFileSync("theme.css", "utf8");
  const industrialSlate = theme.slice(theme.indexOf(':where(html, body)[data-theme="industrial-slate"]{'), theme.indexOf('/* ----------------------------------------------------------------------- * Industrial Slate Dark'));
  assert.match(industrialSlate, /--desktop-canvas-bg: #9dafbf;/);
  assert.match(desktop, /body\{overflow:hidden;background:var\(--desktop-canvas-bg\)\}/);
  assert.match(desktop, /body\[data-theme="industrial-slate"\]\{background:linear-gradient\(135deg,var\(--desktop-canvas-bg\),color-mix\(in srgb,var\(--desktop-canvas-bg\) 55%,white\)\)\}/);
  assert.match(desktop, /\.desktopWeightSummaryValues b\{[\s\S]*?font-size:18px;font-weight:850/);
  assert.match(desktop, /\.desktopWeightSummaryValues b \+ b\{color:var\(--muted\);font-size:13px/);
  assert.match(desktop, /\.desktopWeightEditFields input\{[\s\S]*?font-size:14px;font-weight:800/);
});

test("desktop type scale strengthens navigation and compact operational text without mobile rules", () => {
  assert.match(desktop, /--desktop-type-body:14px;[\s\S]*?--desktop-type-secondary:12px;[\s\S]*?--desktop-type-label:11px;[\s\S]*?--desktop-type-heading:16px/);
  assert.match(desktop, /\.workspaceNavButton span\{font-size:14px;font-weight:650;letter-spacing:\.06em;text-transform:uppercase\}/);
  assert.match(desktop, /\.workspaceNavButton small\{font-size:var\(--desktop-type-secondary\);font-weight:600/);
  assert.match(desktop, /\.workspaceStatusItem span\{font-size:var\(--desktop-type-label\);font-weight:650/);
  assert.match(desktop, /\.desktopWeightsActionToolbar button\{[\s\S]*?font-size:var\(--desktop-type-control\);font-weight:750/);
});

test("desktop refinements keep Smart Hoppers obvious and utility/sidebar chrome restrained", () => {
  assert.match(app, /data-toggle-state-for="smartHoppersToggle" aria-live="polite">Disabled/);
  assert.match(desktop, /desktopWeightsSmartControl \.toggle\.on\{background:color-mix\(in srgb,var\(--ok\)/);
  assert.match(desktop, /desktopSmartHopperState\[data-state="on"\]\{color:var\(--ok\)/);
  assert.match(desktop, /workspaceNavButton small\{display:block;[\s\S]*?border:0;[\s\S]*?white-space:normal/);
  assert.match(desktop, /#appFooterAccount\{width:38px;height:38px;border-color:transparent;background:transparent/);
  assert.match(desktop, /\.desktopDisplayToggle\{[\s\S]*?border-color:transparent;[\s\S]*?background:transparent/);
});

test("the gruvbox/industrial-slate rail caption reserves its own line height, so it can't be starved to a sliver by overflow:hidden", () => {
  // A grid item with overflow other than visible has its automatic minimum
  // size treated as 0 for track sizing (CSS Grid  2.7) - without an
  // explicit min-height here, .workspaceNavButton's auto row for this
  // single-line, ellipsis-truncated caption was free to shrink to whatever
  // space was left over in the button's fixed min-height instead of
  // growing to fit one line, clipping every RT Sync/Tools/Help/Sudo access
  // caption's descenders under the overflow:hidden a few lines below.
  const start = desktop.indexOf('body:is([data-theme="gruvbox-dark"],[data-theme="gruvbox-light"],[data-theme="industrial-slate-dark"],[data-theme="industrial-slate"]) .workspaceNavButton small{');
  assert.notEqual(start, -1);
  const rule = desktop.slice(start, desktop.indexOf("}", start) + 1);
  assert.match(rule, /min-height:1\.15em;/);
  assert.match(rule, /overflow:hidden;/);
});

test("Weight Profiles stands alone in the desktop matrix action area - Bulk Edit was folded into View:Edit, not kept as a sibling tab", () => {
  assert.match(app, /profilesAction\.innerHTML = '<span>Weight Profiles<\/span>/);
  assert.doesNotMatch(app, /bulkModeButton|desktopWeightsBulkToggle/);
  assert.match(app, /desktopWeightsBulkContext/);
  assert.match(desktop, /desktopWeightsBulkContext\[hidden\]\{display:none!important\}/);
});

test("desktop utility dialogs remain bounded and closed account menus cannot paint", () => {
  assert.match(desktop, /footerAccountMenu:not\(\[open\]\)\{display:none!important\}/);
  assert.match(desktop, /footerAccountMenu\{[\s\S]*?max-height:calc\(100dvh - 73px\)/);
  assert.match(desktop, /displaySheet\[open\]\{position:fixed;inset:50% auto auto 50%/);
});

test("the intermediate desktop range keeps the full readable side-rail width", () => {
  assert.match(desktop, /@media \(min-width:901px\) and \(max-width:1180px\) and \(pointer: fine\)\{[\s\S]*?main\{grid-template-columns:240px minmax\(0,1fr\)\}/);
  assert.doesNotMatch(desktop, /main\{grid-template-columns:190px minmax\(0,1fr\)\}/);
});

test("variable length desktop sections use bounded internal scrolling", () => {
  assert.match(desktop, /#resultsArea\{min-height:0;overflow:auto;/);
  assert.match(desktop, /#resinCalcResults\{min-height:0;overflow:auto\}/);
  assert.match(desktop, /#changelogBlock > \.blockBody\{overflow:auto\}/);
});

test("desktop Recipe controls use the five-layer rail and Summary omits the redundant tracking panel", () => {
  assert.match(styles, /#splitsBlock\{\s*--recipe-five-layer-rail: 1062px;/);
  assert.match(styles, /#splitsBlock \.recipeHeaderRow,\s*#splitsArea > \.splitsBulkBar\{\s*width: min\(100%, var\(--recipe-five-layer-rail\)\);/);
  assert.match(styles, /#splitsArea > \.splitsTrackingBar\{\s*display: none;/);
  assert.doesNotMatch(styles, /--recipe-view-stage-height/);
});

test("the LAYERS/1-3-5/Done/Load Next Recipe/Print Recipe toolbar stays one unbroken, right-anchored unit on a real desktop mouse - styles.css's own fix for this row (.recipeHeaderRow{flex-wrap:nowrap}, tabs flex:1 1 auto;min-width:0) only lives inside \"(max-width:900px), (min-width:901px) and (pointer:coarse)\", which a pointer:fine window never matches at any width - the same coarse/fine gap that bit the edit toolbar earlier, here on the row above it", () => {
  const start = desktop.indexOf("@media (min-width:901px) and (pointer: fine){");
  assert.notEqual(start, -1);
  // Tabs get first claim on shrinking, same as the existing touch-tablet fix -
  // so the toolbar group never has to give up space or wrap internally.
  assert.match(desktop, /\.recipeHeaderRow > \.recipePageTabs\{\s*\n\s*min-width: 0;\s*\n\s*flex: 1 1 auto;\s*\n\s*\}/);
  // The toolbar itself: fixed width (never asked to shrink), never wraps its
  // own children, and - unlike the row's own justify-content:space-between,
  // which only distributes space between 2+ items on the same line and
  // resolves to flex-start for a lone item once wrapped - margin-left:auto
  // keeps it pinned to the right edge of whichever line it ends up on, even
  // if it's ever alone on a wrapped second line.
  assert.match(desktop, /#recipeHeaderControls\{\s*\n\s*flex: 0 0 auto;\s*\n\s*flex-wrap: nowrap;\s*\n\s*margin-left: auto;\s*\n\s*\}/);
  // Confirm this fix lives specifically in desktop.css's pointer:fine scope,
  // not a brand new breakpoint - it fills the exact complementary gap next
  // to the pointer:coarse fix that already exists in styles.css.
  assert.match(styles, /@media \(max-width: 900px\), \(min-width: 901px\) and \(pointer: coarse\)\{/);
  assert.match(styles, /\.recipeHeaderRow\{flex-wrap:nowrap;align-items:flex-end\}/);
});

test("the header row itself is explicitly nowrap on real desktop, not left at its base flex-wrap:wrap - CSS decides whether a flex line needs to wrap using each item's hypothetical/natural size, computed BEFORE flex-shrink is applied, so tabs' own flex:1 1 auto;min-width:0 (previous test) could not by itself stop the row from wrapping: even though tabs COULD shrink to fit, the wrap decision compared their natural ~295px width against the available row width and wrapped anyway, never giving shrink the chance to apply. Measured at ~1040px: natural tabs (~295px) + the fixed toolbar (~446px) + the row's 12px gap = ~753px against ~726px available - about 27px over, small enough that letting shrink actually apply (via nowrap) absorbs it losslessly", () => {
  assert.match(desktop, /\.recipeHeaderRow\{\s*\n\s*flex-wrap: nowrap;\s*\n\s*\}/);
});

test("page tabs get a tighter compact-desktop padding/gap baseline so shrinking starts from less wasted space rather than looking visibly squeezed at the narrow end of the pointer:fine range", () => {
  assert.match(desktop, /\.recipeHeaderRow > \.recipePageTabs\{\s*\n\s*gap: 2px;\s*\n\s*\}/);
  assert.match(desktop, /\.recipeHeaderRow > \.recipePageTabs > \.recipePageTab\{\s*\n\s*padding: 6px 9px 5px;\s*\n\s*\}/);
});
