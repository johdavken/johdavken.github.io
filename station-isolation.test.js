"use strict";

/* Station must not be able to affect the production floor UI.
 *
 * The safety rule for this phase is that the existing desktop/mobile/tablet
 * interface is untouched. "We were careful" is not a mechanism, so this file
 * is the mechanism: it checks the boundary in both directions, and it checks
 * the properties that would let Station leak across it even while the two
 * file sets stay separate.
 *
 * If a future phase deliberately connects Station to the app, the connection
 * should be a shared MODULE both pages load - which these tests allow - and
 * never a stylesheet or a global that one page inherits from the other.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const STATION = path.join(ROOT, "station");

const STATION_FILES = ["station-line-model.js", "station-render.js", "station.js",
  "station-demo-lines.js", "station-source.js", "station-shell.js",
  "station-machine-layout.js", "station-machine-parts.js", "station-extruder-lab.js",
  "station-extruder-assets.js", "station-mixer-assets.js", "station-transition.js",
  "station-focus-editor.js", "station-sync-console.js", "station-hopper-controls.js",
  "station-rundown.js", "station-armed.js", "station-rundown-timeline.js", "station-hopper-info.js", "station-job-controls.js",
  "station-handbook.js", "station-recipe-book.js", "station-resin-totals.js", "station-appearance.js", "station-theme-preview.js",
  "station-changeover.js", "station-winding-tension.js", "station-print-sheet.js", "station-avatar.js", "station-machine-rail.js", "station-logo.js",
  "station-sudo.js", "station-sudo-workspaces.js", "station-sudo-lines.js", "station-weights.js", "station-weight-cards.js", "station-plan-controls.js"];

const stationHtml = fs.readFileSync(path.join(STATION, "station.html"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function stationStylesheets() {
  const dir = path.join(STATION, "styles");
  const out = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) out.push(full);
    }
  })(dir);
  return out;
}

/* Selector text of every rule, with comments and at-rule preludes removed.
 * Good enough to answer "what does this stylesheet claim to style", which is
 * the only question these tests ask of it. */
