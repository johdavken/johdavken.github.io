"use strict";

/* Resin Database (station/station-sudo-resins.js), Sudo's third tool,
 * driven against a small fake DOM and a real admin bridge with a
 * recording producer behind it. What is pinned: the row of tools names
 * it third and it reads its list only when it is turned to; the list is
 * the bridge's answer in code order, inactive records marked, searched by
 * code alone without the caret moving; the editor holds a code and two
 * densities as text, blank for unknown; a save is one request through
 * the bridge carrying the record, refused here first for a blank code or
 * one another loaded record holds (nothing sent), and the list is re-read
 * after; a refusal from the application keeps the draft and marks the
 * field it names; deactivation and deletion are under the fold, asked
 * first in the floor UI's own words; a lost session drops everything.
 *
 * Never assert.equal a fake-DOM node: compare identity with assert.ok.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const sudoModule = require("./station/station-sudo.js");
const resinsModule = require("./station/station-sudo-resins.js");
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
const typeInto = (node, value) => { node.value = value; node.dispatchEvent({ type: "input", bubbles: true }); };
const pressEnter = node => node.dispatchEvent({ type: "keydown", key: "Enter", bubbles: true, preventDefault() {} });
const hidden = node => node.hasAttribute("hidden");
const byAction = (root, name) => root.querySelector(`[data-action='${name}']`);
const rows = root => root.querySelectorAll("[data-resin]");
const rowCodes = root => rows(root).map(row => row.querySelector(".station-sudo-ws__row-name").textContent);
const field = (root, name) => root.querySelector(`[data-field='${name}']`);
const pane = root => root.querySelector("[data-role='resin-database']");
const noteOf = root => pane(root).querySelector(".station-sudo-ws__note");
const stripOf = root => root.querySelector(".station-sudo-resins__current-text");
const searchOf = root => root.querySelector("[data-role='search']");
const countOf = root => pane(root).querySelector(".station-sudo-ws__count");
const metaOf = (root, id) => root.querySelector(`[data-resin='${id}']`).querySelector(".station-sudo-ws__row-meta");
const nameOf = (root, id) => root.querySelector(`[data-resin='${id}']`).querySelector(".station-sudo-ws__row-name");
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

/* ----------------------------------------------------------------------
 *   A producer: a small catalog, recorded actions
 * -------------------------------------------------------------------- */

function resin(id, resinCode, densityGCm3, bulkDensityLbFt3, extra) {
  return Object.assign({ id, resinCode, densityGCm3, bulkDensityLbFt3, isActive: true, updatedAt: "2026-09-01T00:00:00Z" }, extra || {});
}

function producer(overrides) {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const env = {
    calls: [],
    admin: { ready: true, signedIn: false, isAdmin: false, email: "" },
    device: { ready: true, userId: "anon-desk-a-000000", deviceId: "dev-desk-a-000000", deviceLabel: "Desk A" },
    workspaces: [{ id: "w-8", name: "Line 8", memberCount: 3, recipeCount: 8, profileCount: 1, createdAt: "2026-01-03T00:00:00Z", lastActivityAt: "", thisDevice: true }],
    resins: [
      resin("r-ll", "LL 1001", 0.918, 33.5),
      resin("r-hd", "hd 200", 0.955, null),
      resin("r-pp", "PP 30", null, null),
      resin("r-ev", "EVA 5", 0.94, 30, { isActive: false }),
      resin("r-am", "AM 12", 1.2, 40, { updatedAt: "" }),
      resin("r-ld", "LD 100", 0.92, 32)
    ],
    nextId: 100
  };
  const base = {
    signIn: async ({ email }) => { env.admin = { ready: true, signedIn: true, isAdmin: true, email }; handle.publish(); return { ok: true }; },
    signOut: async () => { env.admin = { ready: true, signedIn: false, isAdmin: false, email: "" }; handle.publish(); return { ok: true }; },
    listWorkspaces: async () => ({ ok: true, workspaces: env.workspaces }),
    workspaceDevices: async () => ({ ok: true, devices: [] }),
    addThisDevice: async () => ({ ok: true, alreadyMember: false, role: "member" }),
    createLine: async ({ name }) => ({ ok: true, id: "w-new", name }),
    renameLine: async ({ id, name }) => ({ ok: true, id, name }),
    transferOwnership: async () => ({ ok: true }),
    disconnectDevice: async () => ({ ok: true }),
    mergeWorkspace: async () => ({ ok: true, recipesMerged: 0, profilesMerged: 0 }),
    deleteWorkspace: async () => ({ ok: true }),
    listLineConfigurations: async () => ({ ok: true, lines: [] }),
    saveLineConfiguration: async ({ id, line }) => ({ ok: true, line: Object.assign({ id: id || "l-new" }, line) }),
    listResins: async () => ({ ok: true, resins: env.resins }),
    saveResin: async ({ id, resin: record }) => {
      const saved = Object.assign({ id: id || `r-${env.nextId++}`, updatedAt: "2026-09-13T00:00:00Z" }, record);
      env.resins = env.resins.filter(item => item.id !== saved.id).concat([saved]);
      return { ok: true, resin: saved };
    },
    deleteResin: async ({ id }) => { env.resins = env.resins.filter(item => item.id !== id); return { ok: true }; }
  };
  const actions = {};
  for (const name of bridgeModule.ACTIONS) {
    actions[name] = async args => { env.calls.push({ name, args }); return ((overrides && overrides[name]) || base[name])(args); };
  }
  const handle = bridge.connect({ read: () => bridgeModule.project(env.admin, env.device), actions });
  return { bridge, env, handle };
}

