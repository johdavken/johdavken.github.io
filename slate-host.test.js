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
  // A desktop's window, when the test says so: the media query or the width, and no native shell.
  if (settings.wide !== undefined) root.matchMedia = query => ({ matches: query === "(pointer: coarse)" ? !!settings.coarse : (settings.wide && query === "(min-width: 1100px)") });
  // The screen, for a tablet's: [width, height] in CSS px.
  if (settings.screen) root.screen = { width: settings.screen[0], height: settings.screen[1] };
  // The device's stored choice of what it opens (slate-display.js `host`).
  if (settings.host) root.PolynSlateDisplay = { readFrom: () => ({ host: settings.host }) };
  if (settings.innerWidth !== undefined) root.innerWidth = settings.innerWidth;
  if (settings.native) root.Capacitor = { isNativePlatform: () => true };
  // The page's viewport tag and a clock, for the zoom reset.
  const timers = [];
  let meta = null;
  if (settings.viewport !== undefined) {
    meta = makeNode("meta");
    meta.setAttribute("name", "viewport");
    meta.setAttribute("content", settings.viewport);
    doc.querySelector = selector => (selector === "meta[name='viewport']" ? meta : null);
    root.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    root.addEventListener = () => {};
  }
  if (settings.theme) root.PolynSlateTheme = settings.theme;
  if (settings.display) root.PolynSlateDisplay = settings.display;
  root.globalThis = root;
  vm.createContext(root);
  new vm.Script(SOURCE).runInContext(root);

  return {
    doc, head, body, created, listeners, root, meta, timers,
    flushTimers() { while (timers.length) timers.shift().fn(); },
    fire(type) { for (const handler of listeners[type] || []) handler(); },
    stylesheets: () => head.children.filter(node => node.nodeName === "LINK").map(node => node.href),
    scripts: () => head.children.filter(node => node.nodeName === "SCRIPT").map(node => node.src)
  };
}

const ACTIVE = "https://resin.tools/?view=slate";

/* ----------------------------------------------------------------------
 *   Normal startup does not activate Slate
 * -------------------------------------------------------------------- */

test("a load that is not Slate's - here a phone-width window on the bare URL - creates nothing, sets nothing, and requests nothing", () => {
  const run1 = run("https://resin.tools/", { wide: false });
  assert.equal(run1.created.length, 0, "the host created a DOM element on a normal load");
  assert.deepEqual(run1.body.attributes, {}, "the host set an attribute on a normal load");
  assert.equal(run1.body.children.length, 0);
  assert.equal(run1.head.children.length, 0);
  assert.deepEqual(Object.keys(run1.listeners), [], "the host registered a listener on a normal load");
});

test("a URL naming another view - legacy, station, a partial match, an empty view - never activates Slate, however wide the window", () => {
  for (const href of [
    "https://resin.tools/?view=legacy",
    "https://resin.tools/?view=",
    "https://resin.tools/?view=slates",
    "https://resin.tools/?view=Slate",
    "https://resin.tools/?view=station",
    "https://resin.tools/?view=legacy&other=1"
  ]) {
    const result = run(href, { wide: true });
    assert.equal(result.created.length, 0, `${href} activated Slate`);
    assert.equal(result.body.getAttribute("data-slate-view"), null, `${href} activated Slate`);
  }
});

