"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const identity = require("./line-identity.js");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const workspace = (name, extra = {}) => ({ id: `ws-${name}`, name, membership: { role: "member" }, ...extra });
const linked = (ws, { connected = true } = {}) => ws
  ? { selectedWorkspaceId: ws.id, selectedWorkspace: ws, connected }
  : { selectedWorkspaceId: "", selectedWorkspace: null, connected: false };
const required = state => identity.requiredLayerCountForSync(state);
const forLine = (name, options) => required(linked(workspace(name), options));

/* ----------------------------------------------------------------------
 *   The mapping, line by line
 * -------------------------------------------------------------------- */

test("Lines 1-4 are one-layer lines", () => {
  assert.equal(forLine("Line 1"), 1);
  assert.equal(forLine("Line 2"), 1);
  assert.equal(forLine("Line 3"), 1);
  assert.equal(forLine("Line 4"), 1);
});

test("Lines 5-9 are three-layer lines", () => {
  [5, 6, 7, 8, 9].forEach(n => assert.equal(forLine(`Line ${n}`), 3, `Line ${n}`));
});

test("Lines 10 and 11 are five-layer lines", () => {
  assert.equal(forLine("Line 10"), 5);
  assert.equal(forLine("Line 11"), 5);
});

test("Lines 12-14 are three-layer lines", () => {
  assert.equal(forLine("Line 12"), 3);
  assert.equal(forLine("Line 13"), 3);
  assert.equal(forLine("Line 14"), 3);
});

test("Line 15 is a five-layer line", () => {
  assert.equal(forLine("Line 15"), 5);
});

test("the mapping covers exactly Lines 1-15 and only ever yields 1, 3 or 5", () => {
  const keys = Object.keys(identity.LAYER_COUNT_BY_LINE).map(Number).sort((a, b) => a - b);
  assert.deepEqual(keys, Array.from({ length: 15 }, (_, i) => i + 1));
  Object.values(identity.LAYER_COUNT_BY_LINE).forEach(count => {
    assert.ok([1, 3, 5].includes(count), `${count} must be a real line configuration`);
  });
});

/* ----------------------------------------------------------------------
 *   Label parsing safety
 * -------------------------------------------------------------------- */

test("Line 1 is never confused with Lines 10-15", () => {
  assert.equal(identity.workspaceLineNumber(workspace("Line 1")), 1);
  [10, 11, 12, 13, 14, 15].forEach(n => {
    assert.equal(identity.workspaceLineNumber(workspace(`Line ${n}`)), n, `Line ${n}`);
  });
  // The one-layer answer must belong to Line 1 alone.
  assert.equal(forLine("Line 1"), 1);
  [10, 11, 15].forEach(n => assert.equal(forLine(`Line ${n}`), 5));
  [12, 13, 14].forEach(n => assert.equal(forLine(`Line ${n}`), 3));
});

test("harmless case and whitespace differences normalize", () => {
  ["Line 7", "line 7", "LINE 7", "  Line   7  ", "\tLine 7\n"].forEach(name => {
    assert.equal(forLine(name), 3, JSON.stringify(name));
  });
  assert.equal(forLine("  LINE   15 "), 5);
});

test("a range-style name is not a line, and unrelated numbers are never mined", () => {
  // "Lines 1-4" means four separate workspaces, never one literal workspace.
  ["Line 1-4", "Lines 1-4", "Line 1 - 4", "Line 1/2"].forEach(name => {
    assert.equal(identity.workspaceLineNumber(workspace(name)), null, name);
  });
  ["Production Line 9 backup", "Extruder 5", "Line", "Line nine", "Building 3 Line", "9"].forEach(name => {
    assert.equal(identity.workspaceLineNumber(workspace(name)), null, name);
  });
  assert.equal(identity.workspaceLineNumber(workspace("Line 09")), 9, "a padded exact label is still Line 9");
});

test("unknown or out-of-range lines return null rather than a guess", () => {
  assert.equal(identity.requiredLayerCount(16), null);
  assert.equal(identity.requiredLayerCount(0), null);
  assert.equal(identity.requiredLayerCount(90), null);
  assert.equal(identity.requiredLayerCount(null), null);
  assert.equal(identity.requiredLayerCount("three"), null);
  assert.equal(forLine("Line 90"), null);
  assert.equal(forLine("Test bench"), null);
});

test("structured workspace identity is preferred over the label", () => {
  assert.equal(required(linked(workspace("Renamed bench", { line_number: 11 }))), 5);
  assert.equal(required(linked(workspace("Line 11", { metadata: { lineNumber: 1 } }))), 1);
  assert.equal(required(linked(workspace("Line 2", { lineNumber: 15 }))), 5);
});

