"use strict";

/* The production path from index.html to an editable Station, as a chain
 * of checks over the real files - and the two hosts that are meant to stay
 * read-only, told apart from it.
 *
 * The chain: index.html loads the state bridge, the command contract and
 * the command bridge (each once, all before app.js); app.js's init connects
 * the state bridge and then the executor, synchronously, on every load;
 * station-host.js, on ?view=station, loads Station's own modules and none
 * of the bridges again; station.js hands the editor the bridge only for a
 * live source; the editor asks that bridge what it may offer.
 *
 * Every link was in place when a returning browser reported "no application
 * is connected to Station commands" - because it was running a cached
 * app.js from before the executor under a tag nobody had moved, beneath
 * Station modules station-host.js had just refreshed under its own VERSION.
 * script-cache-tags.test.js now guards the tag; this file guards the chain,
 * so the next report of that sentence points at exactly one broken link.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const indexHtml = read("index.html");
const app = read("app.js");
const boot = read("station/station.js");
const hostSource = read("station-host.js");

const contract = require("./station-command-contract.js");
const editor = require("./station/station-focus-editor.js");
const lineModel = require("./station/station-line-model.js");

/* The scripts index.html loads, in order, without their tags. */
function loadedScripts() {
  const out = [];
  const pattern = /<script\b[^>]*src="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(indexHtml))) out.push(match[1].split("?")[0]);
  return out;
}

function tagOf(file) {
  const match = new RegExp(`src="${file.replace(".", "\\.")}\\?v=([^"]+)"`).exec(indexHtml);
  return match ? match[1] : null;
}

function newer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/* ----------------------------------------------------------------------
 *   1. index.html: the bridges, once each, before app.js
 * -------------------------------------------------------------------- */

test("index.html loads each bridge file exactly once, all before app.js, and no Station UI module", () => {
  const scripts = loadedScripts();
  const at = file => scripts.indexOf(file);
  for (const file of ["station-state-bridge.js", "station-command-contract.js", "station-command-bridge.js", "station-host.js"]) {
    assert.equal(scripts.filter(name => name === file).length, 1, `${file} is loaded ${scripts.filter(name => name === file).length} times`);
    assert.ok(at(file) < at("app.js"), `${file} is loaded after app.js, so app.js cannot connect to it`);
  }
  assert.ok(at("hookup-sources.js") < at("station-command-contract.js"), "the contract normalizes sources through hookup-sources.js");
  assert.ok(!scripts.some(name => name.startsWith("station/")), "index.html loads a Station UI module statically");
});

test("station-host.js loads Station's modules and never a bridge or the contract again", () => {
  /* A second evaluation of station-command-bridge.js would replace the
   * global with a fresh, unconnected instance - after app.js connected to
   * the first. The host must not load it. Run for real, as station-host
   * .test.js does. */
  const head = { children: [] };
  const created = [];
  const node = name => ({ nodeName: name.toUpperCase(), attributes: {}, children: [], setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; }, hasAttribute(k) { return k in this.attributes; }, appendChild(c) { this.children.push(c); return c; } });
  const doc = { readyState: "complete", head: Object.assign(node("head"), head), body: node("body"), createElement(name) { const n = node(name); created.push(n); return n; }, addEventListener() {} };
  const root = { document: doc, location: { href: "https://resin.tools/?view=station" }, URL };
  root.globalThis = root;
  vm.createContext(root);
  new vm.Script(hostSource).runInContext(root);
  const scripts = doc.head.children.filter(n => n.nodeName === "SCRIPT").map(n => n.src.split("?")[0]);
  assert.ok(scripts.includes("station/station.js"));
  assert.ok(scripts.includes("station/station-focus-editor.js"));
  for (const forbidden of ["station-state-bridge.js", "station-command-contract.js", "station-command-bridge.js", "app.js"]) {
    assert.ok(!scripts.some(name => name.endsWith(forbidden)), `the host loads ${forbidden} a second time`);
  }
});

test("evaluating the command bridge module twice replaces the connected instance with an unconnected one - which is why it is loaded once", () => {
  const window = { PolynStationCommandContract: contract };
  const context = vm.createContext({ globalThis: window, window });
  const source = read("station-command-bridge.js");
  new vm.Script(source).runInContext(context);
  const first = window.PolynStationCommandBridge;
  first.connect({ execute: () => contract.success({ changed: false }), capabilities: ["undo"] });
  assert.equal(first.isAvailable(), true);
  new vm.Script(source).runInContext(context);
  const second = window.PolynStationCommandBridge;
  assert.notEqual(second, first);
  assert.equal(second.isAvailable(), false, "a re-evaluated module starts with no producer");
  assert.equal(first.isAvailable(), true, "and the instance app.js connected to is simply no longer the global");
});

/* ----------------------------------------------------------------------
 *   2. app.js: connects on every load, synchronously, before Station runs
 * -------------------------------------------------------------------- */

