"use strict";

/* Line Configuration (station/station-sudo-lines.js), Sudo's second tool,
 * and the row of tools Sudo (station/station-sudo.js) grew to hold it,
 * driven against a small fake DOM and a real admin bridge with a
 * recording producer behind it. What is pinned: signed out there is no
 * row and no tool; signed in the row turns between Workspace Management
 * and Line Configuration inside the one Sudo tab, and each tool reads its
 * list only when it is turned to; the list is the bridge's answer, in
 * line order, marked on the line this desktop is on; the layer rows are
 * always A, B, C... whichever side A is on, with the roles derived from
 * that one fact - Line 8 reads A Inside / B Core / C Outside and Line 12
 * A Outside / B Core / C Inside; choosing a side on an end row sets that
 * fact and nothing reorders; a save is one request through the bridge
 * carrying the definition, refused here first when line-identity would
 * refuse it, and the list is re-read after; Add Line is a definition,
 * not a workspace; deactivation is under the fold, asked first; and
 * Workspace Management is as it was.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const sudoModule = require("./station/station-sudo.js");
const linesModule = require("./station/station-sudo-lines.js");
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
const hidden = node => node.hasAttribute("hidden");
const byAction = (root, name) => root.querySelector(`[data-action='${name}']`);
const rows = root => root.querySelectorAll("[data-line]");
// The tool's own note and count: the pane's, not Workspace Management's.
const linesPane = root => root.querySelector("[data-role='line-configuration']");
const noteOf = root => linesPane(root).querySelector(".station-sudo-ws__note");
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

/* The layer rows as "A=Inside B=Core C=Outside": the key, then the role
 * word, or the pressed side on an end row. */
function layerReading(root) {
  return root.querySelectorAll(".station-sudo-lines__layer").map(row => {
    const key = row.querySelector(".station-sudo-lines__layer-key").textContent;
    const word = row.querySelector(".station-sudo-lines__layer-role");
    if (word) return `${key}=${word.textContent}`;
    const pressed = row.querySelectorAll("[data-choice][aria-pressed='true']")[0];
    return `${key}=${pressed ? pressed.textContent : "?"}`;
  }).join(" ");
}

/* ----------------------------------------------------------------------
 *   A producer: the plant's lines, a workspace list, recorded actions
 * -------------------------------------------------------------------- */

function line(id, lineNumber, layerCount, layerAPosition, extra) {
  return Object.assign({
    id, lineNumber, displayName: `Line ${lineNumber}`, aliases: [], layerCount, layerAPosition,
    hopperGeometry: "cylindrical", hopperNamingMode: "standard", isActive: true, metadata: {}, updatedAt: "2026-09-01T00:00:00Z"
  }, extra || {});
}

function producer(overrides) {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const env = {
    calls: [],
    admin: { ready: true, signedIn: false, isAdmin: false, email: "" },
    device: { ready: true, userId: "anon-desk-a-000000", deviceId: "dev-desk-a-000000", deviceLabel: "Desk A" },
    workspaces: [
      { id: "w-8", name: "Line 8", memberCount: 3, recipeCount: 8, profileCount: 1, createdAt: "2026-01-03T00:00:00Z", lastActivityAt: "", thisDevice: true },
      { id: "w-12", name: "Line 12", memberCount: 2, recipeCount: 2, profileCount: 2, createdAt: "2026-03-03T00:00:00Z", lastActivityAt: "", thisDevice: false }
    ],
    devices: { "w-8": [{ memberId: "anon-desk-a-000000", label: "Desk A", role: "owner", lastSeenAt: "", thisDevice: true }], "w-12": [] },
    lines: [
      line("l-12", 12, 3, "outside"),
      line("l-8", 8, 3, "inside", { hopperGeometry: "volume", metadata: { note: "kept" } }),
      line("l-1", 1, 1, null, { hopperGeometry: "volume" }),
      line("l-10", 10, 5, "outside"),
      line("l-9", 9, 3, "outside", { hopperNamingMode: "main-plus-five", aliases: ["Nine"] }),
      line("l-14", 14, 3, "outside", { isActive: false })
    ],
    nextId: 100
  };
  const base = {
    signIn: async ({ email }) => { env.admin = { ready: true, signedIn: true, isAdmin: true, email }; handle.publish(); return { ok: true }; },
    signOut: async () => { env.admin = { ready: true, signedIn: false, isAdmin: false, email: "" }; handle.publish(); return { ok: true }; },
    listWorkspaces: async () => ({ ok: true, workspaces: env.workspaces }),
    workspaceDevices: async ({ id }) => ({ ok: true, devices: env.devices[id] || [] }),
    addThisDevice: async () => ({ ok: true, alreadyMember: false, role: "member" }),
    createLine: async ({ name }) => ({ ok: true, id: "w-new", name }),
    renameLine: async ({ id, name }) => ({ ok: true, id, name }),
    transferOwnership: async () => ({ ok: true }),
    disconnectDevice: async () => ({ ok: true }),
    mergeWorkspace: async () => ({ ok: true, recipesMerged: 0, profilesMerged: 0 }),
    deleteWorkspace: async () => ({ ok: true }),
    listLineConfigurations: async () => ({ ok: true, lines: env.lines }),
    saveLineConfiguration: async ({ id, line: definition }) => {
      const saved = Object.assign({ id: id || `l-${env.nextId++}`, updatedAt: "2026-09-13T00:00:00Z" }, definition);
      env.lines = env.lines.filter(item => item.id !== saved.id).concat([saved]);
      return { ok: true, line: saved };
    }
  };
  const actions = {};
  for (const name of bridgeModule.ACTIONS) {
    actions[name] = async args => { env.calls.push({ name, args }); return ((overrides && overrides[name]) || base[name])(args); };
  }
  const handle = bridge.connect({ read: () => bridgeModule.project(env.admin, env.device), actions });
  return { bridge, env, handle };
}

