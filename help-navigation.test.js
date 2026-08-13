"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");

const TOP_LEVEL = [
  "helpQuickStart", "helpSetup", "helpHopperPercentages", "helpTimeline",
  "helpCloudSync", "helpTools", "helpRecipeScan", "helpChangelog"
];

/** A topic's markup, tracking <details> depth so nested subtopics are included. */
function topic(id){
  const start = html.indexOf(`<details class="helpTopic" id="${id}"`);
  assert.notEqual(start, -1, `expected a ${id} topic`);
  const tags = /<details\b|<\/details>/g;
  tags.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tags.exec(html))){
    depth += match[0] === "</details>" ? -1 : 1;
    if (depth === 0) return html.slice(start, match.index);
  }
  throw new Error(`${id} has an unbalanced <details>`);
}

/** The body of a CSS rule, matched on the selector at the start of a line. */
function rule(selector, source = styles){
  const at = source.indexOf(`\n${selector}{`);
  assert.notEqual(at, -1, `expected a ${selector} rule`);
  const open = at + selector.length + 1;
  return source.slice(open + 1, source.indexOf("}", open));
}

function accordion(){
  const start = app.indexOf("const helpTopics = [...document.querySelectorAll");
  assert.notEqual(start, -1, "expected the Help accordion wiring in app.js");
  return app.slice(start, app.indexOf("toolTabs.forEach", start));
}

/* ============================================================
 *   Single-open top level
 * ============================================================ */

test("opening a top-level section closes the others", () => {
  const body = accordion();
  assert.match(body, /helpTopics\.forEach\(other=>\{ if \(other !== topic\) other\.open = false; \}\);/);
  // Only direct children of .helpTopics - nested subtopics must be untouched.
  assert.match(body, /querySelectorAll\("#helpBlock \.helpTopics > \.helpTopic"\)/);
});

test("closing a sibling cannot hijack the scroll of the section being opened", () => {
  // Each `other.open = false` fires that sibling's own toggle. Without the
  // guard the two scroll animations fight and the panel lands nowhere.
  const body = accordion();
  assert.match(body, /let helpSwitching = false;/);
  assert.match(body, /if \(helpSwitching\) return;/);
  const openBranch = body.slice(body.indexOf("helpSwitching = true;"));
  assert.match(openBranch, /helpSwitching = true;[\s\S]*?other\.open = false;[\s\S]*?helpSwitching = false;/);
});