test("a URL naming no view boots Slate on a desktop window and the floor UI on a phone, or in the native app on a phone's screen; with nothing to measure, never assume a desktop", () => {
  for (const href of ["https://resin.tools/", "https://resin.tools/?other=1", "https://resin.tools/?slate", "https://resin.tools/?viewer=slate", "https://resin.tools/#view=slate", "https://resin.tools/index.html"]) {
    const desktop = run(href, { wide: true });
    assert.equal(desktop.body.getAttribute("data-slate-view"), "slate", `${href} did not boot Slate on a desktop`);
    assert.equal(desktop.body.children.filter(node => node.hasAttribute("data-slate-host")).length, 1);
    const phone = run(href, { wide: false });
    assert.equal(phone.body.getAttribute("data-slate-view"), null, `${href} booted Slate on a phone`);
    assert.equal(phone.created.length, 0);
    const native = run(href, { wide: true, native: true });
    assert.equal(native.body.getAttribute("data-slate-view"), null, `${href} booted Slate in the native app`);
    const unknown = run(href);
    assert.equal(unknown.body.getAttribute("data-slate-view"), null, `${href} assumed a desktop with nothing to measure`);
  }
  // Without matchMedia the width decides.
  assert.equal(run("https://resin.tools/", { innerWidth: 1100 }).body.getAttribute("data-slate-view"), "slate");
  assert.equal(run("https://resin.tools/", { innerWidth: 1099 }).body.getAttribute("data-slate-view"), null);
  // ?view=slate boots Slate on any window, as it always has.
  assert.equal(run("https://resin.tools/?view=slate", { wide: false }).body.getAttribute("data-slate-view"), "slate");
  assert.equal(run("https://resin.tools/?view=slate", { native: true }).body.getAttribute("data-slate-view"), "slate");
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
  assert.equal(bare.body.children[0].getAttribute("data-theme"), "yaru-dark");
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
  // The timeline reads the run-down module's and its layout's globals when it executes.
  assert.ok(scripts.indexOf("station/station-rundown.js") < scripts.indexOf("slate/slate-timeline-layout.js"));
  assert.ok(scripts.indexOf("slate/slate-timeline-layout.js") < scripts.indexOf("slate/slate-timeline.js"));
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

/* ----------------------------------------------------------------------
 *   Tablets
 * -------------------------------------------------------------------- */

const TABLET = [800, 1280];
const PHONE = [412, 915];
const view = result => result.body.getAttribute("data-slate-view");

test("a tablet's screen boots Slate with a touch pointer in the browser and in the Android app, in either orientation; a phone never does", () => {
  // The unfolded Galaxy Z Fold, as its WebView reports it: 933x704, and turned.
  for (const screen of [TABLET, [1280, 800], [1200, 1920], [960, 600], [933, 704], [704, 933]]) {
    assert.equal(view(run("https://resin.tools/", { wide: false, coarse: true, screen })), "slate", `browser tablet ${screen}`);
    assert.equal(view(run("https://resin.tools/", { wide: false, native: true, screen })), "slate", `app tablet ${screen}`);
  }
  // Phones, and the Fold's folded cover screen, in either orientation.
  for (const screen of [PHONE, [915, 412], [390, 844], [599, 1000], [700, 880], [412, 968], [968, 412]]) {
    assert.equal(view(run("https://resin.tools/", { wide: false, coarse: true, screen })), null, `browser phone ${screen}`);
    assert.equal(view(run("https://resin.tools/", { wide: true, native: true, screen })), null, `app phone ${screen}`);
  }
  // A narrow desktop window on a big screen, with a mouse, keeps the floor UI as before.
  assert.equal(view(run("https://resin.tools/", { wide: false, coarse: false, screen: [1920, 1080] })), null);
  // The app with no screen to measure keeps the floor UI.
  assert.equal(view(run("https://resin.tools/", { wide: true, native: true })), null);
});

test("the device's own choice decides first: legacy is the floor UI everywhere; slate is Slate anywhere but a phone's screen; ?view= still wins", () => {
  assert.equal(view(run("https://resin.tools/", { wide: true, host: "legacy" })), null, "a desktop that chose legacy got Slate");
  assert.equal(view(run("https://resin.tools/", { wide: false, native: true, screen: TABLET, host: "legacy" })), null);
  assert.equal(view(run("https://resin.tools/", { wide: false, coarse: false, screen: [1920, 1080], host: "slate" })), "slate", "a narrow desktop window that chose Slate");
  assert.equal(view(run("https://resin.tools/", { wide: false, native: true, screen: TABLET, host: "slate" })), "slate");
  assert.equal(view(run("https://resin.tools/", { wide: false, coarse: true, screen: PHONE, host: "slate" })), null, "a phone was given Slate");
  assert.equal(view(run("https://resin.tools/", { wide: true, native: true, screen: PHONE, host: "slate" })), null);
  assert.equal(view(run("https://resin.tools/?view=slate", { wide: true, host: "legacy" })), "slate");
  assert.equal(view(run("https://resin.tools/?view=legacy", { wide: true, host: "slate" })), null);
  assert.equal(view(run("https://resin.tools/", { wide: true, host: "nonsense" })), "slate", "an unknown choice is automatic");
});

test("the host marks a provisional tier before any Slate sheet loads, so a touch screen never paints the 1440px frame", () => {
  const app = run(ACTIVE, { wide: false, native: true });
  const hostEl = app.body.children.find(node => node.hasAttribute("data-slate-host"));
  assert.equal(hostEl.getAttribute("data-input"), "touch");
  assert.equal(hostEl.getAttribute("data-viewport"), "narrow");
  const tablet = run(ACTIVE, { wide: true, coarse: true });
  assert.equal(tablet.body.children.find(node => node.hasAttribute("data-slate-host")).getAttribute("data-input"), "touch");
  const desk = run(ACTIVE, { wide: true });
  const deskEl = desk.body.children.find(node => node.hasAttribute("data-slate-host"));
  assert.equal(deskEl.getAttribute("data-input"), "pointer");
  assert.equal(deskEl.getAttribute("data-viewport"), "wide");
});

test("on a touch device the host brings back a zoom the page never asked for - capped at 1 for a moment, then the viewport as it was; a desktop is left alone", () => {
  const VIEWPORT = "width=device-width,initial-scale=1,viewport-fit=cover";
  const app = run(ACTIVE, { wide: false, native: true, viewport: VIEWPORT });
  assert.equal(app.meta.getAttribute("content"), VIEWPORT, "the viewport changed before the page had loaded");
  app.timers.shift().fn();
  assert.equal(app.meta.getAttribute("content"), `${VIEWPORT},maximum-scale=1`);
  app.flushTimers();
  assert.equal(app.meta.getAttribute("content"), VIEWPORT, "the viewport was not restored, so a pinch could never zoom again");
  const desk = run(ACTIVE, { wide: true, viewport: VIEWPORT });
  assert.equal(desk.timers.length, 0, "a desktop's zoom was touched");
  const capped = run(ACTIVE, { native: true, viewport: "width=device-width,maximum-scale=2" });
  capped.flushTimers();
  assert.equal(capped.meta.getAttribute("content"), "width=device-width,maximum-scale=2", "a page's own maximum-scale was overridden");
});
