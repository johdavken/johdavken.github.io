"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

// The Timeline once had 6 selectable card styles (Soft Cards, Vertical Event
// Rail, Precision Data Strips, Time-First Priority Lane, Borderless Divided
// List, Compact Command). The operator instead selected Schedule Ribbon, so
// the picker and the other styles' CSS are gone. Schedule Ribbon's own
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

test("Timeline uses the compact Schedule Ribbon: a shared spine, status nodes, and one-to-two-line rows", () => {
  const gridStart = styles.indexOf(".resultGrid{");
  const gridRule = styles.slice(gridStart, styles.indexOf("}", gridStart) + 1);
  assert.match(gridRule, /position:relative;/);
  assert.match(gridRule, /padding:10px 12px 10px 26px;/);
  assert.match(gridRule, /border-radius:11px;/);
  assert.match(gridRule, /background:var\(--panel\);/);
  assert.match(gridRule, /width:620px;/);
  assert.match(gridRule, /max-width:100%;/);
  assert.match(styles, /\.resultGrid::before\{[\s\S]*?width:1px;[\s\S]*?background:var\(--row-border-2\);/);

  const start = styles.indexOf(".resultRow{");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /position:relative;/);
  assert.match(rule, /grid-template-columns:43px minmax\(0,1fr\) auto;/);
  assert.match(rule, /min-height:36px;/);

  const beforeStart = styles.indexOf(".resultRow::before{");
  const beforeRule = styles.slice(beforeStart, styles.indexOf("}", beforeStart) + 1);
  assert.match(beforeRule, /border-radius:50%;/);
  assert.match(beforeRule, /background:var\(--focus-border\);/, "the colored schedule node");
  assert.match(styles, /\.resultRow\.done::before\{ background:var\(--row-border\); \}/);
  assert.match(styles, /\.resultRow\.late::before\{ background:var\(--warn\); \}/);

  assert.match(styles, /\.resultHopper\{display:inline-flex;flex:0 0 auto;align-items:center;min-height:22px;/);
  assert.match(styles, /body\[data-theme="gruvbox-light"\] \.resultHopper\{color:#076678\}/);
  assert.match(styles, /body:is\(\[data-theme="industrial-slate-dark"\],\[data-theme="gruvbox-dark"\]\) \.resultHopper\{color:#d65d0e\}/);
});

test("the Start-by/Soonest time value is a compact, strong visual anchor", () => {
  const start = styles.indexOf(".resultTimingValue{");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /color:var\(--text\);/);
  // A late hopper still overrides to the warning color - untouched by this fix.
  assert.match(styles, /\.resultRow\.late \.resultTimingValue\{color:var\(--warn\)\}/);
  const timelineStart = app.indexOf("function renderResultsFlat");
  const timeline = app.slice(timelineStart, app.indexOf("function resetTracking", timelineStart));
  assert.match(timeline, /const timingValue = hasStart \? h\.startByText\.split\(" · ", 1\)\[0\] : "Unavailable";/);
  assert.match(timeline, /const timingTitle = hasStart \? `\$\{timingLabel\}: \$\{h\.startByText\}` : timingLabel;/);
  assert.match(timeline, /const timingParts = hasStart \? \/\^\(\\d\{1,2\}:\\d\{2\}\)\(\?:\\s\+\(\[AP\]M\)\)\?\$\//);
  assert.match(timeline, /class="resultTimingClock" data-timing-clock/);
  assert.match(timeline, /class="resultTimingPeriod" data-timing-period/);
  assert.match(timeline, /timingPeriodNode\.hidden = !timingPeriod;/);
});

test("Timeline time emphasis responds independently on tablet and phone", () => {
  assert.match(styles, /@media \(min-width:701px\)\{[\s\S]*?body\[data-shell="touch"\] #resultsArea\.resultGrid\{ width:min\(760px,100%\); \}[\s\S]*?grid-template-columns:82px minmax\(0,1fr\) auto;[\s\S]*?body\[data-shell="touch"\] #resultsArea \.resultTimingClock\{ font-size:18px; \}/);
  assert.doesNotMatch(styles, /@media \(min-width:701px\)[^{]*pointer:coarse[^}]*\{[\s\S]*?#resultsArea/);
  assert.match(styles, /@media \(max-width:600px\)\{[\s\S]*?\.resultTimingValue\{display:grid;justify-items:end;gap:1px;line-height:1\}[\s\S]*?\.resultTimingClock\{font-size:14px\}[\s\S]*?\.resultTimingPeriod\{font-size:7px\}/);
});

test("Timeline uses a constrained single-column grid and compact schedule regions", () => {
  const gridStart = styles.indexOf(".resultGrid{");
  const gridRule = styles.slice(gridStart, styles.indexOf("}", gridStart) + 1);
  assert.match(gridRule, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(gridRule, /width:620px;/);
  assert.match(gridRule, /max-width:100%;/);
  assert.match(gridRule, /align-items:start;/);
  assert.match(styles, /\.resultSchedule\{min-width:0;font-size:9px;text-align:right\}/);
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
  assert.match(body, /const timingValue = hasStart \? h\.startByText\.split\(" · ", 1\)\[0\] : "Unavailable";/);
  assert.match(body, /class="mono resultHopper"/);
  assert.doesNotMatch(body, /class="pill mono resultHopper"/);
});
