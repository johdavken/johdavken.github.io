"use strict";

/* slate-host.js, actually executed.
 *
 * The claim "normal startup is unchanged" deserves better than a regex over the
 * source. This runs the real file in a sandbox with a fake window and document
 * and checks what it did: with no flag it must not create an element, set an
 * attribute, or request a single asset. The fake implements exactly what the
 * host touches - if the host ever reaches for something else, it fails here
 * rather than quietly depending on a browser.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "slate-host.js"), "utf8");

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
    appendChild(child) { this.children.push(child); return child; },
    listeners: {},
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); }
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

  // A vm context starts with no web globals, so URL has to be handed in.
  const root = { document: doc, location: { href }, URL };
  if (settings.theme) root.PolynSlateTheme = settings.theme;
  if (settings.display) root.PolynSlateDisplay = settings.display;
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

const ACTIVE = "https://resin.tools/?view=slate";

/* ----------------------------------------------------------------------
 *   Normal startup does not activate Slate
 * -------------------------------------------------------------------- */

test("a normal load creates nothing, sets nothing, and requests nothing", () => {
  const run1 = run("https://resin.tools/");
  assert.equal(run1.created.length, 0, "the host created a DOM element on a normal load");
  assert.deepEqual(run1.body.attributes, {}, "the host set an attribute on a normal load");
  assert.equal(run1.body.children.length, 0);
  assert.equal(run1.head.children.length, 0);
  assert.deepEqual(Object.keys(run1.listeners), [], "the host registered a listener on a normal load");
});

test("neither a different view, a partial match, nor a missing query activates Slate", () => {
  for (const href of [
    "https://resin.tools/",
    "https://resin.tools/?view=",
    "https://resin.tools/?view=slates",
    "https://resin.tools/?view=Slate",
    "https://resin.tools/?view=station",
    "https://resin.tools/?slate",
    "https://resin.tools/?viewer=slate",
    "https://resin.tools/#view=slate",
    "https://resin.tools/?other=1"
  ]) {
    const result = run(href);
    assert.equal(result.created.length, 0, `${href} activated Slate`);
    assert.equal(result.body.getAttribute("data-slate-view"), null, `${href} activated Slate`);
  }
});

test("an unreadable URL means not requested, never assume yes", () => {
  const result = run(undefined);
  assert.equal(result.created.length, 0);
  assert.equal(result.body.getAttribute("data-slate-view"), null);
});

/* ----------------------------------------------------------------------
 *   ?view=slate activates the Slate presentation
 * -------------------------------------------------------------------- */

test("?view=slate marks the body and creates exactly one host container", () => {
  const result = run(ACTIVE);
  assert.equal(result.body.getAttribute("data-slate-view"), "slate");

  const hosts = result.body.children.filter(node => node.hasAttribute("data-slate-host"));
  assert.equal(hosts.length, 1);
  // The container is also the mount point, so slate.js finds it and builds
  // the shell there from the shared builder.
  assert.equal(hosts[0].getAttribute("data-slate-app"), "");
  assert.match(hosts[0].className, /\bslate-root\b/);
  // Station's attribute is never touched: the two hosts are strangers.
  assert.equal(result.body.getAttribute("data-station-view"), null);
});

test("the theme is restored onto the host before it is appended, and falls back to Yaru Light", () => {
  const calls = [];
  const theme = { initialize(element, environment) { calls.push({ element, environment }); element.setAttribute("data-theme", "yaru-dark"); return { getTheme: () => "yaru-dark" }; } };
  const themed = run(ACTIVE, { theme });
  const host = themed.body.children[0];
  assert.equal(calls.length, 1);
  assert.ok(calls[0].element === host, "the controller was created for something other than the host");
  assert.ok(calls[0].environment && calls[0].environment.document === themed.doc, "the controller reads storage from somewhere other than the window");
  assert.equal(host.getAttribute("data-theme"), "yaru-dark");
  assert.ok(host.slateTheme, "the controller is not kept on the host for slate.js to find");

  const bare = run(ACTIVE);
  assert.equal(bare.body.children[0].getAttribute("data-theme"), "yaru-light");
});

