"use strict";

/* The Operator Handbook (station/station-handbook.js): the launcher, the
 * panel it opens over the stage's lower half, the sections it hosts, and
 * the flight it opens with - driven against a small fake DOM, with the
 * animations recorded rather than played. What is pinned: opening changes
 * nothing but the Handbook's own state; the launcher is an SVG drawn in
 * tokens; the shell hosts sections without knowing what they are; motion
 * runs through the transition module and respects reduced motion; and the
 * whole thing is desktop-only by construction.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const handbookModule = require("./station/station-handbook.js");
const transition = require("./station/station-transition.js");

const ROOT = __dirname;

/* ----------------------------------------------------------------------
 *   A fake DOM
 * -------------------------------------------------------------------- */

let focused = null;

function makeNode(name, ns) {
  const node = {
    tagName: name.toUpperCase(),
    nodeName: name.toUpperCase(),
    namespaceURI: ns || null,
    attributes: {},
    children: [],
    parent: null,
    listeners: {},
    textContent: "",
    value: "",
    disabled: false,
    rect: null,
    animations: [],
    get firstChild() { return this.children[0] || null; },
    get parentNode() { return this.parent; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
    closest(selector) { let n = this; while (n) { if (matches(n, selector)) return n; n = n.parent; } return null; },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    dispatchEvent(event) {
      event.target = event.target || this;
      let n = this;
      while (n && !event.stopped) {
        for (const fn of n.listeners[event.type] || []) fn(event);
        if (!event.bubbles) break;
        n = n.parent;
      }
      return true;
    },
    focus() { focused = this; },
    blur() { if (focused === this) focused = null; },
    getBoundingClientRect() { return this.rect; },
    classList: {
      add(name) { const set = classSet(node); set.add(name); node.attributes.class = [...set].join(" "); },
      remove(name) { const set = classSet(node); set.delete(name); node.attributes.class = [...set].join(" "); },
      contains(name) { return classSet(node).has(name); },
      toggle(name, force) { const on = force === undefined ? !classSet(node).has(name) : !!force; (on ? this.add : this.remove)(name); return on; }
    }
  };
  return node;
}
function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
function matchesOne(node, selector) {
  const parts = selector.match(/(\.[a-z0-9_-]+|\[[a-z-]+(?:='[^']*')?\]|[a-z]+)/gi) || [];
  return parts.every(part => {
    if (part.startsWith(".")) return classSet(node).has(part.slice(1));
    const attr = part.match(/^\[([a-z-]+)(?:='([^']*)')?\]$/);
    if (attr) return attr[2] === undefined ? node.hasAttribute(attr[1]) : node.getAttribute(attr[1]) === attr[2];
    return node.tagName === part.toUpperCase();
  });
}
function matches(node, selector) { return selector.split(",").some(one => matchesOne(node, one.trim())); }
function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }
function fakeDocument() {
  const doc = makeNode("#document");
  doc.createElement = name => makeNode(name);
  doc.createElementNS = (ns, name) => makeNode(name, ns);
  Object.defineProperty(doc, "activeElement", { get: () => focused });
  return doc;
}
const click = node => node.dispatchEvent({ type: "click", bubbles: true });
const key = (node, k) => node.dispatchEvent({ type: "keydown", key: k, bubbles: true, stopPropagation() { this.stopped = true; }, preventDefault() {} });
const hidden = node => node.hasAttribute("hidden");
const byClass = (root, name) => root.querySelector(`.${name}`);
const tick = () => new Promise(resolve => setImmediate(resolve));

/* A recorded animation, with the surface the Handbook uses. */
function fakeAnimation(element, keyframes, options) {
  const animation = { element, keyframes, options, reversed: 0, cancelled: false, finish: null };
  animation.finished = new Promise(resolve => { animation.finish = resolve; });
  animation.reverse = () => { animation.reversed += 1; };
  animation.cancel = () => { animation.cancelled = true; animation.finish(); };
  return animation;
}

/* A section that records what the Handbook tells it. */
function recordingSection(id, title) {
  const log = [];
  return {
    log,
    section: {
      id, title,
      create(doc, context) {
        log.push(["create", Object.keys(context)]);
        const element = doc.createElement("div");
        element.setAttribute("data-test-section", id);
        return { element, update() { log.push(["update"]); }, focus() { log.push(["focus"]); } };
      }
    }
  };
}

function build(options) {
  const doc = fakeDocument();
  const animations = [];
  const a = recordingSection("recipe-book", "Recipe Book");
  const b = recordingSection("second", "Second");
  const settings = Object.assign({
    sections: [a.section, b.section],
    context: { recipes: null, blend: null },
    animate: (element, keyframes, opts) => { const animation = fakeAnimation(element, keyframes, opts); animations.push(animation); return animation; },
    measure: element => element.rect,
    reducedMotion: () => false
  }, options || {});
  const handbook = handbookModule.create(doc, settings);
  handbook.launcher.rect = { left: 16, top: 600, width: 64, height: 64 };
  handbook.panel.rect = { left: 300, top: 400, width: 880, height: 320 };
  return { doc, handbook, animations, a, b };
}

/* ----------------------------------------------------------------------
 *   The launcher
 * -------------------------------------------------------------------- */

test("the launcher is a 64 by 64 SVG drawn in Station's own classes: no emoji, no image, no text glyph", () => {
  const { handbook } = build();
  const launcher = handbook.launcher;
  assert.equal(launcher.tagName, "BUTTON");
  assert.equal(launcher.getAttribute("aria-label"), "Operator Handbook");
  assert.equal(launcher.getAttribute("aria-expanded"), "false");
  const icon = launcher.children[0];
  assert.equal(icon.tagName, "SVG");
  assert.equal(icon.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(icon.getAttribute("viewBox"), "0 0 64 64");
  assert.equal(icon.getAttribute("width"), "64");
  assert.equal(icon.getAttribute("height"), "64");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  const names = [];
  walk(icon, node => { if (node !== icon) names.push(node.tagName); });
  assert.ok(names.every(name => ["RECT", "PATH"].includes(name)), `the icon is drawn with ${[...new Set(names)]}`);
  walk(icon, node => {
    assert.equal(node.textContent, "", "the icon carries no text");
    for (const cls of classSet(node)) assert.match(cls, /^station-handbook__icon/);
    assert.ok(!node.hasAttribute("fill") && !node.hasAttribute("stroke") && !node.hasAttribute("style"), "a colour is written on the icon rather than in the stylesheet");
  });
  // Two pages, a spine, page lines, blend rows, a ribbon - the parts the stylesheet names.
  for (const part of ["icon-plate", "icon-page", "icon-spine", "icon-line", "icon-row", "icon-ribbon"]) {
    assert.ok(icon.querySelector(`.station-handbook__${part}`), `the icon has no ${part}`);
  }
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/handbook.css"), "utf8");
  for (const part of ["icon-plate", "icon-page", "icon-spine", "icon-line", "icon-row", "icon-ribbon"]) {
    assert.match(css, new RegExp(`\\.station-handbook__${part}`), `handbook.css does not colour the ${part}`);
  }
  assert.match(css, /\.station-root \.station-handbook__launcher \{[^}]*width: 64px;[^}]*height: 64px;/);
  const source = fs.readFileSync(path.join(ROOT, "station/station-handbook.js"), "utf8");
  assert.doesNotMatch(source, /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u, "the launcher uses an emoji");
  assert.doesNotMatch(source, /<img|\.png|\.svg"|background-image/, "the launcher loads an image asset");
});

/* ----------------------------------------------------------------------
 *   Opening and closing
 * -------------------------------------------------------------------- */

test("closed by default; the launcher opens the panel, Close and Escape close it, and nothing else is touched", () => {
  const { handbook, a } = build();
  assert.equal(handbook.isOpen(), false);
  assert.ok(hidden(handbook.panel));
  const before = a.log.length;
  click(handbook.launcher);
  assert.equal(handbook.isOpen(), true);
  assert.ok(!hidden(handbook.panel));
  assert.equal(handbook.launcher.getAttribute("aria-expanded"), "true");
  assert.ok(handbook.element.classList.contains("is-open"));
  // Opening told the section to update and to take focus - and did nothing
  // else: the context handed to the sections carries no setter, and the
  // Handbook has no way to reach the stage.
  assert.deepEqual(a.log.slice(before), [["update"], ["focus"]]);
  click(byClass(handbook.panel, "station-handbook__close"));
  assert.equal(handbook.isOpen(), false);
  assert.equal(handbook.launcher.getAttribute("aria-expanded"), "false");
  click(handbook.launcher);
  assert.equal(handbook.isOpen(), true);
  const event = { type: "keydown", key: "Escape", bubbles: true, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} };
  handbook.panel.dispatchEvent(event);
  assert.equal(handbook.isOpen(), false);
  assert.equal(event.stopped, true, "Escape inside the panel is spent on the panel, not passed to the stage");
  // Escape outside the panel is not the Handbook's.
  click(handbook.launcher);
  key(handbook.launcher, "Escape");
  assert.equal(handbook.isOpen(), true);
});

test("every way out runs beforeClose first - Close, the launcher, Escape inside the panel, close() - once each, while the panel is still open; opening never does", () => {
  const log = [];
  const { handbook } = build({ beforeClose: () => { log.push(["before", handbook.isOpen(), handbook.launcher.getAttribute("aria-expanded")]); } });
  click(handbook.launcher);
  assert.deepEqual(log, [], "opening is not a close");
  click(byClass(handbook.panel, "station-handbook__close"));
  assert.deepEqual(log, [["before", true, "true"]], "Close ran the hook before the panel's state changed");
  click(handbook.launcher);
  click(handbook.launcher);
  assert.equal(log.length, 2, "the launcher toggling the panel shut is a close");
  click(handbook.launcher);
  handbook.panel.dispatchEvent({ type: "keydown", key: "Escape", bubbles: true, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} });
  assert.equal(log.length, 3, "Escape inside the panel is a close");
  assert.equal(handbook.isOpen(), false);
  // A closed panel asked to close again does nothing, and runs nothing.
  assert.equal(handbook.close(), false);
  assert.equal(log.length, 3);
  handbook.open();
  assert.equal(handbook.close(), true);
  assert.equal(log.length, 4, "the programmatic close is the same close");
  // Without the option nothing changes: the hook is optional.
  const plain = build();
  click(plain.handbook.launcher);
  assert.equal(plain.handbook.close(), true);
});

test("the panel is a region over the stage: no dialog role, no backdrop, no element outside its own root", () => {
  const { handbook } = build();
  assert.equal(handbook.panel.getAttribute("role"), "region");
  assert.equal(handbook.panel.getAttribute("aria-label"), "Operator Handbook");
  assert.equal(handbook.element.children.length, 2, "the root is the launcher and the panel, nothing else");
  walk(handbook.element, node => {
    assert.notEqual(node.getAttribute("role"), "dialog");
    assert.doesNotMatch(String(node.getAttribute("class") || ""), /backdrop|overlay|modal|scrim/);
  });
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/handbook.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const panel = css.slice(css.indexOf(".station-handbook__panel {"), css.indexOf("}", css.indexOf(".station-handbook__panel {")));
  assert.match(panel, /height: min\(var\(--station-handbook-max-height\), calc\(var\(--station-handbook-share\) - var\(--station-space-3\)\)\);/, "the panel's height is not the stage's share");
  assert.match(panel, /width: min\(var\(--station-handbook-width\), calc\(100% - 2 \* var\(--station-handbook-clearance\)\)\);/, "the panel spans the window instead of its preferred width");
  assert.match(panel, /margin: 0 auto;/, "the panel is not centred");
  assert.match(panel, /bottom: var\(--station-space-3\);/);
  assert.doesNotMatch(css, /backdrop-filter|\.station-handbook__backdrop|inset: 0;\s*background/);
  // The root lets the pointer through to the hoppers; only its two boxes take it.
  assert.match(css, /\.station-handbook \{[^}]*pointer-events: none;/);
  assert.match(css, /\.station-root \.station-handbook__launcher \{[^}]*pointer-events: auto;/);
  assert.match(panel, /pointer-events: auto;/);
});

/* ----------------------------------------------------------------------
 *   Sections
 * -------------------------------------------------------------------- */

test("sections are built once with the context, tabbed in order, and the first shows first", () => {
  const { handbook, a, b } = build({ context: { recipes: "R", blend: "B" } });
  assert.deepEqual(handbook.sections(), ["recipe-book", "second"]);
  assert.deepEqual(a.log[0], ["create", ["recipes", "blend"]]);
  assert.deepEqual(b.log[0], ["create", ["recipes", "blend"]]);
  assert.equal(handbook.current(), "recipe-book");
  const tabs = handbook.panel.querySelectorAll(".station-handbook__tab");
  assert.deepEqual(tabs.map(tab => [tab.textContent, tab.getAttribute("aria-pressed")]), [["Recipe Book", "true"], ["Second", "false"]]);
  const hosts = handbook.panel.querySelectorAll(".station-handbook__section");
  assert.deepEqual(hosts.map(host => [host.getAttribute("data-section"), hidden(host)]), [["recipe-book", false], ["second", true]]);
  assert.equal(hosts[0].children[0].getAttribute("data-test-section"), "recipe-book");
  click(tabs[1]);
  assert.equal(handbook.current(), "second");
  assert.deepEqual(hosts.map(host => hidden(host)), [true, false]);
  assert.deepEqual(b.log[b.log.length - 1], ["update"]);
  // update() reaches every section; a section that throws on create is
  // dropped rather than taking the Handbook down.
  handbook.update();
  assert.deepEqual(a.log[a.log.length - 1], ["update"]);
  const broken = handbookModule.create(fakeDocument(), { sections: [{ id: "x", title: "X", create() { throw new Error("no"); } }, a.section] });
  assert.deepEqual(broken.sections(), ["x", "recipe-book"]);
  assert.equal(broken.section("x"), null);
  assert.ok(broken.section("recipe-book"));
  // A malformed section is not a section.
  assert.deepEqual(handbookModule.create(fakeDocument(), { sections: [null, { id: "", create() {} }, { id: "y" }] }).sections(), []);
});

/* ----------------------------------------------------------------------
 *   The flight
 * -------------------------------------------------------------------- */

test("opening is a flight out of the launcher on the transition's tokens, closing reverses it, and reduced motion drops the travel", async () => {
  const { handbook, animations } = build({ timing: { move: 300, settle: 120, ease: "ease-x" } });
  handbook.open();
  assert.equal(animations.length, 2, "the panel and its body");
  const [panel, body] = animations;
  assert.equal(panel.element, handbook.panel);
  // The transform that lays the panel over the launcher: the launcher's
  // width over the panel's, from the panel's top-left to the launcher's.
  const expected = transition.overlayTransform(handbook.launcher.rect, handbook.panel.rect);
  assert.equal(panel.keyframes[0].transform, expected);
  assert.match(expected, /^translate\(-284px, 200px\) scale\(0\.073\)$/);
  assert.equal(panel.keyframes[1].transform, "none");
  assert.deepEqual(panel.options, { duration: 300, easing: "ease-x", fill: "both" });
  assert.equal(body.options.duration, 120);
  assert.equal(body.options.delay, 180);
  // Closing while still opening turns the same animations around.
  handbook.close();
  assert.equal(handbook.isOpen(), false);
  assert.equal(animations.length, 2, "closing mid-flight played nothing new");
  assert.equal(panel.reversed, 1);
  assert.equal(body.reversed, 1);
  assert.ok(!hidden(handbook.panel), "still travelling: the panel is not hidden yet");
  panel.finish(); body.finish();
  await tick(); await tick();
  assert.ok(hidden(handbook.panel), "landed closed: the panel is hidden");
  // Opened and settled, then closed: leaves along the same path.
  handbook.open();
  animations[2].finish(); animations[3].finish();
  await tick(); await tick();
  handbook.close();
  assert.equal(animations.length, 5);
  assert.equal(animations[4].keyframes[1].transform, expected);
  animations[4].finish();
  await tick(); await tick();
  assert.ok(hidden(handbook.panel));
  // Reduced motion: state changes, nothing travels.
  const quiet = build({ reducedMotion: () => true });
  quiet.handbook.open();
  assert.equal(quiet.animations.length, 0);
  assert.equal(quiet.handbook.isOpen(), true);
  quiet.handbook.close();
  assert.equal(quiet.animations.length, 0);
  assert.ok(hidden(quiet.handbook.panel));
});

test("motion runs through the transition module's helpers - the Handbook never animates on its own", () => {
  const source = fs.readFileSync(path.join(ROOT, "station/station-handbook.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\.animate\s*\(/);
  assert.match(source, /transitionModule\.play\(/);
  assert.match(source, /transitionModule\.overlayTransform\(/);
  assert.match(source, /transitionModule\.readTiming\(/);
  assert.doesNotMatch(source, /setTimeout|setInterval|requestAnimationFrame/);
  // The module's own defaults are the transition's.
  assert.equal(handbookModule.DEFAULT_TIMING, transition.DEFAULT_TIMING);
  // And the two helpers do what the Handbook needs of them.
  assert.equal(transition.overlayTransform(null, { width: 1, height: 1 }), null);
  assert.equal(transition.overlayTransform({ width: 64, left: 0, top: 0 }, { width: 0, height: 10 }), null);
  assert.equal(transition.play({}, [], {}), null, "an element that cannot animate is not an error");
});

/* ----------------------------------------------------------------------
 *   One frame, fixed capacity
 * -------------------------------------------------------------------- */

/* The panel's box comes from the stage, never from the section showing in
 * it: switching sections is turning a page in one window, not opening a
 * different one. What the stylesheet promises is pinned here, the rest is
 * measured in the browser (the report of the pass that set it). */
test("the frame is sized from the stage's tokens alone - a definite height, no maximum that content could fall under, and the sections clipped inside it", () => {
  const raw = fs.readFileSync(path.join(ROOT, "station/styles/components/handbook.css"), "utf8");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = name => { const at = css.indexOf(`${name} {`); assert.ok(at >= 0, `${name} has no rule`); return css.slice(at, css.indexOf("}", at)); };
  const panel = rule(".station-handbook__panel");
  assert.match(panel, /\bheight: min\(var\(--station-handbook-max-height\), calc\(var\(--station-handbook-share\) - var\(--station-space-3\)\)\);/);
  assert.doesNotMatch(panel, /\s(max-height|min-height):|fit-content|max-content|height: auto/, "the panel's height answers to its contents");
  assert.doesNotMatch(panel, /\d+px|\d+vh|\d+vw/, "the panel carries a raw length instead of a token");
  // The four tokens are the stage's to define, in the one file that holds raw lengths.
  const tokens = fs.readFileSync(path.join(ROOT, "station/styles/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(tokens, /--station-handbook-width: \d+px;/);
  assert.match(tokens, /--station-handbook-share: \d+%;/);
  assert.match(tokens, /--station-handbook-max-height: \d+px;/);
  assert.match(tokens, /--station-handbook-clearance: \d+px;/);
  // Whatever the share, the frame never reaches the hopper bank: the drawing
  // is 740 units tall and its clusters end at unit 404 (station-machine-layout.js),
  // 55% down a height-fitted stage, so the share has to stay under 45%.
  const share = Number(/--station-handbook-share: (\d+)%;/.exec(tokens)[1]);
  assert.ok(share <= 44, `a ${share}% share reaches the hopper clusters`);
  const layout = fs.readFileSync(path.join(ROOT, "station/station-machine-layout.js"), "utf8");
  const d = key => Number(new RegExp(`\\b${key}: (\\d+),`).exec(layout)[1]);
  const clusterBottom = d("vesselBottom") + d("coneHeight") + d("spoutHeight") + d("hopperCaptionGap") + d("hopperCaptionHeight");
  assert.ok(clusterBottom / d("height") < 1 - share / 100, `the clusters end ${Math.round(100 * clusterBottom / d("height"))}% down; the frame starts at ${100 - share}%`);
  // The launcher's column stays clear of the centred frame at Station's narrowest.
  const clearance = Number(/--station-handbook-clearance: (\d+)px;/.exec(tokens)[1]);
  assert.ok(clearance >= 16 + 64 + 16, "the frame can land on the launcher");
  // The bench clips; a section with more than fits scrolls within itself.
  assert.match(rule(".station-handbook__body"), /overflow: hidden;/);
  assert.match(rule(".station-handbook__section"), /overflow: hidden;/);
  for (const own of [".station-book__list", ".station-book__detail", ".station-book__blend"]) {
    assert.match(rule(own), /overflow-y: auto;/, `${own} does not scroll on its own`);
  }
  // No section rule sets a height the frame would have to meet.
  for (const match of css.matchAll(/\.station-book[a-z_-]* \{([^}]*)\}/g)) {
    assert.doesNotMatch(match[1], /(^|[^-])height:/, `a Recipe Book rule asks for a height: ${match[0].slice(0, 40)}`);
  }
  assert.doesNotMatch(css, /margin-top: auto/, "a section pins something to the frame's floor");
  // The tag the harness loads the stylesheet under moved with its bytes.
  assert.match(raw, /ONE SURFACE, FIXED CAPACITY/);
});

test("switching sections touches the tabs and the section hosts and nothing of the frame, so Recipe Book and any other section stand in one and the same box", () => {
  const { handbook, a, b } = build();
  const panel = handbook.panel;
  const frame = () => JSON.stringify({
    tag: panel.tagName, attributes: panel.attributes, head: panel.children[0].attributes,
    close: byClass(panel, "station-handbook__close").attributes,
    body: panel.children[1].attributes, root: handbook.element.attributes,
    launcher: handbook.launcher.attributes
  });
  handbook.open();
  const opened = frame();
  assert.equal(handbook.current(), "recipe-book");
  handbook.show("second");
  assert.equal(handbook.current(), "second");
  assert.equal(frame(), opened, "showing another section changed the frame");
  handbook.show("recipe-book");
  assert.equal(frame(), opened);
  // The sections' hosts are the only things that change, and only by hidden.
  const hosts = panel.querySelectorAll(".station-handbook__section");
  handbook.show("second");
  assert.deepEqual(hosts.map(hidden), [true, false]);
  assert.deepEqual(hosts.map(host => Object.keys(host.attributes).filter(k => k !== "hidden").sort()), [["class", "data-section", "role"], ["class", "data-section", "role"]]);
  // The Handbook offers a section no way to size the frame: nothing in the
  // context or the section contract names the panel.
  assert.deepEqual(a.log[0], ["create", ["recipes", "blend"]]);
  assert.deepEqual(b.log[0], ["create", ["recipes", "blend"]]);
  const source = fs.readFileSync(path.join(ROOT, "station/station-handbook.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /panel\.style|\.style\.(height|width|maxHeight|minHeight)|offsetHeight|scrollHeight|clientHeight/, "the shell measures or sizes the frame in script");
  assert.doesNotMatch(source, /panel\.classList\.(add|toggle)\(/, "the shell marks the panel per section");
});

test("opening with any section showing flies to the same frame, from the same launcher", () => {
  const first = build({ timing: { move: 300, settle: 120, ease: "ease-x" } });
  first.handbook.open();
  const second = build({ timing: { move: 300, settle: 120, ease: "ease-x" } });
  second.handbook.show("second");
  second.handbook.open();
  assert.equal(first.animations[0].keyframes[0].transform, second.animations[0].keyframes[0].transform, "a different section flew to a different box");
  assert.deepEqual(first.animations.map(animation => [animation.keyframes, animation.options]), second.animations.map(animation => [animation.keyframes, animation.options]));
  // And back: closing from either section leaves along that same path.
  first.animations.forEach(animation => animation.finish());
  second.animations.forEach(animation => animation.finish());
  return tick().then(tick).then(() => {
    first.handbook.close();
    second.handbook.close();
    assert.equal(first.animations[2].keyframes[1].transform, second.animations[2].keyframes[1].transform);
  });
});

/* ----------------------------------------------------------------------
 *   Desktop only, by construction
 * -------------------------------------------------------------------- */

test("the Handbook exists only inside Station: loaded by the host and the harness, never by index.html, and its CSS names nothing of the floor UI", () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.doesNotMatch(indexHtml, /station-handbook|station-recipe-book|handbook\.css|Operator Handbook|station-book/);
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  assert.match(host, /"station\/station-handbook\.js"/);
  // The host loads Station only under ?view=station, and Station's shell
  // hides itself under 1100px: the Handbook inherits both gates and adds
  // no breakpoint of its own.
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/handbook.css"), "utf8");
  assert.doesNotMatch(css, /@media/);
  for (const legacy of ["mobile", "tablet", "touch", "#", "body", "main"]) {
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), new RegExp(`(^|[\\s,>])${legacy.replace("#", "\\#")}\\b`, "m"), `handbook.css reaches for ${legacy}`);
  }
  // The floor UI's stylesheets and markup gained nothing for it.
  for (const sheet of fs.readdirSync(ROOT).filter(name => name.endsWith(".css"))) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, sheet), "utf8"), /handbook|station-book/i, `${sheet} styles the Handbook`);
  }
});
