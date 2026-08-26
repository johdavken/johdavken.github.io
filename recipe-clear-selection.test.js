"use strict";

// Recipe Setup's two views each select something, and until now neither had
// a way to unselect in bulk from the grid itself:
//
//   Summary - selecting means tracking. The only way to drop it all was
//             Timeline's own Reset tracking, a panel away from the cells
//             being tapped. Summary now carries its own bar: a live count
//             of tracked hoppers and one Clear tracking action.
//   Edit    - selecting means bulk selection. Phone and tablet now share
//             the same inline panel and the same Clear selection action.
//
// Both clear paths only touch what the view they belong to selects: Clear
// tracking never edits a recipe assignment, and Clear selection never
// mutates a hopper at all.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

const splitsArea = functionBody("renderSplitsArea");

/* ----------------------------------------------------------------------
 *   Summary: the tracking bar
 * -------------------------------------------------------------------- */

test("Summary gets a status + Clear tracking bar, disabled until something is tracked", () => {
  assert.match(splitsArea, /trackingBar\.id = "splitsTrackingBar";/);
  assert.match(splitsArea, /<div id="splitsTrackingStatus" class="tiny splitsSelectionStatus" role="status" aria-live="polite">No hoppers tracked<\/div>/);
  assert.match(splitsArea, /<button id="clearSplitTracking" type="button" class="bulkTextAction" disabled>Clear tracking<\/button>/);
});

test("the count is derived from the page being shown, and refreshes on every path that changes tracking", () => {
  assert.match(splitsArea, /function trackedHopperCount\(\)\{\s*\n\s*return recipeLayers\(\)\.reduce\(\(total,L\)=>total \+ L\.hoppers\.filter\(h=>h\.track\)\.length, 0\);/);
  assert.match(splitsArea, /clearTrackingButton\.disabled = count === 0;/);
  // Every toggle, and once per render so a restored session lands correct.
  assert.match(splitsArea, /hopper\.track = !hopper\.track;\s*\n\s*refreshCellState\(\);\s*\n\s*updateTrackingUI\(\);/);
  assert.match(splitsArea, /updateHopperTotals\(\);\s*\n\s*updateTrackingUI\(\);/);
});

test("Clear tracking clears only runtime tracking state - never a resin, percentage or receiver weight", () => {
  const handler = splitsArea.slice(splitsArea.indexOf('clearTrackingButton.addEventListener("click"'));
  const body = handler.slice(0, handler.indexOf("\n      });") + 9);
  assert.match(body, /if \(!trackedHopperCount\(\)\) return;/);
  assert.match(body, /if \(!confirm\("Untrack every hopper and clear their Pump off status\?"\)\) return;/);
  assert.match(body, /hopper\.track = false;\s*\n\s*hopper\.pumpOff = false;/);
  assert.doesNotMatch(body, /resinName/);
  assert.doesNotMatch(body, /\.pct/);
  assert.doesNotMatch(body, /weight/i);
  // Same live-state notification a single toggle already emits.
  assert.match(body, /validateAndCompute\(\{ sync: true, immediate: true, kind: "tracking" \}\);/);
  assert.match(body, /saveSession\(\);/);
});

test("the bar belongs to Summary alone, and stands down for the mobile rearrange prompt", () => {
  assert.match(splitsArea, /if \(trackingView\) area\.append\(trackingBar\);/);
  assert.match(splitsArea, /if \(trackingView\) actionTray\.append\(trackingBar\);/);
  assert.match(splitsArea, /trackingBar\.hidden=!trackingView\|\|!!hopperRearrangement\?\.active;/);
  // Desktop panel chrome; on the compact mobile tray, Clear tracking moves
  // into .splitsMobilePrimaryRow (see the next test) and this bar keeps
  // only the tracked count, visually hidden but still aria-live.
  assert.match(styles, /\.splitsTrackingBar\{[\s\S]*?background: var\(--readonly-bg\);/);
  assert.match(styles, /\.splitsTrackingBar\[hidden\]\{ display: none; \}/);
  assert.match(styles, /\.splitsTrackingBar\.mobileTrackContext\{[\s\S]*?clip:rect\(0,0,0,0\);/);
  assert.match(styles, /\.splitsTrackingBar\.mobileTrackContext\[hidden\]\{display:none\}/);
});

test("on the compact phone tray, Clear tracking moves into the primary row instead of a dedicated bar", () => {
  // The tracked count next to it wasn't worth its own row on a phone -
  // Recipes/Load Next/More already has room (see the "Done Rearranging"
  // containment comment on the same row).
  const primaryRow = splitsArea.slice(splitsArea.indexOf("let mobilePrimaryRow = null;"), splitsArea.indexOf("mobilePrimaryRow.append(mobileMoreButton);"));
  assert.match(primaryRow, /if \(trackingView\)\{\s*\n\s*clearTrackingButton\.className = "secondary";\s*\n\s*mobilePrimaryRow\.append\(clearTrackingButton\);/);
});

/* ----------------------------------------------------------------------
 *   Edit: mobile's missing Clear selection
 * -------------------------------------------------------------------- */

test("the shared inline editor exposes Clear selection on mobile", () => {
  // Select all was removed: a recipe/weights matrix never has a real use
  // case for selecting every cell at once (Reset Recipe already covers
  // "start over"), so it just cost the row a slot for nothing.
  assert.doesNotMatch(splitsArea, /id="selectAllSplits"/);
  assert.match(splitsArea, /<button id="clearSplitSelection"[^>]*data-button-variant="quiet"[^>]*>Clear selection<\/button>/);
  assert.match(styles, /#splitsArea \.splitsEditRowSecondary > \.splitsBulkActions/);
});

test("Clear drops the selection without touching a single hopper", () => {
  const handler = splitsArea.slice(splitsArea.indexOf('toolbar.querySelector("#clearSplitSelection").addEventListener'));
  const body = handler.slice(0, handler.indexOf("\n      });") + 9);
  assert.match(body, /selected\.clear\(\);\s*\n\s*updateSelectionUI\(\);/);
  assert.doesNotMatch(body, /hopper|resinName|pct|track/);
});

test("it is the same action the Edit panel's own Clear selection performs", () => {
  assert.match(splitsArea, /toolbar\.querySelector\("#clearSplitSelection"\)\.addEventListener\("click",\(\)=>\{\s*\n\s*selected\.clear\(\);\s*\n\s*updateSelectionUI\(\);/);
});
