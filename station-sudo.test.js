"use strict";

/* Sudo (station/station-sudo.js) and its Workspace Management tool
 * (station/station-sudo-workspaces.js), driven against a small fake DOM
 * and a real admin bridge with a recording producer behind it. What is
 * pinned: the page is a sign-in until the window says an administrator
 * is in, and a sign-in is one request carrying the fields; the list is
 * the bridge's answer and is read only for a page on screen; choosing a
 * workspace reads its devices and changes nothing; every change is asked
 * first, in place, with the floor UI's words, and is one request; the
 * common actions follow the device's readiness and membership; a lost
 * session returns the page to the sign-in with nothing of the old list
 * kept; and maintenance stays folded.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const sudoModule = require("./station/station-sudo.js");
const workspacesModule = require("./station/station-sudo-workspaces.js");
const bridgeModule = require("./station-admin-bridge.js");

/* ----------------------------------------------------------------------
 *   A fake DOM
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
    value: "",
    disabled: false,
    get firstChild() { return this.children[0] || null; },
    get parentNode() { return this.parent; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
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
    select() {},
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
  return doc;
}
const click = node => node.dispatchEvent({ type: "click", bubbles: true });
const submit = node => node.dispatchEvent({ type: "submit", bubbles: false, preventDefault() {} });
const hidden = node => node.hasAttribute("hidden");
const byAction = (root, name) => root.querySelector(`[data-action='${name}']`);
const rows = root => root.querySelectorAll(".station-sudo-ws__row");
const deviceRows = root => root.querySelectorAll(".station-sudo-ws__device-row");
const noteOf = root => root.querySelector(".station-sudo-ws__note");
const gateNoteOf = root => root.querySelector(".station-sudo__note");
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

/* ----------------------------------------------------------------------
 *   A producer: three lines, their devices, and recorded actions
 * -------------------------------------------------------------------- */

function producer(overrides) {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const env = {
    calls: [],
    admin: { ready: true, signedIn: false, isAdmin: false, email: "" },
    device: { ready: true, userId: "anon-desk-a-000000", deviceId: "dev-desk-a-000000", deviceLabel: "Desk A" },
    workspaces: [
      { id: "w-10", name: "Line 10", memberCount: 3, recipeCount: 8, profileCount: 1, createdAt: "2026-01-03T00:00:00Z", lastActivityAt: "2026-09-12T00:00:00Z", thisDevice: true },
      { id: "w-11", name: "Line 11", memberCount: 1, recipeCount: 0, profileCount: 0, createdAt: "2026-02-03T00:00:00Z", lastActivityAt: "", thisDevice: false },
      { id: "w-12", name: "Line 12", memberCount: 2, recipeCount: 2, profileCount: 2, createdAt: "2026-03-03T00:00:00Z", lastActivityAt: "", thisDevice: false }
    ],
    devices: {
      "w-10": [
        { memberId: "anon-desk-a-000000", label: "Desk A", role: "owner", lastSeenAt: "2026-09-12T10:00:00Z", thisDevice: true },
        { memberId: "anon-tablet-000000", label: "Tablet", role: "member", lastSeenAt: "2026-09-10T10:00:00Z", thisDevice: false },
        { memberId: "anon-phone-0000000", label: "", role: "member", lastSeenAt: "", thisDevice: false }
      ],
      "w-11": [{ memberId: "anon-other-000000", label: "Other desk", role: "owner", lastSeenAt: "", thisDevice: false }],
      "w-12": [
        { memberId: "anon-other-000000", label: "Other desk", role: "owner", lastSeenAt: "", thisDevice: false },
        { memberId: "anon-desk-a-000000", label: "Desk A", role: "member", lastSeenAt: "2026-09-12T10:00:00Z", thisDevice: true }
      ]
    }
  };
  const base = {
    signIn: async ({ email }) => { env.admin = { ready: true, signedIn: true, isAdmin: true, email }; handle.publish(); return { ok: true }; },
    signOut: async () => { env.admin = { ready: true, signedIn: false, isAdmin: false, email: "" }; handle.publish(); return { ok: true }; },
    listWorkspaces: async () => ({ ok: true, workspaces: env.workspaces }),
    workspaceDevices: async ({ id }) => ({ ok: true, devices: env.devices[id] || [] }),
    addThisDevice: async ({ id }) => { const w = env.workspaces.find(x => x.id === id); if (w) w.thisDevice = true; return { ok: true, alreadyMember: false, role: "member" }; },
    createLine: async ({ name }) => { env.workspaces.push({ id: "w-new", name, memberCount: 1, recipeCount: 0, profileCount: 0, createdAt: "", lastActivityAt: "", thisDevice: true }); return { ok: true, id: "w-new", name }; },
    renameLine: async ({ id, name }) => { const w = env.workspaces.find(x => x.id === id); if (w) w.name = name; return { ok: true, id, name }; },
    transferOwnership: async () => ({ ok: true }),
    disconnectDevice: async ({ id, memberId }) => { env.devices[id] = (env.devices[id] || []).filter(d => d.memberId !== memberId); return { ok: true }; },
    mergeWorkspace: async ({ id }) => { env.workspaces = env.workspaces.filter(x => x.id !== id); return { ok: true, recipesMerged: 2, profilesMerged: 1 }; },
    deleteWorkspace: async ({ id }) => { env.workspaces = env.workspaces.filter(x => x.id !== id); return { ok: true }; }
  };
  const actions = {};
  for (const name of bridgeModule.ACTIONS) {
    actions[name] = async args => { env.calls.push({ name, args }); return ((overrides && overrides[name]) || base[name])(args); };
  }
  const handle = bridge.connect({ read: () => bridgeModule.project(env.admin, env.device), actions });
  return { bridge, env, handle };
}

