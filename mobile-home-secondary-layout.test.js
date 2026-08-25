"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("mobile home renders the four primary destinations as one connected rail", () => {
  assert.match(html, /class="mobileWorkflowLabel"><span>Production workflow<\/span><strong id="mobileWorkflowWorkspace">LOCAL<\/strong>/);
  assert.equal((html.match(/class="mobileRailChev"/g) || []).length, 4);
  assert.match(styles, /body\[data-mobile-workspace="home"\] \.workspaceNav\{[\s\S]*?grid-template-columns:minmax\(0,1fr\);/);
  assert.match(styles, /\.workspaceNavButton\[data-step\][\s\S]*?min-height:82px;/);
  assert.match(styles, /\.workspaceNavButton:is\(\[data-step="1"\],\[data-step="2"\],\[data-step="3"\]\)::after\{[\s\S]*?height:calc\(100% - 26px\);/);
});

test("the workflow divider names the connected workspace and falls back to LOCAL", () => {
  const app = fs.readFileSync("app.js", "utf8");
  assert.match(app, /mobileWorkflowWorkspace\.textContent = syncState\.connected && syncState\.selectedWorkspace\?\.name[\s\S]*?\? syncState\.selectedWorkspace\.name[\s\S]*?: "LOCAL";/);
  assert.match(styles, /\.mobileWorkflowLabel > strong\{[\s\S]*?max-width:42%;[\s\S]*?text-overflow:ellipsis;/);
});

test("mobile Workspace and support is one disclosure for the secondary destinations", () => {
  assert.match(html, /class="mobileWorkspaceNavMore"[\s\S]*?<strong>Workspace &amp; support<\/strong><small>RT Sync · Tools · Help · Sudo access<\/small>/);
  assert.match(html, /id="mobileWorkspaceSyncStatusText">RT Sync is local only<\/span>/);
  assert.match(styles, /\.workspaceNav:not\(\.navExpanded\) \.workspaceNavExtra:not\(\.active\)\{display:none\}/);
  assert.match(styles, /\.workspaceNav\.navExpanded \.workspaceNavExtra\{[\s\S]*?min-height:58px;/);
});

test("the connected rail hierarchy stays scoped to the mobile home", () => {
  const concept = styles.slice(styles.indexOf("/* Connected production rail:"), styles.indexOf("  .footerBar{", styles.indexOf("/* Connected production rail:")));
  assert.match(concept, /body\[data-mobile-workspace="home"\]/);
  assert.match(styles, /\.mobileWorkflowLabel,[\s\S]*?\.mobileWorkspaceSyncStatus\{ display:none; \}/);
});
