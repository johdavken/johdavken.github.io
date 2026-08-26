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
