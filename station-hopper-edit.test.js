"use strict";

/* The bulk field (station/station-hopper-edit.js): where the resin Bulk
 * Edit writes is entered - one field the boot file hands the rail, which
 * stands it above its Blend row. Tested on its own: hidden until a
 * selection is on, what it says for a count, the draft told and taken,
 * Enter and Escape. Where it stands is the rail's and the booted suite's
 * (station-blend-actions-boot.test.js). The fake DOM is the machine rail
 * test's. */

const test = require("node:test");
const assert = require("node:assert/strict");

const editModule = require("./station/station-hopper-edit.js");

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
  const editor = editModule.create(doc, Object.assign({
    onInput: drafts => calls.push(`input:${drafts.resin}|${drafts.pct}`),
    onApply: () => calls.push("apply"),
    onCancel: () => calls.push("cancel"),
    activeElement: () => focused
  }, options || {}));
  doc.body.appendChild(editor.element);
  return { doc, editor, calls, resin: editor.resinInput, pct: editor.pctInput, apply: editor.applyButton, cancel: editor.cancelButton };
}

function type(input, value) {
  input.value = value;
  input.dispatchEvent(makeEvent("input", { bubbles: true }));
}

/* ----------------------------------------------------------------------
 *   Tests
 * -------------------------------------------------------------------- */

test("a form of the count, two labelled fields with No change as their empty meaning, Apply and Cancel - hidden, inert and out of the reader's tree until a hopper is selected; nothing dispatched", () => {
  const { editor, resin, pct, apply, cancel } = build();
  const root = editor.element;
  assert.equal(root.nodeName, "form");
  assert.equal(root.getAttribute("data-role"), "hopper-edit");
  assert.equal(root.getAttribute("role"), "group");
  assert.equal(root.getAttribute("aria-label"), "Selected hoppers");
  assert.ok(root.hasAttribute("hidden") && root.hasAttribute("inert") && root.getAttribute("aria-hidden") === "true");
  assert.deepEqual(root.children.map(n => n.getAttribute("data-role") || n.getAttribute("class") || n.nodeName), [
    "hopper-edit-count", "station-hopper-edit__field station-hopper-edit__field--resin", "station-hopper-edit__field station-hopper-edit__field--pct",
    "station-hopper-edit__action is-primary", "station-hopper-edit__action"
  ]);
  assert.equal(resin.getAttribute("data-action"), "edit-resin");
  assert.equal(resin.getAttribute("type"), "text");
  assert.equal(resin.getAttribute("placeholder"), "No change");
  assert.equal(resin.getAttribute("autocomplete"), "off");
  assert.ok(resin.getAttribute("list"), "the resin field takes the catalog's list");
  assert.equal(root.querySelector("datalist").getAttribute("id"), resin.getAttribute("list"));
  assert.equal(pct.getAttribute("data-action"), "edit-pct");
  assert.equal(pct.getAttribute("type"), "text", "a text field, not a spinner");
  assert.equal(pct.getAttribute("inputmode"), "decimal");
  assert.equal(pct.getAttribute("placeholder"), "No change");
  assert.equal(root.querySelectorAll("label")[0].children[0].textContent, "Resin");
  assert.equal(root.querySelectorAll("label")[1].children[0].textContent, "%");
  assert.equal(apply.getAttribute("data-action"), "edit-apply");
  assert.equal(apply.getAttribute("type"), "button", "Apply is a plain button: the form never submits");
  assert.equal(apply.textContent, "Apply");
  assert.equal(apply.disabled, true);
  assert.equal(apply.getAttribute("title"), "Apply · select a hopper on a card first");
  assert.equal(cancel.getAttribute("data-action"), "edit-cancel");
  assert.equal(cancel.getAttribute("type"), "button");
  assert.equal(cancel.textContent, "Cancel");
  assert.match(cancel.getAttribute("title"), /clears the selection; nothing is written/);
  assert.deepEqual(editor.getState(), { shown: false, count: 0, recipe: "current", resins: [], resin: "", pct: "" });
  assert.deepEqual(editModule.LABEL, { resin: "Resin", pct: "%", apply: "Apply", cancel: "Cancel", noChange: "No change" });
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "station", "station-hopper-edit.js"), "utf8");
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), /dispatch|PolynStationCommand|PolynStationStateBridge|localStorage|sessionStorage/);
});