test("app.js reads both bridges from the page at load and connects them in init, in order, with nothing asynchronous before", () => {
  assert.match(app, /const stationBridge = window\.PolynStationStateBridge \|\| null;/);
  assert.match(app, /const stationCommands = window\.PolynStationCommandBridge \|\| null;/);
  assert.match(app, /const stationCommandContract = window\.PolynStationCommandContract \|\| null;/);
  const start = app.indexOf("(function init(){");
  assert.ok(start > -1, "init is not where it was");
  const connectAt = app.indexOf("connectStationBridge();\n      connectStationCommands();", start);
  assert.ok(connectAt > start, "init does not connect the state bridge and then the executor");
  const before = app.slice(start, connectAt);
  assert.doesNotMatch(before, /\bawait\b|\.then\(|setTimeout\(|requestAnimationFrame\(/, "something asynchronous sits between init starting and the bridges connecting");
  // Not gated on the view: the floor UI connects whether or not Station is
  // on screen, so the connection cannot depend on how the page was reached.
  assert.doesNotMatch(before, /view=station|data-station-view|PolynStation(?!StateBridge|CommandBridge|CommandContract)/);
  assert.equal((app.match(/connectStationCommands\(\);/g) || []).length, 1);
  assert.equal((app.match(/connectStationBridge\(\);/g) || []).length, 1);
});

test("the executor connects with its own declared capabilities, and only when both bridge files are on the page", () => {
  const at = app.indexOf("function connectStationCommands(){");
  const body = app.slice(at, app.indexOf("\n  }\n", at));
  // With no bridge on the page there is nothing to connect: a no-op, so a
  // page that omits the bridge files is read-only rather than broken.
  assert.match(body, /if \(!stationCommands \|\| !stationCommandContract \|\| stationCommandHandle\) return;/);
  assert.match(body, /stationCommands\.connect\(\{ execute: executor\.execute, capabilities: executor\.capabilities \}\)/);
});

/* ----------------------------------------------------------------------
 *   3. station.js: live gets the bridge, demo gets null
 * -------------------------------------------------------------------- */

function commandsForFrom(bridge) {
  const at = boot.indexOf("function commandsFor(resolved)");
  const source = boot.slice(at, boot.indexOf("\n  }\n", at) + 4);
  return new Function("commands", `${source}; return commandsFor;`)(bridge);
}

test("commandsFor hands the connected bridge to a live source and nothing to a demo source", () => {
  const bridge = require("./station-command-bridge.js").create();
  bridge.connect({ execute: () => contract.success({ changed: false }), capabilities: ["setHopperResin", "setHopperBlend", "setSource"] });
  const commandsFor = commandsForFrom(bridge);
  assert.equal(commandsFor({ kind: "live", live: true }), bridge);
  assert.equal(commandsFor({ kind: "demo", live: false }), null, "demo data pinned in the host must not carry a live executor");
  assert.equal(commandsFor(null), null);
  assert.equal(commandsForFrom(null)({ live: true }), null, "the harness, with no bridge on the page");
});

/* ----------------------------------------------------------------------
 *   4. The editor over each: editable live, read-only otherwise
 * -------------------------------------------------------------------- */

function fakeDocument() {
  const make = name => {
    const node = {
      tagName: name.toUpperCase(), attributes: {}, children: [], textContent: "", value: "",
      get firstChild() { return this.children[0] || null; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      classList: {
        add(n) { const s = set(); s.add(n); node.attributes.class = [...s].join(" "); },
        remove(n) { const s = set(); s.delete(n); node.attributes.class = [...s].join(" "); },
        toggle(n, on) { (on ? this.add : this.remove)(n); },
        contains(n) { return set().has(n); }
      }
    };
    const set = () => new Set(String(node.attributes.class || "").split(/\s+/).filter(Boolean));
    return node;
  };
  return { createElement: make };
}

function editorOver(commands, recipe) {
  const model = lineModel.buildLineModel({ lineKey: "t", displayName: "T", layerCount: 3, layerAPosition: "inside", hopperNamingMode: "standard", hopperCount: 6 });
  const built = editor.create(fakeDocument(), {
    layer: model.layers[0],
    hopperState: { "A:0": { resinName: "HX204", pct: 60, source: "SILO 3" }, "A:2": { resinName: "EVA340", pct: 40, source: "BOX 12" } },
    commands, recipe
  });
  return { able: built.able, mode: built.element.children[0].children[1] };
}

test("the same editor is editable over the production host's bridge and read-only over the demo host's null", () => {
  const bridge = require("./station-command-bridge.js").create();
  bridge.connect({ execute: () => contract.success({ changed: false }), capabilities: [...contract.COMMANDS] });
  const commandsFor = commandsForFrom(bridge);

  const live = editorOver(commandsFor({ live: true }), "current");
  assert.deepEqual(live.able, { resin: true, pct: true, source: true, move: true });
  assert.equal(live.mode.textContent, "Editing");

  const demo = editorOver(commandsFor({ live: false }), "current");
  assert.deepEqual(demo.able, { resin: false, pct: false, source: false, move: false });
  assert.equal(demo.mode.textContent, "Read-only");
  assert.match(demo.mode.getAttribute("title"), /No application is connected to Station commands/);

  // And an unconnected bridge - the harness, or a cached app.js from before
  // the executor - reads the same way, from the bridge's own answer.
  const unconnected = editorOver(require("./station-command-bridge.js").create(), "current");
  assert.deepEqual(unconnected.able, { resin: false, pct: false, source: false, move: false });
  assert.match(unconnected.mode.getAttribute("title"), /No application is connected to Station commands/);
});

/* ----------------------------------------------------------------------
 *   5. The tags that let a returning browser run the new UI over the old app
 * -------------------------------------------------------------------- */

test("app.js and station-host.js ship under tags newer than the last release without the executor", () => {
  // 0.25.15 was app.js's tag through two commits that changed it, and 0.1.0
  // station-host.js's through the same. Both are behind us for good;
  // script-cache-tags.test.js keeps every later change honest.
  assert.ok(newer(tagOf("app.js"), "0.25.15"), `app.js is at ?v=${tagOf("app.js")}`);
  assert.ok(newer(tagOf("station-host.js"), "0.1.0"), `station-host.js is at ?v=${tagOf("station-host.js")}`);
  // The tag app.js ships under must describe an app.js that connects the executor.
  assert.match(app, /function connectStationCommands\(\)\{/);
});

/* ----------------------------------------------------------------------
 *   6. A cached application under a fresh Station is named as such
 * -------------------------------------------------------------------- */

function statusHelpersFrom(root, bridge) {
  const from = boot.indexOf("function hosted()");
  const to = boot.indexOf("\n  }\n", boot.indexOf("function standaloneHarness()")) + 4;
  return new Function("root", "bridge", `${boot.slice(from, to)}; return { hostWithoutApplication, standaloneHarness };`)(root, bridge);
}
const hostWithoutApplicationFrom = (root, bridge) => statusHelpersFrom(root, bridge).hostWithoutApplication;

test("inside the host, an unconnected state bridge is reported as a stale application, never as 'no application'", () => {
  const hosted = { document: { body: { hasAttribute: name => name === "data-station-view" } } };
  const harness = { document: { body: { hasAttribute: () => false } } };
  const connected = { isConnected: () => true };
  const unconnected = { isConnected: () => false };
  // The case that was reported: the host's body attribute is set (station-
  // host.js ran, so the Station scripts are current) and the state bridge
  // has no producer (app.js is from before the bridges).
  assert.equal(hostWithoutApplicationFrom(hosted, unconnected)(), true);
  // A correct host load, and the host with demo pinned: the application connected.
  assert.equal(hostWithoutApplicationFrom(hosted, connected)(), false);
  // The standalone harness legitimately has no application.
  assert.equal(hostWithoutApplicationFrom(harness, unconnected)(), false);
  assert.equal(hostWithoutApplicationFrom(harness, null)(), false);
  // And the status line spends it: the message replaces the source detail
  // and marks the bar, and says what to do.
  const status = boot.slice(boot.indexOf("function renderStatus("), boot.indexOf("\n  }\n", boot.indexOf("function renderStatus(")));
  assert.match(status, /parts\.push\(hostWithoutApplication\(\) \? STALE_APPLICATION : \(standaloneHarness\(\) \? HARNESS : resolved\.detail\)\);/);
  assert.match(status, /classList\.toggle\("is-stale-application", hostWithoutApplication\(\)\)/);
  assert.match(boot, /const STALE_APPLICATION = "The application on this page did not connect to Station - it is likely a cached copy from before Station\. Reload bypassing the cache\."/);
  const shell = read("station/styles/shell.css");
  assert.match(shell, /\.station-status\.is-stale-application \{[^}]*var\(--station-warning\)/);
});

test("the standalone harness names itself and points at the application's Station view; the host never does", () => {
  const hosted = { document: { body: { hasAttribute: name => name === "data-station-view" } } };
  const harness = { document: { body: { hasAttribute: () => false } } };
  const connected = { isConnected: () => true };
  const unconnected = { isConnected: () => false };
  assert.equal(statusHelpersFrom(harness, unconnected).standaloneHarness(), true);
  assert.equal(statusHelpersFrom(harness, null).standaloneHarness(), true);
  assert.equal(statusHelpersFrom(hosted, unconnected).standaloneHarness(), false, "a hosted page with no application is the stale case, not the harness");
  assert.equal(statusHelpersFrom(hosted, connected).standaloneHarness(), false);
  assert.match(boot, /const HARNESS = "Standalone harness: demo data, read-only\. The application's Station view is index\.html\?view=station\."/);
});
