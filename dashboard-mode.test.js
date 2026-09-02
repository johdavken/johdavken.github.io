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

test("sidebar carries an understated Dashboard entry, visually separated near the bottom", () => {
  const nav = html.slice(html.indexOf('<nav class="workspaceNav"'), html.indexOf('</nav>', html.indexOf('<nav class="workspaceNav"')));
  const dividerIndex = nav.indexOf('class="workspaceNavDashboardDivider"');
  const buttonIndex = nav.indexOf('id="workspaceNavDashboard"');
  const versionIndex = nav.indexOf('class="desktopRailVersion"');
  assert.ok(dividerIndex > -1 && buttonIndex > -1 && versionIndex > -1);
  // Sits after every production/support destination, right above the
  // version string - the rail's one pocket of otherwise-unused space.
  assert.ok(dividerIndex < buttonIndex);
  assert.ok(buttonIndex < versionIndex);
  assert.match(nav, /id="workspaceNavSudo"[\s\S]*id="workspaceNavDashboard"/, "Dashboard follows every existing nav item rather than reordering them");
  // No data-workspace-target: Dashboard is a mode switch, not another
  // section the generic setWorkspacePanel wiring should ever drive.
  assert.doesNotMatch(nav.slice(buttonIndex, buttonIndex + 400), /data-workspace-target/);
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

test("Dashboard shows exactly the five approved facts, nothing else", () => {
  const panel = html.slice(html.indexOf('id="dashboardPanel"'), html.indexOf('</section>', html.indexOf('id="dashboardPanel"')));
  ["dashboardLineNumber", "dashboardWorkspaceName", "dashboardChangeoverClock", "dashboardChangeoverRemaining", "dashboardOutputValue", "dashboardNextActionTime", "dashboardNextActionHoppers", "dashboardSyncStatus"].forEach(id => {
    assert.match(panel, new RegExp(`id="${id}"`));
  });
  // The forbidden additions called out explicitly in the spec.
  assert.doesNotMatch(panel, /resinTotal|recipeMatrix|productionHistory|quickAction/i);
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

test("Dashboard back button and sidebar entry are keyboard-focusable with visible focus styles", () => {
  assert.match(desktop, /\.dashboardBackButton:focus-visible\{ outline:2px solid var\(--focus-border\); outline-offset:2px; \}/);
  assert.match(desktop, /\.workspaceNavDashboard:focus-visible\{/);
  // Real <button> elements, not divs with a click handler.
  assert.match(html, /<button type="button" class="dashboardBackButton"/);
  assert.match(html, /<button class="workspaceNavButton workspaceNavDashboard" id="workspaceNavDashboard" type="button"/);
});