test("the display preferences are restored onto the host the same way, and their absence is survived", () => {
  const calls = [];
  const display = { initialize(element, environment) { calls.push({ element, environment }); return { getReadOnly: () => null }; } };
  const themed = run(ACTIVE, { display });
  const host = themed.body.children[0];
  assert.equal(calls.length, 1);
  assert.ok(calls[0].element === host);
  assert.ok(host.slateDisplay, "the controller is not kept on the host for slate.js to find");
  assert.equal(run(ACTIVE).body.children[0].slateDisplay, null);
});

test("focus stops at the host's edge: focusin inside Slate never reaches the application's document listeners", () => {
  const result = run(ACTIVE);
  const host = result.body.children.find(node => node.hasAttribute("data-slate-host"));
  const handlers = host.listeners.focusin || [];
  assert.equal(handlers.length, 1, "the host stops focusin, and listens for nothing else");
  assert.deepEqual(Object.keys(host.listeners), ["focusin"]);
  const event = { stopped: false, stopPropagation() { this.stopped = true; } };
  handlers[0](event);
  assert.equal(event.stopped, true);
  // The reason is the application's own: a deferred select-all on every
  // focused input, which would take the focus back from a Slate control.
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(app, /document\.addEventListener\("focusin",\(e\)=>\{[\s\S]{0,300}selectAllSoon\(el\);/);
});

test("the flag still works alongside other query parameters", () => {
  for (const href of [
    "https://resin.tools/?view=slate",
    "https://resin.tools/?view=slate&other=1",
    "https://resin.tools/?other=1&view=slate",
    "https://resin.tools/index.html?view=slate"
  ]) {
    assert.equal(run(href).body.getAttribute("data-slate-view"), "slate", `${href} did not activate`);
  }
});

test("the container exists before the attribute that reveals it", () => {
  // host.css hides everything that is not the host the instant the attribute
  // lands. If the order were reversed the page would flash empty.
  const result = run(ACTIVE);
  const host = result.body.children[0];
  assert.ok(host && host.hasAttribute("data-slate-host"),
    "the host container is not the first thing appended to the body");
  assert.equal(result.body.getAttribute("data-slate-view"), "slate");
});

test("activation waits for the document when the parser is still running", () => {
  const result = run(ACTIVE, { readyState: "loading" });
  assert.deepEqual(Object.keys(result.listeners), ["DOMContentLoaded"]);
  assert.equal(result.body.children.length, 0, "the host touched the body before it was parsed");
  result.fire("DOMContentLoaded");
  assert.equal(result.body.getAttribute("data-slate-view"), "slate");
  assert.equal(result.body.children.length, 1);
});

test("activating twice does not build a second host", () => {
  const result = run(ACTIVE, { readyState: "loading" });
  result.fire("DOMContentLoaded");
  result.fire("DOMContentLoaded");
  assert.equal(result.body.children.filter(node => node.hasAttribute("data-slate-host")).length, 1);
  assert.equal(result.scripts().length, new Set(result.scripts()).size, "assets were loaded twice");
});

/* ----------------------------------------------------------------------
 *   What it loads, and how
 * -------------------------------------------------------------------- */

test("Slate assets are loaded only in Slate mode", () => {
  assert.equal(run("https://resin.tools/").head.children.length, 0);
  const active = run(ACTIVE);
  assert.ok(active.stylesheets().length > 0);
  assert.ok(active.scripts().length > 0);
});

test("every asset loaded is a Slate asset, or the one pure Station module Slate shares - no application code is re-run", () => {
  const result = run(ACTIVE);
  for (const url of result.stylesheets()) {
    assert.match(url, /^slate\/styles\//, `the host loaded ${url}, which is not a Slate stylesheet`);
  }
  for (const url of result.scripts()) {
    const file = url.split("?")[0];
    assert.ok(/^slate\//.test(file) || ["station/station-rundown.js", "station/station-print-sheet.js"].includes(file),
      `the host loaded ${file}, which is not part of the Slate presentation`);
    assert.doesNotMatch(url, /app\.js/);
    assert.doesNotMatch(url, /cloud-sync|supabase|active-job|line-identity/);
    // Station's UI is a different presentation; Slate draws its own.
    assert.doesNotMatch(file, /^station\/station\.js$|station-shell|station-render|station-machine/);
  }
});

test("Slate's own scripts are loaded in dependency order and cannot race", () => {
  const result = run(ACTIVE);
  const scripts = result.scripts().map(url => url.split("?")[0]);

  // slate.js reads the other globals when it executes, so it must be last.
  assert.equal(scripts[scripts.length - 1], "slate/slate.js");
  for (const dependency of ["slate/slate-line.js", "slate/slate-source.js", "slate/slate-shell.js",
    "slate/slate-demo.js", "slate/slate-sections.js", "station/station-rundown.js"]) {
    assert.ok(scripts.indexOf(dependency) > -1, `${dependency} is not loaded`);
    assert.ok(scripts.indexOf(dependency) < scripts.indexOf("slate/slate.js"));
  }
  // The summary reads the run-down module's global when it executes.
  assert.ok(scripts.indexOf("station/station-rundown.js") < scripts.indexOf("slate/slate-rundown-summary.js"));
  assert.ok(scripts.indexOf("station/station-print-sheet.js") < scripts.indexOf("slate/slate-print.js"));
  for (const dependency of ["slate/slate-recipe-actions.js", "slate/slate-plan-actions.js", "slate/slate-resin-search.js", "slate/slate-recipe-drag.js", "slate/slate-layer-menu.js", "slate/slate-print.js"]) {
    assert.ok(scripts.indexOf(dependency) > -1 && scripts.indexOf(dependency) < scripts.indexOf("slate/slate-recipe.js"), `${dependency} must load before the recipe section`);
  }

  // Dynamically inserted scripts default to async, which would let them run in
  // any order. This is the one line that stops that.
  const nodes = result.head.children.filter(node => node.nodeName === "SCRIPT");
  for (const node of nodes) assert.equal(node.async, false, "a Slate script was left async and can race");
});

test("the host integration stylesheet loads before the component stylesheets", () => {
  const sheets = run(ACTIVE).stylesheets().map(url => url.split("?")[0]);
  assert.equal(sheets[0], "slate/styles/host.css");
  for (const sheet of ["slate/styles/tokens.css", "slate/styles/base.css", "slate/styles/shell.css",
    "slate/styles/themes/yaru-light.css", "slate/styles/themes/yaru-dark.css"]) {
    assert.ok(sheets.includes(sheet), `${sheet} is not loaded`);
  }
  // Tokens and themes before base, which spends them.
  assert.ok(sheets.indexOf("slate/styles/tokens.css") < sheets.indexOf("slate/styles/base.css"));
  assert.ok(sheets.indexOf("slate/styles/themes/yaru-light.css") < sheets.indexOf("slate/styles/base.css"));
});

test("every asset carries a cache-busting version", () => {
  const result = run(ACTIVE);
  for (const url of [...result.stylesheets(), ...result.scripts()]) {
    assert.match(url, /\?v=\d+\.\d+\.\d+$/, `${url} has no ?v= tag`);
  }
});

test("every asset the host names exists on disk", () => {
  const result = run(ACTIVE);
  for (const url of [...result.stylesheets(), ...result.scripts()]) {
    const file = url.split("?")[0];
    assert.ok(fs.existsSync(path.join(__dirname, file)), `the host loads ${file}, which does not exist`);
  }
});

/* ----------------------------------------------------------------------
 *   It remains a switch, not an application
 * -------------------------------------------------------------------- */

test("the host defines no global of its own", () => {
  const result = run(ACTIVE);
  const added = Object.keys(result.root).filter(key => !["document", "location", "globalThis", "URL"].includes(key));
  assert.deepEqual(added, [], `the host leaked globals: ${added.join(", ")}`);
});

test("the host runs without a document at all", () => {
  const root = { location: { href: ACTIVE }, URL };
  vm.createContext(root);
  assert.doesNotThrow(() => new vm.Script(SOURCE).runInContext(root));
});

test("the harness really can activate - so the negative tests above mean something", () => {
  const active = run(ACTIVE);
  assert.equal(active.body.getAttribute("data-slate-view"), "slate");
  assert.ok(active.created.length > 0);
  const inactive = run("https://resin.tools/");
  assert.equal(inactive.created.length, 0);
});
