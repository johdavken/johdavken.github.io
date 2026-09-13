"use strict";

/* Station's profile picture (station/station-avatar.js): the face beside
 * the name in the header, and the larger picture it opens under itself.
 * These tests drive the module against the same small fake DOM the line
 * console's tests use, and pin the two hosts' wiring at source level.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const avatarModule = require("./station/station-avatar.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ----------------------------------------------------------------------
 *   A fake DOM: attributes, classes, a few selectors, bubbling events
 * -------------------------------------------------------------------- */

let focused = null;
function makeNode(name) {
  const node = {
    tagName: name.toUpperCase(),
    attributes: {},
    children: [],
    parent: null,
    listeners: {},
    textContent: "",
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
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
    classList: {
      add(name) { const set = classSet(node); set.add(name); node.attributes.class = [...set].join(" "); },
      remove(name) { const set = classSet(node); set.delete(name); node.attributes.class = [...set].join(" "); },
      contains(name) { return classSet(node).has(name); }
    }
  };
  return node;
}
function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
function matches(node, selector) {
  const cls = selector.match(/^\.([a-z0-9_-]+)$/i);
  if (cls) return classSet(node).has(cls[1]);
  throw new Error(`unsupported selector ${selector}`);
}
function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }
function fakeDocument() {
  const doc = makeNode("#document");
  doc.createElement = name => makeNode(name);
  doc.captureListeners = {};
  doc.addEventListener = (type, fn, capture) => { const bucket = capture ? doc.captureListeners : doc.listeners; (bucket[type] = bucket[type] || []).push(fn); };
  doc.removeEventListener = (type, fn, capture) => { const bucket = capture ? doc.captureListeners : doc.listeners; bucket[type] = (bucket[type] || []).filter(entry => entry !== fn); };
  /* A pointer press somewhere in the document, as the module's capture
   * listener sees it. */
  doc.pressOutside = target => { for (const fn of doc.captureListeners.pointerdown || []) fn({ type: "pointerdown", target }); };
  return doc;
}
const click = node => node.dispatchEvent({ type: "click", bubbles: true });
const key = (node, k) => {
  const event = { type: "keydown", key: k, bubbles: true, stopped: false, defaultPrevented: false,
    stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } };
  node.dispatchEvent(event);
  return event;
};
const hidden = node => node.hasAttribute("hidden");
const byClass = (root, name) => root.querySelector(`.${name}`);

function mount(options) {
  const doc = fakeDocument();
  const built = avatarModule.create(doc, Object.assign({ assets: "station/assets/" }, options || {}));
  const outside = doc.appendChild(makeNode("div"));
  doc.appendChild(built.element);
  return { doc, built, root: built.element, outside,
    trigger: byClass(built.element, "station-avatar__trigger"), panel: byClass(built.element, "station-avatar__panel") };
}

/* ----------------------------------------------------------------------
 *   Structure
 * -------------------------------------------------------------------- */

test("the avatar is a button around the face and a hidden dialog holding the larger picture - nothing else", () => {
  const { root, trigger, panel } = mount();
  assert.deepEqual(root.children.map(node => [node.tagName, node.getAttribute("class")]),
    [["BUTTON", "station-avatar__trigger"], ["DIV", "station-avatar__panel"]]);
  assert.equal(trigger.getAttribute("type"), "button");
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(trigger.getAttribute("aria-label"), "Station's picture");
  const face = byClass(root, "station-avatar__face");
  assert.equal(face.tagName, "IMG");
  assert.equal(face.parent, trigger);
  assert.equal(face.getAttribute("alt"), "", "decorative to a screen reader; the button carries the name");
  assert.equal(face.getAttribute("width"), "32");
  assert.equal(face.getAttribute("height"), "32");
  assert.equal(panel.getAttribute("role"), "dialog");
  assert.equal(panel.getAttribute("tabindex"), "-1");
  assert.ok(hidden(panel), "the picture is hidden until asked for");
  const portrait = byClass(root, "station-avatar__portrait");
  assert.equal(portrait.tagName, "IMG");
  assert.equal(portrait.parent, panel);
  assert.equal(panel.children.length, 1, "the panel is the picture and nothing else");
  assert.equal(portrait.getAttribute("loading"), "lazy", "the larger file is not fetched for a header that never opens it");
  assert.equal(portrait.getAttribute("width"), "320");
  assert.equal(portrait.getAttribute("height"), "380");
  assert.match(portrait.getAttribute("alt"), /Station/);
  // No text in the header from it: the name is the title's.
  walk(root, node => assert.equal(node.textContent, ""));
});

test("the two pictures are the derived files in station/assets, resolved from the assets base", () => {
  const { root, built } = mount({ assets: "https://resin.tools/station/assets/" });
  assert.equal(byClass(root, "station-avatar__face").getAttribute("src"), "https://resin.tools/station/assets/station-avatar.jpg");
  assert.equal(byClass(root, "station-avatar__portrait").getAttribute("src"), "https://resin.tools/station/assets/station-portrait.jpg");
  assert.deepEqual(built.assets, { avatar: "https://resin.tools/station/assets/station-avatar.jpg", portrait: "https://resin.tools/station/assets/station-portrait.jpg" });
  // A base without its slash gets one; the files exist on disk.
  assert.equal(avatarModule.resolveAssets("station/assets").avatar, "station/assets/station-avatar.jpg");
  for (const file of Object.values(avatarModule.FILES)) {
    assert.ok(fs.existsSync(path.join(ROOT, "station/assets", file)), `${file} is missing from station/assets`);
  }
});

/* ----------------------------------------------------------------------
 *   Open and close
 * -------------------------------------------------------------------- */

