"use strict";

/* Desktop status-bar "Refresh RT Sync now".
 *
 * Desktop had no way to force a sync while the connection looked healthy.
 * All three existing controls are gated out of the ordinary state:
 *
 *   #lineSyncRetryBtn        only when status is Error/Offline/Conflict
 *   #desktopLineSyncSetupBtn only while this desktop is NOT connected
 *   #lineSyncRetryMobileBtn  .mobileSyncOnly - phones only
 *
 * So a connected desktop refreshed only on its own, via visibilitychange and
 * Realtime. This adds the operator-triggered path, running the same
 * refreshSelected() the other buttons run rather than a new route into RT
 * Sync.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles, ruleIn } = (() => ({
  readStyles: require("./css-source").readStyles,
  ruleIn: require("./css-media").ruleIn,
}))();

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");
const styles = readStyles();

function statusItem(){
  const start = html.indexOf('<div class="workspaceStatusItem lineSyncStatusItem">');
  assert.notEqual(start, -1, "the RT Sync status item is gone");
  return html.slice(start, html.indexOf("</div>", start));
}

test("the refresh control lives in the RT Sync status item, beside the readout it acts on", () => {
  const item = statusItem();
  assert.match(item, /id="lineSyncTopStatus"/);
  assert.match(item, /id="lineSyncRefreshStatusBtn"/);
  assert.match(item, /aria-label="Refresh RT Sync now"/);
  assert.match(item, /title="Refresh RT Sync now"/,
    "a title, since the control is icon-only");
});

test("it ships hidden, and JS owns that attribute - a class alone could not hide it", () => {
  /* The global [hidden]{display:none!important} outranks desktop.css's
   * display:grid, so the attribute is the only thing that can hide this
   * button once the desktop rule matches. That cuts both ways, and cost a
   * real bug earlier: a control revealed by a class while still carrying
   * hidden stays invisible. Here the attribute is the switch, set from
   * whether a line is selected. */
  assert.match(statusItem(), /id="lineSyncRefreshStatusBtn"[^>]*\bhidden\b/);
  assert.match(styles, /\[hidden\]\{display:none!important\}/);
  assert.match(app, /statusRefresh\.hidden = !syncState\.selectedWorkspaceId;/,
    "with no line selected there is nothing to refresh, so the control should be absent");
});

test("it runs the same action as the existing retry buttons, not a new path into RT Sync", () => {
  // reconnectRtSync -> refreshSelected() when a line is selected, retry()
  // otherwise. Reusing it keeps one definition of what "refresh" means.
  assert.match(app, /\$\("lineSyncRefreshStatusBtn"\)\?\.addEventListener\("click",reconnectRtSync\);/);
  assert.match(app, /const reconnectRtSync = \(\)=>runLineSyncAction\(\(\)=>[\s\S]*?lineSync\.refreshSelected\(\)[\s\S]*?: lineSync\.retry\(\)/);
  // No second call site inventing its own reconcile.
  const calls = app.match(/lineSync\.refreshSelected\(\)/g) || [];
  assert.ok(calls.length <= 2, `refreshSelected() has ${calls.length} call sites - expected the setup button and reconnectRtSync only`);
});

test("it is disabled while a sync action is already running, like the other two", () => {
  assert.match(app, /\["lineSyncRetryBtn", "lineSyncRetryMobileBtn", "lineSyncRefreshStatusBtn"\]\.forEach\(id=>\{\s*\n\s*if \(\$\(id\)\) \$\(id\)\.disabled = lineSyncActionInFlight;/);
  // ...and says so, rather than looking idle mid-refresh.
  assert.match(app, /statusRefresh\.dataset\.busy = String\(lineSyncActionInFlight && lineSyncBusyAction === "refresh"\);/);
  assert.match(desktop, /\.statusSyncRefresh\[data-busy="true"\] svg\{animation:statusSyncSpin/);
  assert.match(desktop, /@keyframes statusSyncSpin/);
});

test("desktop and tablet only - phones keep their own Refresh now in the RT Sync panel", () => {
  // Not scoped by a media query of its own: every .workspaceStatusItem is
  // display:none on touch shells except the changeover countdown, so this
  // cannot appear on a phone even with the attribute cleared. Measured at
  // 390: the button computes to a 0x0 box because its item is display:none.
  const touchHide = ruleIn(styles, ".workspaceStatusBar .workspaceStatusItem{", /max-width:\s*900px/);
  assert.ok(touchHide, "the touch-shell rule that hides status items is gone");
  assert.match(touchHide.body, /display:\s*none/);
  // The phone control it complements still exists.
  assert.match(html, /id="lineSyncRetryMobileBtn"/);
  assert.match(html, /class="mobileSyncOnly lineSyncMobileRefresh/);
});

test("styled as an adornment on the readout, not a peer of the wizard trigger beside it", () => {
  assert.match(desktop, /\.statusSyncRefresh\{[^}]*width:22px;height:22px/);
  assert.match(desktop, /\.desktopChangeoverWizardTrigger\{[^}]*width:34px;height:34px/,
    "the precedent this is deliberately one size down from");
  assert.match(desktop, /\.statusSyncRefresh:focus-visible\{outline:var\(--focus-outline\)/);
  assert.match(desktop, /\.statusSyncRefresh\[disabled\]\{opacity:/);
});

test("app.js and desktop.css carry moved ?v= tags, so a returning desktop gets both halves", () => {
  // The button is inert without its handler, and unstyled without the CSS.
  assert.match(html, /app\.js\?v=0\.25\.(1[5-9]|[2-9]\d)/);
  assert.match(html, /desktop\.css\?v=0\.1\.(29|[3-9]\d)/);
});
