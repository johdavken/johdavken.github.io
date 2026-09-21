"use strict";

/* A small fake DOM for the Slate test suites.
 *
 * Implements exactly what Slate's modules touch - elements, attributes,
 * classes, text, a few event listeners, and a selector matcher wide
 * enough for the queries Slate makes inside its own container. Nothing
 * here is jsdom; if a module reaches for something else it fails loudly
 * in the test rather than quietly depending on a browser.
 *
 * Never assert.equal two nodes from this DOM: the cyclic parent links
 * make the diff explode. Compare attributes, text and identity (===).
 */

function makeClassList(node) {
  const set = new Set();
  return {
    add(...names) { for (const name of names) set.add(name); node._syncClass(); },
    remove(...names) { for (const name of names) set.delete(name); node._syncClass(); },
    toggle(name, force) {
      const on = force === undefined ? !set.has(name) : !!force;
      if (on) set.add(name); else set.delete(name);
      node._syncClass();
      return on;
    },
    contains: name => set.has(name),
    _set: set,
    _read(value) { set.clear(); for (const name of String(value || "").split(/\s+/).filter(Boolean)) set.add(name); }
  };
}

function parseCompound(text) {
  // tag? (.class | [attr] | [attr="v"] | [attr='v'] | :not(...) is ignored)*
  const out = { tag: null, classes: [], attrs: [] };
  let rest = text;
  const tag = /^[a-zA-Z][\w-]*/.exec(rest);
  if (tag) { out.tag = tag[0].toUpperCase(); rest = rest.slice(tag[0].length); }
  const part = /^(\.[\w-]+|\[[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\]]*))?\]|:[\w-]+(?:\([^)]*\))?)/;
  while (rest.length) {
    const m = part.exec(rest);
    if (!m) throw new Error(`fake-dom: unsupported selector part "${rest}"`);
    const token = m[0];
    if (token[0] === ".") out.classes.push(token.slice(1));
    else if (token[0] === "[") {
      const inner = token.slice(1, -1);
      const eq = inner.indexOf("=");
      if (eq === -1) out.attrs.push({ name: inner, value: null });
      else out.attrs.push({ name: inner.slice(0, eq), value: inner.slice(eq + 1).replace(/^["']|["']$/g, "") });
    }
    // pseudo-classes are ignored (matched as true)
    rest = rest.slice(token.length);
  }
  return out;
}

function matchesCompound(node, compound) {
  if (!node || node.nodeType !== 1) return false;
  if (compound.tag && node.tagName !== compound.tag) return false;
  for (const name of compound.classes) if (!node.classList.contains(name)) return false;
  for (const attr of compound.attrs) {
    if (!node.hasAttribute(attr.name)) return false;
    if (attr.value !== null && node.getAttribute(attr.name) !== attr.value) return false;
  }
  return true;
}

/* Split on whitespace and commas that sit outside [...] and (...). */
function splitSelector(selector, separator) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "[" || ch === "(") depth += 1;
    if (ch === "]" || ch === ")") depth -= 1;
    if (depth === 0 && (separator === "," ? ch === "," : /\s/.test(ch))) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function matchesSelector(node, selector) {
  return splitSelector(selector, ",").some(one => {
    const parts = splitSelector(one, " ").map(parseCompound);
    let current = node;
    let index = parts.length - 1;
    if (!matchesCompound(current, parts[index])) return false;
    index -= 1;
    current = current.parentNode;
    while (index >= 0) {
      while (current && !matchesCompound(current, parts[index])) current = current.parentNode;
      if (!current) return false;
      index -= 1;
      current = current.parentNode;
    }
    return true;
  });
}

function makeNode(tag, doc, namespace) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    localName: String(tag),
    namespaceURI: namespace || null,
    ownerDocument: doc,
    parentNode: null,
    childNodes: [],
    attributes: {},
    listeners: {},
    style: {
      _props: {},
      setProperty(name, value) { this._props[name] = String(value); },
      getPropertyValue(name) { return this._props[name] || ""; }
    },
    _text: "",
    _value: "",
    _innerHTML: "",
    offsetWidth: 0,
    focused: false,
    selected: false,
    disabled: false,
    get children() { return this.childNodes.filter(child => child.nodeType === 1); },
    get firstChild() { return this.childNodes[0] || null; },
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; },
    get firstElementChild() { return this.children[0] || null; },
    get className() { return this.attributes.class || ""; },
    set className(value) { this.setAttribute("class", value); },
    get id() { return this.attributes.id || ""; },
    get textContent() {
      if (this.childNodes.length === 0) return this._text;
      return this.childNodes.map(child => (child.nodeType === 3 ? child.data : child.textContent)).join("");
    },
    set textContent(value) {
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes = [];
      this._text = String(value == null ? "" : value);
    },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(value) {
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes = [];
      this._innerHTML = String(value);
    },
    get value() { return this._value; },
    set value(value) { this._value = String(value == null ? "" : value); },
    get hidden() { return this.hasAttribute("hidden"); },
    _syncClass() { this.attributes.class = [...this.classList._set].join(" "); },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "class") this.classList._read(value);
      if (name === "value") this._value = String(value);
      if (name === "disabled") this.disabled = true;
    },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); },
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === "class") this.classList._read("");
      if (name === "disabled") this.disabled = false;
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      this._text = "";
      if (child.tagName === "IFRAME" && typeof child._attach === "function") child._attach();
      return child;
    },
    insertBefore(child, before) {
      if (!before) return this.appendChild(child);
      if (child.parentNode) child.parentNode.removeChild(child);
      const index = this.childNodes.indexOf(before);
      child.parentNode = this;
      this.childNodes.splice(index === -1 ? this.childNodes.length : index, 0, child);
      this._text = "";
      return child;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    get nextSibling() {
      if (!this.parentNode) return null;
      const index = this.parentNode.childNodes.indexOf(this);
      return this.parentNode.childNodes[index + 1] || null;
    },
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index > -1) this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    contains(other) {
      let current = other;
      while (current) { if (current === this) return true; current = current.parentNode; }
      return false;
    },
    matches(selector) { return matchesSelector(this, selector); },
    closest(selector) {
      let current = this;
      while (current && current.nodeType === 1) { if (matchesSelector(current, selector)) return current; current = current.parentNode; }
      return null;
    },
    querySelectorAll(selector) {
      const out = [];
      (function walk(parent) {
        for (const child of parent.childNodes) {
          if (child.nodeType !== 1) continue;
          if (matchesSelector(child, selector)) out.push(child);
          walk(child);
        }
      })(this);
      return out;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
    removeEventListener(type, handler) {
      const list = this.listeners[type] || [];
      const index = list.indexOf(handler);
      if (index > -1) list.splice(index, 1);
    },
    /* Bubbles up the parents like the real thing; handlers may stop it. */
    dispatchEvent(event) {
      event.target = event.target || this;
      let current = this;
      while (current && !event._stopped) {
        for (const handler of (current.listeners[event.type] || []).slice()) handler.call(current, event);
        current = current.parentNode;
      }
      if (!event._stopped && this.ownerDocument && this.isConnected) {
        for (const handler of (this.ownerDocument.listeners[event.type] || []).slice()) handler.call(this.ownerDocument, event);
      }
      return !event._defaultPrevented;
    },
    focus() { this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; },
    blur() { this.focused = false; },
    select() { this.selected = true; },
    /* Pointer capture is recorded, never enforced: the tests drive the
     * pointer events by hand at whatever node they choose. */
    captured: null,
    setPointerCapture(id) { this.captured = id; },
    releasePointerCapture(id) { if (this.captured === id) this.captured = null; },
    hasPointerCapture(id) { return this.captured === id; },
    /* Geometry the tests set: node._rect = {left, top, width, height}. */
    _rect: null,
    getBoundingClientRect() {
      const rect = this._rect || { left: 0, top: 0, width: 0, height: 0 };
      return Object.assign({ right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top }, rect);
    },
    /* Attached to the document's tree, as the real property reads. */
    get isConnected() {
      let current = this;
      while (current) {
        if (current === (this.ownerDocument && this.ownerDocument.documentElement)) return true;
        current = current.parentNode;
      }
      return false;
    }
  };
  node.classList = makeClassList(node);
  /* An iframe gets a document of its own and a window that records print(). */
  if (node.tagName === "IFRAME") {
    node.contentDocument = null;
    node.contentWindow = null;
    node._attach = () => {
      if (node.contentDocument) return;
      const inner = makeDocument({ href: "about:blank" });
      node.contentDocument = inner;
      node.contentWindow = { document: inner, prints: 0, print() { this.prints += 1; }, focus() {} };
    };
  }
  return node;
}