test("a press on the face opens the picture, focuses it and says so; a second press closes it and returns focus", () => {
  const opens = [];
  const { doc, built, root, trigger, panel } = mount({ onOpenChange: open => opens.push(open) });
  assert.equal(built.isOpen(), false);
  click(trigger);
  assert.equal(built.isOpen(), true);
  assert.equal(hidden(panel), false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(root.classList.contains("is-open"));
  assert.ok(focused === panel, "focus moves to the picture so Escape reaches it");
  assert.equal((doc.captureListeners.pointerdown || []).length, 1, "listening for a press outside while open");
  click(trigger);
  assert.equal(built.isOpen(), false);
  assert.ok(hidden(panel));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.ok(!root.classList.contains("is-open"));
  assert.ok(focused === trigger, "focus returns to the face");
  assert.equal((doc.captureListeners.pointerdown || []).length, 0, "the document listener is removed with the panel");
  assert.deepEqual(opens, [true, false]);
});

test("a press outside closes the picture; a press on it closes it too; a press on the face while open is the face's own toggle", () => {
  const { doc, built, trigger, panel, outside } = mount();
  click(trigger);
  doc.pressOutside(outside);
  assert.equal(built.isOpen(), false, "a press outside closes it");
  click(trigger);
  doc.pressOutside(panel);
  assert.equal(built.isOpen(), true, "a press inside the module is not 'outside'");
  doc.pressOutside(trigger);
  assert.equal(built.isOpen(), true, "the face's own press is left to its click handler");
  click(panel);
  assert.equal(built.isOpen(), false, "a press on the picture puts it away");
});

test("Escape closes the picture and is not passed on; Escape while closed is not the avatar's", () => {
  const { built, trigger, panel } = mount();
  const idle = key(trigger, "Escape");
  assert.equal(idle.stopped, false, "with nothing open, Escape belongs to whatever is under it");
  click(trigger);
  const closing = key(panel, "Escape");
  assert.equal(built.isOpen(), false);
  assert.equal(closing.stopped, true);
  assert.equal(closing.defaultPrevented, true);
  click(trigger);
  const other = key(panel, "Enter");
  assert.equal(built.isOpen(), true, "only Escape closes it");
  assert.equal(other.stopped, false);
  // From the face, with focus still there, Escape closes it as well.
  key(trigger, "Escape");
  assert.equal(built.isOpen(), false);
});

test("open, close and destroy are idempotent and never throw", () => {
  const { built, panel } = mount();
  built.close();
  built.open();
  built.open();
  assert.equal(built.isOpen(), true);
  built.close();
  built.close();
  assert.equal(built.isOpen(), false);
  built.open();
  built.destroy();
  assert.equal(built.isOpen(), false);
  assert.ok(hidden(panel));
  assert.ok(Object.isFrozen(built));
});

/* ----------------------------------------------------------------------
 *   Identity, not a control
 * -------------------------------------------------------------------- */

test("the avatar is handed nothing and reaches nothing: no bridge, no command, no storage, no network", () => {
  const source = read("station/station-avatar.js");
  for (const pattern of [/PolynStation(?!Avatar)\w+/, /\.request\s*\(/, /\.subscribe\s*\(/, /\.dispatch\s*\(/, /localStorage/, /\bfetch\s*\(/]) {
    assert.doesNotMatch(source, pattern, `station-avatar.js reaches outside itself (matched ${pattern})`);
  }
  // And the boot file hands it the document alone.
  const boot = read("station/station.js");
  assert.match(boot, /mounts\.avatar\.appendChild\(avatar\.create\(doc\)\.element\)/);
});

/* ----------------------------------------------------------------------
 *   Both hosts load it, in the same place
 * -------------------------------------------------------------------- */

test("both hosts load the avatar module and its sheet, after the shell and before the boot file", () => {
  const host = read("station-host.js");
  const harness = read("station/station.html");
  assert.match(host, /"station\/station-avatar\.js"/);
  assert.match(host, /"station\/styles\/components\/avatar\.css"/);
  assert.match(harness, /src="station-avatar\.js\?v=/);
  assert.match(harness, /href="styles\/components\/avatar\.css\?v=/);
  assert.ok(host.indexOf("station-shell.js") < host.indexOf("station-avatar.js"));
  assert.ok(host.indexOf("station-avatar.js") < host.indexOf("station/station.js"));
  assert.ok(harness.indexOf("station-shell.js") < harness.indexOf("station-avatar.js"));
  assert.ok(harness.indexOf("station-avatar.js") < harness.indexOf('src="station.js'));
});

test("the face fits inside the header's row: 32px in a 52px track, the slot itself adding no height", () => {
  const tokens = read("station/styles/tokens.css");
  assert.match(tokens, /--station-header-height: 52px;/);
  const css = read("station/styles/components/avatar.css");
  const trigger = css.match(/\.station-root \.station-avatar__trigger \{([^}]*)\}/);
  assert.ok(trigger);
  assert.match(trigger[1], /width: 32px;/);
  assert.match(trigger[1], /height: 32px;/);
  assert.match(trigger[1], /border-radius: var\(--station-radius\);/, "rounded corners, from the shape tokens");
  const shell = read("station/styles/shell.css");
  const slot = shell.match(/\.station-header__avatar \{([^}]*)\}/);
  assert.ok(slot);
  assert.doesNotMatch(slot[1], /height|padding|margin/);
  // The picture is a popover over the stage, not a track of the shell.
  const panel = css.match(/\.station-avatar__panel \{([^}]*)\}/);
  assert.match(panel[1], /position: absolute;/);
  assert.match(panel[1], /z-index: 20;/);
  assert.doesNotMatch(shell, /station-avatar__panel/);
  assert.equal(avatarModule.AVATAR_SIZE, 32);
});
