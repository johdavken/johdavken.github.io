"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("mobile home renders the three visible workflow destinations as one connected rail", () => {
  assert.match(html, /class="workspaceIdentityBar" id="workspaceIdentityButton" type="button"[\s\S]*?<strong id="workspaceIdentityName">LOCAL<\/strong>/);
  assert.equal((html.match(/class="mobileRailChev"/g) || []).length, 4);
  assert.match(styles, /body\[data-mobile-workspace="home"\] \.workspaceNav\{[\s\S]*?grid-template-columns:minmax\(0,1fr\);/);
  assert.match(styles, /\.workspaceNavButton\[data-step\][\s\S]*?min-height:82px;/);
  assert.match(styles, /\.workspaceNavButton:is\(\[data-step="1"\],\[data-step="2"\]\)::after\{[\s\S]*?height:calc\(100% - 26px\);/);
  assert.match(styles, /\.workspaceNavButton\[data-step="3"\]::after\{display:none\}/);
});

test("the workspace identity bar names the connected workspace, falls back to Connect, and opens RT Sync - identically on mobile and desktop", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const desktop = fs.readFileSync("desktop.css", "utf8");
  assert.match(app, /workspaceIdentityName\.textContent = syncState\.connected && syncState\.selectedWorkspace\?\.name[\s\S]*?\? syncState\.selectedWorkspace\.name[\s\S]*?: "Connect";/);
  assert.match(app, /\$\("workspaceIdentityButton"\)\?\.addEventListener\("click",\(\)=>\{\s*\n\s*setWorkspacePanel\("lineSyncBlock", \{ reveal:true \}\);/);
  // One shared rule (styles.css, not gated by any width) supplies the
  // divider-line/name/button treatment; mobile and desktop each only flip
  // display and pick their own margin, so the two can't drift apart.
  assert.match(styles, /\.workspaceIdentityBar strong\{[\s\S]*?max-width: 60%;[\s\S]*?text-overflow: ellipsis;/);
  assert.match(styles, /body\[data-mobile-workspace="home"\] \.workspaceIdentityBar\{\s*\n\s*display:flex;/);
  assert.match(desktop, /\.workspaceIdentityBar\{\s*\n\s*display:flex;/);
});

test("mobile Workspace and support is one disclosure for the secondary destinations", () => {
  assert.match(html, /class="mobileWorkspaceNavMore"[\s\S]*?<strong>Workspace &amp; support<\/strong><small>RT Sync · Tools · Get the app · Changelog · Sudo access<\/small>/);
  assert.match(html, /id="mobileWorkspaceSyncStatusText">RT Sync is local only<\/span>/);
  assert.match(styles, /\.workspaceNav:not\(\.navExpanded\) \.workspaceNavExtra:not\(\.active\)\{display:none\}/);
  assert.match(styles, /\.workspaceNav\.navExpanded \.workspaceNavExtra\{[\s\S]*?padding:0;/);
});

test("the connected rail hierarchy stays scoped to the mobile home", () => {
  const concept = styles.slice(styles.indexOf("/* Connected production rail:"), styles.indexOf("  .footerBar{", styles.indexOf("/* Connected production rail:")));
  assert.match(concept, /body\[data-mobile-workspace="home"\]/);
  assert.match(styles, /\.workspaceIdentityBar,[\s\S]*?\.mobileWorkspaceSyncStatus\{ display:none; \}/);
});
