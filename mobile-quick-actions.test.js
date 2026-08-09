"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

test("mobile tile home has an accessible expanding quick-actions menu",()=>{
  assert.match(html,/id="mobileQuickActionsToggle"[^>]*aria-expanded="false"[^>]*aria-controls="mobileQuickActionsMenu"/);
  assert.match(html,/id="mobileQuickActionsMenu"[^>]*aria-hidden="true"[^>]*inert/);
  assert.match(html,/id="quickScanDosingScreenBtn"/);
  assert.match(html,/id="quickProductionSummaryBtn"/);
  assert.match(styles,/body\[data-mobile-workspace="home"\] \.mobileQuickActions\{/);
  assert.match(styles,/@keyframes quickActionPulse/);
  assert.match(styles,/@media \(prefers-reduced-motion:reduce\)/);
});

test("quick actions reuse the existing scan and tool navigation flows",()=>{
  assert.match(app,/PolynRecipeScanUI\?\.startScan\("dosing_screen"\)/);
  assert.match(app,/setWorkspacePanel\("toolsBlock", \{ reveal: true \}\);\s*selectToolPanel\("productionSummaryTool"\);/);
  assert.match(app,/setMobileQuickActionsOpen\(false\)/);
  assert.match(app,/menu\.inert = !expanded/);
});
