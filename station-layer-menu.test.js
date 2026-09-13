"use strict";

/* The layer card's menu (station/station-layer-menu.js): the quiet "⋯" in
 * a Blend Edit card's bottom-left and the three things it offers - Copy,
 * Paste and Reset - tested on its own: what it draws, how it opens and
 * closes, what each choice hands back, and the reset's arm-and-confirm.
 * What the boot file does with the callbacks is the booted suite's
 * (station-blend-actions-boot.test.js). The fake DOM is the machine
 * rail test's. */

const test = require("node:test");
const assert = require("node:assert/strict");

const menuModule = require("./station/station-layer-menu.js");
const actions = require("./station/station-blend-actions.js");

/* ----------------------------------------------------------------------
 *   A fake DOM
 * -------------------------------------------------------------------- */

let focused = null;

function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
function matchesOne(node, selector) {
  const parts = selector.match(/(\.[a-zA-Z0-9_-]+|\[[a-zA-Z-]+(?:='[^']*')?\]|[a-zA-Z]+)/g) || [];
  return parts.every(part => {
    if (part.startsWith(".")) return classSet(node).has(part.slice(1));
    const attr = part.match(/^\[([a-zA-Z-]+)(?:='([^']*)')?\]$/);
    if (attr) return attr[2] === undefined ? node.hasAttribute(attr[1]) : node.getAttribute(attr[1]) === attr[2];
    return node.nodeName.toLowerCase() === part.toLowerCase();
  });
}
function matches(node, selector) { return selector.split(",").some(one => matchesOne(node, one.trim())); }
function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }

function makeEvent(type, init) {
  return Object.assign({ type, bubbles: false, stopped: false, defaultPrevented: false, target: null,
    stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } }, init || {});
}

function makeNode(doc, name, ns) {
  const node = {
    nodeName: name, tagName: name.toUpperCase(), namespaceURI: ns || null, nodeType: 1,
    attributes: {}, children: [], parent: null, listeners: {}, style: {}, disabled: false, ownerDocument: doc,
    rect: null,
    get textContent() { return this._text !== undefined && !this.children.length ? this._text : this.children.map(c => c.textContent).join(""); },
    set textContent(v) { this.children = []; this._text = String(v); },
    get hidden() { return this.hasAttribute("hidden"); },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { if (child.parent) child.parent.removeChild(child); this.children.push(child); child.parent = this; return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
    closest(selector) { let n = this; while (n) { if (n.nodeType === 1 && matches(n, selector)) return n; n = n.parent; } return null; },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && n.nodeType === 1 && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); },
    dispatchEvent(event) {
      event.target = event.target || this;
      // Capture on the document first, as the rail's click-away listener is registered.
      if (doc && doc !== this) for (const fn of (doc.listeners[event.type] || []).slice()) fn(event);
      let n = this;
      while (n && !event.stopped) {
        for (const fn of (n.listeners[event.type] || []).slice()) fn(event);
        if (!event.bubbles) break;
        n = n.parent;
      }
      return true;
    },
    click() { this.dispatchEvent(makeEvent("pointerdown", { bubbles: true })); this.dispatchEvent(makeEvent("click", { bubbles: true })); },
    focus() { const old = focused; focused = this; if (old && old !== this) old.dispatchEvent(makeEvent("blur")); },
    blur() { if (focused !== this) return; focused = null; this.dispatchEvent(makeEvent("blur")); },
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, width: 0, height: 0 }; },
    classList: null
  };
  node.classList = {
    add(...names) { const set = classSet(node); for (const nm of names) set.add(nm); node.attributes.class = [...set].join(" "); },
    remove(...names) { const set = classSet(node); for (const nm of names) set.delete(nm); node.attributes.class = [...set].join(" "); },
    contains(nm) { return classSet(node).has(nm); },
    toggle(nm, force) { const on = force === undefined ? !classSet(node).has(nm) : !!force; (on ? this.add : this.remove).call(this, nm); return on; }
  };
  return node;
}

function fakeDocument() {
  const doc = makeNode(null, "#document");
  doc.ownerDocument = doc;
  doc.nodeType = 9;
  doc.createElement = name => makeNode(doc, name);
  doc.createElementNS = (ns, name) => makeNode(doc, name, ns);
  doc.body = doc.appendChild(makeNode(doc, "body"));
  return doc;
}