/* The connection bridge as the tool reads it: which line this desktop is on. */
function fakeConnection(lineNumber) {
  const listeners = [];
  const status = { linked: lineNumber !== null, line: lineNumber !== null ? { lineNumber, workspaceId: `w-${lineNumber}`, name: `Line ${lineNumber}`, displayName: `Line ${lineNumber}` } : null };
  return {
    getStatus: () => status,
    subscribe: fn => { listeners.push(fn); return () => {}; },
    move(next) { status.linked = next !== null; status.line = next !== null ? { lineNumber: next, workspaceId: `w-${next}`, name: `Line ${next}`, displayName: `Line ${next}` } : null; for (const fn of listeners) fn(); }
  };
}

function build(options) {
  const settings = options || {};
  const doc = fakeDocument();
  const { bridge, env, handle } = settings.producer || producer(settings.overrides);
  const connection = settings.connection === undefined ? fakeConnection(8) : settings.connection;
  const section = sudoModule.section.create(doc, { admin: settings.noBridge ? null : bridge, connection });
  const host = doc.createElement("div");
  host.appendChild(section.element);
  doc.appendChild(host);
  return { doc, bridge, env, handle, section, connection, host, root: section.element,
    workspaces: section.tool("workspaces"), lines: section.tool("lines") };
}

async function signedIn(options) {
  const s = build(options);
  s.env.admin = { ready: true, signedIn: true, isAdmin: true, email: "admin@example.com" };
  s.handle.publish();
  s.section.update();
  await tick();
  return s;
}

/* Signed in and turned to Line Configuration, its list read. */
async function onLines(options) {
  const s = await signedIn(options);
  click(s.root.querySelector("[data-tool-tab='lines']"));
  await tick();
  return s;
}

const calls = s => s.env.calls.map(c => c.name);
const tabs = root => root.querySelectorAll("[data-tool-tab]");
const tabFor = (root, id) => root.querySelector(`[data-tool-tab='${id}']`);
const paneFor = (root, id) => root.querySelector(`.station-sudo__tool[data-tool='${id}']`);

/* ----------------------------------------------------------------------
 *   The row of tools
 * -------------------------------------------------------------------- */

test("signed out, Sudo is the sign-in it was: no row of tools, no tool, nothing asked of the application", () => {
  const s = build();
  assert.equal(s.section.getState().gate, "signed-out");
  assert.ok(hidden(s.root.querySelector(".station-sudo__nav")), "no row of tools while signed out");
  assert.ok(hidden(s.root.querySelector(".station-sudo__tools")), "no tool while signed out");
  assert.ok(hidden(paneFor(s.root, "lines")));
  assert.equal(s.root.querySelectorAll(".station-sudo-lines__layer").length, 0, "no Line Configuration control is drawn before sign-in");
  assert.equal(s.env.calls.length, 0);
});

