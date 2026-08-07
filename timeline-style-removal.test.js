"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

// The Timeline once had 6 selectable card styles (Soft Cards, Vertical Event
// Rail, Precision Data Strips, Time-First Priority Lane, Borderless Divided
// List, Compact Command). The operator only ever wanted Compact Command, so
// the picker and the other 5 styles' CSS are gone - Compact Command's own
// rules are now just the base .resultRow/.resultHopper/etc. rules,
// unconditional, with no body[data-timeline-style="..."] switch left to key
// off of.

test("the Timeline style picker is gone from Settings, and so is the body attribute it used to drive", () => {
  // timelineStyleSel is gone outright - no id, no label referencing it. The
  // words "Timeline style" can still legitimately appear in the Changelog's
  // prose describing this same removal, so that phrase alone isn't checked.
  assert.doesNotMatch(html, /timelineStyleSel/);
  assert.doesNotMatch(html, /data-timeline-style/);
});

test("app.js has no remaining timelineStyle state, apply function, or select listener", () => {
  assert.doesNotMatch(app, /timelineStyle/i);
  assert.doesNotMatch(app, /applyTimelineStyle/);
});

test("styles.css has no leftover body[data-timeline-style=...] rules for any of the 5 removed styles", () => {
  assert.doesNotMatch(styles, /data-timeline-style/);
  for (const removed of ["soft-cards", "event-rail", "data-strips", "priority-lane", "divided-list"]){
    assert.doesNotMatch(styles, new RegExp(removed.replace("-", "\\-")));
  }
});

test("Compact Command's look (rounded panel card, colored accent bar, bold hopper label) is now the unconditional base .resultRow style", () => {
  const start = styles.indexOf(".resultRow{");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /position: relative;/);
  assert.match(rule, /min-height: 48px;/);
  assert.match(rule, /padding: 6px 9px 6px 17px;/);
  assert.match(rule, /border-radius: 7px;/);
  assert.match(rule, /background: var\(--panel\);/);

  const beforeStart = styles.indexOf(".resultRow::before{");
  const beforeRule = styles.slice(beforeStart, styles.indexOf("}", beforeStart) + 1);
  assert.match(beforeRule, /background:var\(--focus-border\);/, "the colored left accent bar");
  assert.match(styles, /\.resultRow\.done::before\{ background:var\(--row-border\); \}/);
  assert.match(styles, /\.resultRow\.late::before\{ background:var\(--warn\); \}/);

  assert.match(styles, /\.resultHopper\{ font-size:calc\(var\(--font-base\) \+ 1px\); font-weight:950; \}/);
});

test("the Start-by/Soonest time value is dark grey, not near-black - it was inheriting --text with no color rule of its own before this fix", () => {
  const start = styles.indexOf(".resultTimingValue{");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /color:var\(--muted\);/);
  // A late hopper still overrides to the warning color - untouched by this fix.
  assert.match(styles, /\.resultRow\.late \.resultTimingValue\{ color:var\(--warn\); \}/);
});

test("on mobile, the Start-by/checkbox group can wrap instead of overflowing past the card's left edge", () => {
  const resultRowBase = styles.indexOf(".resultRow{");
  const mediaStart = styles.indexOf("@media (max-width:600px){", resultRowBase);
  assert.notEqual(mediaStart, -1);
  const media = styles.slice(mediaStart, styles.indexOf("\n}\n", mediaStart));
  const timingStart = media.indexOf(".resultTiming{");
  const timingRule = media.slice(timingStart, media.indexOf("}", timingStart) + 1);
  assert.match(timingRule, /white-space:normal;/,
    "resets the base rule's white-space:nowrap, which - combined with justify-content:flex-end - was overflowing leftward past the card instead of wrapping");
  assert.match(timingRule, /flex-wrap:wrap;/, "second line of defense if the wrapped text still doesn't fit on one row");
  assert.match(timingRule, /justify-content:flex-end;/);
});
