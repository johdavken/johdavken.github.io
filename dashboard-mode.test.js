"use strict";

// Dashboard is a desktop-only overview mode that replaces the sidebar +
// status bar + working panel with a single spacious screen (see
// setDashboardActive/renderDashboard in app.js). It is a read-only
// projection of state the rest of the app already owns - no parallel
// timers, no duplicate changeover/output/timeline math, no separate
// connectivity check.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");

test("sidebar carries an understated Dashboard entry, centered at the very bottom below a divider", () => {
  const nav = html.slice(html.indexOf('<nav class="workspaceNav"'), html.indexOf('</nav>', html.indexOf('<nav class="workspaceNav"')));
  const footerIndex = nav.indexOf('class="workspaceNavFooter"');
  const versionIndex = nav.indexOf('class="desktopRailVersion"');
  const dividerIndex = nav.indexOf('class="workspaceNavDashboardDivider"');
  const buttonIndex = nav.indexOf('id="workspaceNavDashboard"');
  assert.ok(footerIndex > -1 && versionIndex > -1 && dividerIndex > -1 && buttonIndex > -1);
  // The footer block sits after every production/support destination, floated
  // to the rail foot by margin-top:auto. Inside it the order reads
  // top-to-bottom: version, then the divider, then Dashboard - the version is
  // informational and must not look attached to the Dashboard switch.
  assert.ok(footerIndex > nav.indexOf('id="workspaceNavSudo"'), "footer block follows every existing nav item");
  assert.ok(versionIndex < dividerIndex, "version sits above the divider");
  assert.ok(dividerIndex < buttonIndex, "divider separates normal navigation from the Dashboard switch");
  assert.match(nav, /id="workspaceNavSudo"[\s\S]*id="workspaceNavDashboard"/, "Dashboard follows every existing nav item rather than reordering them");
  // Reduced to a centered word: no data-workspace-target (it is a mode switch,
  // never a setWorkspacePanel destination), no tile icon, no caption.
  const button = nav.slice(buttonIndex, nav.indexOf('</button>', buttonIndex));
  assert.doesNotMatch(button, /data-workspace-target/);
  assert.doesNotMatch(button, /workspaceTileIcon|<small/);
  assert.match(button, /<span>Dashboard<\/span>/);
  assert.match(desktop, /\.workspaceNavDashboard span\{[\s\S]*?justify-content:center;/);
  assert.match(desktop, /\.workspaceNavFooter\{[\s\S]*?margin-top:auto;/);
});

test("Dashboard panel exists once, outside the normal workspace shell", () => {
  assert.match(html, /<section class="dashboardPanel" id="dashboardPanel"/);
  const panelIndex = html.indexOf('id="dashboardPanel"');
  const contentCloseIndex = html.lastIndexOf('</div>', panelIndex);
  const mainCloseIndex = html.indexOf('</main>', panelIndex);
  assert.ok(contentCloseIndex < panelIndex && panelIndex < mainCloseIndex, "dashboardPanel is a sibling of .workspaceContent, inside <main>");
});

test("Back to Line is a real labeled button, not an X or icon-only control", () => {
  assert.match(html, /<button type="button" class="dashboardBackButton" id="dashboardBackButton">\s*<svg[\s\S]*?<\/svg>\s*Back to Line\s*<\/button>/);
});

test("Dashboard shows exactly the five approved facts, plus the one allowed control", () => {
  const panel = html.slice(html.indexOf('id="dashboardPanel"'), html.indexOf('</section>', html.indexOf('id="dashboardPanel"')));
  ["dashboardLineNumber", "dashboardWorkspaceName", "dashboardChangeoverClock", "dashboardChangeoverRemaining", "dashboardOutputValue", "dashboardNextActionTime", "dashboardNextActionHoppers", "dashboardSyncStatus"].forEach(id => {
    assert.match(panel, new RegExp(`id="${id}"`));
  });
  // The forbidden additions called out explicitly in the spec.
  assert.doesNotMatch(panel, /resinTotal|recipeMatrix|productionHistory|quickAction/i);
  // The single new action inside the Dashboard information area: a small
  // secondary re-open of the existing changeover calculator. Nothing else.
  const buttons = [...panel.matchAll(/<button\b/g)];
  assert.equal(buttons.length, 2, "only Back to Line and the changeover refresh are buttons in the panel");
  assert.match(panel, /id="dashboardChangeoverRefresh"/);
});

test("Dashboard mode is a pure presentation toggle - one flag, no reload, no second data source", () => {
  assert.match(app, /let dashboardActive = false;/);
  assert.match(app, /function setDashboardActive\(active\)\{/);
  // Guarded by the app's one existing desktop/fine-pointer detector, not a
  // new breakpoint.
  assert.match(app, /const next = !!active && isDesktopLayout\(\);/);
  // Entering/leaving Dashboard never touches activeWorkspaceId or calls
  // setWorkspacePanel - the working section underneath is simply never
  // rebuilt, so there is nothing to "restore" beyond removing the class.
  const fn = app.slice(app.indexOf("function setDashboardActive"), app.indexOf("function updateShortFootageCalculator"));
  assert.doesNotMatch(fn, /activeWorkspaceId\s*=/);
  assert.doesNotMatch(fn, /setWorkspacePanel\(/);
  assert.match(fn, /document\.body\.classList\.toggle\("dashboardActive", dashboardActive\)/);
});

test("Dashboard reuses existing state/calculations for every displayed value - no duplicate timers or fetches", () => {
  const fn = app.slice(app.indexOf("function renderDashboard("), app.indexOf("function setDashboardActive"));
  // Workspace/line identity: the same resolver app.js is required elsewhere
  // to reach the line number through (see derived-layer-count.test.js).
  assert.match(fn, /window\.PolynLineIdentity\?\.getLineConfigurationForSync\(syncState\)/);
  assert.doesNotMatch(fn, /window\.PolynLineIdentity\?\.linkedLineNumber/);
  // Changeover: the same parseChangeoverDate/isChangeoverStale/fmtRelFromNow
  // trio the status bar and countdown chip already use.
  assert.match(fn, /parseChangeoverDate\(state\.changeoverTime\)/);
  assert.match(fn, /isChangeoverStale\(state\.changeoverSetAt\)/);
  assert.match(fn, /fmtRelFromNow\(changeoverDate\)/);
  // Output: the exact same state.lineRate and formatting used by
  // workspaceOutputStatus.
  assert.match(fn, /state\.lineRate\.toLocaleString\(\[\], \{ maximumFractionDigits: 2 \}\)/);
  // Next action: the cached Timeline arrays, never a fresh computation.
  assert.match(fn, /nextDashboardActionGroup\(lastTimelineFlat, lastTimelineChangeoverDate\)/);
  // RT Sync: lineSync's own live state.
  assert.match(fn, /lineSync\?\.getState\?\.\(\)/);
});

test("next-action grouping reuses Timeline's own tiering and exact millisecond/minute equality - no invented tolerance window", () => {
  const fn = app.slice(app.indexOf("function nextDashboardActionGroup"), app.indexOf("function renderDashboardNextAction"));
  assert.match(fn, /x\.startByDate && Number\.isFinite\(x\.totalMinutes\) && !x\.pumpOff/, "same candidate filter as updateFooterNext's pump-off-by tier");
  assert.match(fn, /a\.startByDate\.getTime\(\) - b\.startByDate\.getTime\(\)/);
  assert.match(fn, /x\.startByDate\.getTime\(\) === soonest/, "grouped by exact getTime() equality, not a window");
  assert.match(fn, /Number\.isFinite\(x\.minutesToEmpty\) && x\.minutesToEmpty >= 0 && !x\.pumpOff/, "same fallback tier as updateFooterNext's soonest-empty case");
  assert.match(fn, /x\.minutesToEmpty === soonestMinutes/);
  assert.doesNotMatch(fn, /Math\.abs\(/, "no epsilon/tolerance comparison anywhere in the grouping logic");
});

// Reimplementation of the grouping rule, independent of app.js's own copy,
// so a future edit to either can't silently drift without a test noticing.
function groupNextAction(flat, changeoverDate, stale){
  if (!flat.length) return null;
  if (changeoverDate && stale) return null;
  if (changeoverDate){
    const candidates = flat.filter(x => x.startByDate && Number.isFinite(x.totalMinutes) && !x.pumpOff);
    if (candidates.length){
      candidates.sort((a, b) => a.startByDate.getTime() - b.startByDate.getTime());
      const soonest = candidates[0].startByDate.getTime();
      return candidates.filter(x => x.startByDate.getTime() === soonest);
    }
  }
  const fallback = flat.filter(x => Number.isFinite(x.minutesToEmpty) && x.minutesToEmpty >= 0 && !x.pumpOff);
  if (!fallback.length) return null;
  fallback.sort((a, b) => a.minutesToEmpty - b.minutesToEmpty);
  const soonestMinutes = fallback[0].minutesToEmpty;
  return fallback.filter(x => x.minutesToEmpty === soonestMinutes);
}

test("a single next hopper action groups to just itself", () => {
  const base = new Date("2026-01-01T16:29:00");
  const flat = [
    { hopperLabel: "A4", resinName: "MS1307", startByDate: base, totalMinutes: 40, pumpOff: false },
    { hopperLabel: "B1", resinName: "MS0440", startByDate: new Date(base.getTime() + 5 * 60000), totalMinutes: 45, pumpOff: false }
  ];
  const group = groupNextAction(flat, new Date("2026-01-01T18:00:00"), false);
  assert.equal(group.length, 1);
  assert.equal(group[0].hopperLabel, "A4");
});

test("2-5 hoppers landing on the exact same calculated time all group together", () => {
  const t = new Date("2026-01-01T16:29:00");
  const flat = [
    { hopperLabel: "A4", resinName: "MS1307", startByDate: new Date(t), totalMinutes: 40, pumpOff: false },
    { hopperLabel: "B4", resinName: "MS1307", startByDate: new Date(t), totalMinutes: 40, pumpOff: false },
    { hopperLabel: "C1", resinName: "MS0470", startByDate: new Date(t), totalMinutes: 40, pumpOff: false },
    { hopperLabel: "A1", resinName: "MS0440", startByDate: new Date(t), totalMinutes: 40, pumpOff: false },
    { hopperLabel: "B5", resinName: "MS0999", startByDate: new Date(t.getTime() + 1), totalMinutes: 40, pumpOff: false }
  ];
  const group = groupNextAction(flat, new Date("2026-01-01T18:00:00"), false);
  assert.equal(group.length, 4, "the hopper 1ms later is a separate event, not folded in");
  assert.deepEqual(group.map(x => x.hopperLabel).sort(), ["A1", "A4", "B4", "C1"]);
});

test("hoppers a minute apart are never merged by a fabricated tolerance window", () => {
  const t = new Date("2026-01-01T16:29:00");
  const flat = [
    { hopperLabel: "A4", startByDate: new Date(t), totalMinutes: 40, pumpOff: false },
    { hopperLabel: "B4", startByDate: new Date(t.getTime() + 60000), totalMinutes: 41, pumpOff: false }
  ];
  const group = groupNextAction(flat, new Date("2026-01-01T18:00:00"), false);
  assert.equal(group.length, 1);
  assert.equal(group[0].hopperLabel, "A4");
});

test("no tracked hoppers yields no group, rendered as a clean empty state", () => {
  assert.equal(groupNextAction([], null, false), null);
  assert.match(html, /No tracked hopper actions/);
  assert.match(app, /function renderDashboardNextAction\(\)\{/);
});

test("a stale changeover suppresses next-action the same way it does in the Timeline's own footer summary", () => {
  const flat = [{ hopperLabel: "A4", startByDate: new Date(), totalMinutes: 10, pumpOff: false }];
  assert.equal(groupNextAction(flat, new Date(), true), null);
});

test("RT Sync status reuses the same status text and severity mapping the sidebar tile already uses", () => {
  assert.match(app, /function syncStatusSeverity\(status\)\{/);
  assert.match(app, /function renderDashboardSync\(syncState\)\{/);
  const fn = app.slice(app.indexOf("function renderDashboardSync"), app.indexOf("function setDashboardActive"));
  assert.match(fn, /syncState\.status \|\| "Local only"/);
  assert.match(fn, /syncStatusSeverity\(status\)/);
  // Not color-only: the status word itself is always written into the DOM.
  assert.match(fn, /textEl\.textContent = status;/);
});

test("the lower Dashboard row is a balanced Output / Next Action / RT Sync composition, RT Sync anchored right", () => {
  const panel = html.slice(html.indexOf('id="dashboardPanel"'), html.indexOf('</section>', html.indexOf('id="dashboardPanel"')));
  const grid = panel.slice(panel.indexOf('class="dashboardLowerGrid"'), panel.indexOf('</div>\n    </div>', panel.indexOf('class="dashboardLowerGrid"')) + 20);
  // All three sections now live inside the one lower grid, in reading order.
  assert.match(grid, /dashboardOutput[\s\S]*?dashboardNextAction[\s\S]*?dashboardSync/);
  assert.equal((panel.match(/class="dashboardSync"/g) || []).length, 1);
  // RT Sync is a grid child (indented under .dashboardLowerGrid), no longer a
  // section-level sibling block sitting after the grid.
  assert.match(panel, /\n {6}<div class="dashboardSync">/);
  assert.doesNotMatch(panel, /\n\n {4}<div class="dashboardSync">/);
  // Three-column grid; align-items:start keeps the labels on one top baseline
  // and stops RT Sync sliding down when Next Action grows.
  assert.match(desktop, /\.dashboardLowerGrid\{[\s\S]*?grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.5fr\) minmax\(0,1fr\);[\s\S]*?align-items:start;/);
  // Output stays left (default), Next Action is centre-anchored over its wider
  // column, RT Sync is right-anchored - the three-part balance from the brief.
  assert.match(desktop, /\.dashboardNextAction\{[\s\S]*?flex-direction:column;[\s\S]*?align-items:center;/);
  assert.match(desktop, /\.dashboardNextActionBody\{[^}]*align-items:center;/);
  assert.match(desktop, /\.dashboardSync\{[\s\S]*?flex-direction:column;[\s\S]*?align-items:flex-end;/);
  assert.doesNotMatch(desktop, /\.dashboardSync\{[^}]*(border:|background:|box-shadow:)/);
  // No new pixel positioning was introduced for the relocation.
  assert.doesNotMatch(desktop, /\.dashboardSync\b[^{]*\{[^}]*position:absolute/);
});

test("RT Sync gains a moderate, state-recoloured status icon - the app's one sync glyph, not a per-state icon set", () => {
  const panel = html.slice(html.indexOf('id="dashboardPanel"'), html.indexOf('</section>', html.indexOf('id="dashboardPanel"')));
  // Reuses the exact circular-arrows sync path the mobile line-sync status and
  // the changeover refresh already use.
  assert.match(panel, /<svg class="dashboardSyncIcon"[\s\S]*?M5 7a8 8 0 0 1 13 1l2 3M19 17a8 8 0 0 1-13-1l-2-3/);
  assert.match(panel, /dashboardSyncIcon"[^>]*aria-hidden="true"/);
  // The old bare colour dot is gone.
  assert.doesNotMatch(panel, /dashboardSyncStatus"[^>]*>\s*<i /);
  // Theme-aware (currentColor) and recoloured by state, never a fixed hex.
  assert.match(desktop, /\.dashboardSyncIcon\{[\s\S]*?stroke:currentColor;/);
  assert.match(desktop, /\.dashboardSyncStatus\[data-state="ok"\]\{ color:var\(--ok\); \}/);
  assert.match(desktop, /\.dashboardSyncStatus\[data-state="warn"\]\{ color:var\(--warn\); \}/);
  assert.match(desktop, /\.dashboardSyncStatus\[data-state="bad"\]\{ color:var\(--bad\); \}/);
  assert.doesNotMatch(desktop, /\.dashboardSync(Icon|Status)[^{]*\{[^}]*#[0-9a-fA-F]{3,}/);
  // Present but restrained: icon ~22px, "Synced" well under the Output value's clamp(40px,5vw,64px).
  assert.match(desktop, /\.dashboardSyncIcon\{[\s\S]*?width:22px;/);
  assert.match(desktop, /\.dashboardSyncStatus\{[\s\S]*?font-size:clamp\(17px,1\.5vw,20px\);/);
});

test("empty/unavailable states render clean text, never fake data", () => {
  const changeoverFn = app.slice(app.indexOf("function renderDashboardChangeover"), app.indexOf("function renderDashboardOutput"));
  assert.match(changeoverFn, /clockEl\.textContent = "Not set";/);
  const outputFn = app.slice(app.indexOf("function renderDashboardOutput"), app.indexOf("function nextDashboardActionGroup"));
  assert.match(outputFn, /valueEl\.textContent = "Not set";/);
});

test("Dashboard is not the startup landing page - loadWorkspacePreference/activeWorkspaceId are untouched", () => {
  assert.doesNotMatch(app, /loadWorkspacePreference[\s\S]{0,200}dashboard/i);
  assert.match(app, /let activeWorkspaceId = "resultsBlock";/);
});

test("leaving desktop width while Dashboard is open closes it automatically", () => {
  const fn = app.slice(app.indexOf("function syncLayoutMode("), app.indexOf("function watchLayoutMode("));
  assert.match(fn, /if \(!desktop && dashboardActive\) setDashboardActive\(false\);/);
});

test("Dashboard CSS hides the working shell and is scoped to the existing desktop media query, never a new breakpoint", () => {
  assert.match(desktop, /@media \(min-width:901px\) and \(pointer: fine\)\{/);
  const dashboardCssIndex = desktop.indexOf(".dashboardPanel{");
  assert.ok(dashboardCssIndex > desktop.indexOf("@media (min-width:901px) and (pointer: fine){"));
  assert.match(desktop, /body\.dashboardActive \.workspaceNav,\s*\n\s*body\.dashboardActive \.workspaceContent\{ display:none; \}/);
  assert.match(desktop, /body\.dashboardActive \.dashboardPanel\{/);
});

test("the Dashboard panel and its rail-foot entry are hidden by default so touch layouts never render them inline", () => {
  const styles = fs.readFileSync("styles.css", "utf8");
  // Sits with the other base (mobile-first) "hide desktop-only chrome" rules
  // next to .desktopRailVersion; desktop.css opts them back in behind the
  // desktop/fine-pointer query.
  assert.match(styles, /\.desktopRailVersion\{display:none\}\n(?:\/\*[\s\S]*?\*\/\n)?\.workspaceNavFooter\{display:none\}\n\.dashboardPanel\{display:none\}/);
  // desktop.css re-enables the footer inside the shared desktop query.
  assert.match(desktop, /\.workspaceNavFooter\{[\s\S]*?margin-top:auto;[\s\S]*?display:flex;/);
});

test("Dashboard back button and sidebar entry are keyboard-focusable with visible focus styles", () => {
  assert.match(desktop, /\.dashboardBackButton:focus-visible\{ outline:2px solid var\(--focus-border\); outline-offset:2px; \}/);
  assert.match(desktop, /\.workspaceNavDashboard:focus-visible\{/);
  // Real <button> elements, not divs with a click handler.
  assert.match(html, /<button type="button" class="dashboardBackButton"/);
  assert.match(html, /<button class="workspaceNavButton workspaceNavDashboard" id="workspaceNavDashboard" type="button"/);
});

test("the changeover refresh is another entry into the existing wizard, not a second calculator", () => {
  const panel = html.slice(html.indexOf('id="dashboardPanel"'), html.indexOf('</section>', html.indexOf('id="dashboardPanel"')));
  const btn = panel.slice(panel.indexOf('id="dashboardChangeoverRefresh"') - 40, panel.indexOf('</button>', panel.indexOf('id="dashboardChangeoverRefresh"')) + 9);
  // Wired purely by the app's single existing wizard-trigger listener -
  // data-changeover-wizard-trigger - so there is no Dashboard-only handler,
  // no duplicated formula, no independent changeover-time write.
  assert.match(btn, /data-changeover-wizard-trigger/);
  assert.match(btn, /aria-controls="changeoverWizardDialog"/);
  assert.match(btn, /aria-label="Update changeover estimate"/);
  assert.match(btn, /title="Update changeover estimate"/);
  // Sits beside the CHANGEOVER label, not near the hero clock.
  assert.match(panel, /dashboardChangeoverHead[\s\S]*?dashboardLabel[\s\S]*?dashboardChangeoverRefresh[\s\S]*?dashboardChangeoverClock/);
  // Reuses the app's established circular-arrows refresh glyph (same path
  // data the RT Sync refresh control uses), not a new icon.
  assert.match(btn, /M5 7a8 8 0 0 1 13 1l2 3M19 17a8 8 0 0 1-13-1l-2-3/);
  // No new click handler bound to it in app.js.
  assert.doesNotMatch(app, /dashboardChangeoverRefresh/);
  // Theme-aware, visually secondary, still an easy target, clear on hover/focus.
  assert.match(desktop, /\.dashboardChangeoverRefresh\{[\s\S]*?color:var\(--muted\);/);
  assert.match(desktop, /\.dashboardChangeoverRefresh\{[\s\S]*?width:32px;[\s\S]*?height:32px;/);
  assert.match(desktop, /\.dashboardChangeoverRefresh:hover\{/);
  assert.match(desktop, /\.dashboardChangeoverRefresh:focus-visible\{/);
});

test("the sidebar RT logo opens Dashboard through the same setDashboardActive path", () => {
  assert.match(html, /<div class="workspaceBrand" id="workspaceBrandDashboard" role="button" tabindex="0" aria-label="Open Dashboard" title="Open Dashboard">/);
  const fn = app.slice(app.indexOf('const brandDashboard = $("workspaceBrandDashboard");'), app.indexOf('$("dashboardBackButton")?.addEventListener'));
  // One navigation path: the exact same call the bottom link uses, plus
  // Enter/Space for the role="button" markup - never a parallel transition.
  assert.match(fn, /brandDashboard\.addEventListener\("click",\(\)=>setDashboardActive\(true\)\)/);
  assert.match(fn, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(fn, /setDashboardActive\(true\)/);
  assert.doesNotMatch(fn, /dashboardActive\s*=\s*true|classList\.(add|toggle)\("dashboardActive"/);
  // Pointer + visible focus, logo mark itself unchanged.
  assert.match(desktop, /#workspaceBrandDashboard\{[\s\S]*?cursor:pointer;/);
  assert.match(desktop, /#workspaceBrandDashboard:focus-visible\{/);
});

test("desktop-only RT logo entry point does not disturb the mobile brand mark", () => {
  // The mobile logo is a separate .mobileBrand element; only the sidebar
  // .workspaceBrand (display:none at mobile widths) gained the role/handler.
  assert.doesNotMatch(html, /<div class="mobileBrand"[^>]*role="button"/);
  assert.match(html, /<div class="mobileBrand" aria-label="Resin\.Tools">/);
});

test("duplicate line/workspace identity collapses to one row; a distinct name still shows both", () => {
  const fn = app.slice(app.indexOf("function renderDashboardIdentity"), app.indexOf("function renderDashboardChangeover"));
  // Structured comparison via PolynLineIdentity's own normalizer against the
  // "line <n>" identity form - not a parse of the rendered "LINE n" string.
  assert.match(fn, /window\.PolynLineIdentity\?\.normalizeLineName/);
  assert.match(fn, /normalizeLineName\(workspaceName\) === `line \$\{lineNumber\}`/);
  assert.match(fn, /\(lineNumber && !duplicatesLineIdentity\) \? workspaceName : ""/);
  // Display suppression only - the stored workspace name is never rewritten.
  assert.doesNotMatch(fn, /\.name\s*=|selectedWorkspace\.name\s*=/);

  // Independent re-implementation of the rule so app.js and the test cannot
  // drift silently.
  const normalize = v => String(v || "").trim().replace(/\s+/g, " ").toLowerCase();
  const secondRow = (lineNumber, workspaceName) => {
    const dup = !!lineNumber && normalize(workspaceName) === `line ${lineNumber}`;
    return (lineNumber && !dup) ? workspaceName : "";
  };
  assert.equal(secondRow(20, "Line 20"), "", "\"Line 20\" for line 20 is hidden");
  assert.equal(secondRow(20, "  line   20 "), "", "whitespace/case variants still collapse");
  assert.equal(secondRow(20, "LINE 20"), "");
  assert.equal(secondRow(20, "Extrusion West"), "Extrusion West", "a distinct name still shows");
  assert.equal(secondRow(null, "Some Workspace"), "", "no mapped line means no second row, unchanged");
});

test("the rail's version/divider/Dashboard block is bottom-anchored by flex, never absolute positioning", () => {
  const navRule = desktop.slice(desktop.indexOf(".workspaceNav{"), desktop.indexOf("}", desktop.indexOf(".workspaceNav{")) + 1);
  assert.match(navRule, /display:flex;\s*\n\s*flex-direction:column;/);
  // Existing scroll behavior is the graceful-degradation path on short
  // viewports - the rule already carries overflow:auto, no new scrollbar.
  assert.match(navRule, /overflow:auto;/);
  const footerRule = desktop.slice(desktop.indexOf(".workspaceNavFooter{"), desktop.indexOf("}", desktop.indexOf(".workspaceNavFooter{")) + 1);
  assert.match(footerRule, /margin-top:auto;/);
  assert.doesNotMatch(footerRule, /position:absolute/);
  const versionRule = desktop.slice(desktop.indexOf(".desktopRailVersion{"), desktop.indexOf("}", desktop.indexOf(".desktopRailVersion{")) + 1);
  assert.doesNotMatch(versionRule, /position:absolute/);
});
