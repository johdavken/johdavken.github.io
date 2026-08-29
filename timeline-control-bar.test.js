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

test("the three controls sit in one non-wrapping bar with Show all in the leading slot", () => {
  assert.match(html, /<div class="[^"]*\btimelineControlBar\b[^"]*" id="timelineControlsRow">/);
  // Show all is a compact toggle button in the leading group - not a sliding
  // switch. Same underlying id, now a <button> exposing aria-pressed.
  assert.match(
    controls,
    /<span class="timelineControlBarShowAll">\s*<button\s+id="showPumpOffToggle"\s+class="timelineControlToggle"\s+type="button"\s+aria-pressed="false"[\s\S]*?>Show all<\/button>/
  );
  assert.doesNotMatch(controls, /id="showPumpOffToggle"[^>]*role="switch"/);
  assert.doesNotMatch(controls, /id="showPumpOffToggle"[^>]*class="toggle"/);
  assert.match(styles, /\.timelineControlBar\{[\s\S]*?flex-wrap:nowrap;/);
  // Reset + gear are pushed to the trailing edge by the Reset button's margin.
  assert.match(styles, /\.timelineControlBar > #resetTrackingBtn\{ margin-left:auto; \}/);
  // The gear no longer owns the auto margin (Reset does now).
  const gear = styles.slice(styles.indexOf(".timelineDisplayToggle{"), styles.indexOf(".timelineDisplayToggle svg"));
  assert.doesNotMatch(gear, /margin-left:auto/);
});

test("Show all is a compact toggle button: subdued when off, theme-accent tint when on", () => {
  const block = styles.slice(
    styles.indexOf(".timelineControlToggle{"),
    styles.indexOf("\n/* A toggle whose feature has nothing to act on yet")
  );
  // Understated at rest - faint outline, no fill, muted text, sized like the
  // sibling actions.
  assert.match(block, /\.timelineControlToggle\{[\s\S]*?border:1px solid var\(--border2\);[\s\S]*?background:transparent;[\s\S]*?color:var\(--muted\);[\s\S]*?\}/);
  // Active state rides the theme's own accent tokens - no hard-coded colour -
  // and stays light: a --focus-ring wash, --focus-border edge, title-weight ink.
  assert.match(block, /\.timelineControlToggle\[aria-pressed="true"\]\{[\s\S]*?border-color:var\(--focus-border\);[\s\S]*?background:var\(--focus-ring\);[\s\S]*?color:var\(--title\);[\s\S]*?\}/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}\b/);
  assert.match(block, /\.timelineControlToggle:focus-visible\{ outline:2px solid var\(--focus-border\);/);
  // Grows to a comfortable touch target on mobile, same as its siblings.
  assert.match(styles, /@media \(max-width:600px\)\{[\s\S]*?\.timelineControlToggle\{ min-height:36px;[\s\S]*?\}/);
});

test("Show all keeps its exact toggle behaviour - same state, same generic hookToggle wiring", () => {
  // Still routed through hookToggle against the same state flag; only the
  // element type and ARIA attribute changed.
  assert.match(app, /hookToggle\(\s*"showPumpOffToggle",\s*\(\)=> !!state\.showPumpOffTracked,\s*\(v\)=> \{ state\.showPumpOffTracked = !!v; \}\s*\)/);
  // syncToggleUI now writes aria-pressed for toggle buttons, aria-checked for
  // the remaining role="switch" controls - so rebuildUIFromState and resetAll
  // keep re-syncing the button through the exact same call.
  assert.match(app, /if \(el\.hasAttribute\("aria-pressed"\)\) el\.setAttribute\("aria-pressed", String\(!!on\)\);\s*\n\s*else el\.setAttribute\("aria-checked", String\(!!on\)\);/);
  assert.match(app, /syncToggleUI\("showPumpOffToggle", !!state\.showPumpOffTracked\);/);
  // Reset tracking (the Timeline control) clears per-hopper flags only and
  // never touches the Show all view filter - unchanged.
  const rt = app.slice(app.indexOf("function resetTracking(){"), app.indexOf("function resetAll(){"));
  assert.doesNotMatch(rt, /showPumpOffTracked/);
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