test("signed in, the row names the two tools inside the one Sudo page, Workspaces first and pressed; Line Configuration waits, unread, until it is turned to", async () => {
  const s = await signedIn();
  const nav = s.root.querySelector(".station-sudo__nav");
  assert.ok(!hidden(nav));
  assert.equal(nav.getAttribute("role"), "tablist");
  assert.deepEqual(tabs(s.root).map(tab => tab.textContent), ["Workspaces", "Line Configuration"]);
  assert.deepEqual(tabs(s.root).map(tab => tab.getAttribute("aria-pressed")), ["true", "false"]);
  assert.equal(s.section.getState().tool, "workspaces");
  assert.ok(!hidden(paneFor(s.root, "workspaces")));
  assert.ok(hidden(paneFor(s.root, "lines")));
  assert.deepEqual(calls(s), ["listWorkspaces"], "only the showing tool reads");
  assert.equal(s.lines.getState().loaded, false);
  // The strip's slot shows the showing tool's status alone.
  const slots = s.root.querySelectorAll(".station-sudo__slot-item");
  assert.deepEqual(slots.map(slot => [slot.getAttribute("data-tool"), hidden(slot)]), [["workspaces", false], ["lines", true]]);
});

test("turning to Line Configuration shows it, reads its list once, and moves the strip's status; turning back re-reads nothing", async () => {
  const s = await signedIn();
  click(tabFor(s.root, "lines"));
  await tick();
  assert.equal(s.section.getState().tool, "lines");
  assert.deepEqual(tabs(s.root).map(tab => tab.getAttribute("aria-pressed")), ["false", "true"]);
  assert.ok(hidden(paneFor(s.root, "workspaces")));
  assert.ok(!hidden(paneFor(s.root, "lines")));
  assert.deepEqual(calls(s), ["listWorkspaces", "listLineConfigurations"]);
  assert.equal(s.lines.getState().loaded, true);
  const slots = s.root.querySelectorAll(".station-sudo__slot-item");
  assert.deepEqual(slots.map(slot => hidden(slot)), [true, false]);
  assert.equal(s.root.querySelector(".station-sudo-lines__current-text").textContent, "This desktop is on Line 8");
  click(tabFor(s.root, "workspaces"));
  await tick();
  assert.equal(s.section.getState().tool, "workspaces");
  assert.deepEqual(calls(s), ["listWorkspaces", "listLineConfigurations"], "a tool already read is not read again on turning back");
  // The keyboard turns the row too.
  s.root.querySelector(".station-sudo__nav").dispatchEvent({ type: "keydown", key: "ArrowRight", bubbles: false, preventDefault() {} });
  assert.equal(s.section.getState().tool, "lines");
});

test("Workspace Management is as it was under the row: its list, its rows, choosing a workspace reads its devices, and its actions are its own requests", async () => {
  const s = await signedIn();
  const wsRows = s.root.querySelectorAll(".station-sudo-ws__row[data-workspace]");
  assert.deepEqual(wsRows.map(row => row.querySelector(".station-sudo-ws__row-name").textContent), ["Line 8", "Line 12"]);
  click(wsRows[1]);
  await tick();
  assert.deepEqual(calls(s), ["listWorkspaces", "workspaceDevices"]);
  assert.equal(s.workspaces.getState().focusId, "w-12");
  click(byAction(paneFor(s.root, "workspaces"), "rename-line"));
  assert.deepEqual(s.workspaces.getState().view, { kind: "entry", action: "rename" });
  // Turning to the other tool and back leaves its state in place.
  click(tabFor(s.root, "lines"));
  await tick();
  click(tabFor(s.root, "workspaces"));
  assert.equal(s.workspaces.getState().focusId, "w-12");
  assert.deepEqual(s.workspaces.getState().view, { kind: "entry", action: "rename" });
});

/* ----------------------------------------------------------------------
 *   The list
 * -------------------------------------------------------------------- */

test("the list is the bridge's answer in line order, a name and one line of facts each, quieter when inactive, marked on the line this desktop is on", async () => {
  const s = await onLines();
  const listed = rows(s.root);
  assert.deepEqual(listed.map(row => row.querySelector(".station-sudo-ws__row-name").textContent), ["Line 1", "Line 8", "Line 9", "Line 10", "Line 12", "Line 14"]);
  assert.equal(listed[1].querySelector(".station-sudo-ws__row-meta").textContent, "3 layers · A Inside · Volume · Standard");
  assert.equal(listed[2].querySelector(".station-sudo-ws__row-meta").textContent, "3 layers · A Outside · Cylindrical · Main + 1–5");
  assert.equal(listed[0].querySelector(".station-sudo-ws__row-meta").textContent, "1 layer · A N/A · Volume · Standard");
  assert.equal(listed[5].querySelector(".station-sudo-ws__row-meta").textContent, "3 layers · A Outside · Cylindrical · Standard · Inactive");
  assert.ok(listed[5].classList.contains("is-inactive"));
  assert.deepEqual(listed.map(row => row.classList.contains("is-connected")), [false, true, false, false, false, false], "Line 8 is the connected line");
  assert.equal(listed[1].querySelector(".station-sudo-ws__row-mark").textContent, "●");
  assert.equal(linesPane(s.root).querySelector(".station-sudo-ws__count").textContent, "6");
  assert.match(noteOf(s.root).textContent, /6 lines loaded/);
  // The right pane starts empty; nothing is chosen for the operator.
  assert.equal(s.lines.getState().focusId, null);
  assert.match(paneFor(s.root, "lines").querySelector(".station-sudo-ws__empty").textContent, /Select a line/);
});

