"use strict";

/* The application side of the bridge: one connect, one publish, and nothing
 * else. These are source-level assertions because app.js cannot be executed
 * outside a browser - which is exactly why the integration was kept small
 * enough to be described in a handful of checks.
 *
 * What they are guarding against is not a typo. It is the gradual version:
 * a second publish site, a publish moved into a render path, a projection
 * that starts being built eagerly, or `state` itself being handed over
 * because it was more convenient than a closure.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

/* ----------------------------------------------------------------------
 *   The integration is optional
 * -------------------------------------------------------------------- */

test("the application treats the bridge as optional at every call site", () => {
  // If the module fails to load, the floor UI must be completely unaffected.
  assert.match(app, /const stationBridge = window\.PolynStationStateBridge \|\| null;/);
  assert.match(app, /stationBridgeHandle\?\.publish\(\)/,
    "publish must be optional-chained; an absent bridge would otherwise throw on every save");
  assert.match(app, /if \(!stationBridge \|\| stationBridgeHandle\) return;/,
    "connect must bail out when there is no bridge, and must never connect twice");
});

test("a failure inside connect cannot stop the application starting", () => {
  const connect = app.slice(app.indexOf("function connectStationBridge()"));
  const body = connect.slice(0, connect.indexOf("\n  function "));
  assert.match(body, /try\{/);
  assert.match(body, /catch\(error\)\{ stationBridgeHandle = null; \}/);
});

/* ----------------------------------------------------------------------
 *   Exactly one publish, in the right place
 * -------------------------------------------------------------------- */

test("there is exactly one publish site, and it is the session commit point", () => {
  assert.equal((app.match(/stationBridgeHandle\?\.publish\(\)/g) || []).length, 1,
    "a second publish site means state changes are announced from two places");

  const saveSession = app.slice(app.indexOf("function saveSession(){"));
  const body = saveSession.slice(0, saveSession.indexOf("function loadSession()"));
  assert.match(body, /stationBridgeHandle\?\.publish\(\)/, "the publish is not in saveSession");

  // Order matters twice over: after snapshotPayload(), which commits the
  // working Next Recipe, and before the storage-failure return, so state that
  // moved is still announced when persisting it failed.
  assert.ok(
    body.indexOf("snapshotPayload()") < body.indexOf("stationBridgeHandle?.publish()"),
    "publish must come after snapshotPayload() commits the working Next Recipe"
  );
  assert.ok(
    body.indexOf("stationBridgeHandle?.publish()") < body.indexOf("if (!result.ok)"),
    "publish must not sit inside or after the storage-failure branch"
  );
});

test("publish is not wired into a render or tick path", () => {
  // refreshTimelinePresentation deliberately re-renders without changing data.
  // Announcing a state change from there would make the console re-render on
  // every clock tick for no reason.
  const ticker = app.slice(app.indexOf("function refreshTimelinePresentation()"));
  const body = ticker.slice(0, ticker.indexOf("\n    // Started once at app init"));
  assert.doesNotMatch(body, /publish/);
});

test("saveSession's own contract is unchanged", () => {
  const saveSession = app.slice(app.indexOf("function saveSession(){"));
  const body = saveSession.slice(0, saveSession.indexOf("function loadSession()"));
  // Same write, same warning, same two return values as before the bridge.
  assert.match(body, /writeJson\(localStorage, LS_SESSION_KEY, snapshotPayload\(\)\)/);
  assert.match(body, /showStorageWarning\("Autosave failed\. Changes may be lost when this page closes\."\)/);
  assert.match(body, /return false;/);
  assert.match(body, /return true;/);
});

/* ----------------------------------------------------------------------
 *   The raw state object is never handed over
 * -------------------------------------------------------------------- */

test("the bridge is given a projection closure, never the state object", () => {
  assert.equal((app.match(/stationBridge\.connect\s*\(/g) || []).length, 1);
  assert.match(app, /read:\s*\(\)=>stationBridge\.project\(state, \{/,
    "read must build a projection; handing over `state` would expose the live object");
  assert.doesNotMatch(app, /connect\(\s*\{\s*read:\s*\(\s*\)\s*=>\s*state\s*[,}]/);
  assert.doesNotMatch(app, /window\.PolynStationStateBridge\s*=/, "app.js must not replace the bridge module");
});

test("the projection is fed the app's own line configuration and weight resolver", () => {
  // Not re-derived inside the bridge: these are facts the application already
  // resolves, and a second derivation is a second thing that can disagree.
  const connect = app.slice(app.indexOf("function connectStationBridge()"));
  const body = connect.slice(0, connect.indexOf("\n  function "));
  assert.match(body, /lineConfiguration: derivedLineConfiguration\(\)/);
  assert.match(body, /resolveHopperWeight: effectiveHopperWeight/);
});

test("the projection is fed the effective planned recipe and history availability, not the stacks", () => {
  /* The Next recipe must come from the same source the application reads
   * when it needs the effective plan (plannedRecipePayload: the working copy
   * while one is open), not from state.nextRecipe, which lags one save
   * behind. History crosses as two booleans per document. */
  const connect = app.slice(app.indexOf("function connectStationBridge()"));
  const body = connect.slice(0, connect.indexOf("\n  function "));
  assert.match(body, /plannedRecipe: plannedRecipePayload\(\)/);
  assert.doesNotMatch(body, /plannedRecipe: state\.nextRecipe/);
  assert.match(body, /history: recipeHistoryAvailability\(\)/);
  assert.doesNotMatch(body, /recipeEditHistory\b/, "the read closure must not hand the history object over");

  const availability = app.slice(app.indexOf("function recipeHistoryAvailability()"));
  const availabilityBody = availability.slice(0, availability.indexOf("\n    function "));
  assert.match(availabilityBody, /canUndo: recipeEditHistory\[page\]\.undo\.length > 0/);
  assert.match(availabilityBody, /canRedo: recipeEditHistory\[page\]\.redo\.length > 0/);
  assert.doesNotMatch(availabilityBody, /undo:\s*recipeEditHistory|\.undo,|\.undo\s*\}/, "the stacks themselves are exposed");
});

test("no application state is exposed on window beyond the bridge", () => {
  for (const leak of [/window\.state\s*=/, /window\.appState\s*=/, /globalThis\.state\s*=/,
    /window\.PolynAppState\s*=/, /root\.state\s*=/]) {
    assert.doesNotMatch(app, leak, "app.js publishes application state onto a global");
  }
});

/* ----------------------------------------------------------------------
 *   Load order
 * -------------------------------------------------------------------- */

test("the bridge loads before app.js, so connect() finds it", () => {
  const bridgeAt = indexHtml.indexOf("station-state-bridge.js");
  const appAt = indexHtml.indexOf('src="app.js');
  assert.ok(bridgeAt > -1, "index.html does not load the bridge");
  assert.ok(bridgeAt < appAt, "the bridge must be linked before app.js");
  // Both are deferred, so document order is execution order.
  assert.match(indexHtml, /<script src="station-state-bridge\.js\?v=[^"]+" defer><\/script>/);
});

/* ----------------------------------------------------------------------
 *   The bridge did not change how the application renders
 * -------------------------------------------------------------------- */

test("the application's own rendering functions are untouched by the bridge", () => {
  // Nothing that draws should know the bridge exists.
  for (const fn of ["validateAndCompute", "renderResultsFlat", "renderDashboard",
    "renderWeightsArea", "updateFooterNext", "renderLineSync"]) {
    const at = app.indexOf(`function ${fn}(`);
    if (at < 0) continue;
    const body = app.slice(at, at + 6000);
    assert.doesNotMatch(body, /stationBridge/, `${fn} references the Station bridge`);
  }
});

test("the bridge module itself is inert to the application", () => {
  // It registers no listeners, starts no timers, and touches no globals.
  const bridge = fs.readFileSync(path.join(ROOT, "station-state-bridge.js"), "utf8");
  for (const pattern of [/addEventListener/, /setInterval/, /setTimeout/, /requestAnimationFrame/]) {
    assert.doesNotMatch(bridge, pattern, "the bridge schedules or listens for something");
  }
  // queueMicrotask is the one scheduling primitive it may use, and only for
  // coalescing its own notifications.
  assert.match(bridge, /queueMicrotask/);
});