function build(options) {
  const settings = options || {};
  const doc = fakeDocument();
  const { bridge, env, handle } = settings.producer || producer(settings.overrides);
  const section = sudoModule.section.create(doc, { admin: settings.noBridge ? null : bridge });
  // Mounted as the Handbook mounts a section: in a host that may be hidden.
  const host = doc.createElement("div");
  host.appendChild(section.element);
  doc.appendChild(host);
  const tool = section.tool("workspaces");
  return { doc, bridge, env, handle, section, tool, host, root: section.element };
}

async function signedIn(options) {
  const s = build(options);
  s.env.admin = { ready: true, signedIn: true, isAdmin: true, email: "admin@example.com" };
  s.handle.publish();
  s.section.update();
  await tick();
  return s;
}

/* ----------------------------------------------------------------------
 *   The gate
 * -------------------------------------------------------------------- */

test("signed out, the page is a compact sign-in; with no producer it says administrator tools are not available; before the check it says so", async () => {
  const none = build({ noBridge: true });
  assert.equal(none.section.getState().gate, "unavailable");
  assert.ok(hidden(none.root.querySelector(".station-sudo__form")), "no form with nothing to sign in to");
  assert.match(none.root.querySelector(".station-sudo__gate-copy").textContent, /No application is connected/);

  const checking = build();
  checking.env.admin = { ready: false };
  checking.handle.publish();
  checking.section.update();
  assert.equal(checking.section.getState().gate, "checking");
  assert.ok(hidden(checking.root.querySelector(".station-sudo__form")));

  const out = build();
  assert.equal(out.section.getState().gate, "signed-out");
  assert.equal(out.root.querySelector(".station-sudo__gate-title").textContent, "Admin Login");
  assert.equal(out.root.querySelector(".station-sudo__gate-copy").textContent, "Verify administrator access.");
  assert.ok(!hidden(out.root.querySelector(".station-sudo__form")));
  assert.ok(hidden(out.root.querySelector(".station-sudo__strip")), "no strip while signed out");
  assert.ok(hidden(out.root.querySelector(".station-sudo__tools")), "no tool while signed out");
  assert.equal(out.env.calls.length, 0, "nothing is asked of the application while signed out");
});

test("sign-in is one request carrying the two fields; the form is emptied of the password whether it succeeds or fails, and a failure is said in place", async () => {
  const s = build({ overrides: { signIn: async () => ({ ok: false, code: "access_denied", message: "This account does not have Resin Database access." }) } });
  const form = s.root.querySelector(".station-sudo__form");
  const email = s.root.querySelector("[name='email']");
  const password = s.root.querySelector("[name='password']");
  submit(form);
  await tick();
  assert.equal(s.env.calls.length, 0, "empty fields ask nothing");
  assert.match(gateNoteOf(s.root).textContent, /Enter the administrator email and password/);
  email.value = "admin@example.com"; password.value = "hunter2";
  submit(form);
  await tick();
  assert.deepEqual(s.env.calls.map(c => c.name), ["signIn"]);
  assert.deepEqual(s.env.calls[0].args, { email: "admin@example.com", password: "hunter2" });
  assert.equal(password.value, "", "the password is not kept");
  assert.equal(gateNoteOf(s.root).textContent, "This account does not have Resin Database access.");
  assert.equal(gateNoteOf(s.root).getAttribute("data-kind"), "error");
  assert.equal(s.section.getState().gate, "signed-out", "still the sign-in");
});