function fakeConnection() {
  const status = { linked: true, line: { lineNumber: 8, workspaceId: "w-8", name: "Line 8", displayName: "Line 8" } };
  return { getStatus: () => status, subscribe: () => () => {} };
}

function build(options) {
  const settings = options || {};
  const doc = fakeDocument();
  const { bridge, env, handle } = settings.producer || producer(settings.overrides);
  const section = sudoModule.section.create(doc, { admin: bridge, connection: fakeConnection() });
  const host = doc.createElement("div");
  host.appendChild(section.element);
  doc.appendChild(host);
  return { doc, bridge, env, handle, section, host, root: section.element, resins: section.tool("resins") };
}

async function signedIn(options) {
  const s = build(options);
  s.env.admin = { ready: true, signedIn: true, isAdmin: true, email: "admin@example.com" };
  s.handle.publish();
  s.section.update();
  await tick();
  return s;
}

/* Signed in and turned to Resin Database, its list read. */
async function onResins(options) {
  const s = await signedIn(options);
  click(s.root.querySelector("[data-tool-tab='resins']"));
  await tick();
  return s;
}

/* Turned to Resin Database with a record chosen. */
async function chosen(id, options) {
  const s = await onResins(options);
  click(s.root.querySelector(`[data-resin='${id}']`));
  await tick();
  return s;
}

const calls = s => s.env.calls.map(c => c.name);
const tabs = root => root.querySelectorAll("[data-tool-tab]");
const tabFor = (root, id) => root.querySelector(`[data-tool-tab='${id}']`);
const paneFor = (root, id) => root.querySelector(`.station-sudo__tool[data-tool='${id}']`);
const resinCalls = s => s.env.calls.filter(c => c.name === "saveResin" || c.name === "deleteResin");

/* ----------------------------------------------------------------------
 *   The row of tools
 * -------------------------------------------------------------------- */

test("signed in, Resin Database is the third tool, unread until it is turned to; turning to it reads the list once, and turning back re-reads nothing", async () => {
  const s = await signedIn();
  assert.deepEqual(tabs(s.root).map(tab => tab.textContent), ["Workspaces", "Line Configuration", "Resin Database"]);
  assert.ok(hidden(paneFor(s.root, "resins")));
  assert.deepEqual(calls(s), ["listWorkspaces"], "only the showing tool reads");
  assert.equal(s.resins.getState().loaded, false);
  assert.equal(s.root.querySelectorAll("[data-resin]").length, 0, "no record is drawn before the tool is turned to");
  click(tabFor(s.root, "resins"));
  await tick();
  assert.equal(s.section.getState().tool, "resins");
  assert.deepEqual(tabs(s.root).map(tab => tab.getAttribute("aria-pressed")), ["false", "false", "true"]);
  assert.ok(!hidden(paneFor(s.root, "resins")));
  assert.deepEqual(calls(s), ["listWorkspaces", "listResins"]);
  assert.equal(s.resins.getState().loaded, true);
  const slots = s.root.querySelectorAll(".station-sudo__slot-item");
  assert.deepEqual(slots.map(slot => hidden(slot)), [true, true, false]);
  click(tabFor(s.root, "workspaces"));
  await tick();
  click(tabFor(s.root, "resins"));
  await tick();
  assert.deepEqual(calls(s), ["listWorkspaces", "listResins"], "a list once read is kept for the session");
});

