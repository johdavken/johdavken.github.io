"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

test("the mobile dock exposes five stable, accessible controls",()=>{
  const footer = html.slice(html.indexOf('<footer class="footerBar"'),html.indexOf('</footer>'));
  for (const id of ["appFooterMain","appFooterDisplay","appFooterShortcuts","appFooterAccount","cloudSyncFooterStatus"]){
    assert.match(footer,new RegExp(`id="${id}"`));
  }
  assert.match(footer,/id="appFooterMain"[^>]*aria-label="Main menu"/);
  assert.match(footer,/id="appFooterAccount"[^>]*aria-label="Account"/);
  assert.match(styles,/min-height:calc\(var\(--app-dock-height\) \+ env\(safe-area-inset-bottom\)\)/);
  const order = ["appFooterDisplay","appFooterShortcuts","appFooterMain","appFooterAccount","cloudSyncFooterStatus"].map(id=>footer.indexOf(`id="${id}"`));
  assert.deepEqual(order,[...order].sort((a,b)=>a-b));
  assert.match(styles,/\.appDockMain\{[\s\S]*?top:-5px;[\s\S]*?min-height:68px;/);
});

test("footer active states use accent-only styling with accessible focus and press feedback",()=>{
  const refinement = styles.slice(styles.lastIndexOf("/* Footer state refinement"));
  assert.match(refinement,/\.appDockControl\[aria-current="page"\],[\s\S]*?background:transparent;/);
  assert.match(refinement,/\.appDockControl\[aria-expanded="true"\][\s\S]*?color:var\(--title\);/);
  assert.match(refinement,/\.appDockMain\[aria-current="page"\],[\s\S]*?border:0;[\s\S]*?background:transparent;/);
  assert.match(refinement,/\.appDockControl:focus-visible[\s\S]*?outline:2px solid var\(--focus-border\)/);
  assert.match(refinement,/\.appDockControl:active:not\(\.cloudSyncFooterStatus\)[\s\S]*?background:color-mix/);
});

test("Display, Shortcuts, and Account use one centered footer-sheet geometry",()=>{
  for (const id of ["displaySheet","footerShortcutsMenu","footerAccountMenu"]){
    assert.match(html,new RegExp(`id="${id}" class="footerSheet`));
  }
  assert.match(styles,/\.footerSheet\{[\s\S]*?left:50%;[\s\S]*?width:min\(410px,calc\(100vw - 20px\)\);[\s\S]*?transform:translateX\(-50%\);/);
  assert.match(styles,/\.footerSheetBackdrop\{bottom:calc\(var\(--app-dock-height\) \+ env\(safe-area-inset-bottom\)\);z-index:69\}/);
});

test("Timeline tile status is set inside the existing next-action renderer",()=>{
  const start = app.indexOf("function updateFooterNext(flat, changeoverDate)");
  const body = app.slice(start,app.indexOf("function updateShortFootageCalculator",start));
  assert.match(body,/workspaceTimelineStatus/);
  assert.match(body,/pump-off due/);
  assert.match(body,/`Next: \$\{next\.hopperLabel\} in \$\{minutesUntil\} min`/);
  assert.match(body,/`Next: \$\{next\.hopperLabel\} at \$\{fmtTime\(next\.startByDate\)\}`/);
  assert.match(body,/Tracked data unavailable/);
});

test("theme choices are exactly Light, Dark, and Gruvbox with legacy migration",()=>{
  const select = html.slice(html.indexOf('<select id="themeSel">'),html.indexOf('</select>',html.indexOf('<select id="themeSel">')));
  assert.equal((select.match(/<option/g) || []).length,3);
  assert.match(app,/\["light", "mse"\]/);
  assert.match(app,/\["dark", "industrial-slate-dark"\]/);
  assert.match(app,/\["gruvbox-dark", "gruvbox-dark"\]/);
  assert.match(app,/migrations\.get\(saved\) \|\| "mse"/);
});

test("admin destinations remain outside the production menu and depend on verified access",()=>{
  const nav = html.slice(html.indexOf('<nav class="workspaceNav"'),html.indexOf('</nav>',html.indexOf('<nav class="workspaceNav"')));
  assert.doesNotMatch(nav,/resinDatabaseButton|workspaceManagementButton|adminLoginButton/);
  assert.match(app,/\.footerAdminDestination/);
  assert.match(fs.readFileSync("resin-admin-ui.js","utf8"),/const adminAccess = !initializing && !!state\?\.isAdmin/);
});
