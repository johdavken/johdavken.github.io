"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

test("mobile Appearance uses a focused section with a return-to-tiles control",()=>{
  assert.match(html,/id="mobileAppearanceBack"[^>]*aria-label="Back to sections"/);
  assert.match(app,/function showMobileAppearancePanel\(\)/);
  assert.match(app,/document\.body\.dataset\.mobileWorkspace = "appearance"/);
  assert.match(app,/\$\("mobileAppearanceBack"\)\?\.addEventListener\("click",\(\)=>\{/);
  assert.match(styles,/body\[data-mobile-workspace="appearance"\] \.workspaceNav\{ display:none; \}/);
  assert.match(styles,/body\[data-mobile-workspace="appearance"\] \.workspaceStatusBar \.statusPreferences\[open\]\{/);
});

test("the old full-screen mobile preferences modal is removed",()=>{
  assert.doesNotMatch(styles,/\.workspaceStatusBar \.statusPreferences\[open\]\{\s*display:block;\s*position:fixed;/);
  assert.match(styles,/body\[data-mobile-workspace="appearance"\] \.workspaceStatusBar \.statusPreferencesPanel\{/);
});
