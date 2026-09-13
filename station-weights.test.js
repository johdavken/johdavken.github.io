"use strict";

/* Weights (station/station-weights.js), the Handbook's page for the
 * physical hoppers, driven against a small fake DOM, a real
 * weight-profiles bridge with a recording producer behind it, and a
 * recording command bridge (handed in as the Handbook hands it, and never
 * used). What is pinned: the page enters no weight and dispatches nothing
 * - the weights are the stage's, on the rail's Weights face - and reads
 * the line's weights only to show a profile against them; the profiles
 * are the bridge's book, and every profile action is one request by id,
 * behind its confirmation; nothing is dispatched or requested by opening,
 * selecting or cancelling.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const weightsModule = require("./station/station-weights.js");
const bridgeModule = require("./station-weight-profiles-bridge.js");
const lineModel = require("./station/station-line-model.js");

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
    readOnly: false,
    get firstChild() { return this.children[0] || null; },
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
    focus() { focused = this; this.dispatchEvent({ type: "focus" }); },
    blur() { if (focused === this) focused = null; this.dispatchEvent({ type: "blur" }); },
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
  const parts = selector.match(/(\.[a-z0-9_-]+|\[[a-z-]+(?:='[^']*')?\]|[a-z0-9]+)/gi) || [];
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
const key = (node, k) => { const event = { type: "keydown", key: k, bubbles: true, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } }; node.dispatchEvent(event); return event; };
const typeInto = (node, value) => { node.value = value; node.dispatchEvent({ type: "input" }); };
const hidden = node => node.hasAttribute("hidden");
const byAction = (root, name) => root.querySelector(`[data-action='${name}']`);
const fieldOf = (root, k) => root.querySelector(`.station-weights__field[data-key='${k}']`);
const pickOf = (root, k) => root.querySelector(`[data-pick='${k}']`);
const rows = root => root.querySelectorAll(".station-weights__row");
const noteOf = root => root.querySelector(".station-weights__note");
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const textIn = node => { const out = []; walk(node, n => { if (n.textContent) out.push(n.textContent); }); return out.join(" "); };

/* ----------------------------------------------------------------------
 *   The line: three layers of two hoppers, with weights
 * -------------------------------------------------------------------- */

function lineFor(overrides) {
  return lineModel.buildLineModel(Object.assign({
    lineNumber: 9, displayName: "Line 9", layerCount: 3, layerAPosition: "outside", hopperNamingMode: "standard", hopperCount: 2
  }, overrides || {}));
}

function stateFor(weights) {
  const hopperState = {};
  for (const layer of ["A", "B", "C"]) {
    for (let index = 0; index < 2; index += 1) {
      const k = `${layer}:${index}`;
      hopperState[k] = { assigned: index === 0, resinName: index === 0 ? `HX-${layer}` : "", pct: index === 0 ? 100 : 0, weight: weights && weights[k] !== undefined ? weights[k] : 0, effectiveWeight: 0, track: false, pumpOff: false, source: "" };
    }
  }
  return { live: true, hopperState };
}

/* A command bridge that records, applies to the resolved state, and
 * answers as the contract does. */
function commandsFor(resolved, options) {
  const settings = options || {};
  const calls = [];
  const capabilities = settings.capabilities || ["setHopperWeight", "setHopperWeights"];
  let revision = 1;
  const bridge = {
    calls,
    isAvailable: () => settings.available !== false,
    capabilities: () => capabilities,
    dispatch(command, args) {
      calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
      const refused = typeof settings.refuse === "function" ? settings.refuse(command, args) : null;
      if (refused) return { ok: false, code: "out_of_range", message: refused };
      const state = resolved();
      let changed = false;
      const apply = entry => {
        const k = `${entry.layer}:${entry.index}`;
        const weight = Number(String(entry.weight).replace(/,/g, ""));
        if (state.hopperState[k] && state.hopperState[k].weight !== weight) { state.hopperState[k].weight = weight; changed = true; }
      };
      if (command === "setHopperWeight") apply(args);
      else if (command === "setHopperWeights") args.weights.forEach(apply);
      if (changed) revision += 1;
      return { ok: true, changed, revision, persisted: true, snapshot: {} };
    }
  };
  return bridge;
}

