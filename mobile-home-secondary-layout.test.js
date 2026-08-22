"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("mobile home separates RT Sync and support actions from workflow steps", () => {
  assert.match(html, /id="workspaceNavLineSync"[\s\S]*?class="mobileNavHint">Connect this device when it should share a production line\.<\/span>/);
  assert.match(styles, /body\[data-mobile-workspace="home"\] #workspaceNavLineSync\{[\s\S]*?grid-column:1 \/ -1;[\s\S]*?min-height:128px;/);
  assert.match(styles, /#workspaceNavLineSync::before\{[\s\S]*?content:"LINE CONNECTION";/);
  assert.match(styles, /#workspaceNavLineSync::after\{[\s\S]*?content:"Open";/);
  assert.match(styles, /:is\(#workspaceNavTools,#workspaceNavHelp\)\{[\s\S]*?min-height:110px;[\s\S]*?border:1px solid var\(--border2\);[\s\S]*?border-radius:12px;/);
  assert.match(styles, /:is\(#workspaceNavTools,#workspaceNavHelp\) > span\{[\s\S]*?flex-direction:column;/);
  assert.match(styles, /:is\(#workspaceNavTools,#workspaceNavHelp\) > small::before\{\s*display:none;/);
});

test("the alternate hierarchy stays scoped to the mobile home", () => {
  const concept = styles.slice(styles.indexOf("/* Home concept 2:"), styles.indexOf("  .footerBar{", styles.indexOf("/* Home concept 2:")));
  assert.match(concept, /body\[data-mobile-workspace="home"\]/);
  assert.doesNotMatch(concept, /\.workspaceNavDivider\{\s*display:/);
  assert.match(styles, /\.mobileNavHint\{ display:none!important; \}/);
});