test("with no connected line, or one the connection cannot map, nothing is marked and the strip says so; the mark follows the connection", async () => {
  const s = await onLines({ connection: fakeConnection(null) });
  assert.equal(s.root.querySelector(".station-sudo-lines__current-text").textContent, "This desktop is on no line");
  assert.ok(rows(s.root).every(row => !row.classList.contains("is-connected")));
  s.connection.move(12);
  assert.equal(s.root.querySelector(".station-sudo-lines__current-text").textContent, "This desktop is on Line 12");
  assert.deepEqual(rows(s.root).map(row => row.classList.contains("is-connected")), [false, false, false, false, true, false]);
  assert.deepEqual(calls(s), ["listWorkspaces", "listLineConfigurations"], "the connection moving reads nothing");
});

/* ----------------------------------------------------------------------
 *   The chosen line
 * -------------------------------------------------------------------- */

test("choosing Line 8 draws its definition: A Inside, B Core, C Outside - the keys alphabetical, the side a fact on the end rows - and changes nothing", async () => {
  const s = await onLines();
  click(rows(s.root)[1]);
  const pane = paneFor(s.root, "lines");
  assert.equal(s.lines.getState().focusId, "l-8");
  assert.equal(pane.querySelector(".station-sudo-ws__detail-name").textContent, "Line 8");
  assert.equal(pane.querySelector("[data-tag='current']").textContent, "Current line");
  assert.equal(pane.querySelector("[data-tag='dirty']"), null, "clean as read");
  assert.equal(layerReading(pane), "A=Inside B=Core C=Outside");
  assert.deepEqual(pane.querySelectorAll(".station-sudo-lines__layer").map(row => row.getAttribute("data-layer")), ["A", "B", "C"]);
  assert.deepEqual(pane.querySelectorAll(".station-sudo-lines__layer").map(row => row.getAttribute("data-layer-role")), ["inside", "core", "outside"]);
  assert.equal(pane.querySelector("[data-field='lineNumber']").value, "8");
  assert.equal(pane.querySelector("[data-field='displayName']").value, "Line 8");
  assert.deepEqual(pane.querySelectorAll("[data-choice='layerCount']").map(chip => [chip.textContent, chip.getAttribute("aria-pressed")]), [["1", "false"], ["3", "true"], ["5", "false"]]);
  assert.deepEqual(pane.querySelectorAll("[data-choice='hopperGeometry'][aria-pressed='true']").map(chip => chip.textContent), ["Volume"]);
  assert.deepEqual(pane.querySelectorAll("[data-choice='hopperNamingMode'][aria-pressed='true']").map(chip => chip.textContent), ["Standard"]);
  assert.equal(pane.querySelector("[data-role='hoppers']").textContent, "A1–A6 · B1–B6 · C1–C6");
  assert.match(pane.querySelector(".station-sudo-lines__reach").textContent, /reaches this Station now/);
  assert.ok(byAction(pane, "save").disabled, "nothing to save");
  assert.deepEqual(calls(s), ["listWorkspaces", "listLineConfigurations"], "choosing asks nothing");
  assert.equal(s.lines.getState().dirty, false);
});

test("Line 12 reads A Outside, B Core, C Inside - the same letters, the other side; Line 10 reads the five roles; Line 9 shows Main + 1–5 hoppers; Line 1 has no side", async () => {
  const s = await onLines();
  const pane = paneFor(s.root, "lines");
  click(rows(s.root)[4]);
  assert.equal(layerReading(pane), "A=Outside B=Core C=Inside");
  assert.deepEqual(pane.querySelectorAll(".station-sudo-lines__layer").map(row => row.getAttribute("data-layer")), ["A", "B", "C"]);
  assert.equal(pane.querySelector("[data-tag='current']"), null);
  assert.match(pane.querySelector(".station-sudo-lines__reach").textContent, /^A saved change reaches devices on the line/);
  click(rows(s.root)[3]);
  assert.equal(layerReading(pane), "A=Outside B=Outside subskin C=Core D=Inside subskin E=Inside");
  click(rows(s.root)[2]);
  assert.equal(pane.querySelector("[data-role='hoppers']").textContent, "AM, A1–A5 · BM, B1–B5 · CM, C1–C5");
  assert.match(pane.querySelector(".station-sudo-ws__detail-meta").textContent, /Line number 9 · Updated .* · Also Nine/);
  click(rows(s.root)[0]);
  assert.equal(layerReading(pane), "A=Single layer");
  assert.equal(pane.querySelectorAll("[data-choice^='side']").length, 0, "a single-layer line offers no side");
});

