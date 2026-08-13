"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");

// Option 6 ("Dropdown selector") from the Tools-index mockup round,
// implemented for real on mobile: the 2-column grid of tool tabs collapses
// into a single <details> trigger showing the active tool's name; tapping
// it reveals the other four, picking one closes it again. Desktop keeps
// the original always-visible vertical list, completely unchanged.
//
// .toolsIndexDropdown and .toolsIndex are siblings, not nested - an earlier
// attempt nested the real <nav> inside the <details> and tried to force it
// visible via CSS `display` on desktop, which silently failed to paint in
// Chromium: a closed <details>'s non-summary content is treated as
// content-visibility:hidden internally, which skips rendering independently
// of any authored `display` override. As siblings, .toolsIndex is never
// subject to that at all.
//
// Round 2 (option 2, "merged header-select" from the mobile refinement
// mockups): the trigger no longer looks like a boxed pill button - it's
// styled with the same .layerTitle heading treatment (thin weight, tracked
// uppercase, --title color) used everywhere else in the app, because it now
// replaces a real heading: each tool panel used to render its own
// .layerTitle with the same name directly below the trigger, which read as
// the name being printed twice. That per-panel heading is hidden on mobile
// now that the trigger carries the name instead.

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

test(".toolsIndexDropdown and .toolsIndex are siblings in the DOM, not nested - the real tab buttons are never inside the <details>", () => {
  const detailsStart = html.indexOf('<details class="toolsIndexDropdown">');
  assert.notEqual(detailsStart, -1);
  const detailsEnd = html.indexOf("</details>", detailsStart);
  const detailsBody = html.slice(detailsStart, detailsEnd);
  assert.doesNotMatch(detailsBody, /toolsIndexButton/, "the tab buttons must not be inside the <details>");
  assert.match(detailsBody, /toolsIndexDropdownLabel/, "only the summary label lives inside it");
  const afterDetails = html.slice(detailsEnd, detailsEnd + 400);
  assert.match(afterDetails, /<nav class="toolsIndex" role="tablist" aria-label="Production tools">/, "the real nav follows immediately as a sibling");
});

test("all 4 remaining tool tabs are still present and unchanged (same ids, data-tool-target, aria wiring) inside the sibling nav - Production Summary moved out to its own top-level section", () => {
  const navStart = html.indexOf('<nav class="toolsIndex"');
  const navEnd = html.indexOf("</nav>", navStart);
  const nav = html.slice(navStart, navEnd);
  for (const id of ["shortFootageToolTab", "hopperWeightToolTab", "resinLookupToolTab", "recipeScanToolTab"]){
    assert.match(nav, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(nav, /productionSummaryToolTab/);
});

test("on mobile, .toolsIndex is hidden by default and only shown via the adjacent-sibling combinator when the details is [open] - not nested content-visibility tricks", () => {
  const mobileStart = styles.lastIndexOf("@media (max-width: 720px){", styles.indexOf(".toolsIndexDropdown > summary{\n    display: flex;"));
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}", mobileStart));
  assert.match(mobileBlock, /\.toolsIndex\{ display: none; \}/);
  assert.match(mobileBlock, /\.toolsIndexDropdown\[open\] \+ \.toolsIndex\{/);
});

test("the whole .toolsIndexDropdown element (not just its summary) is display:none on desktop, so a closed-but-present <details> never occupies a cell in .toolsWorkspace's 2-column grid", () => {
  const baseRule = styles.slice(styles.indexOf("\n.toolsIndexDropdown{"), styles.indexOf("}", styles.indexOf("\n.toolsIndexDropdown{")) + 1);
  assert.match(baseRule, /display: none;/);
  const baseToolsIndexRule = styles.slice(styles.indexOf("\n.toolsIndex{"), styles.indexOf("}", styles.indexOf("\n.toolsIndex{")) + 1);
  assert.match(baseToolsIndexRule, /display: grid;/, "unconditional - not gated behind [open] or a min-width media query");
});

test("on mobile, .toolsIndexDropdown is restored to display:block so it participates in the single-column layout again", () => {
  const mobileStart = styles.lastIndexOf("@media (max-width: 720px){", styles.indexOf(".toolsIndexDropdown > summary{\n    display: flex;"));
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}", mobileStart));
  assert.match(mobileBlock, /\.toolsIndexDropdown\{ display: block; \}/);
});

test("the mobile trigger is styled as the .layerTitle heading it replaces (thin weight, tracked uppercase, --title color), not a boxed pill", () => {
  const mobileSummaryStart = styles.indexOf(".toolsIndexDropdown > summary{\n    display: flex;");
  assert.notEqual(mobileSummaryStart, -1, "expected a mobile-scoped summary rule using the heading treatment");
  const summaryRule = styles.slice(mobileSummaryStart, styles.indexOf("}", mobileSummaryStart) + 1);
  assert.match(summaryRule, /font-weight: 300;/);
  assert.match(summaryRule, /text-transform: uppercase;/);
  assert.match(summaryRule, /letter-spacing: \.22em;/);
  assert.match(summaryRule, /color: var\(--title, var\(--text\)\);/);
  assert.doesNotMatch(summaryRule, /border: 1px solid/, "should read as a heading, not a bordered pill button");
  assert.doesNotMatch(summaryRule, /background: var\(--btn-primary-a\);/, "should read as a heading, not a tinted pill button");
});

test("the trigger's label truncates with an ellipsis instead of wrapping or overflowing on narrow phones, while the chevron stays visible", () => {
  const labelRule = styles.slice(styles.indexOf(".toolsIndexDropdownLabel{"), styles.indexOf("}", styles.indexOf(".toolsIndexDropdownLabel{")) + 1);
  assert.match(labelRule, /flex: 1 1 auto;/);
  assert.match(labelRule, /min-width: 0;/);
  assert.match(labelRule, /text-overflow: ellipsis;/);
  assert.match(labelRule, /white-space: nowrap;/);
});

test("each tool panel's own duplicate heading is hidden on mobile, since the dropdown trigger above now carries the active tool's name using the same heading treatment", () => {
  const mobileStart = styles.lastIndexOf("@media (max-width: 720px){", styles.indexOf(".toolWorkspacePanel .layerTitle{ display: none; }"));
  assert.notEqual(mobileStart, -1);
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}", mobileStart));
  // A descendant selector, not ">" - Scan Recipe wraps its title one level
  // deeper (inside .toolTitleRow, alongside the "Experimental" badge) than
  // every other panel's title, and a direct-child selector missed it.
  assert.match(mobileBlock, /\.toolWorkspacePanel \.layerTitle\{ display: none; \}/);
});