/* ----------------------------------------------------------------------
 *   A producer: Line 9's two profiles, and recorded actions
 * -------------------------------------------------------------------- */

function profilePayload(lineType, geometry) {
  const names = lineType === 1 ? ["A"] : lineType === 5 ? ["A", "B", "C", "D", "E"] : ["A", "B", "C"];
  return {
    schema_version: 1, line_type: lineType || 3, hopper_naming_mode: "standard", hoppers_per_layer: 6,
    layers: names.map((name, i) => Object.assign({ name, receiver_weights_lb: [1000 + i * 100, 500, 0, 0, 0, 0] },
      geometry ? { usable_heights_in: [30, 30, 0, 0, 0, 0] } : {}))
  };
}

function item(id, name, lineType, geometry) {
  return { id, workspaceId: "ws-9", type: "receiver_weight_profile", name, normalizedName: name.toLowerCase(), schemaVersion: 1, payload: profilePayload(lineType, geometry), favorite: false, createdBy: "u", updatedBy: "u", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z" };
}

function envelope(profiles) {
  return { ok: true, workspaceId: "ws-9", cachedAt: 1, items: { receiver_weight_profile: profiles, recipe: [] } };
}

function producer(overrides) {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const env = {
    calls: [],
    profiles: [item("p-1", "Standard weights", 3), item("p-5", "Five layer", 5), item("p-geo", "Measured", 3, true)],
    workspaceId: "ws-9", refreshing: false
  };
  const byId = id => env.profiles.find(profile => profile.id === id) || null;
  const actions = Object.assign({
    saveCurrentWeights: async ({ name }) => {
      env.calls.push(["saveCurrentWeights", name]);
      if (env.profiles.some(profile => profile.normalizedName === name.toLowerCase())) return { ok: false, code: "duplicate_name", message: "A configuration with that name already exists." };
      env.profiles.push(item("p-new", name, 3));
      env.handle.publish();
      return { ok: true, item: { id: "p-new" } };
    },
    replaceWeightProfile: async ({ id }) => { env.calls.push(["replaceWeightProfile", id]); env.handle.publish(); return { ok: true, item: { id } }; },
    loadWeightProfile: async ({ id }) => { env.calls.push(["loadWeightProfile", id]); return { ok: true }; },
    renameWeightProfile: async ({ id, name }) => { env.calls.push(["renameWeightProfile", id, name]); const p = byId(id); if (p) { p.name = name; p.normalizedName = name.toLowerCase(); } env.handle.publish(); return { ok: true, item: { id } }; },
    duplicateWeightProfile: async ({ id, name }) => { env.calls.push(["duplicateWeightProfile", id, name]); env.profiles.push(item("p-copy", name, 3)); env.handle.publish(); return { ok: true, item: { id: "p-copy" } }; },
    deleteWeightProfile: async ({ id }) => { env.calls.push(["deleteWeightProfile", id]); env.profiles = env.profiles.filter(profile => profile.id !== id); env.handle.publish(); return { ok: true }; },
    refresh: async () => { env.calls.push(["refresh"]); return { ok: true }; }
  }, overrides || {});
  env.handle = bridge.connect({
    read: () => bridgeModule.project(envelope(env.profiles), { workspaceId: env.workspaceId, displayName: "Line 9", refreshing: env.refreshing }),
    actions
  });
  env.bridge = bridge;
  return env;
}

function build(options) {
  const settings = options || {};
  const doc = fakeDocument();
  const model = settings.model === undefined ? lineFor() : settings.model;
  const state = settings.state || stateFor({ "A:0": 1000, "A:1": 500, "B:0": 1100 });
  const resolved = () => state;
  const commands = settings.commands === null ? null : (settings.commands || commandsFor(resolved, settings.commandOptions));
  const committed = [];
  const env = settings.env === null ? null : (settings.env || producer());
  const page = weightsModule.create(doc, {
    weightProfiles: env ? env.bridge : null,
    resolved,
    model: () => model,
    commands: () => commands,
    onCommitted: result => { committed.push(result); page.update(); },
    layerRole: name => { const layer = model ? model.layers.find(entry => entry.id === name) : null; return layer ? layer.role : ""; }
  });
  return { doc, page, root: page.element, state, commands, committed, env, model };
}

/* ----------------------------------------------------------------------
 *   No weights are entered here
 * -------------------------------------------------------------------- */

test("the page carries no weight field, no bulk apply and no command: the weights are the stage's (the rail's Weights face); this page reads them only to show a profile against them", () => {
  const h = build();
  assert.equal(h.root.querySelector(".station-weights__grid"), null);
  assert.equal(h.root.querySelector(".station-weights__bulk"), null);
  assert.equal(h.root.querySelectorAll("input").length, 1, "the one field is the profile name");
  assert.equal(h.root.querySelector("input").getAttribute("aria-label"), "Profile name");
  assert.deepEqual(h.root.querySelectorAll("[data-action]").map(node => node.getAttribute("data-action")), ["save-current", "refresh", "confirm-entry", "replace", "cancel-entry"]);
  assert.deepEqual(h.commands.calls, []);
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "station/station-weights.js"), "utf8");
  assert.doesNotMatch(source, /\.dispatch\s*\(|setHopperWeight|data-pick|apply-bulk/, "the page dispatches, or names a weight command");
});