test("a successful sign-in replaces the sign-in in place with the strip and Workspace Management, which reads the list once", async () => {
  const s = build();
  s.root.querySelector("[name='email']").value = "admin@example.com";
  s.root.querySelector("[name='password']").value = "hunter2";
  submit(s.root.querySelector(".station-sudo__form"));
  await tick();
  assert.ok(hidden(s.root.querySelector(".station-sudo__gate")));
  assert.ok(!hidden(s.root.querySelector(".station-sudo__strip")));
  assert.equal(s.root.querySelector(".station-sudo__email").textContent, "admin@example.com");
  assert.deepEqual(s.env.calls.map(c => c.name), ["signIn", "listWorkspaces"]);
  assert.equal(rows(s.root).length, 3);
  assert.equal(s.root.querySelector(".station-sudo-ws__count").textContent, "3");
  // Further publishes and updates do not re-read the list.
  s.handle.publish(); s.section.update(); s.section.update();
  await tick();
  assert.deepEqual(s.env.calls.map(c => c.name), ["signIn", "listWorkspaces"], "read once per session");
});

test("the list is read only for a page on screen: hidden by the Handbook, a signed-in page waits; shown, it reads", async () => {
  const s = build();
  s.host.setAttribute("hidden", "");
  s.env.admin = { ready: true, signedIn: true, isAdmin: true, email: "admin@example.com" };
  s.handle.publish(); s.section.update();
  await tick();
  assert.deepEqual(s.env.calls.map(c => c.name), [], "hidden: nothing read");
  s.host.removeAttribute("hidden");
  s.section.update();
  await tick();
  assert.deepEqual(s.env.calls.map(c => c.name), ["listWorkspaces"]);
});

/* ----------------------------------------------------------------------
 *   The list and the chosen workspace
 * -------------------------------------------------------------------- */

test("a workspace row is its name and one line of counts, marked when this device is on it; the strip says which lines this device is on", async () => {
  const s = await signedIn();
  const [first, second] = rows(s.root);
  assert.equal(first.querySelector(".station-sudo-ws__row-name").textContent, "Line 10");
  assert.equal(first.querySelector(".station-sudo-ws__row-meta").textContent, "3 members · 8 recipes · 1 profile");
  assert.ok(first.classList.contains("is-connected"));
  assert.equal(first.querySelector(".station-sudo-ws__row-mark").textContent, "●");
  assert.equal(second.querySelector(".station-sudo-ws__row-mark").textContent, "");
  assert.equal(second.querySelector(".station-sudo-ws__row-meta").textContent, "1 member · 0 recipes · 0 profiles");
  assert.equal(s.root.querySelector(".station-sudo-ws__device-text").textContent, "Desk A · RT Sync ready · on Line 10");
  assert.equal(workspacesModule.deviceStatus({ ready: false, label: "" }, []), "This device · RT Sync identity not ready");
  assert.equal(workspacesModule.rowMeta({ memberCount: 1, recipeCount: 1, profileCount: 1 }), "1 member · 1 recipe · 1 profile");
});

