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
  assert.match(desktop, /#lineSetupBlock > \.blockBody\{[\s\S]*?grid-template-columns:minmax\(280px,min\(24vw,320px\)\) minmax\(620px,1fr\)/);
  assert.match(desktop, /\.weightsMatrix\{width:100%;min-width:620px;table-layout:fixed\}/);
  assert.match(desktop, /\.weightsMatrixCell\{height:54px;/);
  assert.doesNotMatch(app, /desktopWeightVisualReadout[\s\S]{0,300}<svg/);
  assert.match(app, /desktopSummaryWeightId/);
  assert.match(app, /desktopWeightSummaryWeight.*smart/);
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
