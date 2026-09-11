"use strict";

/* station-host.js, actually executed.
 *
 * The claim "normal startup is unchanged" deserves better than a regex over the
 * source. This runs the real file in a sandbox with a fake window and document
 * and checks what it did: with no flag it must not create an element, set an
 * attribute, or request a single asset. The repo has no jsdom, so the fake
 * implements exactly what the host touches - if the host ever reaches for
 * something else, it fails here rather than quietly depending on a browser.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "station-host.js"), "utf8");

function makeNode(name) {
  return {
    nodeName: name.toUpperCase(),
    attributes: {},
    children: [],
    className: "",
    async: undefined,
    rel: undefined,
    href: undefined,
    src: undefined,
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    appendChild(child) { this.children.push(child); return child; }
  };
}

/* Runs the host with a given URL and returns everything it touched. */
function run(href, options) {
  const settings = options || {};
  const created = [];
  const listeners = {};
  const head = makeNode("head");
  const body = makeNode("body");

  const doc = {
    readyState: settings.readyState || "complete",
    head,
    body,
    createElement(name) { const node = makeNode(name); created.push(node); return node; },
    addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler); }
  };

  // A vm context starts with no web globals, so URL has to be handed in. Without
  // it `new URL(...)` throws, the host's catch treats that as "not requested",
  // and every negative test below would pass for entirely the wrong reason.
  const root = { document: doc, location: { href }, URL };
  root.globalThis = root;
  vm.createContext(root);
  new vm.Script(SOURCE).runInContext(root);

  return {
    doc, head, body, created, listeners, root,
    fire(type) { for (const handler of listeners[type] || []) handler(); },
    stylesheets: () => head.children.filter(node => node.nodeName === "LINK").map(node => node.href),
    scripts: () => head.children.filter(node => node.nodeName === "SCRIPT").map(node => node.src)
  };
}

/* ----------------------------------------------------------------------
 *   Normal startup does not activate Station
 * -------------------------------------------------------------------- */

test("a normal load creates nothing, sets nothing, and requests nothing", () => {
  const run1 = run("https://resin.tools/");
  assert.equal(run1.created.length, 0, "the host created a DOM element on a normal load");
  assert.deepEqual(run1.body.attributes, {}, "the host set an attribute on a normal load");
  assert.equal(run1.body.children.length, 0);
  assert.equal(run1.head.children.length, 0);
  assert.deepEqual(Object.keys(run1.listeners), [], "the host registered a listener on a normal load");
});

test("neither a different view, a partial match, nor a missing query activates Station", () => {
  for (const href of [
    "https://resin.tools/",
    "https://resin.tools/?view=",
    "https://resin.tools/?view=stations",
    "https://resin.tools/?view=Station",
    "https://resin.tools/?station",
    "https://resin.tools/?viewer=station",
    "https://resin.tools/#view=station",
    "https://resin.tools/?other=1"
  ]) {
    const result = run(href);
    assert.equal(result.created.length, 0, `${href} activated Station`);
    assert.equal(result.body.getAttribute("data-station-view"), null, `${href} activated Station`);
  }
});

test("an unreadable URL means not requested, never assume yes", () => {
  const result = run(undefined);
  assert.equal(result.created.length, 0);
  assert.equal(result.body.getAttribute("data-station-view"), null);
});

/* ----------------------------------------------------------------------
 *   ?view=station activates the Station presentation
 * -------------------------------------------------------------------- */

test("?view=station marks the body and creates exactly one host container", () => {
  const result = run("https://resin.tools/?view=station");
  assert.equal(result.body.getAttribute("data-station-view"), "station");

  const hosts = result.body.children.filter(node => node.hasAttribute("data-station-host"));
  assert.equal(hosts.length, 1);
  // The container is also the mount point, so station.js finds it and builds
  // the shell there from the shared builder.
  assert.equal(hosts[0].getAttribute("data-station-app"), "");
  assert.match(hosts[0].className, /\bstation-root\b/);
});

test("the flag still works alongside other query parameters", () => {
  for (const href of [
    "https://resin.tools/?view=station",
    "https://resin.tools/?view=station&source=demo",
    "https://resin.tools/?source=demo&view=station",
    "https://resin.tools/index.html?view=station"
  ]) {
    assert.equal(run(href).body.getAttribute("data-station-view"), "station", `${href} did not activate`);
  }
});

test("the container exists before the attribute that reveals it", () => {
  // host.css hides everything that is not the host the instant the attribute
  // lands. If the order were reversed the page would flash empty.
  const result = run("https://resin.tools/?view=station");
  const host = result.body.children[0];
  assert.ok(host && host.hasAttribute("data-station-host"),
    "the host container is not the first thing appended to the body");
  assert.equal(result.body.getAttribute("data-station-view"), "station");
});