/* ----------------------------------------------------------------------
 *   The list
 * -------------------------------------------------------------------- */

test("the list is the bridge's answer in code order without regard to case, inactive records marked, with the count, the note and the strip's tally", async () => {
  const s = await onResins();
  assert.deepEqual(rowCodes(s.root), ["AM 12", "EVA 5", "hd 200", "LD 100", "LL 1001", "PP 30"]);
  const eva = s.root.querySelector("[data-resin='r-ev']");
  assert.ok(eva.classList.contains("is-inactive"));
  assert.equal(eva.querySelector(".station-sudo-ws__row-meta").textContent, "0.94 g/cm³ · 30 lb/ft³ · Inactive");
  assert.equal(metaOf(s.root, "r-hd").textContent, "0.955 g/cm³");
  assert.equal(metaOf(s.root, "r-pp").textContent, "No densities recorded");
  assert.equal(countOf(s.root).textContent, "6");
  assert.equal(noteOf(s.root).textContent, "6 resin records loaded.");
  assert.equal(noteOf(s.root).getAttribute("data-kind"), "ok");
  assert.equal(stripOf(s.root).textContent, "5 active · 1 inactive");
  assert.equal(pane(s.root).querySelector(".station-sudo-ws__detail-pane").querySelector(".station-sudo-ws__empty").textContent, "Select a resin to see its record.");
});

test("the search narrows the list by code alone, without regard to case, and never redraws its own field; a search with nothing under it says so; reset clears it", async () => {
  const s = await onResins();
  const search = searchOf(s.root);
  typeInto(search, "ll");
  assert.deepEqual(rowCodes(s.root), ["LL 1001"]);
  assert.equal(countOf(s.root).textContent, "1 of 6");
  assert.ok(searchOf(s.root) === search, "the search field is the same node after the list redrew");
  assert.equal(search.value, "ll");
  typeInto(search, "d ");
  assert.deepEqual(rowCodes(s.root), ["hd 200", "LD 100"]);
  typeInto(search, "0.9");
  assert.deepEqual(rowCodes(s.root), [], "a density is not searched");
  assert.equal(pane(s.root).querySelector(".station-sudo-ws__list").querySelector(".station-sudo-ws__empty").textContent, "No matching resin records.");
  typeInto(search, "");
  assert.equal(rows(s.root).length, 6);
  typeInto(search, "pp");
  s.resins.reset();
  assert.equal(search.value, "");
  assert.equal(s.resins.getState().query, "");
});

/* ----------------------------------------------------------------------
 *   The editor
 * -------------------------------------------------------------------- */

test("choosing a record draws its code and densities as text - blank for unknown - clean, with Save asleep; typing wakes Save and marks the draft", async () => {
  const s = await chosen("r-hd");
  assert.equal(s.root.querySelector(".station-sudo-ws__detail-name").textContent, "hd 200");
  assert.equal(s.root.querySelector(".station-sudo-ws__detail-meta").textContent.startsWith("Updated "), true);
  assert.equal(field(s.root, "resinCode").value, "hd 200");
  assert.equal(field(s.root, "densityGCm3").value, "0.955");
  assert.equal(field(s.root, "bulkDensityLbFt3").value, "");
  assert.equal(field(s.root, "densityGCm3").getAttribute("placeholder"), "Blank if unknown");
  assert.equal(field(s.root, "densityGCm3").getAttribute("data-width"), "short");
  assert.equal(s.resins.getState().dirty, false);
  assert.equal(byAction(s.root, "save").disabled, true);
  assert.equal(byAction(s.root, "save").textContent, "Save Changes");
  assert.ok(s.root.querySelector("[data-tag='dirty']") === null);
  const density = field(s.root, "densityGCm3");
  typeInto(density, "0.96");
  assert.equal(s.resins.getState().dirty, true);
  assert.equal(byAction(s.root, "save").disabled, false);
  assert.ok(s.root.querySelector("[data-tag='dirty']") !== null);
  assert.ok(field(s.root, "densityGCm3") === density, "the field is not redrawn under the operator");
  typeInto(density, "0.955");
  assert.equal(s.resins.getState().dirty, false, "typed back to what was stored is clean again");
  assert.ok(s.root.querySelector("[data-tag='dirty']") === null);
  assert.equal(s.resins.getState().view, null);
});