test("choosing a workspace reads its devices, draws its summary and its rows, and changes nothing; the right pane starts empty", async () => {
  const s = await signedIn();
  assert.match(s.root.querySelector(".station-sudo-ws__detail-pane").querySelector(".station-sudo-ws__empty").textContent, /Select a workspace/);
  click(rows(s.root)[0]);
  await tick();
  assert.deepEqual(s.env.calls.map(c => c.name), ["listWorkspaces", "workspaceDevices"]);
  assert.deepEqual(s.env.calls[1].args, { id: "w-10" });
  assert.equal(s.tool.getState().focusId, "w-10");
  assert.equal(rows(s.root)[0].getAttribute("aria-pressed"), "true");
  assert.equal(s.root.querySelector(".station-sudo-ws__detail-name").textContent, "Line 10");
  assert.match(s.root.querySelector(".station-sudo-ws__detail-meta").textContent, /^Created .*2026 · 3 members · 8 recipes · 1 weight profile$/);
  const devices = deviceRows(s.root);
  assert.equal(devices.length, 3);
  assert.equal(s.root.querySelector(".station-sudo-ws__devices").querySelector(".station-sudo-ws__count").textContent, "3");
  assert.equal(devices[0].querySelector(".station-sudo-ws__device-name").textContent, "Desk A");
  assert.equal(devices[0].querySelector(".station-sudo-ws__device-role").textContent, "owner");
  assert.equal(devices[0].querySelector(".station-sudo-ws__device-self").textContent, "this device");
  assert.match(devices[0].querySelector(".station-sudo-ws__device-seen").textContent, /^seen /);
  assert.ok(devices[0].classList.contains("is-this-device"));
  assert.equal(devices[2].querySelector(".station-sudo-ws__device-name").textContent, "Unnamed device");
  assert.equal(devices[2].querySelector(".station-sudo-ws__device-seen").textContent, "never seen");
  // Make Owner only for a member; Disconnect for every row; the owner's row has no Make Owner.
  assert.ok(devices[0].querySelector("[data-action='make-owner']") === null, "the owner cannot be made owner");
  assert.ok(devices[1].querySelector("[data-action='make-owner']") !== null);
  assert.equal(s.root.querySelectorAll("[data-action='disconnect']").length, 3);
  assert.ok(byAction(s.root, "disconnect").classList.contains("is-danger"));
});

test("Add This Device is offered only for a line this device is not on, and only with a ready identity; a connected line says so instead", async () => {
  const s = await signedIn();
  click(rows(s.root)[0]); await tick();
  assert.ok(byAction(s.root, "add-this-device") === null, "already on Line 10: no Add");
  assert.equal(s.root.querySelector(".station-sudo-ws__connected").textContent, "This device is connected");
  click(rows(s.root)[1]); await tick();
  const add = byAction(s.root, "add-this-device");
  assert.ok(add !== null && !add.disabled);
  assert.ok(add.classList.contains("is-primary"));
  s.env.device = { ready: false, userId: "", deviceId: "", deviceLabel: "" };
  s.handle.publish(); s.section.update();
  assert.ok(byAction(s.root, "add-this-device").disabled, "not ready: Add is held");
  assert.ok(byAction(s.root, "create-line").disabled, "not ready: Create Line is held");
  assert.equal(s.root.querySelector(".station-sudo-ws__device").getAttribute("data-ready"), "false");
});

/* ----------------------------------------------------------------------
 *   The procedures: each asked first, each one request
 * -------------------------------------------------------------------- */

test("Add This Device asks in place with the floor UI's words, then is one request; the list and the line are re-read after", async () => {
  const s = await signedIn();
  click(rows(s.root)[1]); await tick();
  click(byAction(s.root, "add-this-device"));
  assert.deepEqual(s.tool.getState().view, { kind: "confirm", action: "addThisDevice" });
  const confirm = s.root.querySelector(".station-sudo-ws__confirm");
  assert.equal(confirm.getAttribute("data-danger"), "false");
  assert.equal(confirm.querySelector(".station-sudo-ws__confirm-title").textContent, "Reconnect This Device");
  const lines = confirm.querySelectorAll(".station-sudo-ws__confirm-line").map(n => n.textContent);
  assert.ok(lines.includes("• add this browser's current RT Sync identity to Line 11;"));
  assert.ok(lines.includes("• transfer workspace ownership."));
  assert.ok(s.root.querySelector(".station-sudo-ws__detail") === null, "the confirmation replaces the line");
  const before = s.env.calls.length;
  click(byAction(s.root, "cancel-view"));
  assert.equal(s.tool.getState().view, null);
  assert.equal(s.env.calls.length, before, "Cancel asks nothing");
  click(byAction(s.root, "add-this-device"));
  click(byAction(s.root, "confirm-view"));
  await tick();
  const names = s.env.calls.slice(before).map(c => c.name);
  assert.deepEqual(names, ["addThisDevice", "listWorkspaces", "workspaceDevices"]);
  assert.deepEqual(s.env.calls[before].args, { id: "w-11" });
  assert.equal(noteOf(s.root).textContent, "This device is now connected to Line 11.");
  assert.equal(noteOf(s.root).getAttribute("data-kind"), "ok");
  assert.ok(byAction(s.root, "add-this-device") === null, "now on Line 11");
});

