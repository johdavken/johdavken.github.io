"use strict";

// Starter guide in the Timeline panel: an "i" in the summary bar, opposite
// the TIMELINE title. Opening it drops a concise how-to (down + to the left)
// with three short sections - Timeline, Hookups, Options. Same nested
// <details> pattern as the Recipe icon guide (#recipeInfoLegend): its
// summary click must not bubble out and toggle the panel, and it closes on
// an outside click / Escape. Unlike the Recipe guide it is shown at every
// width - it is conceptual onboarding, not a phone-only icon crib.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function timelineSummary(){
  const block = html.indexOf('id="resultsBlock"');
  const start = html.indexOf("<summary>", block);
  const end = html.indexOf("</summary>", start);
  assert.ok(start > -1 && end > start);
  return html.slice(start, end);
}

function guideMarkup(){
  const s = html.indexOf('<details class="timelineInfoGuide"');
  const e = html.indexOf("</details>", s);
  assert.ok(s > -1 && e > s, "expected #timelineInfoGuide markup");
  return html.slice(s, e);
}

/* -------------------------------------------------------------------
 *   Placement: in the Timeline summary bar, after the status pill
 * ------------------------------------------------------------------- */

test("the guide is a <details id=\"timelineInfoGuide\"> in the Timeline panel's summary, after #timelineSummaryStatus", () => {
  const summary = timelineSummary();
  const pillAt = summary.indexOf('id="timelineSummaryStatus"');
  const guideAt = summary.indexOf('id="timelineInfoGuide"');
  assert.ok(pillAt > -1 && guideAt > pillAt, "guide sits opposite the title, after the status pill");
  assert.match(summary, /<details class="timelineInfoGuide" id="timelineInfoGuide">/);
  assert.match(summary, /<summary aria-label="How to use the Timeline"[^>]*><svg/);
});

/* -------------------------------------------------------------------
 *   Contents: three concise sections
 * ------------------------------------------------------------------- */

test("the guide has exactly the three sections: Timeline, Hookups, Options", () => {
  const guide = guideMarkup();
  const heads = [...guide.matchAll(/<div class="timelineInfoGuideSection">\s*<strong>([^<]+)<\/strong>/g)].map(m => m[1]);
  assert.deepEqual(heads, ["Timeline", "Hookups", "Options"]);
});

test("each section carries a real one-line description", () => {
  const guide = guideMarkup();
  const sections = guide.match(/<div class="timelineInfoGuideSection">[\s\S]*?<\/div>/g) || [];
  assert.equal(sections.length, 3);
  for (const s of sections){
    const text = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    assert.ok(text.length > 60, `section has a real description: ${text.slice(0, 40)}...`);
  }
});

test("the guide names the concrete Timeline controls it is explaining", () => {
  const guide = guideMarkup();
  assert.match(guide, /<b>Show all<\/b>/);
  assert.match(guide, /<b>Reset tracking<\/b>/);
  assert.match(guide, /<b>Hookups<\/b> tab/);
  assert.match(guide, /<b>Timeline Display<\/b>/);
  assert.match(guide, /<b>Next<\/b> resin/);
});

/* -------------------------------------------------------------------
 *   CSS: visible at every width, drops down + right-aligned
 * ------------------------------------------------------------------- */

test("the guide is shown at every width - no display:none / breakpoint gate", () => {
  assert.match(styles, /\.timelineInfoGuide\{ position: relative; flex: 0 0 auto; margin-left: auto; \}/);
  // No rule hides it, and nothing re-enables it inside a media query.
  assert.doesNotMatch(styles, /\.timelineInfoGuide\{[^}]*display:\s*none/);
  assert.doesNotMatch(styles, /#resultsBlock \.timelineInfoGuide\{ display:/);
});

test("the panel drops downward and hugs the right edge (opens to the left)", () => {
  const rule = styles.slice(styles.indexOf(".timelineInfoGuidePanel{"), styles.indexOf("}", styles.indexOf(".timelineInfoGuidePanel{")));
  assert.match(rule, /position: absolute;/);
  assert.match(rule, /top: calc\(100% \+ 6px\);/);
  assert.match(rule, /right: 0;/);
  assert.match(rule, /max-height:/);
  assert.match(rule, /overflow-y: auto;/);
});

/* -------------------------------------------------------------------
 *   Behaviour: never toggles the panel; closes on outside click / Escape
 * ------------------------------------------------------------------- */

test("hookTimelineInfoGuide stops the summary click from bubbling to the panel <summary>", () => {
  assert.match(app, /function hookTimelineInfoGuide\(\)\{[\s\S]*?querySelector\(":scope > summary"\)\?\.addEventListener\("click", event=>\{\s*\n\s*event\.stopPropagation\(\);/);
  assert.match(app, /hookTimelineInfoGuide\(\);/);
});

test("an outside click and Escape close the guide, mirroring the Recipe guide", () => {
  assert.match(app, /const timelineInfoGuide = document\.getElementById\("timelineInfoGuide"\);\s*\n\s*if \(timelineInfoGuide\?\.open && !timelineInfoGuide\.contains\(event\.target\)\) timelineInfoGuide\.open = false;/);
  assert.match(app, /if \(event\.key === "Escape" && timelineInfoGuide\?\.open\)\{\s*\n\s*timelineInfoGuide\.open = false;/);
});

test("the guide's open state is not persisted (not in DETAILS_IDS)", () => {
  const idsBlock = app.slice(app.indexOf("DETAILS_IDS"), app.indexOf("]", app.indexOf("DETAILS_IDS")) + 1);
  assert.doesNotMatch(idsBlock, /timelineInfoGuide/);
});