test("Save is one request carrying the record - id, trimmed code, densities as numbers or null, active unchanged - then the list is re-read and the floor UI's note is said", async () => {
  const s = await chosen("r-hd");
  typeInto(field(s.root, "bulkDensityLbFt3"), " 36 ");
  typeInto(field(s.root, "resinCode"), " HD 200 ");
  click(byAction(s.root, "save"));
  await tick();
  assert.deepEqual(calls(s).slice(2), ["saveResin", "listResins"]);
  assert.deepEqual(resinCalls(s)[0].args, { id: "r-hd", resin: { resinCode: "HD 200", densityGCm3: 0.955, bulkDensityLbFt3: 36, isActive: true } });
  assert.equal(noteOf(s.root).textContent, "Resin saved. The active catalog has been refreshed.");
  assert.equal(noteOf(s.root).getAttribute("data-kind"), "ok");
  assert.equal(s.resins.getState().dirty, false);
  assert.equal(s.resins.getState().focusId, "r-hd");
  assert.equal(s.root.querySelector(".station-sudo-ws__detail-name").textContent, "HD 200");
  assert.equal(field(s.root, "bulkDensityLbFt3").value, "36");
});

test("Enter in a field saves when the draft is dirty and does nothing when it is clean; Enter in the search saves nothing", async () => {
  const s = await chosen("r-ld");
  pressEnter(field(s.root, "densityGCm3"));
  await tick();
  assert.equal(resinCalls(s).length, 0);
  typeInto(field(s.root, "densityGCm3"), "0.921");
  pressEnter(field(s.root, "densityGCm3"));
  await tick();
  assert.equal(resinCalls(s).length, 1);
  typeInto(field(s.root, "densityGCm3"), "0.922");
  pressEnter(searchOf(s.root));
  await tick();
  assert.equal(resinCalls(s).length, 1);
});

test("Add Resin opens a new record with the caret on the code, stands in the list under the code as typed, and saves with an empty id; the saved record becomes the chosen one", async () => {
  const s = await onResins();
  click(byAction(s.root, "add-resin"));
  await tick();
  assert.equal(s.resins.getState().focusId, "new");
  assert.ok(focused === field(s.root, "resinCode"), "the code field takes focus");
  assert.equal(s.root.querySelector(".station-sudo-ws__detail-name").textContent, "New Resin");
  assert.equal(byAction(s.root, "save").textContent, "Add Resin");
  assert.equal(byAction(s.root, "discard").textContent, "Cancel");
  assert.ok(s.root.querySelector("[data-resin='new']").classList.contains("is-new"));
  assert.equal(nameOf(s.root, "new").textContent, "New resin");
  assert.ok(s.root.querySelector(".station-sudo-ws__maintenance") === null, "no maintenance for a record not yet saved");
  typeInto(field(s.root, "resinCode"), "MB 77");
  assert.equal(nameOf(s.root, "new").textContent, "MB 77");
  typeInto(field(s.root, "densityGCm3"), "1.05");
  click(byAction(s.root, "save"));
  await tick();
  assert.deepEqual(resinCalls(s)[0].args, { id: "", resin: { resinCode: "MB 77", densityGCm3: 1.05, bulkDensityLbFt3: null, isActive: true } });
  assert.equal(s.resins.getState().focusId, "r-100");
  assert.equal(rows(s.root).length, 7);
  assert.equal(s.root.querySelector("[data-resin='r-100']").getAttribute("aria-pressed"), "true");
  assert.equal(noteOf(s.root).textContent, "Resin saved. The active catalog has been refreshed.");
});

test("Cancel on a new record drops it; Discard on a changed record returns to what was stored", async () => {
  const s = await onResins();
  click(byAction(s.root, "add-resin"));
  typeInto(field(s.root, "resinCode"), "ZZ");
  click(byAction(s.root, "discard"));
  assert.equal(s.resins.getState().focusId, null);
  assert.equal(rows(s.root).length, 6);
  click(s.root.querySelector("[data-resin='r-ll']"));
  typeInto(field(s.root, "densityGCm3"), "2");
  assert.equal(s.resins.getState().dirty, true);
  click(byAction(s.root, "discard"));
  assert.equal(s.resins.getState().dirty, false);
  assert.equal(field(s.root, "densityGCm3").value, "0.918");
  assert.equal(resinCalls(s).length, 0);
});

