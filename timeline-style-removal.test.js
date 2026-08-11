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

test("Timeline cards retain their colored status rail while using compact responsive-grid styling", () => {
  const start = styles.indexOf(".resultRow{");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /position:relative;/);
  assert.doesNotMatch(rule, /min-height:/);
  assert.match(rule, /padding:5px 10px 5px 17px;/);
  assert.match(rule, /border-radius:7px;/);
  assert.match(rule, /background:var\(--panel\);/);

  const beforeStart = styles.indexOf(".resultRow::before{");
  const beforeRule = styles.slice(beforeStart, styles.indexOf("}", beforeStart) + 1);
  assert.match(beforeRule, /background:var\(--focus-border\);/, "the colored left accent bar");
  assert.match(styles, /\.resultRow\.done::before\{ background:var\(--row-border\); \}/);
  assert.match(styles, /\.resultRow\.late::before\{ background:var\(--warn\); \}/);

  assert.match(styles, /\.resultHopper\{font-size:calc\(var\(--font-base\) \+ 1px\);font-weight:950\}/);
});

test("the Start-by/Soonest time value is dark grey, not near-black - it was inheriting --text with no color rule of its own before this fix", () => {
  const start = styles.indexOf(".resultTimingValue{");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /color:var\(--muted\);/);
  // A late hopper still overrides to the warning color - untouched by this fix.
  assert.match(styles, /\.resultRow\.late \.resultTimingValue\{color:var\(--warn\)\}/);
});

test("Timeline uses a constrained single-column grid and compact timing regions", () => {
  const gridStart = styles.indexOf(".resultGrid{");
  const gridRule = styles.slice(gridStart, styles.indexOf("}", gridStart) + 1);
  assert.match(gridRule, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(gridRule, /width:min\(100%,760px\)/);
  assert.match(gridRule, /align-items:start;/);
  assert.match(styles, /\.resultTiming\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(styles, /\.resultStatusChip\{display:inline-flex;align-items:center;min-height:22px/);
});

test("Timeline display rounds only presentation values and uses concise missing-data labels", () => {
  const start = app.indexOf("function renderResultsFlat");
  const body = app.slice(start, app.indexOf("function resetTracking", start));
  assert.match(body, /fmtNum\(h\.weight,1\)\} lb/);
  assert.match(body, /fmtNum\(h\.rate,1\)\} lb\/hr/);
  assert.match(body, /h\.resinName \|\| "No resin"/);
  assert.match(body, /"Not feeding"/);
  assert.match(body, /"Start unavailable"/);
});
