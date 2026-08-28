"use strict";

// The Timeline controls - Show all, Reset tracking, and the settings gear -
// are refined into one cohesive control bar in the same slot. This is a
// presentation change only: every existing behaviour is preserved.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const controls = html.slice(
  html.indexOf('id="timelineControlsRow"'),
  html.indexOf('id="resultsArea"')
);

test("the standalone 'Sorted by upcoming time' caption is gone from the Timeline pane", () => {
  const pane = html.slice(html.indexOf('<div id="timelinePane">'), html.indexOf('id="resultsArea"'));
  assert.doesNotMatch(pane, /Sorted by upcoming time/);
});

test("the three controls sit in one non-wrapping bar with Show all grouped and prominent", () => {
  assert.match(html, /<div class="[^"]*\btimelineControlBar\b[^"]*" id="timelineControlsRow">/);
  // Label and toggle stay welded together as the Show all group.
  assert.match(
    controls,
    /<span class="timelineControlBarShowAll">\s*<span class="trackLabel">Show all<\/span>\s*<div\s+id="showPumpOffToggle"/
  );
  assert.match(styles, /\.timelineControlBar\{[\s\S]*?flex-wrap:nowrap;/);
  // Reset + gear are pushed to the trailing edge by the Reset button's margin.
  assert.match(styles, /\.timelineControlBar > #resetTrackingBtn\{ margin-left:auto; \}/);
  // The gear no longer owns the auto margin (Reset does now).
  const gear = styles.slice(styles.indexOf(".timelineDisplayToggle{"), styles.indexOf(".timelineDisplayToggle svg"));
  assert.doesNotMatch(gear, /margin-left:auto/);
});

test("Reset tracking is a quiet icon-text action, not a large outlined button", () => {
  assert.match(controls, /id="resetTrackingBtn"\s+class="timelineControlAction"/);
  assert.doesNotMatch(controls, /id="resetTrackingBtn"[^>]*\bcopyBtn\b/);
  // An SVG glyph, not a text arrow.
  assert.match(controls, /id="resetTrackingBtn"[\s\S]*?<svg[\s\S]*?<\/svg>/);
  assert.doesNotMatch(controls, /↺|↻|⟲/);
  // Full label on desktop/tablet, short label swapped in on narrow mobile.
  assert.match(controls, /<span class="timelineControlActionFull">Reset tracking<\/span>/);
  assert.match(controls, /<span class="timelineControlActionShort">Reset<\/span>/);
  assert.match(styles, /\.timelineControlActionShort\{ display:none; \}/);
  assert.match(
    styles,
    /@media \(max-width:600px\)\{[\s\S]*?\.timelineControlActionFull\{ display:none; \}[\s\S]*?\.timelineControlActionShort\{ display:inline; \}[\s\S]*?\}/
  );
  // No border/background at rest; subtle hover/active/focus treatment.
  assert.match(styles, /\.timelineControlAction\{[\s\S]*?border:1px solid transparent;[\s\S]*?background:transparent;[\s\S]*?\}/);
  assert.match(styles, /\.timelineControlAction:hover\{/);
  assert.match(styles, /\.timelineControlAction:focus-visible\{ outline:2px solid var\(--focus-border\);/);
});

test("the settings icon is a cog, not the radial sun used by the global display control", () => {
  const btn = controls.slice(controls.indexOf('id="timelineDisplayToggle"'));
  assert.match(btn, /aria-label="Timeline settings"/);
  assert.match(btn, /title="Timeline settings"/);
  // The old icon was a centre dot plus straight rays - the same shape as
  // #desktopDisplayToggle's brightness icon. That path is gone.
  assert.doesNotMatch(btn, /M12 3\.5v3M12 17\.5v3/);
  // A cog: a hub circle plus a toothed ring drawn with 2x2 corner arcs.
  assert.match(btn, /<circle cx="12" cy="12" r="3"\/>/);
  assert.match(btn, /a2 2 0/);
});

test("Reset tracking keeps its exact behaviour - same handler, same confirm", () => {
  assert.match(app, /\$\("resetTrackingBtn"\)\?\.addEventListener\("click", resetTracking\);/);
  const start = app.indexOf("function resetTracking(");
  const body = app.slice(start, app.indexOf("\n    function ", start + 1));
  assert.match(body, /confirm\("Untrack all hoppers and clear their Pump off status\?"\)/);
  assert.match(body, /h\.track = false;/);
  assert.match(body, /h\.pumpOff = false;/);
  assert.match(body, /notifyActiveJobMutation\(\{ immediate: true, kind: "reset-tracking" \}\);/);
});

test("the settings gear still opens the shared footer sheet, unchanged", () => {
  assert.match(controls, /id="timelineDisplayToggle"[\s\S]*?aria-haspopup="dialog"[\s\S]*?aria-controls="timelineDisplaySheet"/);
  assert.match(app, /timelineDisplay: \[\$\("timelineDisplayToggle"\), \$\("timelineDisplaySheet"\)\]/);
  assert.match(app, /setFooterSheetOpen\("timelineDisplay", true, event\.currentTarget\)/);
});