test("a blank code, or one another loaded record holds - without regard to case - is refused here with the field marked, and nothing is sent; the draft is kept", async () => {
  const s = await chosen("r-hd");
  typeInto(field(s.root, "resinCode"), "  ");
  click(byAction(s.root, "save"));
  await tick();
  assert.equal(noteOf(s.root).textContent, "Resin code is required.");
  assert.equal(noteOf(s.root).getAttribute("data-kind"), "error");
  assert.equal(field(s.root, "resinCode").getAttribute("aria-invalid"), "true");
  typeInto(field(s.root, "resinCode"), "ll 1001");
  assert.ok(field(s.root, "resinCode").getAttribute("aria-invalid") === null, "typing clears the mark");
  click(byAction(s.root, "save"));
  await tick();
  assert.equal(noteOf(s.root).textContent, "That resin code already exists.");
  assert.equal(field(s.root, "resinCode").getAttribute("aria-invalid"), "true");
  assert.equal(field(s.root, "resinCode").value, "ll 1001", "the draft is kept");
  assert.equal(resinCalls(s).length, 0, "nothing reached the application");
  // Its own code, in another case, is not a duplicate of itself.
  typeInto(field(s.root, "resinCode"), "HD 200");
  click(byAction(s.root, "save"));
  await tick();
  assert.equal(resinCalls(s).length, 1);
});

test("a refusal from the application keeps the draft and marks the field it names - by the bridge's field, or by the word in the service's message", async () => {
  const answers = [];
  const s = await chosen("r-ll", { overrides: { saveResin: async () => answers.shift() } });
  // The service's own wording for a value out of range: no field, a message.
  answers.push({ ok: false, message: "Density must be blank or between 0.001 and 10 g/cm³." });
  typeInto(field(s.root, "densityGCm3"), "50");
  click(byAction(s.root, "save"));
  await tick();
  assert.equal(noteOf(s.root).textContent, "Density must be blank or between 0.001 and 10 g/cm³.");
  assert.equal(field(s.root, "densityGCm3").getAttribute("aria-invalid"), "true");
  assert.ok(field(s.root, "bulkDensityLbFt3").getAttribute("aria-invalid") === null);
  assert.equal(field(s.root, "densityGCm3").value, "50", "the draft is kept");
  assert.equal(s.resins.getState().dirty, true);
  // The application's duplicate answer, with its code.
  answers.push({ ok: false, code: "duplicate_code", message: "That resin code already exists." });
  typeInto(field(s.root, "densityGCm3"), "0.9");
  typeInto(field(s.root, "resinCode"), "NEW 1");
  click(byAction(s.root, "save"));
  await tick();
  assert.equal(noteOf(s.root).textContent, "That resin code already exists.");
  assert.equal(field(s.root, "resinCode").value, "NEW 1");
  // Something that is not a number never leaves the bridge: refused by field.
  typeInto(field(s.root, "resinCode"), "LL 1001");
  typeInto(field(s.root, "bulkDensityLbFt3"), "abc");
  const before = resinCalls(s).length;
  click(byAction(s.root, "save"));
  await tick();
  assert.equal(resinCalls(s).length, before, "the bridge refused it before the application was asked");
  assert.equal(noteOf(s.root).textContent, "Bulk density must be blank or a number.");
  assert.equal(field(s.root, "bulkDensityLbFt3").getAttribute("aria-invalid"), "true");
  assert.ok(field(s.root, "densityGCm3").getAttribute("aria-invalid") === null);
});

test("choosing another record with changes in hand asks first: Cancel keeps the draft, Discard Changes turns", async () => {
  const s = await chosen("r-ll");
  typeInto(field(s.root, "densityGCm3"), "0.93");
  click(s.root.querySelector("[data-resin='r-hd']"));
  await tick();
  assert.deepEqual(s.resins.getState().view, { kind: "confirm", action: "discard" });
  assert.equal(s.root.querySelector(".station-sudo-ws__confirm-title").textContent, "Unsaved Changes");
  assert.equal(s.root.querySelector(".station-sudo-ws__confirm-line").textContent, "Discard the unsaved changes to LL 1001? The record stays as it was last saved.");
  click(byAction(s.root, "cancel-view"));
  assert.equal(s.resins.getState().focusId, "r-ll");
  assert.equal(field(s.root, "densityGCm3").value, "0.93", "the draft survives Cancel");
  click(s.root.querySelector("[data-resin='r-hd']"));
  await tick();
  click(byAction(s.root, "confirm-view"));
  await tick();
  assert.equal(s.resins.getState().focusId, "r-hd");
  assert.equal(s.resins.getState().dirty, false);
  assert.equal(resinCalls(s).length, 0);
});