function selectorsIn(css) {
  const withoutComments = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    /* @keyframes is a different grammar: `from`, `to` and `40%` are stops, not
     * selectors, and reading them as selectors would demand they be namespaced
     * - which is not a thing a keyframe stop can be. The keyframe NAME is
     * still namespaced, and the rule that applies it is still checked. */
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const selectors = [];
  const pattern = /(^|[}{;])\s*([^{}@;]+?)\s*\{/g;
  let match;
  while ((match = pattern.exec(withoutComments))) {
    const text = match[2].trim();
    if (!text || text.startsWith("@")) continue;
    for (const part of text.split(",")) {
      const one = part.trim();
      if (one) selectors.push(one);
    }
  }
  return selectors;
}

const allStationCss = stationStylesheets().map(file => ({
  name: path.relative(ROOT, file),
  css: fs.readFileSync(file, "utf8")
}));

/* ----------------------------------------------------------------------
 *   The two pages do not share a stylesheet
 * -------------------------------------------------------------------- */

/* The sanctioned connections between the application and Station. Named here,
 * in one place, so widening the boundary is an edit to this list and shows up
 * in review as exactly that - rather than as a new script tag nobody reads.
 *
 *   station-state-bridge.js      the read-only state window (app.js publishes)
 *   station-host.js              the ?view=station activation switch
 *   station-command-contract.js  what a Station write request is (pure)
 *   station-command-bridge.js    the letterbox for such requests; app.js
 *                                connects its one executor (an adapter over
 *                                the grid's own mutation tails), and the
 *                                focused editor is the one Station file
 *                                that dispatches through it
 *   station-connection-bridge.js the line connection: RT Sync's state as a
 *                                projected descriptor (app.js publishes from
 *                                its own sync render) and a letterbox for
 *                                the four RT Sync actions Station may ask
 *                                for, each an application closure; the line
 *                                console is the one Station file that
 *                                requests through it
 *   station-recipes-bridge.js    the workspace's saved recipes: the
 *                                configurations service's cached book as a
 *                                projected list (app.js publishes when the
 *                                cache or the workspace moves) and a
 *                                letterbox for the three Recipe Book
 *                                actions, each an application closure; the
 *                                Recipe Book is the one Station file that
 *                                requests through it
 *   station-admin-bridge.js      administrator access and Workspace
 *                                Management: the admin service's public
 *                                state and this device's RT Sync identity
 *                                as a projected descriptor (app.js
 *                                publishes when either moves) and a
 *                                letterbox for the admin actions, each an
 *                                application closure over the SAME admin
 *                                session and workspace procedures the
 *                                floor UI's Sudo panel runs; Sudo and its
 *                                Workspace Management tool are the two
 *                                Station files that request through it
 *
 * All are inert on a normal load: the bridges only bump a revision nobody
 * reads, the host returns before touching the document, and the command
 * pair and the connection letterbox are never called by the floor UI.
 */
const SHARED_BRIDGE = "station-state-bridge.js";
const STATION_HOST = "station-host.js";
const COMMAND_CONTRACT = "station-command-contract.js";
const COMMAND_BRIDGE = "station-command-bridge.js";
const CONNECTION_BRIDGE = "station-connection-bridge.js";
const RECIPES_BRIDGE = "station-recipes-bridge.js";
const ADMIN_BRIDGE = "station-admin-bridge.js";
const WEIGHT_PROFILES_BRIDGE = "station-weight-profiles-bridge.js";
const THEME = "station-theme.js";
const INDEX_STATION_ASSETS = [SHARED_BRIDGE, STATION_HOST, COMMAND_CONTRACT, COMMAND_BRIDGE, CONNECTION_BRIDGE, RECIPES_BRIDGE, ADMIN_BRIDGE, WEIGHT_PROFILES_BRIDGE, THEME].sort();

/* The one Station stylesheet permitted to name an application selector, use
 * !important, or style a bare element: hiding the application's shell is
 * inherently a cross-boundary act and has to live somewhere. It is excluded
 * from the rules below and held to STRICTER ones of its own in
 * station-host-isolation.test.js - every selector gated on the Station view
 * attribute, and a hard cap on how big it may get. */
const INTEGRATION_SHEET = "host.css";

function componentSheets() {
  return allStationCss.filter(sheet => !sheet.name.endsWith(INTEGRATION_SHEET));
}

test("index.html loads only the sanctioned Station assets", () => {
  // Asset references only. The word "station" also appears in the changelog
  // prose, and a substring match on the whole file would fail on that -
  // passing for a while, then failing for a reason that has nothing to do
  // with the boundary being checked.
  const references = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  const stationAssets = references
    .map(reference => reference.split("?")[0])
    .filter(reference => /(^|\/)station[-/]/.test(reference));
  assert.deepEqual(stationAssets.sort(), INDEX_STATION_ASSETS,
    "index.html may load the state bridge and the host switch, and no other Station asset");
  assert.ok(!/["'\/]station\//.test(indexHtml), "index.html references the station/ directory");
});

test("the state bridge touches no DOM and reaches nothing outside itself", () => {
  // It is loaded by the production page, so it has to be as inert as the
  // other shared modules: no rendering, no storage, no network.
  const bridge = fs.readFileSync(path.join(ROOT, SHARED_BRIDGE), "utf8");
  for (const pattern of [/\bdocument\b/, /localStorage/, /\bfetch\s*\(/, /supabase/i, /XMLHttpRequest/]) {
    assert.doesNotMatch(bridge, pattern, `${SHARED_BRIDGE} reaches outside itself`);
  }
});

test("the bridge gives consumers no way to write - publish lives only on the producer handle", () => {
  const bridge = require("./station-state-bridge.js");
  for (const forbidden of ["publish", "disconnect", "setState", "getState", "state"]) {
    assert.equal(bridge[forbidden], undefined,
      `the module surface exposes ${forbidden}, which would make it writable by any consumer`);
  }
  assert.ok(Object.isFrozen(bridge), "the module surface is not frozen, so a consumer could replace getSnapshot");
});

test("the command pair touches no DOM and reaches nothing outside itself either", () => {
  for (const file of [COMMAND_CONTRACT, COMMAND_BRIDGE]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const pattern of [/\bdocument\b/, /localStorage/, /\bfetch\s*\(/, /supabase/i, /XMLHttpRequest/, /addEventListener/]) {
      assert.doesNotMatch(source, pattern, `${file} reaches outside itself`);
    }
  }
  // Loaded after hookup-sources.js, which the contract normalizes sources
  // through, and before app.js, which connects the producer.
  for (const page of [indexHtml, stationHtml]) {
    assert.ok(page.indexOf("hookup-sources.js") < page.indexOf(COMMAND_CONTRACT));
    assert.ok(page.indexOf(COMMAND_CONTRACT) < page.indexOf(COMMAND_BRIDGE));
  }
  assert.ok(indexHtml.indexOf(COMMAND_BRIDGE) < indexHtml.indexOf('src="app.js'));
});

/* ----------------------------------------------------------------------
 *   The connection bridge is a window and a letterbox, never a sync client
 * -------------------------------------------------------------------- */

/* What RT Sync is made of, by name. None of it may appear in a Station
 * file or in the connection bridge: not the client library, not a channel,
 * not a table, not an RPC, not the storage keys, not the outbox, and not
 * the application's own sync module or its other narrow bridges. */
const RT_SYNC_INTERNALS = [
  /supabase/i, /realtime/i, /\.channel\s*\(/, /postgres_changes/, /\.rpc\s*\(/, /\.from\s*\(\s*["'`]/,
  /line_workspaces?\b/, /line_workspace_members/, /active_jobs/, /saved_setups/, /workspace_configurations/,
  /update_active_job/, /generate_link_code/, /join_workspace/,
  /PolynCloudSync/, /PolynSyncStorage/, /PolynRtSyncBridge/, /PolynRecipeScanBridge/, /PolynBetaAccessBridge/,
  /polyn\.lineSync/, /outbox/i, /access_token/, /accessToken/, /getSession/, /signInAnonymously/,
  /localStorage/, /sessionStorage/, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/,
  /location\.reload/, /\.reload\s*\(/
];

test("the connection bridge touches no DOM and names no RT Sync internal", () => {
  const source = fs.readFileSync(path.join(ROOT, CONNECTION_BRIDGE), "utf8");
  for (const pattern of [/\bdocument\b/, /addEventListener/, ...RT_SYNC_INTERNALS]) {
    assert.doesNotMatch(source, pattern, `${CONNECTION_BRIDGE} reaches outside itself (matched ${pattern})`);
  }
  // Loaded after the state bridge it is built on, and before app.js, which
  // connects the producer - on both pages.
  for (const page of [indexHtml, stationHtml]) {
    assert.ok(page.indexOf(SHARED_BRIDGE) < page.indexOf(CONNECTION_BRIDGE), "the connection bridge loads before the state bridge it requires");
  }
  assert.ok(indexHtml.indexOf(CONNECTION_BRIDGE) < indexHtml.indexOf('src="app.js'));
});

test("the connection bridge gives consumers no way to publish, and its action vocabulary is closed", () => {
  const bridge = require("./station-connection-bridge.js");
  for (const forbidden of ["publish", "disconnect", "setStatus", "setState", "state"]) {
    assert.equal(bridge[forbidden], undefined, `the module surface exposes ${forbidden}`);
  }
  assert.ok(Object.isFrozen(bridge));
  assert.ok(Object.isFrozen(bridge.ACTIONS));
  assert.deepEqual([...bridge.ACTIONS], ["refresh", "reconnect", "generateJoinCode", "renderJoinQr"],
    "a new RT Sync action Station may ask for arrives as an edit to this list");
});

test("the recipes bridge touches no DOM, names no RT Sync internal, and knows no cache key or payload rule", () => {
  const source = fs.readFileSync(path.join(ROOT, RECIPES_BRIDGE), "utf8");
  for (const pattern of [/\bdocument\b/, /addEventListener/, /polyn\.workspaceConfigurations/, /createRecipePayload/, /PolynWorkspaceConfigurations\b/, ...RT_SYNC_INTERNALS]) {
    assert.doesNotMatch(source, pattern, `${RECIPES_BRIDGE} reaches outside itself (matched ${pattern})`);
  }
  for (const page of [indexHtml, stationHtml]) {
    assert.ok(page.indexOf(SHARED_BRIDGE) < page.indexOf(RECIPES_BRIDGE), "the recipes bridge loads before the state bridge it requires");
  }
  assert.ok(indexHtml.indexOf(RECIPES_BRIDGE) < indexHtml.indexOf('src="app.js'));
  const bridge = require("./station-recipes-bridge.js");
  for (const forbidden of ["publish", "disconnect", "setBook", "setState", "state"]) {
    assert.equal(bridge[forbidden], undefined, `the module surface exposes ${forbidden}`);
  }
  assert.ok(Object.isFrozen(bridge));
  assert.deepEqual([...bridge.ACTIONS], ["saveCurrentRecipe", "replaceRecipe", "loadRecipe", "renameRecipe", "duplicateRecipe", "deleteRecipe", "refresh"],
    "a new saved-recipe action Station may ask for arrives as an edit to this list");
});

test("the admin bridge touches no DOM, names no RT Sync internal, and holds no session, client or procedure of its own", () => {
  const source = fs.readFileSync(path.join(ROOT, ADMIN_BRIDGE), "utf8");
  for (const pattern of [/\bdocument\b/, /addEventListener/, /PolynResinAdmin/, /PolynWorkspaceRecovery/, /admin_users/, /signInWithPassword/, /createClient/, ...RT_SYNC_INTERNALS]) {
    assert.doesNotMatch(source, pattern, `${ADMIN_BRIDGE} reaches outside itself (matched ${pattern})`);
  }
  for (const page of [indexHtml, stationHtml]) {
    assert.ok(page.indexOf(SHARED_BRIDGE) < page.indexOf(ADMIN_BRIDGE), "the admin bridge loads before the state bridge it requires");
  }
  // Its producer is the floor UI's Workspace Management file, not app.js:
  // RT Sync's side of the application never learns the admin session exists.
  assert.ok(indexHtml.indexOf(ADMIN_BRIDGE) < indexHtml.indexOf("workspace-recovery-ui.js"));
  const bridge = require("./station-admin-bridge.js");
  for (const forbidden of ["publish", "disconnect", "setAccess", "setState", "state", "signIn", "getClient"]) {
    assert.equal(bridge[forbidden], undefined, `the module surface exposes ${forbidden}`);
  }
  assert.ok(Object.isFrozen(bridge));
  assert.deepEqual([...bridge.ACTIONS], [
    "signIn", "signOut", "listWorkspaces", "workspaceDevices", "addThisDevice", "createLine", "renameLine",
    "transferOwnership", "disconnectDevice", "mergeWorkspace", "deleteWorkspace",
    "listLineConfigurations", "saveLineConfiguration",
    "listResins", "saveResin", "deleteResin"
  ], "a new administrator action Station may ask for arrives as an edit to this list");
});

test("no Station file names an RT Sync internal, subscribes to anything but the bridges, or reloads the page", () => {
  for (const file of STATION_FILES) {
    const source = fs.readFileSync(path.join(STATION, file), "utf8");
    for (const pattern of RT_SYNC_INTERNALS) {
      assert.doesNotMatch(source, pattern, `${file} reaches into RT Sync (matched ${pattern})`);
    }
    // The only subscriptions Station holds are to the windows the
    // application publishes through: the state bridge, the connection
    // bridge, the recipes bridge, the weight-profiles bridge and the admin
    // bridge. Anything else would be a second live feed.
    for (const match of source.matchAll(/(\w+)\??\.subscribe\s*\(/g)) {
      assert.ok(["bridge", "connection", "recipes", "weightProfiles", "admin"].includes(match[1]),
        `${file} subscribes to "${match[1]}", which is none of the bridges`);
    }
  }
});

test("exactly one Station file requests a line-connection action - the line console - and only through the bridge it is handed", () => {
  const REQUESTS = ["station-sync-console.js"];
  for (const file of STATION_FILES) {
    const source = fs.readFileSync(path.join(STATION, file), "utf8");
    if (REQUESTS.includes(file)) {
      assert.match(source, /connection\.request\s*\(/, `${file} no longer requests through the bridge it is handed`);
      assert.doesNotMatch(source, /PolynStationConnectionBridge/, `${file} reaches for the global bridge instead of the one it is handed`);
    } else {
      // stage.request() is the transition controller's own verb; what is
      // forbidden here is a request on the connection bridge, or one that
      // names an action.
      assert.doesNotMatch(source, /connection\.request|\.request\s*\(\s*["'`]/, `${file} requests a line-connection action`);
    }
    // The console holds no workspace choice: no selector, no switch, no
    // second remembered line.
    assert.doesNotMatch(source, /selectWorkspace|joinWorkspace|createWorkspace|leaveWorkspace|workspaceSelect|selectedWorkspaceId/,
      `${file} reaches for a workspace selection`);
  }
});

test("exactly one Station file requests a saved-recipe action - the Recipe Book - and only through the bridge it is handed", () => {
  const REQUESTS = ["station-recipe-book.js"];
  for (const file of STATION_FILES) {
    const source = fs.readFileSync(path.join(STATION, file), "utf8");
    if (REQUESTS.includes(file)) {
      assert.match(source, /recipes\.request\s*\(/, `${file} no longer requests through the bridge it is handed`);
      assert.doesNotMatch(source, /PolynStationRecipesBridge/, `${file} reaches for the global bridge instead of the one it is handed`);
    } else {
      assert.doesNotMatch(source, /recipes\.request\s*\(/, `${file} requests a saved-recipe action`);
    }
    // The book holds no recipe of its own: no payload builder, no cache
    // key, no second list. What it lists is what the bridge published.
    assert.doesNotMatch(source, /createRecipePayload|applyRecipePayload|polyn\.workspaceConfigurations|savedRecipes\s*=\s*\[/,
      `${file} keeps a recipe list or a payload of its own`);
  }
});

test("exactly one Station file requests a weight-profile action - the Weights page - and only through the bridge it is handed", () => {
  const REQUESTS = ["station-weights.js"];
  for (const file of STATION_FILES) {
    const source = fs.readFileSync(path.join(STATION, file), "utf8");
    if (REQUESTS.includes(file)) {
      assert.match(source, /weightProfiles\.request\s*\(/, `${file} no longer requests through the bridge it is handed`);
      assert.doesNotMatch(source, /PolynStationWeightProfilesBridge/, `${file} reaches for the global bridge instead of the one it is handed`);
    } else {
      assert.doesNotMatch(source, /weightProfiles\.request\s*\(/, `${file} requests a weight-profile action`);
    }
    // The page holds no profile of its own and applies none: no payload
    // builder, no apply helper, no second list. What it lists is what the
    // bridge published; what it loads, the application applies.
    assert.doesNotMatch(source, /createReceiverWeightProfile|applyReceiverWeightProfile|validateReceiverWeightProfile|receiver_weights_lb/,
      `${file} keeps a weight profile or applies one of its own`);
  }
});

test("the weight-profiles bridge touches no DOM, names no RT Sync internal, and knows no cache key or payload rule", () => {
  const source = fs.readFileSync(path.join(ROOT, WEIGHT_PROFILES_BRIDGE), "utf8");
  for (const pattern of [/\bdocument\b/, /addEventListener/, /polyn\.workspaceConfigurations/, /createReceiverWeightProfile/, /applyReceiverWeightProfile/, /PolynWorkspaceConfigurations\b/, ...RT_SYNC_INTERNALS]) {
    assert.doesNotMatch(source, pattern, `${WEIGHT_PROFILES_BRIDGE} reaches outside itself (matched ${pattern})`);
  }
  for (const page of [indexHtml, stationHtml]) {
    assert.ok(page.indexOf(SHARED_BRIDGE) < page.indexOf(WEIGHT_PROFILES_BRIDGE), "the weight-profiles bridge loads before the state bridge it requires");
  }
  assert.ok(indexHtml.indexOf(WEIGHT_PROFILES_BRIDGE) < indexHtml.indexOf('src="app.js'));
  const bridge = require("./station-weight-profiles-bridge.js");
  for (const forbidden of ["publish", "disconnect", "setBook", "setState", "state"]) {
    assert.equal(bridge[forbidden], undefined, `the module surface exposes ${forbidden}`);
  }
  assert.ok(Object.isFrozen(bridge));
  assert.deepEqual([...bridge.ACTIONS], ["saveCurrentWeights", "replaceWeightProfile", "loadWeightProfile", "renameWeightProfile", "duplicateWeightProfile", "deleteWeightProfile", "refresh"],
    "a new weight-profile action Station may ask for arrives as an edit to this list");
});

test("exactly three Station files request an administrator action - Sudo and its two tools, Workspace Management and Line Configuration - and only through the bridge they are handed", () => {
  const REQUESTS = ["station-sudo.js", "station-sudo-workspaces.js", "station-sudo-lines.js"];
  for (const file of STATION_FILES) {
    const source = fs.readFileSync(path.join(STATION, file), "utf8");
    if (REQUESTS.includes(file)) {
      assert.match(source, /admin\.request\s*\(/, `${file} no longer requests through the bridge it is handed`);
      assert.doesNotMatch(source, /PolynStationAdminBridge/, `${file} reaches for the global bridge instead of the one it is handed`);
    } else {
      assert.doesNotMatch(source, /admin\.request\s*\(/, `${file} requests an administrator action`);
    }
    // No Station file keeps a session, a password, or an admin check of
    // its own: a password is read from its field on submit and handed over.
    assert.doesNotMatch(source, /isAdmin|admin_users|PolynResinAdmin|PolynWorkspaceRecovery|password\s*[:=]\s*["'`]/,
      `${file} holds administrator state of its own`);
  }
});

test("the application's use of the connection bridge is one connect and two publish sites - the sync render and the busy flag", () => {
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.equal((app.match(/stationConnection\.connect\s*\(/g) || []).length, 1);
  const publishes = [...app.matchAll(/stationConnectionHandle\?\.publish\(\)/g)].map(match => match.index);
  assert.equal(publishes.length, 2, "the connection descriptor is announced from exactly two places");
  const renderLineSync = app.slice(app.indexOf("function renderLineSync(syncState){"), app.indexOf("function openRtSyncJoinFromUrl("));
  const setBusy = app.slice(app.indexOf("function setLineSyncActionBusy(busy, action = \"\"){"), app.indexOf("function formatLineSyncTimestamp("));
  assert.match(renderLineSync, /stationConnectionHandle\?\.publish\(\)/, "one publish is the sync state render");
  assert.match(setBusy, /stationConnectionHandle\?\.publish\(\)/, "the other is the in-flight flag");
  // The projection is the bridge's allow-list, called on cloud-sync's public
  // state; the sync module itself is never handed over.
  assert.match(app, /stationConnection\.project\(syncState,/);
  assert.doesNotMatch(app, /connect\(\s*\{\s*read:\s*\(\s*\)\s*=>\s*lineSync\b/);
});

test("the station- class namespace is unused by the existing application", () => {
  // The namespace is only protection while it stays unclaimed on both sides.
  for (const file of fs.readdirSync(ROOT).filter(name => name.endsWith(".css"))) {
    const css = fs.readFileSync(path.join(ROOT, file), "utf8");
    const claimed = [...css.matchAll(/\.(station-[a-z0-9_-]+)/gi)].map(match => match[1]);
    assert.deepEqual([...new Set(claimed)], [], `${file} defines a station- class`);
  }
});

test("station.html loads none of the application's stylesheets", () => {
  const legacy = [
    "styles-base.css", "styles-hoppers.css", "styles-recipe-views.css",
    "styles-recipe-views-phone.css", "styles-results.css", "styles-controls.css",
    "styles-tools-notes.css", "styles-surfaces.css", "styles-shell.css",
    "styles-responsive.css", "styles-recipe-grid.css",
    "theme.css", "desktop.css", "button-styling.css"
  ];
  for (const sheet of legacy) {
    assert.ok(!stationHtml.includes(sheet), `station.html links the legacy stylesheet ${sheet}`);
  }
});

test("station.html loads no application UI script - only shared, UI-independent modules", () => {
  // Station may consume shared logic. It may not boot a second copy of the
  // floor UI, whose scripts all render into index.html's own DOM.
  const uiScripts = ["app.js", "notes-ui.js", "rt-cloud-ui.js", "resin-admin-ui.js",
    "workspace-recovery-ui.js", "line-configurations-ui.js", "recipe-scan-ui.js",
    "beta-access-ui.js", "database-health-ui.js", "bulk-density-measurement-ui.js"];
  for (const script of uiScripts) {
    assert.ok(!new RegExp(`src="[^"]*${script.replace(".", "\\.")}`).test(stationHtml),
      `station.html loads the application UI script ${script}`);
  }
});

test("every shared module station.html does load is UI-independent", () => {
  const shared = [...stationHtml.matchAll(/src="\.\.\/([^"?]+)/g)].map(match => match[1]);
  assert.ok(shared.length > 0, "expected Station to reuse at least one shared module");
  for (const file of shared) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /document\.(getElementById|querySelector|createElement)/,
      `${file} touches the DOM, so Station must not load it directly`);
  }
});

/* ----------------------------------------------------------------------
 *   Station CSS cannot reach the existing application
 * -------------------------------------------------------------------- */

test("every Station component selector is namespaced, so it cannot match an application element", () => {
  for (const sheet of componentSheets()) {
    for (const selector of selectorsIn(sheet.css)) {
      assert.ok(
        /(^|[\s>+~(])\.station-/.test(selector) || /^\.station-root\b/.test(selector),
        `${sheet.name}: selector "${selector}" is not anchored to a station- class`
      );
    }
  }
});

test("Station styles no bare element outside its own base layer", () => {
  for (const sheet of componentSheets()) {
    if (sheet.name.endsWith("base.css")) continue;
    for (const selector of selectorsIn(sheet.css)) {
      assert.doesNotMatch(selector, /(^|[\s>+~,])(html|body|div|span|button|input|select|textarea|a|p|ul|li|table)\b/,
        `${sheet.name}: "${selector}" styles a bare element outside base.css`);
    }
  }
});

test("the Station base layer's element rules are all scoped inside .station-root", () => {
  const base = allStationCss.find(sheet => sheet.name.endsWith("base.css"));
  for (const selector of selectorsIn(base.css)) {
    assert.match(selector, /^\.station-/, `base.css: "${selector}" escapes the Station root`);
  }
});

/* ----------------------------------------------------------------------
 *   The CSS rules this phase committed to
 * -------------------------------------------------------------------- */

test("no Station rule is styled by id", () => {
  for (const sheet of allStationCss) {
    for (const selector of selectorsIn(sheet.css)) {
      assert.doesNotMatch(selector, /#/, `${sheet.name}: "${selector}" styles by id`);
    }
  }
});

test("no Station component rule uses !important", () => {
  for (const sheet of componentSheets()) {
    assert.doesNotMatch(sheet.css, /!important/, `${sheet.name} uses !important`);
  }
});

test("no Station selector is deep enough to depend on document structure", () => {
  // Three or more class steps is where a selector stops describing a
  // component and starts describing a particular tree.
  for (const sheet of componentSheets()) {
    for (const selector of selectorsIn(sheet.css)) {
      const steps = selector.split(/[\s>+~]+/).filter(Boolean).length;
      assert.ok(steps <= 2, `${sheet.name}: "${selector}" is ${steps} steps deep`);
      assert.doesNotMatch(selector, /:nth-child/, `${sheet.name}: "${selector}" depends on child position`);
    }
  }
});

test("Station state is expressed semantically, never as a visual name", () => {
  const banned = /\.(red|green|blue|yellow|orange|small|large|big|wide|narrow|bold|grey|gray)\b/;
  for (const sheet of componentSheets()) {
    for (const selector of selectorsIn(sheet.css)) {
      assert.doesNotMatch(selector, banned, `${sheet.name}: "${selector}" names a colour or a size`);
    }
    for (const match of sheet.css.matchAll(/\.(is-[a-z0-9-]+)/g)) {
      assert.match(match[1], /^is-[a-z][a-z0-9-]*$/);
    }
  }
});

test("raw colours live only in the centralized theme mappings", () => {
  for (const sheet of allStationCss) {
    if (sheet.name.includes("station/styles/themes/")) continue;
    const body = sheet.css.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, `${sheet.name} hard-codes a hex colour instead of using a token`);
    assert.doesNotMatch(body, /\brgba?\(/i, `${sheet.name} hard-codes an rgb colour instead of using a token`);
  }
});

test("Station has exactly one breakpoint, and it is the documented one", () => {
  const conditions = new Set();
  for (const sheet of componentSheets()) {
    for (const match of sheet.css.matchAll(/@media([^{]+)\{/g)) {
      const condition = match[1].replace(/\s+/g, " ").trim();
      // Preference queries are not breakpoints. prefers-reduced-motion asks
      // what the operator wants, not how wide the window is, and counting it
      // here would either fail this guard or force it to accept any query.
      if (/^\(prefers-[a-z-]+:/.test(condition)) continue;
      conditions.add(condition);
    }
  }
  assert.deepEqual([...conditions].sort(), [
    "(max-width: 1099px)"
  ], "Station gained an undocumented breakpoint - fix the layout above it instead");
});

test("no stylesheet carries an override pile at its own level", () => {
  /* An override pile is a selector that sets a property it already set higher
   * up the same file: the second declaration wins only because it is lower,
   * and nothing at either site says so.
   *
   * Checked per PROPERTY, not per selector. A selector that appears in a
   * grouped rule for shared padding and again alone for its own width is
   * ordinary CSS, not an override - flagging it would only push the file into
   * repeating declarations to satisfy a test. Repeating one inside a media
   * query is fine too, and the breakpoint guard above already pins which
   * queries may exist.
   */
  for (const sheet of allStationCss) {
    const topLevel = sheet.css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@media[^{]+\{[\s\S]*?\n\}/g, "");

    const declared = new Map();
    const collisions = [];
    const rule = /(^|[};{])\s*([^{}@;]+?)\s*\{([^{}]*)\}/g;
    let match;
    while ((match = rule.exec(topLevel))) {
      const selectorText = match[2].trim();
      if (!selectorText || selectorText.startsWith("@")) continue;
      const properties = match[3].split(";")
        .filter(one => one.includes(":"))
        .map(one => one.split(":")[0].trim());
      for (const selector of selectorText.split(",").map(one => one.trim()).filter(Boolean)) {
        if (!declared.has(selector)) declared.set(selector, new Set());
        const seen = declared.get(selector);
        for (const property of properties) {
          if (seen.has(property)) collisions.push(`${selector} { ${property} }`);
          seen.add(property);
        }
      }
    }
    assert.deepEqual(collisions, [],
      `${sheet.name} sets these twice at top level - the later one wins by position alone`);
  }
});

/* ----------------------------------------------------------------------
 *   Station ships to the web only
 * -------------------------------------------------------------------- */

test("Station is not bundled into the Android shell", () => {
  // www/ is derived from index.html's own references. Station is not one of
  // them, and this pins that rather than leaving it to luck.
  const www = path.join(ROOT, "www");
  if (!fs.existsSync(www)) return;
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(www, full));
    }
  })(www);
  // The bridge is part of index.html's own runtime, so it ships with it. The
  // Station UI is not, and must not.
  const leaked = files.filter(file => /(^|\/)station/.test(file) && !INDEX_STATION_ASSETS.includes(file));
  assert.deepEqual(leaked, [], "Station UI files reached the Capacitor webDir");
});

/* ----------------------------------------------------------------------
 *   Station owns no application state
 * -------------------------------------------------------------------- */

test("Station defines no parallel copy of application state", () => {
  const forbidden = /\b(stationRecipeState|stationLayers|stationHoppers|stationActiveJob|stationSyncState)\b/;
  for (const file of STATION_FILES) {
    const source = fs.readFileSync(path.join(STATION, file), "utf8");
    assert.doesNotMatch(source, forbidden, `${file} forks application state`);
  }
});

test("Station writes nothing to storage, sync, or the network in this phase", () => {
  for (const file of STATION_FILES) {
    const source = fs.readFileSync(path.join(STATION, file), "utf8");
    for (const pattern of [/localStorage/, /sessionStorage/, /\bfetch\s*\(/, /XMLHttpRequest/, /supabase/i]) {
      assert.doesNotMatch(source, pattern, `${file} reaches outside the page`);
    }
  }
});

test("Station never writes through the bridge - it only reads and subscribes", () => {
  // Station holds the same module reference the application does. What stops
  // it writing is that it never calls connect(); this is that discipline
  // written down, because the module cannot enforce it from the inside.
  for (const file of STATION_FILES) {
    const source = fs.readFileSync(path.join(STATION, file), "utf8");
    assert.doesNotMatch(source, /\.connect\s*\(/, `${file} connects a producer to the bridge`);
    assert.doesNotMatch(source, /\.publish\s*\(/, `${file} publishes to the bridge`);
  }
});

test("exactly seven Station files dispatch commands - the focused editor, the hopper controls, the job controls, the layer share, Resin Totals, Weights and the weight cards - and only through the bridge they are handed", () => {
  /* The write path is: editor -> command bridge -> the application's
   * executor. The editor is one of four places a Station file may say
   * `.dispatch(` - the others are the hopper cluster's controls module,
   * which carries the tracking and pump toggles drawn on the hoppers,
   * the header's job controls, which carry the line's output and
   * changeover, and the layer share, the percentage edited in each
   * layer's header, and the Handbook's Resin Totals, which carries the
   * job's production and scrap pounds, and the Handbook's Weights page,
   * which carries the receiver weights, and the weight cards on the
   * stage, which carry the same weights and the hopper geometry from the
   * machine rail's Weights face (and the rail's Smart Hoppers switch) -
   * and each says it on the bridge object it was given, never on the
   * global. Every other file stays a reader; the boot file's part is to
   * hand the bridge over and to re-run the publish policy on the answer.
   * The plan controls are the eighth: the rail's two moves under the Next
   * face, promote and copy, each one command on the bridge it is handed.
   * A ninth dispatching file arrives as an edit to this test. */
  const DISPATCHES = ["station-focus-editor.js", "station-hopper-controls.js", "station-plan-controls.js", "station-job-controls.js", "station-layer-share.js", "station-resin-totals.js", "station-weight-cards.js"];
  for (const file of STATION_FILES) {
    const source = fs.readFileSync(path.join(STATION, file), "utf8");
    if (DISPATCHES.includes(file)) {
      assert.match(source, /commands\.dispatch\s*\(/, `${file} no longer dispatches through the bridge it is handed`);
      assert.doesNotMatch(source, /PolynStationCommandBridge/, `${file} reaches for the global bridge instead of the one it is handed`);
    } else {
      assert.doesNotMatch(source, /\.dispatch\s*\(/, `${file} dispatches a command`);
    }
  }
});

test("the application's use of the bridge is exactly one connect and two publish sites - the session save, and the line configurations being re-read", () => {
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.equal((app.match(/stationBridge\.connect\s*\(/g) || []).length, 1);
  assert.equal((app.match(/stationBridgeHandle\?\.publish\s*\(/g) || []).length, 2);
  // The second site is the existing line-configuration listener: the
  // snapshot reads the derived line configuration when it is taken, so
  // the definitions moving is the snapshot moving. Not a third mechanism.
  const listener = app.slice(app.indexOf('window.addEventListener("polyn:line-configurations"'));
  assert.match(listener.slice(0, listener.indexOf("});")), /renderLineSync\(syncState\);[\s\S]*stationBridgeHandle\?\.publish\(\);/);
  // The projection is called with `state`, but only inside the read closure -
  // the state object itself is never handed to the bridge.
  assert.doesNotMatch(app, /connect\(\s*\{\s*read:\s*\(\s*\)\s*=>\s*state\b/,
    "app.js hands the raw state object to the bridge");
});
