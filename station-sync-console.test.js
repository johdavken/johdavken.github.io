"use strict";

/* The line console (station/station-sync-console.js), driven against a
 * small fake DOM: the closed trigger's words, the panel's contents, and
 * the two requests it may make - each proven to reach the connection
 * bridge exactly once and to read nothing but the descriptor.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const consoleModule = require("./station/station-sync-console.js");
const bridgeModule = require("./station-connection-bridge.js");

/* ----------------------------------------------------------------------
 *   A fake DOM: attributes, classes, a few selectors, bubbling events
 * -------------------------------------------------------------------- */

function makeNode(name) {
  const node = {
    tagName: name.toUpperCase(),
    attributes: {},
    children: [],
    parent: null,
    listeners: {},
    textContent: "",
    innerHTML: "",
    disabled: false,
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
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
let focused = null;
function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
function matches(node, selector) {
  const attr = selector.match(/^\[([a-z-]+)='([^']+)'\]$/);
  if (attr) return node.getAttribute(attr[1]) === attr[2];
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
  return doc;
}
const click = node => node.dispatchEvent({ type: "click", bubbles: true });
const key = (node, k) => node.dispatchEvent({ type: "keydown", key: k, bubbles: true, stopPropagation() { this.stopped = true; }, preventDefault() {} });
const hidden = node => node.hasAttribute("hidden");
const byClass = (root, name) => root.querySelector(`.${name}`);
const byAction = (root, name) => root.querySelector(`[data-action='${name}']`);
const tick = () => new Promise(resolve => setImmediate(resolve));

/* ----------------------------------------------------------------------
 *   A producer: a synced Line 9 with three devices, and recorded actions
 * -------------------------------------------------------------------- */

function line9State(overrides) {
  return Object.assign({
    enabled: true, available: true, status: "Synced", message: "RT Sync is up to date.", connected: true,
    selectedWorkspaceId: "ws-9", selectedWorkspace: { id: "ws-9", name: "Line 9" },
    members: [
      { device_id: "dev-desktop", device_label: "Line 9 Desktop", role: "owner", joined_at: "2026-09-01T08:00:00Z" },
      { device_id: "dev-phone", device_label: "Operator Phone", role: "member", joined_at: "2026-09-02T09:30:00Z" },
      { device_id: "dev-tablet", device_label: "Floor Tablet", role: "member", joined_at: "2026-09-03T10:00:00Z" }
    ],
    lastSyncAt: "2026-09-11T14:02:00Z", pendingCount: 0, generatedCode: "", generatedCodeExpiresAt: "", deviceId: "dev-desktop"
  }, overrides || {});
}

function producer(initial, actionOverrides) {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const env = { state: initial || line9State(), busy: false, calls: [] };
  const actions = Object.assign({
    refresh: async () => { env.calls.push("refresh"); return { ok: true }; },
    reconnect: async () => { env.calls.push("reconnect"); return { ok: true }; },
    generateJoinCode: async () => {
      env.calls.push("generateJoinCode");
      env.state = Object.assign({}, env.state, { generatedCode: "AB12", generatedCodeExpiresAt: "2026-09-11T14:32:00Z" });
      env.handle.publish();
      return { ok: true };
    },
    renderJoinQr: async () => { env.calls.push("renderJoinQr"); return { ok: true, code: env.state.generatedCode, svg: "<svg data-code='AB12'></svg>" }; }
  }, actionOverrides || {});
  env.handle = bridge.connect({
    read: () => bridgeModule.project(env.state, { lineNumber: 9, busy: env.busy, joinUrl: env.state.generatedCode ? `https://resin.tools/?rtSyncCode=${env.state.generatedCode}` : "" }),
    actions
  });
  env.bridge = bridge;
  env.set = changes => { env.state = Object.assign({}, env.state, changes); env.handle.publish(); };
  return env;
}

function mount(env, options) {
  const doc = fakeDocument();
  const built = consoleModule.create(doc, Object.assign({ connection: env ? env.bridge : null }, options || {}));
  return { doc, built, root: built.element };
}

/* ----------------------------------------------------------------------
 *   The closed state
 * -------------------------------------------------------------------- */

test("the trigger reads LINE 9 · SYNCED · 3 DEVICES from the descriptor, and the summary is testable as text", () => {
  const env = producer();
  const { root } = mount(env);
  assert.equal(hidden(root), false);
  assert.equal(root.getAttribute("data-state"), "synced");
  assert.equal(byClass(root, "station-sync__line").textContent, "Line 9");
  assert.equal(byClass(root, "station-sync__state").textContent, "Synced");
  assert.equal(byClass(root, "station-sync__devices").textContent, "3 devices");
  assert.equal(consoleModule.summarize(env.bridge.getStatus()).text, "Line 9 · Synced · 3 devices");
  // Rendered in small caps by the stylesheet, not by shouting in the DOM.
  assert.doesNotMatch(byClass(root, "station-sync__line").textContent, /LINE/);
});

test("with no producer the console is hidden, not shown as disconnected - this page has no line", () => {
  const { root, built } = mount(null);
  assert.equal(hidden(root), true);
  assert.equal(root.getAttribute("data-state"), "none");
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const unconnected = mount({ bridge });
  assert.equal(hidden(unconnected.root), true);
  built.destroy();
});

test("each connection state colours its own dot and reads its own word; offline and error are never dressed as synced", () => {
  const env = producer();
  const { root } = mount(env);
  for (const [word, key] of [["Offline", "offline"], ["Pending", "pending"], ["Conflict", "conflict"], ["Error", "error"], ["Syncing", "syncing"], ["Local only", "local-only"], ["Synced", "synced"]]) {
    env.set({ status: word });
    assert.equal(root.getAttribute("data-state"), key, word);
    assert.equal(byClass(root, "station-sync__state").textContent, word);
  }
  env.set({ status: "Pending", pendingCount: 2 });
  assert.equal(byClass(root, "station-sync__state").textContent, "Pending (2)");
});

test("a remembered but disconnected line still reads LINE 9, in local-only, with Reconnect on offer and Refresh withdrawn", () => {
  const env = producer(line9State({ connected: false, status: "Local only", message: "Disconnected on this device. Server membership is preserved." }));
  const { root, built } = mount(env);
  assert.equal(byClass(root, "station-sync__line").textContent, "Line 9");
  assert.equal(root.getAttribute("data-state"), "local-only");
  assert.equal(root.getAttribute("data-linked"), "false");
  built.open();
  assert.equal(hidden(byAction(root, "reconnect")), false);
  assert.equal(byAction(root, "reconnect").disabled, false);
  assert.equal(hidden(byAction(root, "refresh")), true);
  assert.equal(hidden(byAction(root, "add-device")), true);
  assert.match(byClass(root, "station-sync__note").textContent, /disconnected from the line on this device/);
});

test("an unassigned desktop says so and offers no way to pick a line", () => {
  const env = producer(line9State({ selectedWorkspaceId: "", selectedWorkspace: null, members: [], status: "Local only", message: "Create or join a line when ready." }));
  const { root, built } = mount(env);
  assert.equal(byClass(root, "station-sync__line").textContent, "No line");
  assert.equal(byClass(root, "station-sync__devices").textContent, "");
  built.open();
  assert.equal(byClass(root, "station-sync__title").textContent, "No line assigned");
  assert.equal(hidden(byClass(root, "station-sync__actions")), true, "no actions: nothing to refresh, nothing to join to");
  assert.match(byClass(root, "station-sync__note").textContent, /not assigned to a production line/);
  assert.equal(root.querySelectorAll(".station-sync__device").length, 0);
  assert.equal(root.querySelector("[data-action='select-line']"), null);
});

/* ----------------------------------------------------------------------
 *   The panel
 * -------------------------------------------------------------------- */

test("the panel names the line, states the status and message, and lists joined devices with this desktop marked", () => {
  const env = producer();
  const { root, built } = mount(env);
  assert.equal(hidden(byClass(root, "station-sync__panel")), true);
  click(byClass(root, "station-sync__trigger"));
  assert.equal(built.isOpen(), true);
  assert.equal(hidden(byClass(root, "station-sync__panel")), false);
  assert.equal(byClass(root, "station-sync__trigger").getAttribute("aria-expanded"), "true");
  assert.equal(byClass(root, "station-sync__title").textContent, "Line 9");
  assert.equal(byClass(root, "station-sync__status-label").textContent, "Synced");
  assert.equal(byClass(root, "station-sync__message").textContent, "RT Sync is up to date.");
  assert.match(byClass(root, "station-sync__meta").textContent, /^Last sync /);
  const devices = root.querySelectorAll(".station-sync__device");
  assert.equal(devices.length, 3);
  assert.equal(byClass(root, "station-sync__heading").textContent === "Add a device" ? root.querySelectorAll(".station-sync__heading")[1].textContent : byClass(root, "station-sync__heading").textContent, "Joined devices (3)");
  assert.equal(devices[0].querySelector(".station-sync__device-name").textContent, "Line 9 Desktop");
  assert.match(devices[0].querySelector(".station-sync__device-detail").textContent, /^This desktop · Owner · Joined /);
  assert.ok(devices[0].classList.contains("is-this-device"));
  assert.ok(!devices[1].classList.contains("is-this-device"));
  assert.match(devices[1].querySelector(".station-sync__device-detail").textContent, /^Joined /);
  // Never "online": the application knows joined devices, not present ones.
  const flat = JSON.stringify(root, (k, v) => (k === "parent" || k === "listeners" ? undefined : v));
  assert.doesNotMatch(flat, /online|last seen/i);
  click(byClass(root, "station-sync__close"));
  assert.equal(built.isOpen(), false);
  assert.equal(hidden(byClass(root, "station-sync__panel")), true);
});

test("a joined-device update on the descriptor refreshes the count and the list, open or closed", () => {
  const env = producer();
  const { root, built } = mount(env);
  built.open();
  env.set({ members: env.state.members.concat([{ device_id: "dev-new", device_label: "Second Phone", role: "member", joined_at: "2026-09-11T14:10:00Z" }]) });
  assert.equal(byClass(root, "station-sync__devices").textContent, "4 devices");
  assert.equal(root.querySelectorAll(".station-sync__device").length, 4);
  assert.equal(built.isOpen(), true, "a publish never closes the panel");
  built.close();
  env.set({ members: env.state.members.slice(0, 2) });
  assert.equal(byClass(root, "station-sync__devices").textContent, "2 devices");
});

test("Escape and an outside pointer press close the panel; a press inside does not", () => {
  const env = producer();
  const { root, built, doc } = mount(env);
  built.open();
  const outside = doc.createElement("div");
  (doc.captureListeners.pointerdown || []).forEach(fn => fn({ target: byClass(root, "station-sync__title") }));
  assert.equal(built.isOpen(), true);
  (doc.captureListeners.pointerdown || []).forEach(fn => fn({ target: outside }));
  assert.equal(built.isOpen(), false);
  assert.deepEqual(doc.captureListeners.pointerdown || [], [], "the outside-press listener lives only while the panel is open");
  built.open();
  const event = { type: "keydown", key: "Escape", bubbles: true, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} };
  byClass(root, "station-sync__panel").dispatchEvent(event);
  assert.equal(built.isOpen(), false);
  assert.equal(event.stopped, true, "Escape is spent on the panel, not passed on to close the open layer");
  assert.equal(focused, byClass(root, "station-sync__trigger"), "focus returns to the trigger");
});

/* ----------------------------------------------------------------------
 *   Refresh
 * -------------------------------------------------------------------- */

test("Refresh asks the bridge for the application's refresh exactly once, holds its controls meanwhile, and shows a failure's message", async () => {
  let release;
  const env = producer(undefined, { refresh: () => { env.calls.push("refresh"); return new Promise(resolve => { release = resolve; }); } });
  const { root, built } = mount(env);
  built.open();
  click(byAction(root, "refresh"));
  await tick();
  assert.deepEqual(env.calls, ["refresh"]);
  assert.equal(byAction(root, "refresh").disabled, true);
  assert.equal(byAction(root, "add-device").disabled, true);
  assert.equal(byAction(root, "refresh").textContent, "Refreshing…");
  click(byAction(root, "refresh"));
  await tick();
  assert.deepEqual(env.calls, ["refresh"], "a second press while one is in flight asks nothing");
  release({ ok: false, code: "failed", message: "The shared line changed on another device." });
  await tick(); await tick();
  assert.equal(byAction(root, "refresh").disabled, false);
  assert.equal(byAction(root, "refresh").textContent, "Refresh");
  assert.equal(byClass(root, "station-sync__note").textContent, "The shared line changed on another device.");
  assert.equal(byClass(root, "station-sync__note").getAttribute("data-kind"), "error");
});

test("Reconnect asks for the application's reconnect, and the descriptor's busy flag holds every control regardless of who started the action", async () => {
  const env = producer(line9State({ connected: false, status: "Local only" }));
  const { root, built } = mount(env);
  built.open();
  click(byAction(root, "reconnect"));
  await tick(); await tick();
  assert.deepEqual(env.calls, ["reconnect"]);
  // The application marks itself busy (the floor UI's own in-flight flag)
  // - Station reads that from the descriptor, it does not guess.
  env.busy = true; env.set({ connected: true, status: "Syncing" });
  assert.equal(byAction(root, "refresh").disabled, true);
  assert.equal(byAction(root, "add-device").disabled, true);
  env.busy = false; env.set({ status: "Synced" });
  assert.equal(byAction(root, "refresh").disabled, false);
  assert.equal(byAction(root, "add-device").disabled, false);
  assert.equal(hidden(byAction(root, "reconnect")), true);
});

/* ----------------------------------------------------------------------
 *   Add device / QR
 * -------------------------------------------------------------------- */

test("the QR appears only when asked for: Add device mints a code through the bridge, then draws it, once each", async () => {
  const env = producer();
  const { root, built } = mount(env);
  built.open();
  assert.equal(hidden(byClass(root, "station-sync__qr")), true);
  assert.equal(byClass(root, "station-sync__qr-image").innerHTML, "");
  click(byAction(root, "add-device"));
  await tick(); await tick(); await tick();
  assert.deepEqual(env.calls, ["generateJoinCode", "renderJoinQr"]);
  assert.equal(built.showingQr(), true);
  assert.equal(hidden(byClass(root, "station-sync__qr")), false);
  assert.equal(byClass(root, "station-sync__qr-image").innerHTML, "<svg data-code='AB12'></svg>");
  assert.equal(byClass(root, "station-sync__code").textContent, "AB12");
  assert.match(byClass(root, "station-sync__hint").textContent, /One-time use; expires at /);
  // The code shown is the application's; nothing here made one up.
  assert.equal(env.bridge.getStatus().joinCode.code, "AB12");
});

test("Done, Escape and closing the panel each clear the QR view; a newer code on the descriptor retires a stale one", async () => {
  const env = producer();
  const { root, built } = mount(env);
  const show = async () => { click(byAction(root, "add-device")); await tick(); await tick(); await tick(); assert.equal(built.showingQr(), true); };
  built.open();
  await show();
  click(byAction(root, "qr-done"));
  assert.equal(built.showingQr(), false);
  assert.equal(byClass(root, "station-sync__qr-image").innerHTML, "");
  assert.equal(built.isOpen(), true, "Done leaves the panel open");
  await show();
  key(byClass(root, "station-sync__panel"), "Escape");
  assert.equal(built.showingQr(), false);
  assert.equal(built.isOpen(), true, "the first Escape closes only the QR view");
  await show();
  built.close();
  assert.equal(built.showingQr(), false);
  built.open();
  assert.equal(hidden(byClass(root, "station-sync__qr")), true, "reopening never shows a code that was not just asked for");
  await show();
  env.set({ generatedCode: "ZZ99" });
  assert.equal(built.showingQr(), false, "a code minted elsewhere retires the one on screen");
  await show();
  env.set({ connected: false, status: "Local only" });
  assert.equal(built.showingQr(), false, "no join code is shown for a line that is not linked");
});

test("a failed mint or a failed drawing shows the application's message and no QR", async () => {
  const env = producer(undefined, { generateJoinCode: async () => { env.calls.push("generateJoinCode"); return { ok: false, code: "failed", message: "RT Sync did not return a link code." }; } });
  const { root, built } = mount(env);
  built.open();
  click(byAction(root, "add-device"));
  await tick(); await tick(); await tick();
  assert.deepEqual(env.calls, ["generateJoinCode"], "no drawing is asked for without a code");
  assert.equal(built.showingQr(), false);
  assert.equal(byClass(root, "station-sync__note").textContent, "RT Sync did not return a link code.");
  const env2 = producer(undefined, { renderJoinQr: async () => { env2.calls.push("renderJoinQr"); return { ok: false, code: "failed", message: "The QR code could not be drawn." }; } });
  const second = mount(env2);
  second.built.open();
  click(byAction(second.root, "add-device"));
  await tick(); await tick(); await tick();
  assert.deepEqual(env2.calls, ["generateJoinCode", "renderJoinQr"]);
  assert.equal(second.built.showingQr(), false);
  assert.equal(byClass(second.root, "station-sync__note").textContent, "The QR code could not be drawn.");
});

test("controls the descriptor says are not available are disabled rather than dead: unavailable client, disabled sync, admin-required", () => {
  const noClient = producer(line9State({ available: false }));
  const a = mount(noClient); a.built.open();
  assert.equal(byAction(a.root, "add-device").disabled, true);
  assert.equal(byAction(a.root, "refresh").disabled, false);
  const disabled = producer(line9State({ enabled: false, available: false, status: "Local only", message: "RT Sync is unavailable; local mode is active." }));
  const b = mount(disabled); b.built.open();
  assert.equal(hidden(byClass(b.root, "station-sync__actions")), true);
  assert.match(byClass(b.root, "station-sync__note").textContent, /not available on this build/);
  const revoked = producer(line9State({ connected: false, status: "Error", message: "This device no longer has access to this line." }));
  const c = mount(revoked); c.built.open();
  assert.equal(hidden(byAction(c.root, "reconnect")), true, "no reconnect where only an administrator can help");
  assert.match(byClass(c.root, "station-sync__note").textContent, /Ask an administrator/);
  assert.equal(c.root.getAttribute("data-state"), "error");
});

test("the console never touches the bridge but through subscribe, getStatus and request, and unsubscribes on destroy", () => {
  const used = new Set();
  const inner = producer();
  const spy = new Proxy(inner.bridge, { get(target, prop) { used.add(String(prop)); return target[prop]; } });
  const doc = fakeDocument();
  const built = consoleModule.create(doc, { connection: spy });
  built.open(); built.close();
  built.destroy();
  assert.deepEqual([...used].sort(), ["getStatus", "subscribe"]);
  inner.set({ status: "Offline" });
  assert.equal(built.element.getAttribute("data-state"), "synced", "after destroy nothing is redrawn");
});