/* ----------------------------------------------------------------------
 *   Maintenance: active, and delete
 * -------------------------------------------------------------------- */

test("maintenance is folded under the record with Deactivate and Delete; both wait while the draft is dirty", async () => {
  const s = await chosen("r-ll");
  const fold = byAction(s.root, "toggle-maintenance");
  assert.equal(fold.getAttribute("aria-expanded"), "false");
  assert.ok(hidden(s.root.querySelector(".station-sudo-ws__maintenance-body")));
  assert.equal(s.root.querySelector(".station-sudo-ws__fold-note").textContent, "Deactivate · Delete");
  click(fold);
  assert.ok(!hidden(s.root.querySelector(".station-sudo-ws__maintenance-body")));
  assert.equal(byAction(s.root, "deactivate").disabled, false);
  assert.equal(byAction(s.root, "delete").disabled, false);
  assert.ok(byAction(s.root, "reactivate") === null);
  typeInto(field(s.root, "densityGCm3"), "0.9");
  click(byAction(s.root, "discard"));
  click(byAction(s.root, "toggle-maintenance"));
  typeInto(field(s.root, "densityGCm3"), "0.9");
  // The fold is drawn again only on a redraw; the buttons read the dirty state then.
  click(byAction(s.root, "toggle-maintenance"));
  click(byAction(s.root, "toggle-maintenance"));
  assert.equal(byAction(s.root, "deactivate").disabled, true);
  assert.equal(byAction(s.root, "delete").disabled, true);
  assert.equal(byAction(s.root, "delete").getAttribute("title"), "Save or discard the changes first");
});

test("Deactivate is asked first as danger and is one save with active turned off; Reactivate is the plain reverse", async () => {
  const s = await chosen("r-ll");
  click(byAction(s.root, "toggle-maintenance"));
  click(byAction(s.root, "deactivate"));
  assert.deepEqual(s.resins.getState().view, { kind: "confirm", action: "deactivate" });
  const confirm = s.root.querySelector(".station-sudo-ws__confirm");
  assert.equal(confirm.getAttribute("data-danger"), "true");
  assert.equal(s.root.querySelector(".station-sudo-ws__confirm-title").textContent, "Deactivate Resin");
  assert.match(s.root.querySelector(".station-sudo-ws__confirm-line").textContent, /^Deactivate LL 1001\? It leaves the active catalog/);
  assert.equal(resinCalls(s).length, 0, "asked, not done");
  click(byAction(s.root, "confirm-view"));
  await tick();
  assert.equal(resinCalls(s).length, 1);
  assert.deepEqual(resinCalls(s)[0].args, { id: "r-ll", resin: { resinCode: "LL 1001", densityGCm3: 0.918, bulkDensityLbFt3: 33.5, isActive: false } });
  assert.equal(noteOf(s.root).textContent, "LL 1001 deactivated.");
  assert.equal(s.resins.getState().view, null);
  assert.ok(s.root.querySelector("[data-resin='r-ll']").classList.contains("is-inactive"));
  assert.ok(s.root.querySelector("[data-tag='inactive']") !== null);
  assert.equal(stripOf(s.root).textContent, "4 active · 2 inactive");
  click(byAction(s.root, "toggle-maintenance"));
  click(byAction(s.root, "reactivate"));
  assert.equal(s.root.querySelector(".station-sudo-ws__confirm").getAttribute("data-danger"), "false");
  click(byAction(s.root, "confirm-view"));
  await tick();
  assert.equal(resinCalls(s)[1].args.resin.isActive, true);
  assert.equal(noteOf(s.root).textContent, "LL 1001 reactivated.");
  assert.ok(!s.root.querySelector("[data-resin='r-ll']").classList.contains("is-inactive"));
});