test("told a selection it shows, names the count and the recipe, offers the catalog's codes, and takes the drafts it is told; told none it hides again with its drafts kept for the boot file to clear", () => {
  const { editor, resin, pct } = build();
  const root = editor.element;
  editor.update({ shown: true, count: 1, recipe: "current", resins: ["HX 9", "LLDPE 1001", "", 4] });
  assert.ok(!root.hasAttribute("hidden") && !root.hasAttribute("inert") && !root.hasAttribute("aria-hidden"));
  assert.equal(root.querySelector("[data-role='hopper-edit-count']").textContent, "1 hopper");
  assert.equal(root.getAttribute("data-recipe"), "current");
  assert.deepEqual(root.querySelectorAll("option").map(o => o.getAttribute("value")), ["HX 9", "LLDPE 1001"]);
  assert.match(resin.getAttribute("title"), /^Resin for 1 hopper · empty leaves each hopper's resin as it is/);
  assert.match(pct.getAttribute("title"), /^Blend percentage for 1 hopper · empty leaves each hopper's blend as it is/);
  editor.update({ count: 3, recipe: "next" });
  assert.equal(root.querySelector("[data-role='hopper-edit-count']").textContent, "3 hoppers · plan");
  assert.match(root.querySelector("[data-role='hopper-edit-count']").getAttribute("title"), /on the plan's cards/);
  assert.equal(root.getAttribute("data-recipe"), "next");
  editor.update({ resin: "EVA", pct: "12" });
  assert.equal(resin.value, "EVA");
  assert.equal(pct.value, "12");
  assert.deepEqual(editor.getState(), { shown: true, count: 3, recipe: "next", resins: ["HX 9", "LLDPE 1001"], resin: "EVA", pct: "12" });
  editor.update({ recipe: "plan", count: -1 });
  assert.equal(root.getAttribute("data-recipe"), "next", "an unknown recipe or count is ignored");
  editor.update({ shown: false, count: 0 });
  assert.ok(root.hasAttribute("hidden") && root.hasAttribute("inert"));
  assert.equal(root.querySelector("[data-role='hopper-edit-count']").textContent, "");
  assert.equal(resin.value, "EVA", "the drafts are the boot file's to clear");
  editor.update({ resin: "", pct: "" });
  assert.equal(resin.value, "");
  assert.equal(pct.value, "");
});

test("Apply is held until a hopper is selected and something is entered, and says what it would do: a resin, a percentage, both; a percentage that is not one holds it with the reason", () => {
  const { editor, resin, pct, apply, calls } = build();
  editor.update({ shown: true, count: 2 });
  assert.equal(apply.disabled, true);
  assert.equal(apply.getAttribute("title"), "Apply · enter a resin, a percentage, or both; an empty field is no change");
  type(resin, "  EVA 340 ");
  assert.equal(apply.disabled, false);
  assert.equal(apply.hasAttribute("disabled"), false);
  assert.equal(apply.getAttribute("title"), "Apply resin EVA 340 to 2 hoppers");
  assert.deepEqual(calls, ["input:  EVA 340 |"], "every keystroke is handed over, both drafts, untrimmed");
  type(pct, "12.5");
  assert.equal(apply.getAttribute("title"), "Apply resin EVA 340 and 12.5% to 2 hoppers");
  type(resin, "");
  assert.equal(apply.getAttribute("title"), "Apply 12.5% to 2 hoppers");
  type(pct, "abc");
  assert.equal(apply.disabled, true);
  assert.equal(apply.getAttribute("title"), "Apply · The percentage must be a number.");
  type(pct, "101");
  assert.equal(apply.getAttribute("title"), "Apply · The percentage must be between 0 and 100.");
  type(pct, "0");
  assert.equal(apply.disabled, false);
  assert.equal(apply.getAttribute("title"), "Apply 0% to 2 hoppers");
  editor.update({ recipe: "next" });
  assert.equal(apply.getAttribute("title"), "Apply 0% to 2 hoppers in the plan");
  editor.update({ count: 0 });
  assert.equal(apply.disabled, true);
  assert.equal(apply.getAttribute("title"), "Apply · select a hopper on a card first");
});

test("Apply's click and Enter in either field apply - only while Apply is offered; Cancel's click and Escape in either field cancel, Escape spent on the field; focus goes to the resin field, and only while shown", () => {
  const { editor, resin, pct, apply, cancel, calls, doc } = build();
  assert.equal(editor.focus(), false, "hidden: nothing to focus");
  editor.update({ shown: true, count: 1 });
  assert.equal(editor.focus(), true);
  assert.ok(focused === resin, "the resin field took the focus");
  assert.equal(editor.isFocused(), true);
  pct.focus();
  assert.equal(editor.isFocused(), true, "either field counts");
  apply.click();
  assert.deepEqual(calls, [], "held: a click applies nothing");
  resin.dispatchEvent(makeEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(calls, [], "held: Enter applies nothing");
  type(resin, "HX");
  apply.click();
  const enterOnResin = makeEvent("keydown", { key: "Enter", bubbles: true });
  resin.dispatchEvent(enterOnResin);
  assert.equal(enterOnResin.defaultPrevented, true, "Enter never submits the form");
  const enterOnPct = makeEvent("keydown", { key: "Enter", bubbles: true });
  pct.dispatchEvent(enterOnPct);
  assert.deepEqual(calls.filter(c => c === "apply"), ["apply", "apply", "apply"]);
  cancel.click();
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  resin.dispatchEvent(escape);
  assert.equal(escape.stopped, true, "spent on the field: the stage's own Escape does not run");
  assert.equal(escape.defaultPrevented, true);
  pct.dispatchEvent(makeEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(calls.filter(c => c === "cancel"), ["cancel", "cancel", "cancel"]);
  const other = makeEvent("keydown", { key: "a", bubbles: true });
  resin.dispatchEvent(other);
  assert.equal(other.stopped, false, "other keys pass");
  const submit = makeEvent("submit", { bubbles: true });
  editor.element.dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  assert.equal(calls.filter(c => c === "apply").length, 3, "a submit applies nothing of its own");
});

test("the two readers: empty is no change; a percentage takes a trailing %, a comma, and refuses anything else or outside 0..100; a resin is trimmed", () => {
  assert.deepEqual(editModule.readPct(""), { ok: true, pct: null });
  assert.deepEqual(editModule.readPct("  "), { ok: true, pct: null });
  assert.deepEqual(editModule.readPct(null), { ok: true, pct: null });
  assert.deepEqual(editModule.readPct("12.5"), { ok: true, pct: 12.5 });
  assert.deepEqual(editModule.readPct(" 40% "), { ok: true, pct: 40 });
  assert.deepEqual(editModule.readPct("1,5"), { ok: true, pct: 15 });
  assert.deepEqual(editModule.readPct("0"), { ok: true, pct: 0 });
  assert.deepEqual(editModule.readPct("100"), { ok: true, pct: 100 });
  assert.equal(editModule.readPct("abc").ok, false);
  assert.match(editModule.readPct("abc").message, /must be a number/);
  assert.equal(editModule.readPct("-1").ok, false);
  assert.equal(editModule.readPct("100.1").ok, false);
  assert.match(editModule.readPct("101").message, /between 0 and 100/);
  assert.deepEqual(editModule.readResin(""), { ok: true, resin: null });
  assert.deepEqual(editModule.readResin("   "), { ok: true, resin: null });
  assert.deepEqual(editModule.readResin(" HX  9 "), { ok: true, resin: "HX  9" });
  assert.deepEqual(editModule.readResin(undefined), { ok: true, resin: null });
});

test("the stylesheet: every colour a token, the slot's own sheet in both hosts, no placement, and the form's controls scoped under the root's button reset", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = file => fs.readFileSync(path.join(__dirname, file), "utf8");
  const css = read("station/styles/components/hopper-edit.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|!important/i);
  assert.doesNotMatch(css, /position: (absolute|fixed)|\n\s*(left|top|transform):/, "the sheet places the form");
  assert.match(css, /\.station-root \.station-hopper-edit__action \{/);
  assert.match(css, /\.station-root \.station-hopper-edit__action\.is-primary \{[^}]*background: var\(--station-accent\);/);
  assert.match(css, /\.station-root \.station-hopper-edit__action:disabled \{/);
  assert.match(css, /\.station-root \.station-hopper-edit\[hidden\] \{\s*display: none;\s*\}/);
  assert.match(css, /\.station-hopper-edit__input::placeholder \{/, "No change is faded, as a placeholder");
  assert.match(read("station/styles/shell.css"), /\.station-header__edit \{[^}]*flex: 0 1 auto;/);
  // The header may break its row for the editor, and its first line keeps the track: the job slot holds the height.
  assert.match(read("station/styles/shell.css"), /\.station-header \{[^}]*flex-wrap: wrap;[^}]*align-content: flex-start;/);
  assert.match(read("station/styles/shell.css"), /\.station-header__job \{[^}]*min-height: var\(--station-header-height\);/);
  assert.match(read("station/styles/shell.css"), /\.station-header__connection \{[^}]*flex: 1 0 auto;/, "the console never yields width: the editor wraps instead");
  assert.match(read("station/station.html"), /<link rel="stylesheet" href="styles\/components\/hopper-edit\.css\?v=[^"]+">/);
  assert.match(read("station/station.html"), /<script src="station-hopper-edit\.js\?v=[^"]+" defer><\/script>/);
  assert.ok(read("station-host.js").includes('"station/styles/components/hopper-edit.css"'));
  assert.ok(read("station-host.js").includes('"station/station-hopper-edit.js"'));
  assert.doesNotMatch(read("station-host.js") + read("station/station.html"), /bulk-field/);
  for (const theme of require("./station-theme.js").THEME_IDS) {
    const sheet = read(`station/styles/themes/${theme}.css`);
    for (const token of ["--station-surface-editable:", "--station-editable:", "--station-accent-hover:", "--station-text-on-accent:", "--station-text-disabled:", "--station-border:"]) {
      assert.ok(sheet.includes(token), `${theme} lacks ${token}`);
    }
  }
});