function makeEvent(type, init) {
  const event = Object.assign({ type, _stopped: false, _defaultPrevented: false, target: null }, init || {});
  event.stopPropagation = function () { this._stopped = true; };
  event.preventDefault = function () { this._defaultPrevented = true; };
  return event;
}

function makeDocument(options) {
  const settings = options || {};
  const doc = {
    nodeType: 9,
    listeners: {},
    activeElement: null,
    readyState: "complete",
    location: { href: settings.href || "https://resin.tools/slate/slate.html" },
    createElement(tag) { return makeNode(tag, doc); },
    createElementNS(namespace, tag) { return makeNode(tag, doc, namespace); },
    createTextNode(data) { return { nodeType: 3, data: String(data), parentNode: null }; },
    addEventListener(type, handler) { (doc.listeners[type] = doc.listeners[type] || []).push(handler); },
    removeEventListener(type, handler) {
      const list = doc.listeners[type] || [];
      const index = list.indexOf(handler);
      if (index > -1) list.splice(index, 1);
    },
    querySelector(selector) { return doc.body.querySelector(selector); },
    querySelectorAll(selector) { return doc.body.querySelectorAll(selector); },
    /* What is under the pointer: the tests set doc._elementAt = (x, y) => node. */
    _elementAt: null,
    elementFromPoint(x, y) { return typeof doc._elementAt === "function" ? doc._elementAt(x, y) : null; }
  };
  doc.documentElement = makeNode("html", doc);
  doc.head = makeNode("head", doc);
  doc.body = makeNode("body", doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  return doc;
}

/* Fire a click on a node, bubbling. */
function click(node, init) {
  const event = makeEvent("click", init);
  node.dispatchEvent(event);
  return event;
}

/* Fire a pointer event on a node, bubbling. Defaults are a primary mouse
 * press at (0,0) with pointerId 1. */
function pointer(type, node, init) {
  const event = makeEvent(type, Object.assign({ pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 0, clientY: 0 }, init || {}));
  node.dispatchEvent(event);
  return event;
}

function key(node, keyName, init) {
  const event = makeEvent("keydown", Object.assign({ key: keyName }, init || {}));
  node.dispatchEvent(event);
  return event;
}

/* Deterministic timers. */
function makeTimers() {
  const queue = [];
  let id = 0;
  let clock = 0;
  return {
    setTimeout(fn, ms) { id += 1; queue.push({ id, at: clock + (Number(ms) || 0), fn }); return id; },
    clearTimeout(handle) { const index = queue.findIndex(entry => entry.id === handle); if (index > -1) queue.splice(index, 1); },
    advance(ms) {
      clock += ms;
      let fired = 0;
      let next;
      while ((next = queue.filter(entry => entry.at <= clock).sort((a, b) => a.at - b.at)[0])) {
        queue.splice(queue.indexOf(next), 1);
        next.fn();
        fired += 1;
      }
      return fired;
    },
    pending: () => queue.length,
    now: () => clock
  };
}

/* A fake command bridge: records dispatches, answers as told. */
function makeCommands(options) {
  const settings = options || {};
  const capabilities = settings.capabilities || [];
  const calls = [];
  let revision = 10;
  return {
    calls,
    isAvailable: () => settings.available !== false,
    capabilities: () => capabilities.slice(),
    dispatch(command, args) {
      calls.push({ command, args });
      if (typeof settings.answer === "function") {
        const answered = settings.answer(command, args);
        if (answered !== undefined) return answered;
      }
      revision += 1;
      return { ok: true, changed: true, revision, persisted: true, snapshot: null };
    }
  };
}

module.exports = { makeDocument, makeNode, makeEvent, click, key, pointer, makeTimers, makeCommands, matchesSelector };