test("choosing a side on either end row sets Layer A's side and nothing reorders: Inside on C makes A Outside; the line is dirty and Save Changes wakes", async () => {
  const s = await onLines();
  const pane = paneFor(s.root, "lines");
  click(rows(s.root)[1]);
  assert.equal(layerReading(pane), "A=Inside B=Core C=Outside");
  const cRow = pane.querySelectorAll(".station-sudo-lines__layer")[2];
  click(cRow.querySelector("[data-choice='side:2'][data-value='inside']"));
  assert.equal(layerReading(pane), "A=Outside B=Core C=Inside");
  assert.deepEqual(pane.querySelectorAll(".station-sudo-lines__layer").map(row => row.getAttribute("data-layer")), ["A", "B", "C"], "the keys never move");
  assert.equal(s.lines.getState().draft.layerAPosition, "outside");
  assert.equal(s.lines.getState().dirty, true);
  assert.equal(pane.querySelector("[data-tag='dirty']").textContent, "Unsaved changes");
  assert.equal(pane.querySelector(".station-sudo-lines__detail").getAttribute("data-dirty"), "true");
  assert.ok(!byAction(pane, "save").disabled);
  assert.equal(byAction(pane, "save").textContent, "Save Changes");
  // And back, from the A row.
  click(pane.querySelector("[data-choice='side:0'][data-value='inside']"));
  assert.equal(layerReading(pane), "A=Inside B=Core C=Outside");
  assert.equal(s.lines.getState().dirty, false, "the same definition again is clean");
  assert.deepEqual(calls(s), ["listWorkspaces", "listLineConfigurations"], "a choice saves nothing by itself");
});

test("changing the layer count rewrites the layer rows safely: to 1 the side becomes N/A, to 5 from 1 the side is Outside until chosen; the hopper ids follow the count and the naming", async () => {
  const s = await onLines();
  const pane = paneFor(s.root, "lines");
  click(rows(s.root)[1]);
  click(pane.querySelector("[data-choice='layerCount'][data-value='1']"));
  assert.equal(layerReading(pane), "A=Single layer");
  assert.equal(s.lines.getState().draft.layerAPosition, null);
  assert.equal(pane.querySelector("[data-role='hoppers']").textContent, "A1–A6");
  click(pane.querySelector("[data-choice='layerCount'][data-value='5']"));
  assert.equal(layerReading(pane), "A=Outside B=Outside subskin C=Core D=Inside subskin E=Inside");
  assert.equal(s.lines.getState().draft.layerAPosition, "outside");
  click(pane.querySelector("[data-choice='hopperNamingMode'][data-value='main-plus-five']"));
  assert.equal(pane.querySelector("[data-role='hoppers']").textContent, "AM, A1–A5 · BM, B1–B5 · CM, C1–C5 · DM, D1–D5 · EM, E1–E5");
  click(byAction(pane, "discard"));
  assert.equal(layerReading(pane), "A=Inside B=Core C=Outside", "Discard returns the line as read");
  assert.equal(s.lines.getState().dirty, false);
});

/* ----------------------------------------------------------------------
 *   Saving
 * -------------------------------------------------------------------- */

test("Save Changes is one request carrying the definition - the id, every field, the metadata as read - then the list is re-read, the line is clean, and the note says how far it reaches", async () => {
  const s = await onLines();
  const pane = paneFor(s.root, "lines");
  click(rows(s.root)[1]);
  click(pane.querySelector("[data-choice='side:0'][data-value='outside']"));
  typeInto(pane.querySelector("[data-field='aliases']"), "Eight, L8");
  click(byAction(pane, "save"));
  await tick();
  const save = s.env.calls.find(c => c.name === "saveLineConfiguration");
  assert.ok(save, "one save request");
  assert.equal(save.args.id, "l-8");
  assert.deepEqual(save.args.line, {
    lineNumber: 8, displayName: "Line 8", aliases: ["Eight", "L8"], layerCount: 3, layerAPosition: "outside",
    hopperGeometry: "volume", hopperNamingMode: "standard", isActive: true, metadata: { note: "kept" }
  });
  assert.deepEqual(calls(s), ["listWorkspaces", "listLineConfigurations", "saveLineConfiguration", "listLineConfigurations"]);
  assert.equal(s.lines.getState().dirty, false);
  assert.equal(s.lines.getState().focusId, "l-8");
  assert.equal(layerReading(pane), "A=Outside B=Core C=Inside");
  assert.equal(noteOf(s.root).textContent, "Line 8 saved. This Station follows it now; other devices on the line use it when they next reload.");
  assert.equal(noteOf(s.root).getAttribute("data-kind"), "ok");
  assert.match(pane.querySelector(".station-sudo-ws__detail-meta").textContent, /Also Eight, L8/);
});

