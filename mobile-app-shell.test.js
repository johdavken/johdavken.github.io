"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

test("the mobile dock exposes five stable, accessible controls",()=>{
  const footer = html.slice(html.indexOf('<footer class="footerBar"'),html.indexOf('</footer>'));
  for (const id of ["appFooterMain","appFooterDisplay","appFooterNotifications","appFooterAccount","cloudSyncFooterStatus"]){
    assert.match(footer,new RegExp(`id="${id}"`));
  }
  assert.match(footer,/id="appFooterMain"[^>]*aria-label="Main menu"/);
  assert.match(footer,/id="appFooterAccount"[^>]*aria-label="Account"/);
  assert.match(styles,/height:calc\(var\(--app-dock-height\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(styles,/html\{min-height:100%;height:auto\}/);
  assert.match(styles,/body\{height:auto;min-height:100vh;min-height:100dvh;overflow-x:hidden;overflow-y:auto\}/);
  assert.match(styles,/main\{height:auto;min-height:100vh;min-height:100dvh;padding-bottom:calc\(var\(--app-dock-height\) \+ env\(safe-area-inset-bottom\) \+ 22px\)!important\}/);
  assert.match(styles,/\.footerBar\{[\s\S]*?z-index:71;[\s\S]*?display:grid/);
  const order = ["appFooterDisplay","appFooterNotifications","appFooterMain","appFooterAccount","cloudSyncFooterStatus"].map(id=>footer.indexOf(`id="${id}"`));
  assert.deepEqual(order,[...order].sort((a,b)=>a-b));
});

test("the dock is a text-only 32px rail with an inline Alerts badge",()=>{
  assert.match(styles,/:root\{--app-dock-height:32px\}/);
  assert.match(styles,/\.appDockControl svg,\.cloudSyncFooterStatus svg\{display:none\}/);
  assert.match(styles,/\.appDockControl > span:not\(\.mobileNotificationsBadge\),[\s\S]*?display:block;/);
  assert.match(styles,/\.mobileNotificationsToggle > span:last-child\{order:1\}/);
  const refinement = styles.slice(styles.lastIndexOf("/* Footer state refinement"));
  assert.match(refinement,/\.mobileNotificationsBadge\{[\s\S]*?position:static;[\s\S]*?order:2;[\s\S]*?min-width:12px;[\s\S]*?height:12px;/);
  assert.match(html,/id="appFooterNotifications"[\s\S]*?<span>Alerts<\/span>/);
});

test("Refresh is the fifth status cell and preserves live RT Sync state without a second row",()=>{
  const footer = html.slice(html.indexOf('<footer class="footerBar"'),html.indexOf('</footer>'));
  assert.match(footer,/id="cloudSyncFooterStatus"[\s\S]*?<span>Refresh<\/span><strong id="lineSyncMobileStatus">Local only<\/strong>/);
  const refinement = styles.slice(styles.lastIndexOf("/* Footer state refinement"));
  assert.match(refinement,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\) minmax\(68px,\.9fr\)/);
  assert.match(refinement,/\.cloudSyncFooterStatus\{[\s\S]*?flex-direction:column;[\s\S]*?border-left:1px solid var\(--border2\)/);
  assert.match(app,/const footerStatus = status === "Local only" \? "Local" : status;/);
});

test("footer active states use accent-only styling with accessible focus and press feedback",()=>{
  const refinement = styles.slice(styles.lastIndexOf("/* Footer state refinement"));
  assert.match(refinement,/\.appDockControl\[aria-current="page"\],[\s\S]*?background:transparent;/);
  assert.match(refinement,/\.appDockControl\[aria-expanded="true"\][\s\S]*?color:var\(--title\);/);
  assert.match(refinement,/\.appDockMain\[aria-current="page"\],[\s\S]*?border:0;[\s\S]*?background:transparent;/);
  assert.match(refinement,/\.appDockControl:focus-visible[\s\S]*?outline:2px solid var\(--focus-border\)/);
  assert.match(refinement,/\.appDockControl:active:not\(\.cloudSyncFooterStatus\)[\s\S]*?background:color-mix/);
});

test("Display and Account use one centered footer-sheet geometry",()=>{
  for (const id of ["displaySheet","footerAccountMenu"]){
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

test("theme choices include restored light and evergreen palettes and retain legacy migration",()=>{
  const select = html.slice(html.indexOf('<select id="themeSel">'),html.indexOf('</select>',html.indexOf('<select id="themeSel">')));
  assert.equal((select.match(/<option/g) || []).length,7);
  assert.match(select,/<option value="rose-pine-dawn">Rosé Pine Light<\/option>/);
  assert.match(select,/<option value="everforest">Evergreen<\/option>/);
  assert.match(select,/<option value="everforest-light">Evergreen Light<\/option>/);
  assert.match(app,/\["light", "industrial-slate"\]/);
  assert.match(app,/\["mse", "industrial-slate"\]/);
  assert.match(app,/\["dark", "industrial-slate-dark"\]/);
  assert.match(app,/\["gruvbox-dark", "gruvbox-dark"\]/);
  assert.match(app,/\["gruvbox-light", "gruvbox-light"\]/);
  assert.match(app,/\["rose-pine-light", "rose-pine-dawn"\]/);
  assert.match(app,/\["evergreen", "everforest"\]/);
  assert.match(app,/\["evergreen-light", "everforest-light"\]/);
  assert.match(app,/migrations\.get\(saved\) \|\| "industrial-slate"/);
});

test("admin destinations remain outside the production menu and depend on verified access",()=>{
  const nav = html.slice(html.indexOf('<nav class="workspaceNav"'),html.indexOf('</nav>',html.indexOf('<nav class="workspaceNav"')));
  assert.doesNotMatch(nav,/resinDatabaseButton|workspaceManagementButton|adminLoginButton/);
  assert.match(app,/\.footerAdminDestination/);
  assert.match(fs.readFileSync("resin-admin-ui.js","utf8"),/const adminAccess = !initializing && !!state\?\.isAdmin/);
});
