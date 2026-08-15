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

test("the dock is icon-only, with every icon the same enlarged size and Main sitting level with the rest",()=>{
  // 22px, the pre-existing icon size, increased by 25% - and the one size
  // every control uses now (Main's own 25px override is gone).
  assert.match(styles,/\.appDockControl svg,\.cloudSyncFooterStatus svg\{width:27\.5px;height:27\.5px;/);
  assert.doesNotMatch(styles,/\.appDockMain svg\{/);
  // Text labels are hidden - aria-label on each control still carries the
  // accessible name - but the unread-count badge is explicitly excluded, so
  // it keeps working exactly as before.
  assert.match(styles,/\.appDockControl > span:not\(\.mobileNotificationsBadge\),\.cloudSyncFooterStatus > strong\{display:none\}/);
  const badgeRule = styles.slice(styles.indexOf(".mobileNotificationsBadge{"),styles.indexOf("}",styles.indexOf(".mobileNotificationsBadge{")));
  assert.doesNotMatch(badgeRule,/display:none/);
  // Main no longer floats above the row (top:-5px) or claims a taller touch
  // target (min-height:68px) than its siblings - all five now sit level.
  const mainRule = styles.slice(styles.indexOf(".appDockMain{"),styles.indexOf("}",styles.indexOf(".appDockMain{")));
  assert.doesNotMatch(mainRule,/position:relative|top:-5px|min-height:/);
  // Main's press feedback now falls through to the same translateY(1px) rule
  // every other control uses, instead of its old standalone lift-up.
  assert.doesNotMatch(styles,/\.appDockMain:active/);
});

test("the dock has no drop shadow or border outline, is 10% shorter without shrinking the icons, and has mirrored raised ends at both top corners with a true concave join",()=>{
  // 72px -> 64.8px (10% shorter). Everything that positions itself off the
  // dock - sheets, trays, banners, main's own bottom padding - reads this
  // same variable, so a single change keeps them all in sync.
  assert.match(styles,/:root\{--app-dock-height:64\.8px\}/);
  assert.doesNotMatch(styles,/--app-dock-height:72px/);
  const dockRuleStart = styles.indexOf(".footerBar{",styles.indexOf(":root{--app-dock-height:64.8px}"));
  const dockRule = styles.slice(dockRuleStart,styles.indexOf("}",dockRuleStart));
  assert.doesNotMatch(dockRule,/box-shadow/);
  // Explicitly zeroed, not just omitted - an older, unscoped .footerBar rule
  // elsewhere in this file (the legacy "Next Pump Off" footer) still sets a
  // 1px top border, and simply not re-declaring it here lets that bleed
  // back through on mobile.
  assert.match(dockRule,/border-top:0;/);
  // The main box itself stays sharp on top (0) - a plain border-radius here
  // would always be convex ("pill" corner), which is explicitly not this
  // shape. Bottom keeps its separate, unrelated 16px round.
  assert.match(dockRule,/border-radius:0 0 16px 16px;/);
  // Mirrored raised-end pseudo-elements: each is a 24x20 block of the bar's
  // own material (not the page background - it must read as the footer
  // rising, not a cutout) sitting above the bar's sharp top corner.
  const wingRule = styles.slice(styles.indexOf(".footerBar::before,.footerBar::after{"),styles.indexOf("}",styles.indexOf(".footerBar::before,.footerBar::after{")));
  assert.match(wingRule,/top:-20px;/);
  assert.match(wingRule,/width:24px;/);
  assert.match(wingRule,/height:20px;/);
  assert.match(wingRule,/background:color-mix\(in srgb,var\(--panelOpen\) 94%,transparent\);/);
  assert.match(wingRule,/pointer-events:none;/);
  // The concave join specifically requires a MASK, not border-radius: a
  // radius keeps material inside its corner ellipse (convex - the rejected
  // pill corner), while this needs material kept outside one, so the arc
  // sags toward the corner. Masking also clips the backdrop-filter, which a
  // transparent-background gradient would not.
  assert.doesNotMatch(wingRule,/border-radius/);
  // Anchored past the combined ".footerBar::before,.footerBar::after" rule
  // above, so these find the standalone per-side rules.
  const beforeStart = styles.indexOf("\n  .footerBar::before{");
  const afterStart = styles.indexOf("\n  .footerBar::after{");
  assert.ok(beforeStart > -1 && afterStart > -1,"expected standalone per-side wing rules");
  const beforeRule = styles.slice(beforeStart,styles.indexOf("}",beforeStart));
  const afterRule = styles.slice(afterStart,styles.indexOf("}",afterStart));
  assert.match(beforeRule,/left:0;/);
  assert.match(afterRule,/right:0;/);
  // True mirrors: identical ellipse dimensions, anchored to opposite inner
  // corners. Both prefixed and unprefixed, since Safari still needs -webkit-.
  assert.match(beforeRule,/-webkit-mask:radial-gradient\(24px 20px at 100% 0,transparent 99%,#000 100%\);/);
  assert.match(beforeRule,/[^-]mask:radial-gradient\(24px 20px at 100% 0,transparent 99%,#000 100%\);/);
  assert.match(afterRule,/-webkit-mask:radial-gradient\(24px 20px at 0 0,transparent 99%,#000 100%\);/);
  assert.match(afterRule,/[^-]mask:radial-gradient\(24px 20px at 0 0,transparent 99%,#000 100%\);/);
  // The touch target shrinks by the same 10%, in step with the bar - but the
  // icon rule (already asserted above) keeps its own fixed 27.5px, untouched
  // by this resize.
  const controlRule = styles.slice(styles.indexOf(".appDockControl,.cloudSyncFooterStatus{"),styles.indexOf("}",styles.indexOf(".appDockControl,.cloudSyncFooterStatus{")));
  assert.match(controlRule,/min-height:57\.6px;/);
  assert.doesNotMatch(controlRule,/min-height:64px/);
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

test("theme choices are exactly Industrial Slate, Dark, and Gruvbox with legacy migration",()=>{
  const select = html.slice(html.indexOf('<select id="themeSel">'),html.indexOf('</select>',html.indexOf('<select id="themeSel">')));
  assert.equal((select.match(/<option/g) || []).length,3);
  assert.match(app,/\["light", "industrial-slate"\]/);
  assert.match(app,/\["mse", "industrial-slate"\]/);
  assert.match(app,/\["dark", "industrial-slate-dark"\]/);
  assert.match(app,/\["gruvbox-dark", "gruvbox-dark"\]/);
  assert.match(app,/migrations\.get\(saved\) \|\| "industrial-slate"/);
});

test("admin destinations remain outside the production menu and depend on verified access",()=>{
  const nav = html.slice(html.indexOf('<nav class="workspaceNav"'),html.indexOf('</nav>',html.indexOf('<nav class="workspaceNav"')));
  assert.doesNotMatch(nav,/resinDatabaseButton|workspaceManagementButton|adminLoginButton/);
  assert.match(app,/\.footerAdminDestination/);
  assert.match(fs.readFileSync("resin-admin-ui.js","utf8"),/const adminAccess = !initializing && !!state\?\.isAdmin/);
});
