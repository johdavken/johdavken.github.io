"use strict";

/* The bulk field (station/station-bulk-field.js): where the resin Bulk
 * Edit writes is entered - one field the boot file hands the rail, which
 * stands it above its Blend row. Tested on its own: hidden until a
 * selection is on, what it says for a count, the draft told and taken,
 * Enter and Escape. Where it stands is the rail's and the booted suite's
 * (station-blend-actions-boot.test.js). The fake DOM is the machine rail
 * test's. */

const test = require("node:test");
const assert = require("node:assert/strict");

const fieldModule = require("./station/station-bulk-field.js");

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

function build(options) {
  focused = null;
  const doc = fakeDocument();
  const calls = [];
  const field = fieldModule.create(doc, Object.assign({
    onInput: value => calls.push(`input:${value}`),
    onConfirm: () => calls.push("confirm"),
    onCancel: () => calls.push("cancel"),
    activeElement: () => focused
  }, options || {}));
  doc.body.appendChild(field.element);
  return { doc, field, calls, input: field.input };
}

test("a labelled text field with a datalist, hidden, inert and out of the reader's tree until a selection is on", () => {
  const { field, input } = build();
  assert.equal(field.element.tagName, "LABEL");
  assert.equal(field.element.getAttribute("data-role"), "bulk-resin");
  assert.ok(field.element.hasAttribute("hidden") && field.element.hasAttribute("inert"));
  assert.equal(field.element.getAttribute("aria-hidden"), "true");
  assert.equal(input.getAttribute("data-action"), "bulk-resin");
  assert.equal(input.getAttribute("type"), "text");
  assert.equal(input.getAttribute("autocomplete"), "off");
  assert.equal(input.getAttribute("list"), field.element.querySelector("datalist").getAttribute("id"));
  assert.equal(input.getAttribute("aria-label"), "Resin for selected hoppers");
  assert.equal(field.focus(), false, "nothing to focus while hidden");
});

test("told the selection is on it shows, names the count, and offers the catalog's codes; told off it hides again", () => {
  const { field, input } = build();
  field.update({ shown: true, count: 0, resins: ["HX204", "LLDPE 1001", "", 7] });
  assert.equal(field.element.hasAttribute("hidden"), false);
  assert.equal(field.element.hasAttribute("inert"), false);
  assert.equal(field.element.querySelector(".station-bulk-field__label").textContent, "Resin name", "nothing selected yet: no count");
  assert.equal(input.getAttribute("aria-label"), "Resin for selected hoppers");
  field.update({ count: 1 });
  assert.equal(input.getAttribute("aria-label"), "Resin for 1 hopper");
  assert.equal(field.element.querySelector(".station-bulk-field__label").textContent, "Resin · 1 hopper");
  assert.deepEqual(field.element.querySelectorAll("option").map(o => o.getAttribute("value")), ["HX204", "LLDPE 1001"]);
  field.update({ count: 3 });
  assert.equal(input.getAttribute("aria-label"), "Resin for 3 hoppers");
  assert.match(input.getAttribute("title"), /Enter applies it, Escape cancels/);
  assert.equal(field.focus(), true);
  assert.ok(focused === input);
  assert.equal(field.isFocused(), true);
  field.update({ shown: false, count: 0 });
  assert.ok(field.element.hasAttribute("hidden"));
  assert.deepEqual(field.getState(), { shown: false, count: 0, draft: "", resins: ["HX204", "LLDPE 1001"] });
});

test("every keystroke is handed over; a draft told back is taken only when it differs; Enter confirms and Escape cancels, each spent on the field", () => {
  const { field, input, calls } = build();
  field.update({ shown: true, count: 2 });
  input.value = "LLD";
  input.dispatchEvent(makeEvent("input"));
  assert.deepEqual(calls, ["input:LLD"]);
  field.update({ draft: "LLDPE 1001" });
  assert.equal(input.value, "LLDPE 1001");
  assert.equal(field.getState().draft, "LLDPE 1001");
  const enter = makeEvent("keydown", { key: "Enter", bubbles: true });
  input.dispatchEvent(enter);
  assert.deepEqual(calls, ["input:LLD", "confirm"]);
  assert.equal(enter.defaultPrevented, true);
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  input.dispatchEvent(escape);
  assert.deepEqual(calls, ["input:LLD", "confirm", "cancel"]);
  assert.equal(escape.stopped, true, "spent on the field, not the stage");
  assert.equal(escape.defaultPrevented, true);
  const other = makeEvent("keydown", { key: "a", bubbles: true });
  input.dispatchEvent(other);
  assert.equal(other.stopped, false);
  assert.ok(Object.isFrozen(fieldModule));
});