test("Create Line and Rename Line ask for the name in place and are one request each; an empty name is refused before asking", async () => {
  const s = await signedIn();
  click(byAction(s.root, "create-line"));
  assert.deepEqual(s.tool.getState().view, { kind: "entry", action: "create" });
  assert.equal(s.root.querySelector(".station-sudo-ws__entry-title").textContent, "Create Line");
  const before = s.env.calls.length;
  click(byAction(s.root, "confirm-entry"));
  await tick();
  assert.equal(s.env.calls.length, before, "no name, no request");
  assert.equal(noteOf(s.root).getAttribute("data-kind"), "error");
  s.root.querySelector("[data-field='name']").value = "  Line   20 ";
  click(byAction(s.root, "confirm-entry"));
  await tick();
  assert.deepEqual(s.env.calls.slice(before).map(c => c.name), ["createLine", "listWorkspaces", "workspaceDevices"]);
  assert.deepEqual(s.env.calls[before].args, { name: "Line 20" });
  assert.equal(s.tool.getState().focusId, "w-new", "the new line is chosen");
  assert.equal(noteOf(s.root).textContent, "Created Line 20 and connected this desktop.");

  click(rows(s.root)[1]); await tick();
  click(byAction(s.root, "rename-line"));
  assert.deepEqual(s.tool.getState().view, { kind: "entry", action: "rename" });
  const input = s.root.querySelector("[data-field='name']");
  assert.equal(input.value, "Line 11", "prefilled with the current name");
  assert.ok(focused === input);
  input.value = "Line Eleven";
  const at = s.env.calls.length;
  input.dispatchEvent({ type: "keydown", key: "Enter", bubbles: true, preventDefault() {} });
  await tick();
  assert.deepEqual(s.env.calls[at], { name: "renameLine", args: { id: "w-11", name: "Line Eleven" } });
  assert.equal(rows(s.root)[1].querySelector(".station-sudo-ws__row-name").textContent, "Line Eleven");
  assert.equal(s.root.querySelector(".station-sudo-ws__detail-name").textContent, "Line Eleven");
});