/* A menu with recording callbacks and a hand-driven clock. */
function build(options) {
  focused = null;
  const doc = fakeDocument();
  const calls = [];
  const timers = [];
  const menu = menuModule.create(doc, Object.assign({
    layer: "B",
    onCopy: () => calls.push("copy"),
    onCancelCopy: () => calls.push("cancel"),
    onPaste: () => calls.push("paste"),
    onReset: () => calls.push("reset"),
    resinOnly: actions.resinOnlyTarget,
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; }
  }, options || {}));
  doc.body.appendChild(menu.element);
  const able = { copy: true, paste: true, reset: true };
  return { doc, menu, calls, timers, able, items: menu.items, button: menu.button };
}

function key(node, name) {
  const event = makeEvent("keydown", { bubbles: true, key: name });
  node.dispatchEvent(event);
  return event;
}

test("a three-dot button and a menu of three items, closed, inert and hidden from a reader until opened", () => {
  const { menu, button, items } = build();
  assert.equal(menu.element.getAttribute("data-role"), "layer-menu");
  assert.equal(menu.element.getAttribute("data-layer"), "B");
  assert.equal(button.getAttribute("aria-haspopup"), "menu");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(button.getAttribute("aria-label"), "Layer actions for Layer B");
  assert.equal(button.children.length, 3, "three dots, no text");
  assert.equal(button.textContent, "");
  assert.equal(menu.menu.getAttribute("role"), "menu");
  assert.equal(menu.menu.hasAttribute("inert"), true);
  assert.equal(menu.menu.getAttribute("aria-hidden"), "true");
  assert.deepEqual(menu.menu.children.map(node => [node.getAttribute("role"), node.getAttribute("data-action"), node.textContent]),
    [["menuitem", "copy-layer", "Copy layer"], ["menuitem", "paste-layer", "Paste layer"], ["menuitem", "reset-layer", "Reset layer"]]);
  // Told nothing yet: nothing is on offer.
  assert.equal(items.copy.disabled, true);
  assert.equal(items.paste.disabled, true);
  assert.equal(items.reset.disabled, true);
  assert.match(items.copy.getAttribute("title"), /no application is connected/);
});

test("the button opens and closes the menu; a press outside, Escape, or focus leaving closes it; Escape is spent", () => {
  const { doc, menu, button, items, able } = build();
  menu.update({ able });
  button.click();
  assert.equal(menu.isOpen(), true);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(menu.menu.hasAttribute("inert"), false);
  assert.equal(menu.element.getAttribute("data-open"), "true");
  assert.ok(focused === items.copy, "the first enabled item takes focus");
  button.click();
  assert.equal(menu.isOpen(), false);
  assert.ok(focused === button, "closing from the button returns focus to it");

  button.click();
  const outside = doc.body.appendChild(makeNode(doc, "div"));
  outside.dispatchEvent(makeEvent("pointerdown", { bubbles: true }));
  assert.equal(menu.isOpen(), false, "a press outside closes it");
  assert.equal(doc.listeners.pointerdown.length, 0, "and the click-away listener is taken down");

  button.click();
  const escape = key(items.paste, "Escape");
  assert.equal(menu.isOpen(), false);
  assert.equal(escape.stopped, true, "Escape is spent on the menu, not the stage");
  assert.equal(escape.defaultPrevented, true);

  button.click();
  menu.element.dispatchEvent(makeEvent("focusout", { relatedTarget: outside }));
  assert.equal(menu.isOpen(), false, "focus leaving closes it");
  button.click();
  menu.element.dispatchEvent(makeEvent("focusout", { relatedTarget: items.reset }));
  assert.equal(menu.isOpen(), true, "focus moving within it does not");
  // The arrows walk the enabled items and wrap (Paste is enabled once a
  // source is armed).
  menu.update({ source: "A" });
  key(items.copy, "ArrowDown");
  assert.ok(focused === items.paste);
  key(items.reset, "ArrowDown");
  assert.ok(focused === items.copy);
  key(items.copy, "ArrowUp");
  assert.ok(focused === items.reset);
});