test("Scan Recipe's title lives inside .toolTitleRow next to the Experimental badge - hiding .layerTitle must not also hide the badge", () => {
  const sectionStart = html.indexOf('id="recipeScanTool"');
  assert.notEqual(sectionStart, -1);
  const sectionBody = html.slice(sectionStart, html.indexOf("</section>", sectionStart));
  assert.match(sectionBody, /<div class="toolTitleRow">\s*<div id="recipeScanTitle" class="layerTitle">Scan Recipe<\/div>\s*<span class="pill badge-warn">Experimental<\/span>/);
});

test("selectToolPanel keeps the dropdown's summary label in sync with whichever tab is active, regardless of how selection changed", () => {
  const body = functionBody("selectToolPanel");
  assert.match(body, /toolsIndexDropdownLabel\.textContent = tab\.textContent;/);
});

test("clicking a tab closes the dropdown, but arrow-key navigation between tabs does not - closing after the first arrow press would prevent browsing the other options", () => {
  // Anchored to the Tools tab wiring: other tab strips (the Recipe
  // Current/Next pages) use the same addEventListener idiom earlier in the
  // file, and an unanchored search would find whichever comes first.
  const toolTabs = app.indexOf("toolTabs.forEach((tab, index)=>{");
  assert.notEqual(toolTabs, -1, "expected the Tools tab wiring");
  const clickStart = app.indexOf('tab.addEventListener("click"', toolTabs);
  const keydownStart = app.indexOf('tab.addEventListener("keydown"', clickStart);
  const clickHandler = app.slice(clickStart, keydownStart);
  const keydownHandler = app.slice(keydownStart, app.indexOf("});", keydownStart) + 3);
  assert.match(clickHandler, /toolsIndexDropdown\.open = false;/);
  assert.doesNotMatch(keydownHandler, /toolsIndexDropdown\.open = false/);
});

test("clicking outside the dropdown, or pressing Escape while it's open, closes it - same established pattern as the appearance-preferences dropdown", () => {
  assert.match(app, /toolsIndexDropdown\?\.open && !toolsIndexDropdown\.contains\(event\.target\)\) toolsIndexDropdown\.open = false;/);
  assert.match(app, /event\.key === "Escape" && toolsIndexDropdown\?\.open/);
});