/* ----------------------------------------------------------------------
 *   Link lifecycle
 * -------------------------------------------------------------------- */

test("an unlinked device has no required layer count", () => {
  assert.equal(required(linked(null)), null);
  assert.equal(required(undefined), null);
  assert.equal(required({}), null);
});

test("a persisted workspace restored at launch is already linked", () => {
  // initialize() rebuilds selectedWorkspaceId/selectedWorkspace from the
  // local workspace cache before any network call.
  const restored = linked(workspace("Line 13"));
  assert.equal(required(restored), 3);
  assert.equal(identity.linkedLineNumber(restored), 13);
});

test("a transient outage keeps the device linked to its line", () => {
  // cloud-sync's `connected` tracks deliberate unlinking, not reachability,
  // so Offline/Pending/Error states leave it true.
  const offline = { ...linked(workspace("Line 11")), status: "Offline", pendingCount: 2 };
  assert.equal(required(offline), 5);
  const reconnecting = { ...linked(workspace("Line 11")), status: "Connecting" };
  assert.equal(required(reconnecting), 5);
  const failed = { ...linked(workspace("Line 11")), status: "Error" };
  assert.equal(required(failed), 5);
});

test("a deliberate unlink restores manual selection", () => {
  assert.equal(required(linked(workspace("Line 15"), { connected: false })), null);
  // leaveWorkspace/deleteWorkspace clear the selection outright.
  assert.equal(required({ selectedWorkspaceId: "", selectedWorkspace: null, connected: false }), null);
});

test("a stale selectedWorkspace that does not match the selected id is not linked", () => {
  assert.equal(required({
    selectedWorkspaceId: "ws-Line 5",
    selectedWorkspace: workspace("Line 11"),
    connected: true
  }), null);
});

test("switching between differently mapped lines re-resolves each time", () => {
  const sequence = ["Line 1", "Line 7", "Line 11", "Line 13", "Line 15", "Line 4"];
  assert.deepEqual(sequence.map(name => forLine(name)), [1, 3, 5, 3, 5, 1]);
});

/* ----------------------------------------------------------------------
 *   Line 9 keeps both behaviors
 * -------------------------------------------------------------------- */

test("Line 9 requires three layers and keeps its Main + 1-5 hopper naming", () => {
  const state = linked(workspace("Line 9"));
  assert.equal(required(state), 3);
  assert.equal(identity.hopperNamingMode(state), "main");
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => identity.hopperPositionLabel(i, state)),
    ["Main", "1", "2", "3", "4", "5"]
  );
});

test("layer enforcement does not leak Line 9 naming onto other three-layer lines", () => {
  [5, 6, 7, 8, 12, 13, 14].forEach(n => {
    const state = linked(workspace(`Line ${n}`));
    assert.equal(required(state), 3, `Line ${n} layers`);
    assert.equal(identity.hopperNamingMode(state), "standard", `Line ${n} naming`);
  });
});

test("hopper naming is unchanged by the new link gate", () => {
  // Naming deliberately does not consult `connected` - only the layer-count
  // enforcement does - so this existing behavior must not regress.
  const disconnected = linked(workspace("Line 9"), { connected: false });
  assert.equal(identity.hopperNamingMode(disconnected), "main");
  assert.equal(required(disconnected), null);
});

/* ----------------------------------------------------------------------
 *   Application wiring
 * -------------------------------------------------------------------- */