test("Copy arms this layer and reads Cancel copy on the source's own card, which wears the source class; the same item then cancels", () => {
  const { menu, button, items, calls, able } = build();
  menu.update({ able, source: null, layerCount: 5 });
  button.click();
  items.copy.click();
  assert.deepEqual(calls, ["copy"]);
  assert.equal(menu.isOpen(), false, "a choice closes the menu");
  // The boot file tells every menu who the source is.
  menu.update({ source: "B" });
  assert.equal(items.copy.textContent, "Cancel copy");
  assert.equal(items.copy.disabled, false);
  assert.equal(menu.element.classList.contains("is-source"), true);
  assert.equal(items.paste.disabled, true, "the source cannot be pasted onto itself");
  assert.match(items.paste.getAttribute("title"), /this is the copied layer/);
  button.click();
  items.copy.click();
  assert.deepEqual(calls, ["copy", "cancel"]);
  menu.update({ source: null });
  assert.equal(items.copy.textContent, "Copy layer");
  assert.equal(menu.element.classList.contains("is-source"), false);
});

test("Paste is offered only while another layer is the source, names it, and says resin only on a 3-layer line's core", () => {
  const { menu, button, items, calls, able } = build();
  menu.update({ able, source: null, layerCount: 3 });
  assert.equal(items.paste.disabled, true);
  assert.match(items.paste.getAttribute("title"), /copy a layer first/);
  menu.update({ source: "A" });
  assert.equal(items.paste.disabled, false);
  assert.equal(items.paste.textContent, "Paste from Layer A");
  assert.match(items.paste.getAttribute("title"), /resins onto Layer B · the core layer keeps its own percentages/);
  menu.update({ layerCount: 5 });
  assert.match(items.paste.getAttribute("title"), /resins and blend onto Layer B/);
  button.click();
  items.paste.click();
  assert.deepEqual(calls, ["paste"]);
  assert.equal(menu.isOpen(), false);
  // Not on offer: disabled with the reason, whatever is armed.
  menu.update({ able: { copy: true, paste: false, reset: true }, reason: "the application does not offer pasting a layer from Station." });
  assert.equal(items.paste.disabled, true);
  assert.match(items.paste.getAttribute("title"), /does not offer pasting a layer/);
  button.click();
  items.paste.click();
  assert.deepEqual(calls, ["paste"], "a disabled item hands nothing back");
});

test("Reset arms on the first click and confirms on the second; a pause, closing the menu, or the offer withdrawn disarms it", () => {
  const { menu, button, items, calls, timers, able } = build();
  menu.update({ able });
  button.click();
  items.reset.click();
  assert.deepEqual(calls, []);
  assert.equal(menu.isArmed(), true);
  assert.equal(items.reset.textContent, "Confirm reset");
  assert.equal(items.reset.getAttribute("data-armed"), "true");
  assert.equal(items.reset.classList.contains("is-armed"), true);
  assert.match(items.reset.getAttribute("aria-label"), /Confirm: reset Layer B/);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, menuModule.ARM_DURATION);
  items.reset.click();
  assert.deepEqual(calls, ["reset"]);
  assert.equal(menu.isArmed(), false);
  assert.equal(menu.isOpen(), false);
  assert.equal(timers[0].cleared, true);
  assert.equal(items.reset.textContent, "Reset layer");

  // The pause.
  button.click();
  items.reset.click();
  timers[1].fn();
  assert.equal(menu.isArmed(), false);
  assert.equal(menu.isOpen(), true, "the menu stays; only the arming lapses");
  // Closing disarms.
  items.reset.click();
  assert.equal(menu.isArmed(), true);
  key(items.reset, "Escape");
  assert.equal(menu.isArmed(), false);
  assert.equal(menu.isOpen(), false);
  // Withdrawn while armed.
  button.click();
  items.reset.click();
  menu.update({ able: { copy: true, paste: true, reset: false } });
  assert.equal(menu.isArmed(), false);
  assert.equal(items.reset.disabled, true);
  assert.deepEqual(calls, ["reset"]);
});

test("the module is frozen and holds nothing between menus", () => {
  assert.ok(Object.isFrozen(menuModule));
  const a = build();
  const b = build({ layer: "C" });
  a.menu.update({ able: a.able, source: "A" });
  assert.equal(b.menu.getState().source, null);
  assert.equal(b.items.paste.disabled, true);
  assert.deepEqual(a.menu.getState().able, { copy: true, paste: true, reset: true });
});