/* ----------------------------------------------------------------------
 *   The profiles
 * -------------------------------------------------------------------- */

test("the profile list is the bridge's book; selecting one shows its weights against the line's, marks what a load would change, and asks for nothing", () => {
  const h = build();
  assert.deepEqual(rows(h.root).map(row => row.getAttribute("data-profile")), ["p-1", "p-5", "p-geo"]);
  assert.match(h.root.querySelector(".station-weights__context").textContent, /Line 9 · 3 profiles/);
  assert.match(textIn(h.root.querySelector(".station-weights__detail")), /Select a profile/);
  click(rows(h.root)[0]);
  assert.equal(h.page.getState().selectedId, "p-1");
  assert.equal(rows(h.root)[0].getAttribute("aria-pressed"), "true");
  const detail = h.root.querySelector(".station-weights__detail");
  assert.equal(detail.querySelector(".station-weights__detail-name").textContent, "Standard weights");
  assert.equal(detail.querySelector(".station-weights__compat"), null, "a matching profile needs no warning");
  const cells = detail.querySelectorAll(".station-weights__profile-hopper");
  assert.deepEqual(cells.map(cell => cell.querySelector(".station-weights__profile-hopper-id").textContent), ["A1", "A2", "B1", "B2", "C1", "C2"], "the line's hoppers, not the profile's six positions");
  // A1: line 1,000, profile 1,000 - unchanged. A2: 500 = 500. B1: 1,100 -> 1,100. B2: — -> 500. C1: — -> 1,200.
  assert.deepEqual(cells.map(cell => cell.getAttribute("data-changed")), ["false", "false", "false", "true", "true", "true"]);
  assert.equal(cells[3].querySelector(".station-weights__profile-from").textContent, "—");
  assert.equal(cells[3].querySelector(".station-weights__profile-to").textContent, "500");
  assert.equal(cells[4].querySelector(".station-weights__profile-to").textContent, "1,200");
  assert.match(textIn(detail), /positions not on this line are stored/);
  assert.equal(byAction(h.root, "load").disabled, false);
  assert.equal(byAction(h.root, "load").classList.contains("is-primary"), true);
  assert.deepEqual(h.env.calls, []);
  assert.deepEqual(h.commands.calls, []);
  // Selecting again deselects.
  click(rows(h.root)[0]);
  assert.equal(h.page.getState().selectedId, null);
});