test("both derivations share one workspace identity module and one lifecycle hook", () => {
  assert.match(app, /syncDerivedHopperNaming\(syncState\);\s*\n(?:\s*\/\/.*\n)*\s*syncDerivedLayerCount\(syncState\);/);
  assert.match(app, /window\.PolynLineIdentity\?\.requiredLayerCountForSync\(syncState\)/);
  assert.match(app, /const identity = window\.PolynLineIdentity;/);
  assert.match(app, /identity\?\.linkedWorkspace\(syncState\) \|\| null/);
  // app.js no longer resolves the line number itself - it stopped needing one
  // when the "Set by Line N" readout was removed. linkedLineNumber is still
  // the single resolver, now reached through getLineConfigurationForSync.
  assert.doesNotMatch(app, /linkedLineNumber/);
  assert.match(fs.readFileSync("line-identity.js", "utf8"), /return getLineConfiguration\(linkedLineNumber\(syncState\)\);/);
  // The same module answers the naming question.
  assert.match(app, /window\.PolynLineIdentity\?\.hopperNamingMode\(syncState\)/);
  // No second workspace-label parser and no second copy of the mapping:
  // app.js never inspects a workspace name itself, and the table lives only
  // in line-identity.js.
  assert.doesNotMatch(app, /selectedWorkspace[^\n]*\.name[^\n]*(match|exec|toLowerCase|replace|startsWith|includes)/);
  assert.doesNotMatch(app, /LAYER_COUNT_BY_LINE/);
  assert.match(fs.readFileSync("line-identity.js", "utf8"), /const LAYER_COUNT_BY_LINE = Object\.freeze\(\{/);
});

test("manual and automatic paths share the existing layer-count transition", () => {
  assert.match(app, /function applyLineTypeChange\(value, \{ confirmDataLoss = true \} = \{\}\)\{/);
  assert.match(app, /state\.lineType = nextType;\s*\n\s*ensureLayers\(\);\s*\n\s*syncLineTypeUI\(\);\s*\n\s*rebuildUIFromState\(\);\s*\n\s*saveSession\(\);\s*\n\s*notifyActiveJobMutation\(\{ immediate: true, kind: "line-type" \}\)/);
  // The automatic path reuses it and never prompts.
  assert.match(app, /return applyLineTypeChange\(required, \{ confirmDataLoss:false \}\);/);
  // Exactly one place assigns state.lineType outside payload application.
  assert.equal(app.match(/state\.lineType = nextType;/g).length, 1);
});

test("an already-correct layer count produces no work and no outgoing mutation", () => {
  // Both the scheduler and the enforcement itself bail before any state
  // write, so renders, reconnects and refreshes never republish.
  assert.match(app, /const required = applyLayerCountLock\(syncState\);\s*\n\s*if \(required === null \|\| Number\(state\.lineType\) === required\) return false;\s*\n\s*scheduleLayerCountEnforcement\(\);/);
  assert.match(app, /if \(required === null \|\| Number\(state\.lineType\) === required\) return false;\s*\n(?:\s*\/\/.*\n)*\s*if \(syncState\?\.isApplyingRemote\) return false;/);
  // applyLineTypeChange is itself a no-op when the value already matches.
  assert.match(app, /if \(nextType === state\.lineType\) return false;/);
});

test("conflicting incoming state is normalized once, outside the remote-apply window", () => {
  // notifyActiveJobMutation suppresses writes while isApplyingRemote is set,
  // so normalizing inside that window would change this device silently.
  assert.match(app, /if \(syncState\?\.isApplyingRemote\) return false;/);
  assert.match(app, /function scheduleLayerCountEnforcement\(\)\{\s*\n\s*if \(layerEnforcementScheduled\) return;/);
  assert.match(app, /layerEnforcementScheduled = true;/);
  // The existing revision/no-op/conflict protections are untouched.
  const sync = fs.readFileSync("cloud-sync.js", "utf8");
  assert.match(sync, /if \(state\.isApplyingRemote \|\| !enabled \|\| !isConnected\(\)\) return;/);
  assert.match(sync, /if \(baseline && activeJobLib\?\.activeJobsEqual\?\.\(baseline, payload\)\) return;/);
});

test("enforcement is driven by sync state only, never by a render or clock tick", () => {
  const ticker = app.slice(app.indexOf("function refreshTimelinePresentation()"));
  assert.doesNotMatch(ticker.slice(0, ticker.indexOf("\n    }\n")), /LayerCount|applyLineTypeChange/);
  const rebuild = app.slice(app.indexOf("function rebuildUIFromState("));
  assert.doesNotMatch(rebuild.slice(0, 600), /syncDerivedLayerCount|enforceDerivedLayerCount/);
  // Exactly one call site feeds the derivation.
  assert.equal(app.match(/syncDerivedLayerCount\(syncState\);/g).length, 1);
});

test("an unmapped linked workspace logs once and keeps manual selection", () => {
  assert.match(app, /if \(unmappedWorkspaceNotice !== workspace\.id\)\{/);
  assert.match(app, /is not a recognized Line 1-15; manual layer selection stays available/);
  assert.match(app, /console\.info\(/);
  // No blocking operator error is raised for it.
  assert.doesNotMatch(app, /alert\([^)]*recognized Line/);
});

/* ----------------------------------------------------------------------
 *   Selector visibility, desktop and mobile
 * -------------------------------------------------------------------- */

test("the manual tiles are hidden and disabled while a line dictates the count", () => {
  assert.match(app, /if \(group\) group\.hidden = required !== null;/);
  assert.match(app, /button\.disabled = locked;/);
  assert.match(app, /button\.tabIndex = selected && !locked \? 0 : -1;/);
  // The lock, not the DOM, is the authoritative guard on manual selection.
  assert.match(app, /const choose = value=>\{\s*\n\s*if \(lockedLayerCount !== null\) return;/);
  assert.match(app, /if \(!\["ArrowLeft", "ArrowRight"\]\.includes\(event\.key\)\) return;\s*\n\s*if \(lockedLayerCount !== null\) return;/);
});

test("nothing is shown in place of the tiles - Overview already reports the line and count", () => {
  // The old "3 layers · Set by Line 9" readout duplicated Overview and is
  // gone, element and styles included. No replacement caption took its place.
  assert.doesNotMatch(html, /setupLayerCountDerived/);
  assert.doesNotMatch(app, /setupLayerCountDerived/);
  assert.doesNotMatch(styles, /setupLayerCountDerived/);
  assert.doesNotMatch(app, /Set by Line/);
  // Same single control on desktop and mobile, so one rule covers both and
  // no viewport-specific override reintroduces the tiles.
  assert.equal(html.match(/id="lineTypeToggle"/g).length, 1);
  // Must outrank the mobile `#lineSetupBlock .layerCountTiles` display
  // override, or the tiles stay visible on mobile despite [hidden].
  assert.match(styles, /#lineSetupBlock \.layerCountTiles\[hidden\]\{ display: none; \}/);
  assert.doesNotMatch(styles, /\.layerCountTiles\{[^}]*display:\s*(flex|grid)\s*!important/);
});

test("the Layers heading is hidden with its control while a line dictates the count", () => {
  // The heading lives on the group, not the tiles, so hiding only the tiles
  // would strand a "Layers" caption above empty space.
  assert.match(html, /<div class="setupControlGroup setupLayerCountGroup" id="setupLayerCountGroup">\s*\n\s*<span class="setupControlLabel">Layer Configuration<\/span>/);
  assert.match(app, /const layerCountGroup = \$\("setupLayerCountGroup"\);\s*\n\s*if \(layerCountGroup\) layerCountGroup\.hidden = required !== null;/);
  // `[hidden]` alone loses to `#lineSetupBlock .setupControlGroup{display:grid}`.
  assert.match(styles, /#lineSetupBlock \.setupLayerCountGroup\[hidden\]\{ display: none; \}/);
});

/* The manual selector is the only way to set a layer count when RT Sync is
 * not linked to a recognized line, so every part of it has to survive the
 * connected-state cleanup above. */
test("the manual fallback selector survives intact for the disconnected state", () => {
  // Markup: heading, radiogroup, and all three tiles still present and
  // visible by default - the group is only hidden when the lock is applied.
  assert.match(html, /<span class="setupControlLabel">Layer Configuration<\/span>/);
  assert.doesNotMatch(html, /id="setupLayerCountGroup"[^>]*\shidden/, "the group must not start hidden");
  assert.doesNotMatch(html, /id="lineTypeToggle"[^>]*\shidden/, "the tiles must not start hidden");
  for (const count of [1, 3, 5]){
    assert.match(html, new RegExp(`data-line-type="${count}"`), `the ${count}-layer tile must remain`);
  }
  assert.match(html, /id="lineTypeToggle" role="radiogroup" aria-label="Layer Configuration"/);

  // Behavior: handlers, state application and keyboard support all intact.
  assert.match(app, /function hookLineTypeChoice\(\)/);
  assert.match(app, /group\.addEventListener\("click"/);
  assert.match(app, /applyLineTypeChange\(/);
  assert.match(app, /state\.lineType = nextType;/);

  // Unlinking clears the lock, which is what makes both reappear.
  assert.match(app, /lockedLayerCount = required;/);
  const lock = app.slice(app.indexOf("function applyLayerCountLock("));
  const body = lock.slice(0, lock.indexOf("\n  let layerEnforcementScheduled"));
  assert.match(body, /if \(group\) group\.hidden = required !== null;/);
  assert.match(body, /layerCountGroup\.hidden = required !== null;/);
  // Both are driven by the same null check, so they can never disagree.
  assert.equal((body.match(/hidden = required !== null;/g) || []).length, 2);
});

test("unlinking leaves the current layer configuration alone", () => {
  // applyLayerCountLock only clears the lock; nothing resets state.lineType.
  const lock = app.slice(app.indexOf("function applyLayerCountLock("));
  const body = lock.slice(0, lock.indexOf("\n  let layerEnforcementScheduled"));
  assert.doesNotMatch(body, /state\.lineType\s*=/);
  assert.doesNotMatch(body, /applyLineTypeChange/);
});

test("existing session and payload handling still clamps the layer count", () => {
  assert.match(app, /state\.lineType = \[1,3,5\]\.includes\(Number\(payload\.lineType\)\) \? Number\(payload\.lineType\) : 3;/);
});