test("activation waits for the document when the parser is still running", () => {
  const result = run("https://resin.tools/?view=station", { readyState: "loading" });
  assert.deepEqual(Object.keys(result.listeners), ["DOMContentLoaded"]);
  assert.equal(result.body.children.length, 0, "the host touched the body before it was parsed");
  result.fire("DOMContentLoaded");
  assert.equal(result.body.getAttribute("data-station-view"), "station");
  assert.equal(result.body.children.length, 1);
});

test("activating twice does not build a second host", () => {
  const result = run("https://resin.tools/?view=station", { readyState: "loading" });
  result.fire("DOMContentLoaded");
  result.fire("DOMContentLoaded");
  assert.equal(result.body.children.filter(node => node.hasAttribute("data-station-host")).length, 1);
  assert.equal(result.scripts().length, new Set(result.scripts()).size, "assets were loaded twice");
});

/* ----------------------------------------------------------------------
 *   What it loads, and how
 * -------------------------------------------------------------------- */

test("Station assets are loaded only in Station mode", () => {
  assert.equal(run("https://resin.tools/").head.children.length, 0);
  const active = run("https://resin.tools/?view=station");
  assert.ok(active.stylesheets().length > 0);
  assert.ok(active.scripts().length > 0);
});

test("every asset loaded is a Station asset - no application code is re-run", () => {
  const result = run("https://resin.tools/?view=station");
  for (const url of [...result.stylesheets(), ...result.scripts()]) {
    assert.match(url, /^station\//, `the host loaded ${url}, which is not part of the Station presentation`);
  }
  for (const url of result.scripts()) {
    assert.doesNotMatch(url, /app\.js/);
    assert.doesNotMatch(url, /cloud-sync|supabase|active-job|line-identity/);
  }
});

test("Station's own scripts are loaded in dependency order and cannot race", () => {
  const result = run("https://resin.tools/?view=station");
  const scripts = result.scripts().map(url => url.split("?")[0]);

  // station.js reads the other globals when it executes, so it must be last.
  assert.equal(scripts[scripts.length - 1], "station/station.js");
  for (const dependency of ["station/station-line-model.js", "station/station-render.js",
    "station/station-shell.js", "station/station-demo-lines.js", "station/station-source.js"]) {
    assert.ok(scripts.indexOf(dependency) > -1, `${dependency} is not loaded`);
    assert.ok(scripts.indexOf(dependency) < scripts.indexOf("station/station.js"));
  }

  // Dynamically inserted scripts default to async, which would let them run in
  // any order. This is the one line that stops that.
  const nodes = result.head.children.filter(node => node.nodeName === "SCRIPT");
  for (const node of nodes) assert.equal(node.async, false, "a Station script was left async and can race");
});

test("the host integration stylesheet loads before the component stylesheets", () => {
  const sheets = run("https://resin.tools/?view=station").stylesheets().map(url => url.split("?")[0]);
  assert.equal(sheets[0], "station/styles/host.css");
  for (const sheet of ["station/styles/tokens.css", "station/styles/base.css", "station/styles/shell.css"]) {
    assert.ok(sheets.includes(sheet), `${sheet} is not loaded`);
  }
});

test("every asset carries a cache-busting version", () => {
  const result = run("https://resin.tools/?view=station");
  for (const url of [...result.stylesheets(), ...result.scripts()]) {
    assert.match(url, /\?v=\d+\.\d+\.\d+$/, `${url} has no ?v= tag`);
  }
});

test("every asset the host names exists on disk", () => {
  const result = run("https://resin.tools/?view=station");
  for (const url of [...result.stylesheets(), ...result.scripts()]) {
    const file = url.split("?")[0];
    assert.ok(fs.existsSync(path.join(__dirname, file)), `the host loads ${file}, which does not exist`);
  }
});

/* ----------------------------------------------------------------------
 *   It remains a switch, not an application
 * -------------------------------------------------------------------- */

test("the host defines no global of its own", () => {
  const result = run("https://resin.tools/?view=station");
  const added = Object.keys(result.root).filter(key => !["document", "location", "globalThis", "URL"].includes(key));
  assert.deepEqual(added, [], `the host leaked globals: ${added.join(", ")}`);
});

test("the host runs without a document at all", () => {
  // Belt and braces: it is loaded by a page, but it must not be the reason
  // something fails in an unusual environment.
  const root = { location: { href: "https://resin.tools/?view=station" }, URL };
  vm.createContext(root);
  assert.doesNotThrow(() => new vm.Script(SOURCE).runInContext(root));
});

test("the harness really can activate - so the negative tests above mean something", () => {
  // A sandbox missing a global would make every "did not activate" assertion
  // pass without testing anything. This is the control.
  const active = run("https://resin.tools/?view=station");
  assert.equal(active.body.getAttribute("data-station-view"), "station");
  assert.ok(active.created.length > 0);
  const inactive = run("https://resin.tools/");
  assert.equal(inactive.created.length, 0);
});
