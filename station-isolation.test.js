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
  "station-machine-layout.js", "station-machine-parts.js", "station-extruder-lab.js"];

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
 *   station-state-bridge.js  the read-only state window (app.js publishes)
 *   station-host.js          the ?view=station activation switch
 *
 * Both are inert on a normal load: the bridge only bumps a revision nobody
 * reads, and the host returns before touching the document.
 */
const SHARED_BRIDGE = "station-state-bridge.js";
const STATION_HOST = "station-host.js";
const INDEX_STATION_ASSETS = [SHARED_BRIDGE, STATION_HOST].sort();

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

test("raw colours live only in the token file", () => {
  for (const sheet of allStationCss) {
    if (sheet.name.endsWith("tokens.css")) continue;
    const body = sheet.css.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, `${sheet.name} hard-codes a hex colour instead of using a token`);
    assert.doesNotMatch(body, /\brgba?\(/i, `${sheet.name} hard-codes an rgb colour instead of using a token`);
  }
});

test("Station has exactly two breakpoints, and they are the documented ones", () => {
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
    "(max-width: 1099px)",
    "(min-width: 1100px) and (max-width: 1439px)"
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

test("the application's use of the bridge is exactly one connect and one publish", () => {
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.equal((app.match(/stationBridge\.connect\s*\(/g) || []).length, 1);
  assert.equal((app.match(/stationBridgeHandle\?\.publish\s*\(/g) || []).length, 1);
  // The projection is called with `state`, but only inside the read closure -
  // the state object itself is never handed to the bridge.
  assert.doesNotMatch(app, /connect\(\s*\{\s*read:\s*\(\s*\)\s*=>\s*state\b/,
    "app.js hands the raw state object to the bridge");
});