test("a profile for another line type cannot be loaded and says so; one with geometry says the heights will change too", () => {
  const h = build();
  h.page.select("p-5");
  const compat = h.root.querySelector(".station-weights__compat[data-kind='incompatible']");
  assert.match(compat.textContent, /for a 5-layer line; this line runs 3/);
  assert.equal(byAction(h.root, "load").disabled, true);
  assert.equal(byAction(h.root, "update").disabled, false, "it can still be replaced with this line's weights");
  h.page.select("p-geo");
  assert.equal(h.root.querySelector(".station-weights__compat[data-kind='incompatible']"), null);
  assert.match(h.root.querySelector(".station-weights__compat[data-kind='geometry']").textContent, /also carries hopper geometry/);
  assert.equal(byAction(h.root, "load").disabled, false);
  // Pure: the same reading without a page.
  assert.equal(weightsModule.compatibility({ lineType: 3, layers: [{ name: "A" }, { name: "B" }, { name: "C" }] }, lineFor()).ok, true);
  assert.match(weightsModule.compatibility({ lineType: 3, layers: [{ name: "A" }, { name: "B" }, { name: "D" }] }, lineFor()).message, /layers \(A, B, D\) are not this line's \(A, B, C\)/);
  assert.equal(weightsModule.compatibility({ lineType: 3, layers: [] }, null).ok, false);
});

test("Load asks first, in the floor UI's own words - with the geometry warning when it applies - and then is one loadWeightProfile by id", async () => {
  const h = build();
  h.page.select("p-1");
  click(byAction(h.root, "load"));
  assert.deepEqual(h.page.getState().confirm, { kind: "load", id: "p-1" });
  const confirm = h.root.querySelector(".station-weights__confirm");
  assert.equal(confirm.getAttribute("data-kind"), "load");
  assert.equal(confirm.querySelector(".station-weights__confirm-text").textContent, `Standard weights. ${weightsModule.LOAD_TEXT}`);
  assert.match(weightsModule.LOAD_TEXT, /change receiver hopper weights only/);
  assert.match(weightsModule.LOAD_TEXT, /will not change line type, layer percentages, resin assignments, hopper blend percentages, tracking, pump-off state, timeline\/runtime state, workspace, or RT Sync state/);
  assert.equal(byAction(h.root, "confirm").textContent, "Load Weights");
  assert.deepEqual(h.env.calls, [], "asking is not loading");
  // Cancel asks for nothing.
  click(byAction(h.root, "cancel-confirm"));
  assert.equal(h.page.getState().confirm, null);
  assert.deepEqual(h.env.calls, []);
  // Confirmed: one request, by id; the note says it took.
  click(byAction(h.root, "load"));
  click(byAction(h.root, "confirm"));
  await tick();
  assert.deepEqual(h.env.calls, [["loadWeightProfile", "p-1"]]);
  assert.equal(h.page.getState().confirm, null);
  assert.match(noteOf(h.root).textContent, /Loaded “Standard weights”/);
  assert.equal(noteOf(h.root).getAttribute("data-kind"), "ok");
  assert.deepEqual(h.commands.calls, [], "a load is the application's apply, not a command");
  // With geometry, the warning is in the question.
  h.page.select("p-geo");
  click(byAction(h.root, "load"));
  assert.equal(h.root.querySelector(".station-weights__confirm-text").textContent, `Measured. ${weightsModule.LOAD_TEXT} ${weightsModule.GEOMETRY_TEXT}`);
  // Escape in the question closes it, and does not reach the Handbook.
  const escape = key(byAction(h.root, "confirm"), "Escape");
  assert.equal(escape.stopped, true);
  assert.equal(h.page.getState().confirm, null);
});

test("a refused load is said and changes nothing here", async () => {
  const h = build({ env: producer({ loadWeightProfile: async () => ({ ok: false, code: "incompatible", message: "Receiver Weight Profile is incompatible with the current line type or physical layer layout." }) }) });
  h.page.select("p-1");
  click(byAction(h.root, "load"));
  click(byAction(h.root, "confirm"));
  await tick();
  assert.match(noteOf(h.root).textContent, /incompatible with the current line type/);
  assert.equal(noteOf(h.root).getAttribute("data-kind"), "error");
  assert.equal(h.page.getState().selectedId, "p-1");
});

test("Save Current Weights asks for a name in place and is one saveCurrentWeights; a duplicate offers Replace existing, by the colliding profile's id", async () => {
  const h = build();
  assert.ok(hidden(h.root.querySelector(".station-weights__entry")));
  click(byAction(h.root, "save-current"));
  assert.deepEqual(h.page.getState().entry, { mode: "save", id: null });
  assert.ok(!hidden(h.root.querySelector(".station-weights__entry")));
  assert.equal(h.root.querySelector(".station-weights__entry-label").textContent, "Save the line's receiver weights as");
  const name = h.root.querySelector(".station-weights__name");
  assert.ok(focused === name);
  // Blank is refused here.
  key(name, "Enter");
  await tick();
  assert.deepEqual(h.env.calls, []);
  assert.equal(name.getAttribute("aria-invalid"), "true");
  // A duplicate: the service says so; Replace existing appears, by id.
  typeInto(name, "  standard   WEIGHTS ");
  key(name, "Enter");
  await tick();
  assert.deepEqual(h.env.calls, [["saveCurrentWeights", "standard WEIGHTS"]]);
  assert.deepEqual(h.page.getState().duplicate, { name: "standard WEIGHTS", id: "p-1" });
  assert.equal(h.page.getState().selectedId, "p-1");
  assert.ok(!hidden(byAction(h.root, "replace")));
  click(byAction(h.root, "replace"));
  await tick();
  assert.deepEqual(h.env.calls[1], ["replaceWeightProfile", "p-1"]);
  assert.equal(h.page.getState().entry, null);
  assert.match(noteOf(h.root).textContent, /Replaced “standard WEIGHTS”/);
  // A new name saves and selects the new profile.
  click(byAction(h.root, "save-current"));
  typeInto(name, "Winter set");
  click(byAction(h.root, "confirm-entry"));
  await tick();
  assert.deepEqual(h.env.calls[2], ["saveCurrentWeights", "Winter set"]);
  assert.equal(h.page.getState().selectedId, "p-new");
  assert.equal(rows(h.root).length, 4);
  assert.deepEqual(h.commands.calls, []);
});

test("Update, Rename, Duplicate and Delete each go back as one request by id; the rare three wait behind More…, and Delete asks first", async () => {
  const h = build();
  h.page.select("p-1");
  assert.ok(hidden(h.root.querySelector(".station-weights__overflow")));
  // Update asks, then replaces.
  click(byAction(h.root, "update"));
  assert.deepEqual(h.page.getState().confirm, { kind: "update", id: "p-1" });
  assert.match(h.root.querySelector(".station-weights__confirm-text").textContent, /Replace “Standard weights” with this line's current weights\?/);
  click(byAction(h.root, "confirm"));
  await tick();
  assert.deepEqual(h.env.calls, [["replaceWeightProfile", "p-1"]]);
  assert.match(noteOf(h.root).textContent, /Updated “Standard weights”/);
  // More… discloses the rest.
  click(byAction(h.root, "more"));
  assert.ok(!hidden(h.root.querySelector(".station-weights__overflow")));
  assert.equal(byAction(h.root, "more").getAttribute("aria-expanded"), "true");
  assert.ok(byAction(h.root, "delete").classList.contains("is-danger"));
  // Rename: the entry, prefilled.
  click(byAction(h.root, "rename"));
  assert.deepEqual(h.page.getState().entry, { mode: "rename", id: "p-1" });
  const name = h.root.querySelector(".station-weights__name");
  assert.equal(name.value, "Standard weights");
  assert.equal(byAction(h.root, "confirm-entry").textContent, "Rename");
  typeInto(name, "Line 9 standard");
  key(name, "Enter");
  await tick();
  assert.deepEqual(h.env.calls[1], ["renameWeightProfile", "p-1", "Line 9 standard"]);
  assert.equal(rows(h.root)[0].querySelector(".station-weights__row-name").textContent, "Line 9 standard");
  assert.equal(h.page.getState().entry, null);
  // Duplicate: a copy, selected once it exists.
  click(byAction(h.root, "more"));
  click(byAction(h.root, "duplicate"));
  assert.equal(name.value, "Line 9 standard copy");
  click(byAction(h.root, "confirm-entry"));
  await tick();
  assert.deepEqual(h.env.calls[2], ["duplicateWeightProfile", "p-1", "Line 9 standard copy"]);
  assert.equal(h.page.getState().selectedId, "p-copy");
  // Delete asks, in the danger colour, then removes; the selection is dropped.
  click(byAction(h.root, "more"));
  click(byAction(h.root, "delete"));
  assert.deepEqual(h.page.getState().confirm, { kind: "delete", id: "p-copy" });
  assert.equal(h.root.querySelector(".station-weights__confirm").getAttribute("data-kind"), "delete");
  assert.ok(byAction(h.root, "confirm").classList.contains("is-danger"));
  click(byAction(h.root, "confirm"));
  await tick();
  assert.deepEqual(h.env.calls[3], ["deleteWeightProfile", "p-copy"]);
  assert.equal(h.page.getState().selectedId, null);
  assert.equal(rows(h.root).length, 3);
  assert.match(noteOf(h.root).textContent, /Deleted “Line 9 standard copy”/);
  assert.deepEqual(h.commands.calls, []);
});

test("while a request is in flight every profile control is held, and a failed refresh is said", async () => {
  let release;
  const h = build({ env: producer({ refresh: () => new Promise(resolve => { release = resolve; }) }) });
  h.page.select("p-1");
  const pending = h.page.refreshBook();
  assert.equal(h.page.getState().pending, "refresh");
  assert.equal(byAction(h.root, "save-current").disabled, true);
  assert.equal(byAction(h.root, "load").disabled, true);
  assert.equal(byAction(h.root, "refresh").disabled, true);
  release({ ok: false, code: "network_error", message: "Shared configurations could not be reached." });
  await pending;
  assert.equal(h.page.getState().pending, null);
  assert.equal(byAction(h.root, "load").disabled, false);
  assert.equal(noteOf(h.root).textContent, "Shared configurations could not be reached.");
  assert.deepEqual(h.env.calls, []);
});

test("with no producer the profiles say so and offer nothing; with no line assigned they say that", () => {
  const none = build({ env: null });
  assert.match(textIn(none.root.querySelector(".station-weights__list")), /No application is connected to Station: weight profiles are not available/);
  assert.equal(byAction(none.root, "save-current").disabled, true);
  assert.equal(none.root.querySelector(".station-weights__context").textContent, "Not connected");
  const env = producer();
  env.workspaceId = "";
  env.handle.publish();
  const unassigned = build({ env });
  assert.equal(unassigned.root.querySelector(".station-weights__context").textContent, "No line");
  assert.match(textIn(unassigned.root.querySelector(".station-weights__list")), /not on a production line/);
});

test("the page's shape: a section for the Handbook, growing, focusing Save Current Weights, with the helpers the words come from", () => {
  assert.deepEqual(Object.keys(weightsModule.section), ["id", "title", "create"]);
  assert.equal(weightsModule.section.id, "weights");
  assert.equal(weightsModule.section.title, "Weights");
  assert.ok(Object.isFrozen(weightsModule.section));
  const h = build();
  assert.equal(h.page.grows(), true);
  h.page.focus();
  assert.ok(focused === byAction(h.root, "save-current"));
  assert.equal(weightsModule.formatPounds(1250.4), "1,250");
  assert.equal(weightsModule.formatPounds(0), "—");
  assert.equal(weightsModule.rowMeta({ layers: [{}, {}, {}], updatedAt: "" }), "3 layers");
  assert.equal(weightsModule.normalizedName("  Standard   Weights "), "standard weights");
  // No action name the Handbook's mode tests forbid, and no word of the mode.
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "station/station-weights.js"), "utf8");
  assert.doesNotMatch(source, /blend-edit|edit-all|show-all|"done"|Blend Edit/);
});