test("Delete is asked first in the floor UI's own words, as danger; confirmed, it is one request, the record leaves the list, and the right pane empties", async () => {
  const s = await chosen("r-pp");
  click(byAction(s.root, "toggle-maintenance"));
  click(byAction(s.root, "delete"));
  assert.deepEqual(s.resins.getState().view, { kind: "confirm", action: "delete" });
  assert.equal(s.root.querySelector(".station-sudo-ws__confirm").getAttribute("data-danger"), "true");
  assert.equal(s.root.querySelector(".station-sudo-ws__confirm-title").textContent, "Delete Resin");
  assert.equal(s.root.querySelector(".station-sudo-ws__confirm-line").textContent,
    "Permanently delete PP 30? Use Inactive instead if this catalog record may be needed again. This cannot be undone.");
  assert.equal(byAction(s.root, "confirm-view").textContent, "Delete Resin");
  click(byAction(s.root, "cancel-view"));
  assert.equal(s.resins.getState().view, null);
  assert.equal(s.resins.getState().focusId, "r-pp");
  assert.equal(resinCalls(s).length, 0);
  click(byAction(s.root, "toggle-maintenance"));
  click(byAction(s.root, "delete"));
  click(byAction(s.root, "confirm-view"));
  await tick();
  assert.deepEqual(resinCalls(s).map(c => [c.name, c.args]), [["deleteResin", { id: "r-pp" }]]);
  assert.deepEqual(calls(s).slice(-2), ["deleteResin", "listResins"]);
  assert.equal(noteOf(s.root).textContent, "PP 30 deleted.");
  assert.equal(s.resins.getState().focusId, null);
  assert.deepEqual(rowCodes(s.root), ["AM 12", "EVA 5", "hd 200", "LD 100", "LL 1001"]);
  assert.ok(s.root.querySelector("[data-field='resinCode']") === null, "nothing is chosen");
});

test("a refused delete keeps the record and says why", async () => {
  const s = await chosen("r-pp", { overrides: { deleteResin: async () => ({ ok: false, message: "Could not delete the resin. No changes were applied." }) } });
  click(byAction(s.root, "toggle-maintenance"));
  click(byAction(s.root, "delete"));
  click(byAction(s.root, "confirm-view"));
  await tick();
  assert.equal(noteOf(s.root).textContent, "Could not delete the resin. No changes were applied.");
  assert.equal(noteOf(s.root).getAttribute("data-kind"), "error");
  assert.equal(s.resins.getState().focusId, "r-pp");
  assert.equal(rows(s.root).length, 6);
  assert.equal(s.resins.getState().view, null);
});

/* ----------------------------------------------------------------------
 *   Access
 * -------------------------------------------------------------------- */

test("an answer saying access is gone - on a save or a delete - drops everything read: no list, no record, no draft; nothing is kept for the next session", async () => {
  const s = await chosen("r-ll", { overrides: { saveResin: async () => ({ ok: false, code: "access_denied", message: "Admin access is required." }) } });
  typeInto(field(s.root, "densityGCm3"), "0.93");
  click(byAction(s.root, "save"));
  await tick();
  const state = s.resins.getState();
  assert.equal(state.resins, 0);
  assert.equal(state.focusId, null);
  assert.equal(state.loaded, false);
  assert.equal(state.draft, null);
  assert.equal(rows(s.root).length, 0);
  const t = await chosen("r-pp", { overrides: { deleteResin: async () => ({ ok: false, code: "not_authenticated", message: "Admin sign-in is required." }) } });
  click(byAction(t.root, "toggle-maintenance"));
  click(byAction(t.root, "delete"));
  click(byAction(t.root, "confirm-view"));
  await tick();
  assert.equal(t.resins.getState().resins, 0);
  assert.equal(t.resins.getState().loaded, false);
});

test("sign-out resets the tool and the next sign-in opens on Workspaces; turning to Resin Database reads the list afresh", async () => {
  const s = await chosen("r-ll");
  typeInto(searchOf(s.root), "ll");
  click(s.root.querySelector("[data-action='sign-out']"));
  await tick();
  assert.equal(s.section.getState().gate, "signed-out");
  assert.equal(s.resins.getState().resins, 0);
  assert.equal(s.resins.getState().query, "");
  assert.equal(searchOf(s.root).value, "");
  s.env.admin = { ready: true, signedIn: true, isAdmin: true, email: "admin@example.com" };
  s.handle.publish();
  s.section.update();
  await tick();
  assert.equal(s.section.getState().tool, "workspaces");
  assert.equal(calls(s).filter(name => name === "listResins").length, 1);
  click(tabFor(s.root, "resins"));
  await tick();
  assert.equal(calls(s).filter(name => name === "listResins").length, 2);
  assert.equal(rows(s.root).length, 6);
});