test("the accordion extends native <details> rather than replacing the control", () => {
  const body = accordion();
  // `toggle` catches pointer, keyboard and programmatic opens alike, so the
  // native summary keeps its own semantics and focus behaviour.
  assert.match(body, /topic\.addEventListener\("toggle"/);
  assert.doesNotMatch(body, /aria-expanded/, "native <details> already exposes expanded state");
  assert.doesNotMatch(body, /preventDefault/, "the disclosure must stay native");
  // Every top-level section is still a real <details>/<summary> pair.
  for (const id of TOP_LEVEL){
    assert.match(html, new RegExp(`<details class="helpTopic" id="${id}"`), `${id} should stay a native details`);
  }
});

/* ============================================================
 *   Sticky section header
 * ============================================================ */

test("the open section's own header is what sticks - no extra floating control", () => {
  const desktop = styles.slice(styles.indexOf("@media (min-width: 901px){", styles.indexOf(".helpTopic[open] > summary{ border-bottom")));
  assert.match(desktop, /\.helpTopic\[open\] > summary\{[\s\S]*?position: sticky;[\s\S]*?top: 0;/);
  // Reuses the existing summary, so the title, description and +/- ride along.
  assert.match(styles, /\.helpTopic\[open\] > summary::after\{ content: "−"; \}/);
  assert.doesNotMatch(styles, /\.helpStickyClose|\.helpFloatingClose/);
});

test("the sticky header is opaque, or the section scrolls straight through it", () => {
  // --row-bg is a ~5% tint. Used alone the pinned header is see-through, so
  // the tint is layered over the panel's opaque base instead.
  assert.match(styles, /background: linear-gradient\(var\(--row-bg\), var\(--row-bg\)\), var\(--panel\);/);
  assert.match(styles, /--row-bg:\s*rgba\(/, "if --row-bg became opaque this layering can be simplified");
});

test("sticky cannot resolve against the topic card itself", () => {
  // overflow:hidden would make .helpTopic a scrollport and the summary would
  // never stick; clip gives the same rounded-corner clipping without that.
  const card = rule(".helpTopic");
  assert.match(card, /overflow: clip;/);
  assert.doesNotMatch(card, /overflow: hidden;/);
});

test("the Help panel's top padding is moved off the scrollport", () => {
  // Scrollport padding is scrolled through, so content would appear in the
  // strip above the pinned header. The spacing moves onto the content.
  assert.match(styles, /#helpBlock > \.blockBody\{ padding-top: 0; \}/);
  assert.match(styles, /#helpBlock > \.blockBody > \.helpTopics\{ margin-top: 14px; \}/);
});

test("the pinned header sits above the content it covers", () => {
  const desktop = styles.slice(styles.indexOf("@media (min-width: 901px){", styles.indexOf(".helpTopic[open] > summary{ border-bottom")));
  const zIndex = /z-index: (\d+);/.exec(desktop);
  assert.ok(zIndex && Number(zIndex[1]) >= 2, "the sticky header needs a stacking order above body content");
});

/* ============================================================
 *   Scroll behaviour
 * ============================================================ */

test("opening, switching and collapsing all reposition through one helper", () => {
  const body = accordion();
  assert.match(body, /function alignHelpTopic\(/);
  // Aligns to the scroller's content edge, which is where sticky top:0 pins -
  // aligning to the border box would leave a gap the moment it sticks.
  assert.match(body, /parseFloat\(getComputedStyle\(helpScroller\)\.paddingTop\)/);
  // Closing realigns too, so collapsing a long section leaves the row visible
  // instead of stranding the reader down an emptied page.
  assert.match(body, /if \(!topic\.open\)\{\s*\n\s*alignHelpTopic\(topic\);/);
  assert.match(body, /prefers-reduced-motion: reduce/);
});

test("the scroll helper guards against measuring a summary that isn't actually rendered", () => {
  // Mobile no longer hides summaries at all (same accordion list as
  // desktop) - #helpBlock > .blockBody simply isn't an overflow:auto
  // scrollport below 901px (desktop.css), so scrollBy there is a harmless
  // no-op rather than something this guard needs to prevent specifically.
  assert.match(accordion(), /!topic\.querySelector\("summary"\)\?\.offsetParent/);
  assert.doesNotMatch(styles, /mobile-help-active/);
});

/* ============================================================
 *   Nested subtopics
 * ============================================================ */

const EXPECTED_SUBTOPICS = {
  helpSetup: ["Line configuration", "Receiver hopper weights", "Smart Hoppers"],
  helpHopperPercentages: ["Layers across, hoppers down", "The toolbar", "Bulk Edit", "Rearrange", "On mobile"],
  helpTimeline: ["Reading the timeline", "Pump off and reset tracking", "On mobile"],
  helpCloudSync: ["Create the line", "Join it", "Knowing where you stand", "Line actions"],
  helpRecipeScan: ["Job Traveler", "Dosing Screen", "Heat Sheet"]
};

test("long sections are broken into a handful of named subtopics", () => {
  for (const [id, expected] of Object.entries(EXPECTED_SUBTOPICS)){
    const titles = [...topic(id).matchAll(/<details class="helpSubtopic"[^>]*>\s*<summary><span>([^<]+)<\/span>/g)].map(m => m[1]);
    assert.deepEqual(titles, expected, `${id} subtopics`);
    assert.ok(titles.length >= 3 && titles.length <= 6, `${id} should carry 3-6 subtopics, has ${titles.length}`);
  }
});

test("short sections and the changelog are deliberately left flat", () => {
  // Nesting a two-screen section, or a reverse-chronological release list,
  // adds a click without adding orientation.
  for (const id of ["helpQuickStart", "helpTools", "helpChangelog"]){
    assert.doesNotMatch(topic(id), /helpSubtopic/, `${id} should stay a single flow`);
  }
});

test("each section opens showing content, not just a list of closed rows", () => {
  for (const id of Object.keys(EXPECTED_SUBTOPICS)){
    const body = topic(id);
    const first = body.indexOf('<details class="helpSubtopic"');
    // Scan Recipe leads with a shared intro and tip, so its sources may all
    // start closed; the rest open their first subtopic.
    if (id === "helpRecipeScan") continue;
    assert.match(body.slice(first, first + 60), /helpSubtopic" open>/, `${id}'s first subtopic should start open`);
  }
});

test("subtopics keep their own screenshots, captions and callouts", () => {
  const recipe = topic("helpHopperPercentages");
  const bulkEdit = recipe.slice(recipe.indexOf("<span>Bulk Edit</span>"), recipe.indexOf("<span>Rearrange</span>"));
  assert.match(bulkEdit, /recipe-bulk-grid\.png/);
  assert.match(bulkEdit, /recipe-bulk-panel\.png/);
  assert.match(bulkEdit, /<figcaption>The panel walks the same three stages every time\.<\/figcaption>/);
  assert.match(bulkEdit, /Reset all<\/span> empties every resin field/);
  // The heat sheet example belongs to the Heat Sheet source, not the others.
  const scan = topic("helpRecipeScan");
  const heatSheet = scan.slice(scan.indexOf("<span>Heat Sheet</span>"));
  assert.match(heatSheet, /heat-sheet-example\.jpg/);
  const dosing = scan.slice(scan.indexOf("<span>Dosing Screen</span>"), scan.indexOf("<span>Heat Sheet</span>"));
  assert.doesNotMatch(dosing, /heat-sheet-example/);
});

test("no section-dividing rule or heading is left orphaned by the move", () => {
  // The subtopic rules replace the <hr>/<h3> pairs that used to divide these
  // sections; leaving either behind would double the separator.
  for (const id of Object.keys(EXPECTED_SUBTOPICS)){
    const body = topic(id);
    assert.doesNotMatch(body, /helpRule/, `${id} should no longer need horizontal rules`);
    assert.doesNotMatch(body, /<h3>/, `${id}'s headings became subtopic summaries`);
  }
});

/* ============================================================
 *   Subordinate styling and mobile
 * ============================================================ */

test("subtopics read as secondary to the section headers", () => {
  const sub = rule(".helpSubtopic > summary span");
  const top = rule(".helpTopic > summary span");
  // Body colour and lighter weight against the section's blue 900.
  assert.match(sub, /color: var\(--text\);/);
  assert.match(top, /color: var\(--title\);/);
  assert.match(sub, /font-weight: 800;/);
  assert.match(top, /font-weight: 900;/);
  // A hairline rule, not another bordered card.
  const card = rule(".helpSubtopic");
  assert.match(card, /border-top: 1px solid var\(--row-border\);/);
  assert.doesNotMatch(card, /background:/, "a subtopic must not read as a second card");
  assert.doesNotMatch(card, /box-shadow:/);
});

test("subtopics use spacing rather than indentation on phones", () => {
  const mobile = styles.slice(styles.indexOf("@media (max-width: 900px){", styles.indexOf("\n.helpSubtopicBody{")));
  const block = mobile.slice(0, mobile.indexOf("\n}"));
  assert.match(block, /\.helpSubtopic > summary\{ padding: 12px 32px 12px 0; min-height: 44px;/);
  // No left indent at any width - horizontal room is scarce on a phone.
  assert.doesNotMatch(styles, /\.helpSubtopic[^{]*\{[^}]*margin-left:/);
  assert.doesNotMatch(styles, /\.helpSubtopic[^{]*\{[^}]*padding-left:/);
});

test("subtopic headers stay keyboard operable with a visible focus ring", () => {
  assert.match(styles, /\.helpSubtopic > summary:focus-visible\{[\s\S]*?outline: 2px solid var\(--focus-border\);/);
  // Native <summary> is focusable and toggles on Enter/Space by default; the
  // markup must not have swapped it for a div.
  const subtopics = [...html.matchAll(/<details class="helpSubtopic"[^>]*>\s*<summary>/g)];
  assert.equal(subtopics.length, 18, "every subtopic should be a native details/summary pair");
});