test("Make Owner and Disconnect on a device row ask first - ownership with the floor UI's warning, disconnect as danger - and are one request each", async () => {
  const s = await signedIn();
  click(rows(s.root)[0]); await tick();
  click(deviceRows(s.root)[1].querySelector("[data-action='make-owner']"));
  assert.deepEqual(s.tool.getState().view, { kind: "confirm", action: "transferOwnership" });
  const lines = s.root.querySelectorAll(".station-sudo-ws__confirm-line").map(n => n.textContent);
  assert.ok(lines.includes("• make Tablet the owner of Line 10;"));
  assert.ok(lines.some(line => /Only do this if the previous owner's device is genuinely gone/.test(line)));
  const before = s.env.calls.length;
  click(byAction(s.root, "confirm-view"));
  await tick();
  assert.deepEqual(s.env.calls[before], { name: "transferOwnership", args: { id: "w-10", memberId: "anon-tablet-000000" } });
  assert.equal(noteOf(s.root).textContent, "Tablet is now the owner of Line 10.");

  click(deviceRows(s.root)[0].querySelector("[data-action='disconnect']"));
  assert.deepEqual(s.tool.getState().view, { kind: "confirm", action: "disconnectDevice" });
  const confirm = s.root.querySelector(".station-sudo-ws__confirm");
  assert.equal(confirm.getAttribute("data-danger"), "true");
  assert.ok(byAction(s.root, "confirm-view").classList.contains("is-danger"));
  const warning = confirm.querySelector(".station-sudo-ws__confirm-line").textContent;
  assert.match(warning, /Desk A is the device you just recovered\. Disconnect it anyway\?/);
  assert.match(warning, /This is the workspace owner; disconnecting it can leave the workspace without an owner\./);
  const at = s.env.calls.length;
  click(byAction(s.root, "confirm-view"));
  await tick();
  assert.deepEqual(s.env.calls[at], { name: "disconnectDevice", args: { id: "w-10", memberId: "anon-desk-a-000000" } });
  assert.equal(deviceRows(s.root).length, 2);
  assert.equal(noteOf(s.root).textContent, "Device disconnected. Its next RT Sync request will be denied.");
});

test("maintenance stays folded; unfolded, reassign-to-this-device follows the floor UI's rule, merge needs a target, and merge and delete are asked as danger", async () => {
  const s = await signedIn();
  click(rows(s.root)[0]); await tick();
  const fold = byAction(s.root, "toggle-maintenance");
  assert.equal(fold.getAttribute("aria-expanded"), "false");
  assert.ok(hidden(s.root.querySelector(".station-sudo-ws__maintenance-body")));
  assert.ok(byAction(s.root, "delete") !== null && hidden(byAction(s.root, "delete").closest(".station-sudo-ws__maintenance-body")), "Delete is drawn under the fold, not on the page");
  click(fold);
  assert.equal(byAction(s.root, "toggle-maintenance").getAttribute("aria-expanded"), "true");
  assert.ok(!hidden(s.root.querySelector(".station-sudo-ws__maintenance-body")));
  // This device owns Line 10: nothing to reassign to it.
  assert.ok(byAction(s.root, "transfer-to-this-device").disabled);
  // Merge: no target chosen yet.
  assert.ok(byAction(s.root, "merge").disabled);
  const targets = s.root.querySelectorAll("[data-target]");
  assert.deepEqual(targets.map(t => t.textContent), ["Line 11", "Line 12"], "the other lines, never this one");
  click(targets[1]);
  assert.equal(s.tool.getState().mergeTargetId, "w-12");
  assert.ok(!byAction(s.root, "merge").disabled);
  click(byAction(s.root, "merge"));
  assert.deepEqual(s.tool.getState().view, { kind: "confirm", action: "mergeWorkspace" });
  assert.equal(s.root.querySelector(".station-sudo-ws__confirm").getAttribute("data-danger"), "true");
  assert.match(s.root.querySelector(".station-sudo-ws__confirm-line").textContent, /Merge “Line 10” into “Line 12”\?.*permanently deleted\.$/);
  const before = s.env.calls.length;
  click(byAction(s.root, "confirm-view"));
  await tick();
  assert.deepEqual(s.env.calls[before], { name: "mergeWorkspace", args: { id: "w-10", targetId: "w-12" } });
  assert.equal(noteOf(s.root).textContent, "Merged 2 recipes and 1 weight profile into Line 12; deleted Line 10.");
  assert.equal(s.tool.getState().focusId, null);
  assert.equal(rows(s.root).length, 2);

  // Line 12: this device is a member, not the owner - reassign is offered.
  click(rows(s.root)[1]); await tick();
  click(byAction(s.root, "toggle-maintenance"));
  assert.ok(!byAction(s.root, "transfer-to-this-device").disabled);
  click(byAction(s.root, "transfer-to-this-device"));
  assert.deepEqual(s.tool.getState().view, { kind: "confirm", action: "transferOwnership" });
  assert.ok(s.root.querySelectorAll(".station-sudo-ws__confirm-line").some(n => n.textContent === "New owner: Desk A"));
  click(byAction(s.root, "cancel-view"));
  click(byAction(s.root, "toggle-maintenance"));
  click(byAction(s.root, "delete"));
  assert.deepEqual(s.tool.getState().view, { kind: "confirm", action: "deleteWorkspace" });
  assert.match(s.root.querySelector(".station-sudo-ws__confirm-line").textContent, /^Permanently delete “Line 12”\?.*This cannot be undone\.$/);
  const at = s.env.calls.length;
  click(byAction(s.root, "confirm-view"));
  await tick();
  assert.deepEqual(s.env.calls[at], { name: "deleteWorkspace", args: { id: "w-12" } });
  assert.equal(noteOf(s.root).textContent, "Deleted Line 12.");
  assert.equal(rows(s.root).length, 1);
});

test("a failed change says why and leaves the list and the line as they were; Refresh is one request", async () => {
  const s = await signedIn({ overrides: { renameLine: async () => ({ ok: false, code: "invalid_name", message: "Enter a line name between 1 and 80 characters." }) } });
  click(rows(s.root)[0]); await tick();
  click(byAction(s.root, "rename-line"));
  s.root.querySelector("[data-field='name']").value = "x";
  const before = s.env.calls.length;
  click(byAction(s.root, "confirm-entry"));
  await tick();
  assert.deepEqual(s.env.calls.slice(before).map(c => c.name), ["renameLine"], "no re-read after a failure");
  assert.equal(noteOf(s.root).textContent, "Enter a line name between 1 and 80 characters.");
  assert.equal(noteOf(s.root).getAttribute("data-kind"), "error");
  assert.deepEqual(s.tool.getState().view, { kind: "entry", action: "rename" }, "the entry stays open to try again");
  click(byAction(s.root, "cancel-view"));
  assert.equal(s.root.querySelector(".station-sudo-ws__detail-name").textContent, "Line 10");
  const at = s.env.calls.length;
  click(byAction(s.root, "refresh"));
  await tick();
  assert.deepEqual(s.env.calls.slice(at).map(c => c.name), ["listWorkspaces"]);
  assert.equal(noteOf(s.root).textContent, "3 workspaces loaded.");
});

/* ----------------------------------------------------------------------
 *   The session
 * -------------------------------------------------------------------- */

test("Sign out is one request; the page returns to the sign-in and keeps nothing of the list", async () => {
  const s = await signedIn();
  click(rows(s.root)[0]); await tick();
  click(byAction(s.root, "sign-out"));
  await tick();
  assert.deepEqual(s.env.calls.map(c => c.name), ["listWorkspaces", "workspaceDevices", "signOut"]);
  assert.equal(s.section.getState().gate, "signed-out");
  assert.ok(!hidden(s.root.querySelector(".station-sudo__gate")));
  assert.ok(hidden(s.root.querySelector(".station-sudo__tools")));
  assert.equal(gateNoteOf(s.root).textContent, "Signed out.");
  assert.deepEqual(s.tool.getState().workspaces, 0);
  assert.equal(s.tool.getState().focusId, null);
  assert.equal(rows(s.root).length, 0);
});

test("a session that ends while the page is open - the window reading signed out, or an answer saying access is gone - returns the page to the sign-in with nothing enabled", async () => {
  const s = await signedIn();
  click(rows(s.root)[0]); await tick();
  s.env.admin = { ready: true, signedIn: false, isAdmin: false, email: "" };
  s.handle.publish(); s.section.update();
  assert.equal(s.section.getState().gate, "signed-out");
  assert.equal(gateNoteOf(s.root).textContent, "Administrator access has ended. Sign in again to continue.");
  assert.equal(rows(s.root).length, 0);
  assert.equal(s.tool.getState().loaded, false);
  // Signing in again reads the list afresh.
  s.env.admin = { ready: true, signedIn: true, isAdmin: true, email: "admin@example.com" };
  s.handle.publish(); s.section.update();
  await tick();
  assert.equal(rows(s.root).length, 3);

  const lost = await signedIn({ overrides: { workspaceDevices: async () => ({ ok: false, code: "not_authenticated", message: "Admin sign-in is required." }) } });
  click(rows(lost.root)[0]); await tick();
  assert.equal(lost.tool.getState().loaded, false, "the tool dropped its list on the answer alone");
  assert.equal(rows(lost.root).length, 0);
});

test("the section is what the Handbook takes, and the tool is what Sudo takes; neither keeps state outside create()", () => {
  assert.deepEqual(Object.keys(sudoModule.section), ["id", "title", "create"]);
  assert.equal(sudoModule.section.id, "sudo");
  assert.equal(sudoModule.section.title, "Sudo");
  assert.ok(Object.isFrozen(sudoModule.section));
  assert.deepEqual(Object.keys(workspacesModule.tool), ["id", "title", "create"]);
  assert.equal(workspacesModule.tool.id, "workspaces");
  assert.ok(Object.isFrozen(workspacesModule.tool));
  const a = build(); const b = build();
  assert.ok(a.section.element !== b.section.element);
  assert.deepEqual(a.section.tools(), ["workspaces"]);
});

test("the page tells the Handbook it can use more bench only behind the gate: the sign-in form wants none, the tools are lists", async () => {
  const s = build();
  assert.equal(s.section.grows(), false, "the gate offered the Handbook's grip");
  s.env.admin = { ready: true, signedIn: true, isAdmin: true, email: "admin@example.com" };
  s.handle.publish();
  s.section.update();
  await tick();
  assert.equal(s.section.grows(), true, "a signed-in page did not offer the grip");
  s.env.admin = { ready: true, signedIn: false, isAdmin: false, email: "" };
  s.handle.publish();
  s.section.update();
  assert.equal(s.section.grows(), false, "the grip stayed after the session went");
  assert.equal(build({ noBridge: true }).section.grows(), false, "with no producer there is nothing to raise the frame for");
});