/* ----------------------------------------------------------------------
 *   The pure helpers, and the module's shape
 * -------------------------------------------------------------------- */

test("the helpers: a draft is text with blank for unknown, values are numbers or null with NaN passing, sameness is by text, duplicates ignore case and self, sort ignores case, search is by code", () => {
  const m = resinsModule;
  assert.deepEqual(m.draftOf(resin("r", "LL", 0.9, null)), { id: "r", resinCode: "LL", densityGCm3: "0.9", bulkDensityLbFt3: "", isActive: true });
  assert.deepEqual(m.draftOf(null), { id: "", resinCode: "", densityGCm3: "", bulkDensityLbFt3: "", isActive: true });
  assert.deepEqual(m.draftOf(resin("r", "LL", 0, 5, { isActive: false })).isActive, false);
  assert.equal(m.parseNumberField(""), null);
  assert.equal(m.parseNumberField("  "), null);
  assert.equal(m.parseNumberField(" 0.92 "), 0.92);
  assert.ok(Number.isNaN(m.parseNumberField("abc")), "not a number passes as NaN for the bridge to refuse by name");
  assert.deepEqual(m.valuesOf({ id: "", resinCode: " X ", densityGCm3: "1", bulkDensityLbFt3: "", isActive: true }), { id: null, resinCode: "X", densityGCm3: 1, bulkDensityLbFt3: null, isActive: true });
  assert.equal(m.sameDraft({ resinCode: "A", densityGCm3: "1 ", bulkDensityLbFt3: "", isActive: true }, { resinCode: "A", densityGCm3: "1", bulkDensityLbFt3: "", isActive: true }), true);
  assert.equal(m.sameDraft({ resinCode: "A", densityGCm3: "abc", bulkDensityLbFt3: "", isActive: true }, { resinCode: "A", densityGCm3: "", bulkDensityLbFt3: "", isActive: true }), false, "a field holding a non-number is a change");
  assert.equal(m.sameDraft({ resinCode: "A", isActive: true }, { resinCode: "A", isActive: false }), false);
  const list = [resin("1", "LL 1001", 1, 1), resin("2", "hd 200", 1, 1)];
  assert.equal(m.duplicateCode(list, " ll 1001 ", "2"), true);
  assert.equal(m.duplicateCode(list, "LL 1001", "1"), false, "not its own duplicate");
  assert.equal(m.duplicateCode(list, "", "9"), false);
  assert.deepEqual(m.sortResins([resin("1", "b", 1, 1), resin("2", "A", 1, 1), resin("3", "a2", 1, 1)]).map(r => r.resinCode), ["A", "a2", "b"]);
  assert.deepEqual(m.filterResins(list, "LL").map(r => r.id), ["1"]);
  assert.deepEqual(m.filterResins(list, " ").map(r => r.id), ["1", "2"]);
  assert.equal(m.rowMeta(resin("1", "X", 0.92, 35)), "0.92 g/cm³ · 35 lb/ft³");
  assert.equal(m.rowMeta(resin("1", "X", null, 35, { isActive: false })), "35 lb/ft³ · Inactive");
  assert.equal(m.detailMeta(resin("1", "X", 1, 1, { updatedAt: "" })), "A catalog record");
  assert.deepEqual(m.deleteLines(resin("1", "X", 1, 1)), ["Permanently delete X? Use Inactive instead if this catalog record may be needed again. This cannot be undone."]);
});

test("the tool is what Sudo takes, frozen, and two instances share nothing", () => {
  assert.deepEqual(Object.keys(resinsModule.tool), ["id", "title", "label", "create"]);
  assert.equal(resinsModule.tool.id, "resins");
  assert.equal(resinsModule.tool.label, "Resin Database");
  assert.ok(Object.isFrozen(resinsModule) && Object.isFrozen(resinsModule.tool));
  const doc = fakeDocument();
  const a = resinsModule.create(doc, {});
  const b = resinsModule.create(doc, {});
  assert.ok(a !== b && a.element !== b.element);
  assert.equal(a.getState().loaded, false);
  assert.deepEqual(Object.keys(a).sort(), ["choose", "element", "focus", "getState", "load", "reset", "save", "search", "update"]);
});
