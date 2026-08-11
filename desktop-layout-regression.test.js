"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");

test("desktop layout rules are isolated in a stylesheet loaded after the shared theme", () => {
  const theme = html.indexOf('href="theme.css');
  const desktopLink = html.indexOf('href="desktop.css');
  assert.ok(theme > -1 && desktopLink > theme);
  assert.match(desktop, /@media \(min-width:901px\)/);
  assert.match(desktop, /grid-template-rows:40px minmax\(0,1fr\)/);
  assert.match(desktop, /workspacePanel\.desktop-active::details-content\{flex:1 1 0;min-height:0;overflow:hidden\}/);
});

test("desktop Changeover exposes one formatted value while retaining the native picker interaction layer", () => {
  assert.match(desktop, /#lineSetupBlock \.gaugeTile input\[type="time"\]\{position:absolute;inset:0;z-index:2;width:100%;height:100%;opacity:0;cursor:pointer\}/);
  assert.match(desktop, /#lineSetupBlock \.gaugeTimeValue\{display:flex;/);
  assert.match(html, /<input id="changeoverTime" type="time" \/>\s*<span class="gaugeTimeValue"/);
});

test("desktop Setup is a two-region workspace with a compact five-column receiver matrix", () => {
  assert.match(desktop, /#lineSetupBlock > \.blockBody\{[\s\S]*?grid-template-columns:minmax\(214px,220px\) minmax\(0,1fr\)/);
  assert.match(desktop, /#lineSetupBlock \.setupPrimaryFields\{display:grid;grid-template-columns:152px;justify-items:start;gap:10px/);
  assert.match(desktop, /#lineSetupBlock \.gaugeTile\{position:relative;width:152px;max-width:152px/);
  assert.match(desktop, /\.weightsMatrix\{width:100%;min-width:620px;table-layout:fixed\}/);
  assert.match(desktop, /\.weightsMatrixCell\{height:54px;/);
  assert.doesNotMatch(app, /desktopWeightVisualReadout[\s\S]{0,300}<svg/);
  assert.match(app, /desktopSummaryWeightId/);
  assert.match(app, /desktopWeightSummaryWeight.*smart/);
});

test("desktop canvas and receiver typography use the shared theme and desktop tokens", () => {
  const theme = fs.readFileSync("theme.css", "utf8");
  const mse = theme.slice(theme.indexOf(':where(html, body)[data-theme="mse"]{'), theme.indexOf('/* ----------------------------------------------------------------------- * Industrial Slate Dark'));
  assert.match(mse, /--desktop-canvas-bg: #e3eaf0;/);
  assert.match(desktop, /body\{overflow:hidden;background:var\(--desktop-canvas-bg\)\}/);
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

test("Receiver Profiles and Bulk Edit live in the desktop matrix action area", () => {
  assert.match(app, /desktopWeightsActionToolbar mobileMatrixActionBar/);
  assert.match(app, /profilesAction\.innerHTML = '<span>Profiles<\/span>/);
  assert.match(app, /bulkModeButton\.innerHTML = '<span>Bulk edit<\/span>/);
  assert.match(app, /desktopWeightsBulkContext/);
  assert.match(desktop, /desktopWeightsBulkContext\[hidden\]\{display:none!important\}/);
});

test("desktop utility dialogs remain bounded and closed account menus cannot paint", () => {
  assert.match(desktop, /footerAccountMenu:not\(\[open\]\)\{display:none!important\}/);
  assert.match(desktop, /footerAccountMenu\{[\s\S]*?max-height:calc\(100dvh - 73px\)/);
  assert.match(desktop, /displaySheet\[open\]\{position:fixed;inset:50% auto auto 50%/);
});

test("variable length desktop sections use bounded internal scrolling", () => {
  assert.match(desktop, /#resultsArea\{min-height:0;overflow:auto;/);
  assert.match(desktop, /#resinCalcResults\{min-height:0;overflow:auto\}/);
  assert.match(desktop, /#helpBlock > \.blockBody\{overflow:auto\}/);
});
