"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

test("the mobile dock exposes three stable, accessible controls",()=>{
  const footer = html.slice(html.indexOf('<footer class="footerBar"'),html.indexOf('</footer>'));
  for (const id of ["appFooterMain","appFooterDisplay","appFooterNotifications"]){
    assert.match(footer,new RegExp(`id="${id}"`));
  }
  assert.match(footer,/id="appFooterMain"[^>]*aria-label="Main menu"/);
  assert.doesNotMatch(footer,/appFooterAccount|cloudSyncFooterStatus/);
  assert.match(styles,/height:calc\(var\(--app-dock-height\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(styles,/html\{min-height:100%;height:auto\}/);
  assert.match(styles,/body\{height:auto;min-height:100vh;min-height:100dvh;overflow-x:hidden;overflow-y:auto\}/);
  assert.match(styles,/main\{height:auto;min-height:100vh;min-height:100dvh;padding-bottom:calc\(var\(--app-dock-height\) \+ env\(safe-area-inset-bottom\) \+ 22px\)!important\}/);
  assert.match(styles,/\.footerBar\{[\s\S]*?z-index:71;[\s\S]*?display:grid/);
  const order = ["appFooterDisplay","appFooterMain","appFooterNotifications"].map(id=>footer.indexOf(`id="${id}"`));
  assert.deepEqual(order,[...order].sort((a,b)=>a-b));
});

test("the dock is a 32px rail with centered Layer stack and icon-only Display/Alerts",()=>{
  assert.match(styles,/:root\{--app-dock-height:32px\}/);
  assert.match(styles,/#appFooterDisplay svg,#appFooterMain svg,#appFooterNotifications svg\{[\s\S]*?display:block;[\s\S]*?width:19px;/);
  assert.match(styles,/#appFooterDisplay > span,[\s\S]*?#appFooterMain > span,[\s\S]*?#appFooterNotifications > span:last-child\{[\s\S]*?clip-path:inset\(50%\)/);
  const refinement = styles.slice(styles.lastIndexOf("/* Footer state refinement"));
  assert.match(refinement,/\.mobileNotificationsBadge\{[\s\S]*?position:absolute;[\s\S]*?left:calc\(50% \+ 5px\);[\s\S]*?min-width:12px;[\s\S]*?height:12px;/);
  assert.match(html,/id="appFooterNotifications"[\s\S]*?<span>Alerts<\/span>/);
  assert.match(html,/id="appFooterMain"[\s\S]*?<span>Main<\/span>/);
  assert.match(html,/id="appFooterMain"[\s\S]*?<path d="M2\.9 10\.5 11\.2 3[^"]*" style="fill:currentColor;stroke:none"\/>/);
});

test("the footer stays three equal cells after Refresh is removed",()=>{
  const footer = html.slice(html.indexOf('<footer class="footerBar"'),html.indexOf('</footer>'));
  assert.doesNotMatch(footer,/cloudSyncFooterStatus|lineSyncMobileStatus|Refresh/);
  const refinement = styles.slice(styles.lastIndexOf("/* Footer state refinement"));
  assert.match(refinement,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(app,/lineSyncMobileStatus|cloudSyncFooterStatus/);
});

test("footer active states use accent-only styling with accessible focus and press feedback",()=>{
  const refinement = styles.slice(styles.lastIndexOf("/* Footer state refinement"));
  assert.match(refinement,/\.appDockControl\[aria-current="page"\],[\s\S]*?background:transparent;/);
  assert.match(refinement,/\.appDockControl\[aria-expanded="true"\][\s\S]*?color:var\(--title\);/);
  assert.match(refinement,/\.appDockMain\[aria-current="page"\],[\s\S]*?border:0;[\s\S]*?background:transparent;/);
  assert.match(refinement,/\.appDockControl:focus-visible[\s\S]*?outline:2px solid var\(--focus-border\)/);
  assert.match(refinement,/\.appDockControl:active:not\(\.cloudSyncFooterStatus\)[\s\S]*?background:color-mix/);
});

test("Display keeps the centered footer-sheet geometry",()=>{
  assert.match(html,/id="displaySheet" class="footerSheet/);
  assert.doesNotMatch(html,/footerAccountMenu/);
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
  assert.equal((select.match(/<option/g) || []).length,10);
  assert.match(select,/<option value="system">System \/ Auto<\/option>/);
  assert.match(select,/<option value="oled-black">OLED Black<\/option>/);
  assert.match(select,/<option value="nord">Nord<\/option>/);
  assert.match(select,/<option value="rose-pine-dawn">Rosé Pine Light<\/option>/);
  assert.match(select,/<option value="everforest">Evergreen<\/option>/);
  assert.match(select,/<option value="everforest-light">Evergreen Light<\/option>/);
  assert.match(app,/\["light", "industrial-slate"\]/);
  assert.match(app,/\["mse", "industrial-slate"\]/);
  assert.match(app,/\["dark", "industrial-slate-dark"\]/);
  assert.match(app,/\["system", "system"\]/);
  assert.match(app,/\["oled-black", "oled-black"\]/);
  assert.match(app,/\["nord", "nord"\]/);
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