test("an invalid definition is refused here, before anything is asked, in line-identity's words: no number, no name, a duplicate number, a name another line owns", async () => {
  const s = await onLines();
  const pane = paneFor(s.root, "lines");
  click(rows(s.root)[1]);
  typeInto(pane.querySelector("[data-field='lineNumber']"), "");
  click(byAction(pane, "save"));
  await tick();
  assert.equal(noteOf(s.root).textContent, "Line number must be between 1 and 999.");
  assert.equal(noteOf(s.root).getAttribute("data-kind"), "error");
  assert.equal(pane.querySelector("[data-field='lineNumber']").getAttribute("aria-invalid"), "true");
  typeInto(pane.querySelector("[data-field='lineNumber']"), "12");
  click(byAction(pane, "save"));
  await tick();
  assert.equal(noteOf(s.root).textContent, "Line 12 is defined more than once.");
  typeInto(pane.querySelector("[data-field='lineNumber']"), "8");
  typeInto(pane.querySelector("[data-field='displayName']"), "");
  click(byAction(pane, "save"));
  await tick();
  assert.match(noteOf(s.root).textContent, /Display name is required/);
  assert.equal(pane.querySelector("[data-field='displayName']").getAttribute("aria-invalid"), "true");
  typeInto(pane.querySelector("[data-field='displayName']"), "Nine");
  click(byAction(pane, "save"));
  await tick();
  assert.equal(noteOf(s.root).textContent, "“Nine” belongs to more than one active line.");
  assert.deepEqual(calls(s), ["listWorkspaces", "listLineConfigurations"], "nothing invalid was sent");
  assert.equal(s.lines.getState().dirty, true, "the draft is kept for correction");
});

test("a save the application refuses says why and leaves the draft and the list as they were; a lost session drops everything", async () => {
  const s = await onLines({ overrides: { saveLineConfiguration: async () => ({ ok: false, code: "failed", message: "That line number already exists." }) } });
  const pane = paneFor(s.root, "lines");
  click(rows(s.root)[1]);
  click(pane.querySelector("[data-choice='hopperGeometry'][data-value='cylindrical']"));
  click(byAction(pane, "save"));
  await tick();
  assert.equal(noteOf(s.root).textContent, "That line number already exists.");
  assert.equal(noteOf(s.root).getAttribute("data-kind"), "error");
  assert.equal(s.lines.getState().dirty, true);
  assert.equal(s.lines.getState().draft.hopperGeometry, "cylindrical");
  assert.equal(s.lines.getState().lines, 6);
  assert.deepEqual(calls(s), ["listWorkspaces", "listLineConfigurations", "saveLineConfiguration"], "no re-read after a refusal");

  const gone = await onLines({ overrides: { saveLineConfiguration: async () => ({ ok: false, code: "access_denied", message: "Admin access is required." }) } });
  click(rows(gone.root)[1]);
  click(paneFor(gone.root, "lines").querySelector("[data-choice='hopperGeometry'][data-value='cylindrical']"));
  click(byAction(paneFor(gone.root, "lines"), "save"));
  await tick();
  assert.equal(gone.lines.getState().lines, 0);
  assert.equal(gone.lines.getState().focusId, null);
  assert.equal(gone.lines.getState().loaded, false);
});

test("Add Line is a definition, not a workspace: a fresh draft whose name follows its number, saved with no id; Cancel drops it", async () => {
  const s = await onLines();
  const pane = paneFor(s.root, "lines");
  assert.equal(byAction(s.root, "add-line").textContent, "Add Line");
  assert.notEqual(byAction(s.root, "add-line").textContent, "Create Line", "Workspaces' Create Line is a different thing");
  click(byAction(s.root, "add-line"));
  assert.equal(s.lines.getState().focusId, "new");
  assert.equal(pane.querySelector(".station-sudo-ws__detail-name").textContent, "New Line");
  assert.match(pane.querySelector(".station-sudo-ws__detail-meta").textContent, /Its RT Sync workspace is Workspaces' Create Line/);
  assert.equal(byAction(pane, "save").textContent, "Add Line");
  assert.equal(focused && focused.getAttribute("data-field"), "lineNumber");
  assert.equal(layerReading(pane), "A=Outside B=Core C=Inside", "a new line starts as three layers, A outside");
  typeInto(pane.querySelector("[data-field='lineNumber']"), "16");
  assert.equal(pane.querySelector("[data-field='displayName']").value, "Line 16");
  assert.equal(rows(s.root)[6].querySelector(".station-sudo-ws__row-name").textContent, "Line 16", "the line being added stands in the list until saved");
  click(pane.querySelector("[data-choice='layerCount'][data-value='5']"));
  click(byAction(pane, "save"));
  await tick();
  const save = s.env.calls.find(c => c.name === "saveLineConfiguration");
  assert.equal(save.args.id, "");
  assert.deepEqual(save.args.line, {
    lineNumber: 16, displayName: "Line 16", aliases: [], layerCount: 5, layerAPosition: "outside",
    hopperGeometry: "cylindrical", hopperNamingMode: "standard", isActive: true, metadata: {}
  });
  assert.equal(s.lines.getState().focusId, "l-100", "the saved line is the chosen one");
  assert.equal(s.lines.getState().dirty, false);
  assert.equal(rows(s.root).length, 7);
  assert.equal(noteOf(s.root).textContent, "Line 16 saved. Devices on the line use it when they next reload.");

  click(byAction(s.root, "add-line"));
  click(byAction(pane, "discard"));
  assert.equal(s.lines.getState().focusId, null);
  assert.equal(rows(s.root).length, 7);
});

test("unsaved changes are not lost to a click on another line: it asks first, in place; Cancel keeps the draft, Discard turns to the other line", async () => {
  const s = await onLines();
  const pane = paneFor(s.root, "lines");
  click(rows(s.root)[1]);
  click(pane.querySelector("[data-choice='side:0'][data-value='outside']"));
  click(rows(s.root)[4]);
  assert.deepEqual(s.lines.getState().view, { kind: "confirm", action: "discard" });
  assert.equal(s.lines.getState().focusId, "l-8", "still Line 8");
  assert.match(pane.querySelector(".station-sudo-ws__confirm-line").textContent, /Discard the unsaved changes to Line 8/);
  click(byAction(pane, "cancel-view"));
  assert.equal(s.lines.getState().view, null);
  assert.equal(s.lines.getState().dirty, true);
  assert.equal(layerReading(pane), "A=Outside B=Core C=Inside", "the draft stands");
  click(rows(s.root)[4]);
  click(byAction(pane, "confirm-view"));
  await tick();
  assert.equal(s.lines.getState().focusId, "l-12");
  assert.equal(s.lines.getState().dirty, false);
  assert.deepEqual(calls(s), ["listWorkspaces", "listLineConfigurations"]);
});

/* ----------------------------------------------------------------------
 *   Maintenance
 * -------------------------------------------------------------------- */

test("deactivation is under the fold, as danger, asked first in the floor UI's words, and is one save with active turned off; reactivation is the plain reverse; neither while the line is dirty", async () => {
  const s = await onLines();
  const pane = paneFor(s.root, "lines");
  click(rows(s.root)[1]);
  assert.equal(pane.querySelector("[data-action='deactivate']").parent.hasAttribute("hidden") || hidden(pane.querySelector(".station-sudo-ws__maintenance-body")), true, "folded");
  assert.equal(byAction(pane, "save").parent.querySelector("[data-action='deactivate']"), null, "Deactivate does not stand beside Save");
  click(byAction(pane, "toggle-maintenance"));
  assert.ok(!hidden(pane.querySelector(".station-sudo-ws__maintenance-body")));
  const deactivate = byAction(pane, "deactivate");
  assert.ok(deactivate.classList.contains("is-danger"));
  assert.ok(pane.querySelector(".station-sudo-ws__maintenance-item").classList.contains("is-danger"));
  click(deactivate);
  assert.deepEqual(s.lines.getState().view, { kind: "confirm", action: "deactivate" });
  assert.equal(pane.querySelector(".station-sudo-ws__confirm").getAttribute("data-danger"), "true");
  assert.equal(pane.querySelector(".station-sudo-ws__confirm-line").textContent,
    "Deactivate Line 8? Structured workspace identities will still resolve, but names and aliases will no longer match this line.");
  click(byAction(pane, "confirm-view"));
  await tick();
  const save = s.env.calls.find(c => c.name === "saveLineConfiguration");
  assert.equal(save.args.id, "l-8");
  assert.equal(save.args.line.isActive, false);
  assert.equal(save.args.line.layerAPosition, "inside", "everything else as read");
  assert.equal(noteOf(s.root).textContent, "Line 8 deactivated.");
  assert.equal(pane.querySelector("[data-tag='inactive']").textContent, "Inactive");
  assert.equal(rows(s.root)[1].querySelector(".station-sudo-ws__row-meta").textContent, "3 layers · A Inside · Volume · Standard · Inactive");
  // Reactivate: the plain action, and it asks too.
  click(byAction(pane, "toggle-maintenance"));
  const reactivate = byAction(pane, "reactivate");
  assert.ok(!reactivate.classList.contains("is-danger"));
  click(reactivate);
  assert.equal(pane.querySelector(".station-sudo-ws__confirm").getAttribute("data-danger"), "false");
  click(byAction(pane, "confirm-view"));
  await tick();
  assert.equal(s.env.calls.filter(c => c.name === "saveLineConfiguration")[1].args.line.isActive, true);
  assert.equal(pane.querySelector("[data-tag='inactive']"), null);
  // Dirty: the fold's command waits for a save or a discard.
  click(pane.querySelector("[data-choice='side:0'][data-value='outside']"));
  click(byAction(pane, "toggle-maintenance"));
  assert.ok(byAction(pane, "deactivate").disabled);
});

/* ----------------------------------------------------------------------
 *   Access
 * -------------------------------------------------------------------- */

test("Sign out returns the page to the sign-in with nothing of the lines kept, and the next sign-in opens on Workspaces", async () => {
  const s = await onLines();
  click(rows(s.root)[1]);
  click(byAction(s.root, "sign-out"));
  await tick();
  assert.equal(s.section.getState().gate, "signed-out");
  assert.equal(s.lines.getState().lines, 0);
  assert.equal(s.lines.getState().focusId, null);
  assert.equal(s.lines.getState().loaded, false);
  assert.ok(hidden(s.root.querySelector(".station-sudo__nav")));
  assert.equal(s.section.getState().tool, "workspaces");
  s.env.admin = { ready: true, signedIn: true, isAdmin: true, email: "admin@example.com" };
  s.handle.publish();
  s.section.update();
  await tick();
  assert.equal(s.section.getState().tool, "workspaces");
  assert.ok(!hidden(paneFor(s.root, "workspaces")));
});

/* ----------------------------------------------------------------------
 *   The pure parts, and the module's shape
 * -------------------------------------------------------------------- */

test("layerRows() is the line model's derivation: A first always, the roles from A's side; sideOfRow and layerAPositionFor are each other's inverse", () => {
  assert.deepEqual(linesModule.layerRows(3, "inside").map(r => `${r.id}=${r.roleLabel}`), ["A=Inside", "B=Core", "C=Outside"]);
  assert.deepEqual(linesModule.layerRows(3, "outside").map(r => `${r.id}=${r.roleLabel}`), ["A=Outside", "B=Core", "C=Inside"]);
  assert.deepEqual(linesModule.layerRows(5, "inside").map(r => `${r.id}=${r.roleLabel}`), ["A=Inside", "B=Inside subskin", "C=Core", "D=Outside subskin", "E=Outside"]);
  assert.deepEqual(linesModule.layerRows(3, "inside").map(r => r.end), [true, false, true]);
  assert.deepEqual(linesModule.layerRows(3, null).map(r => r.roleLabel), ["Choose a side", "Choose a side", "Choose a side"]);
  assert.deepEqual(linesModule.layerRows(1, null).map(r => `${r.id}=${r.roleLabel}`), ["A=Single layer"]);
  assert.deepEqual(linesModule.layerRows(0, null), []);
  for (const count of [3, 5]) {
    for (const side of ["inside", "outside"]) {
      for (const end of [0, count - 1]) {
        assert.equal(linesModule.layerAPositionFor(end, linesModule.sideOfRow(end, count, side)), side);
      }
    }
  }
  assert.equal(linesModule.hopperRange("A", "standard"), "A1–A6");
  assert.equal(linesModule.hopperRange("B", "main-plus-five"), "BM, B1–B5");
  assert.deepEqual(linesModule.layerCountChoices(3), [1, 3, 5]);
  assert.deepEqual(linesModule.layerCountChoices(7), [1, 3, 5, 7], "a count the backend allows but the app does not offer is kept, not rewritten");
});

test("the tool is what Sudo takes: id, title, the short label, create; frozen; nothing kept outside create()", () => {
  assert.deepEqual(Object.keys(linesModule.tool), ["id", "title", "label", "create"]);
  assert.equal(linesModule.tool.id, "lines");
  assert.equal(linesModule.tool.title, "Line Configuration");
  assert.ok(Object.isFrozen(linesModule.tool));
  assert.ok(Object.isFrozen(linesModule));
  const a = build(); const b = build();
  assert.ok(a.lines.element !== b.lines.element);
});
