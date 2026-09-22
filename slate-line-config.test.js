"use strict";

/* slate-line-config.js: what each line IS, for an administrator. The
 * derivation of the layer roles, the draft the editor holds, the
 * validation made before anything is asked, and the one save each change
 * amounts to - pinned by name and arguments. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key } = require("./tools/slate-test/fake-dom.js");
const lines = require("./slate/slate-line-config.js");
const actions = require("./slate/slate-admin-actions.js");
const identity = require("./line-identity.js");
const bridge = require("./station-admin-bridge.js");

const LINES = [
  { id: "l-5", lineNumber: 5, displayName: "Line 5", aliases: ["Five"], layerCount: 3, hopperCounts: [6, 4, 6], layerAPosition: "outside", hopperGeometry: "cylindrical", hopperNamingMode: "standard", hopperManufacturer: "plast-control", isActive: true, metadata: {}, updatedAt: "2026-09-01T10:00:00.000Z" },
  { id: "l-8", lineNumber: 8, displayName: "Line 8", aliases: [], layerCount: 5, hopperCounts: [6, 6, 6, 6, 6], layerAPosition: "inside", hopperGeometry: "volume", hopperNamingMode: "main-plus-five", hopperManufacturer: "tsm", isActive: false, metadata: { note: "kept" }, updatedAt: "" }
];

function makeAdmin(options) {
  const settings = options || {};
  const calls = [];
  const listeners = new Set();
  let stored = (settings.lines || LINES).map(one => Object.assign({}, one));
  const held = [];
  let state = Object.assign({ ready: true, signedIn: true, isAdmin: true, email: "ada@example.com" }, settings.state || {});
  let access = bridge.project(state, { ready: true, userId: "user-1234abcd", deviceId: "dev-5678efgh", deviceLabel: "This browser" });
  function publish() { access = bridge.project(state, { ready: true, userId: "user-1234abcd", deviceId: "dev-5678efgh", deviceLabel: "This browser" }); for (const listener of listeners) listener(access); }
  return {
    calls,
    isConnected: () => settings.connected !== false,
    capabilities: () => (settings.capabilities || [...bridge.ACTIONS]).slice(),
    getAccess: () => access,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { state = Object.assign({}, state, next); publish(); },
    // An action named in `hold` waits here until release() is called, so a
    // test can act while the request is genuinely in flight.
    release() { const waiting = held.slice(); held.length = 0; for (const resolve of waiting) resolve(); },
    async request(action, args) {
      calls.push({ action, args });
      const produce = () => {
        if (typeof settings.answer === "function") {
          const answered = settings.answer(action, args);
          if (answered !== undefined) return answered;
        }
        if (action === "listLineConfigurations") return { ok: true, lines: stored.map(one => Object.assign({}, one)) };
        if (action === "saveLineConfiguration") {
          // As the service does: the definition is stored and answered with.
          const saved = Object.assign({ updatedAt: "2026-09-22T10:00:00.000Z" }, args.line, { id: args.id || "l-new" });
          stored = stored.filter(one => one.id !== saved.id).concat([saved]);
          return { ok: true, line: saved };
        }
        return { ok: true };
      };
      if (settings.hold === action) return new Promise(resolve => held.push(() => resolve(produce())));
      return produce();
    }
  };
}

/* A connection bridge that says which line this device follows. */
function makeConnection(lineNumber) {
  const listeners = new Set();
  let number = lineNumber;
  return {
    getStatus: () => (number === null ? { linked: false, line: null } : { linked: true, line: { lineNumber: number } }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { number = next; for (const listener of listeners) listener(); }
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); };

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const admin = "admin" in settings ? settings.admin : makeAdmin(settings.adminOptions);
  const connection = "connection" in settings ? settings.connection : makeConnection(5);
  const said = [];
  const view = lines.create(doc, { admin, connection, lineIdentity: identity, say: message => said.push(message) });
  doc.body.appendChild(view.element);
  const el = view.element;
  return {
    doc, admin, connection, said, view, el,
    q: selector => el.querySelector(selector),
    rows: () => el.querySelectorAll("[data-line]"),
    row: id => el.querySelector(`[data-line='${id}']`),
    action: name => el.querySelector(`[data-action='${name}']`),
    field: name => el.querySelector(`[data-field='${name}']`),
    chip: (field, value) => el.querySelector(`[data-choice='${field}'][data-value='${value}']`),
    note: () => el.querySelector(".slate-book__note"),
    type(name, value) { const input = el.querySelector(`[data-field='${name}']`); input.value = value; input.dispatchEvent({ type: "input", target: input }); return input; },
    async open() { view.onShow(); await settle(); }
  };
}

/* ----------------------------------------------------------------------
 *   What a line is made of
 * -------------------------------------------------------------------- */

test("the layers are always listed A first, and every role follows from Layer A's side", () => {
  assert.deepEqual(lines.layerRows(5, "outside").map(row => `${row.id}:${row.roleLabel}`),
    ["A:Outside", "B:Outside subskin", "C:Core", "D:Inside subskin", "E:Inside"]);
  // The same line with A inside: the letters do not move, the roles reverse.
  assert.deepEqual(lines.layerRows(5, "inside").map(row => `${row.id}:${row.roleLabel}`),
    ["A:Inside", "B:Inside subskin", "C:Core", "D:Outside subskin", "E:Outside"]);
  assert.deepEqual(lines.layerRows(3, "outside").map(row => row.roleLabel), ["Outside", "Core", "Inside"]);
  assert.deepEqual(lines.layerRows(1, null).map(row => `${row.id}:${row.roleLabel}`), ["A:Single layer"]);
  // Only the two ends may be given a side.
  assert.deepEqual(lines.layerRows(5, "outside").map(row => row.end), [true, false, false, false, true]);
  assert.equal(lines.layerRows(1, null)[0].end, false);
  // With no orientation the rows say so rather than guessing.
  assert.deepEqual(lines.layerRows(3, null).map(row => row.roleLabel), ["Choose a side", "Choose a side", "Choose a side"]);
  assert.deepEqual(lines.layerRows(0, "outside"), []);
});

test("a side chosen on either end names the same one fact, whichever end it was chosen on", () => {
  assert.equal(lines.sideOfRow(0, 3, "outside"), "outside");
  assert.equal(lines.sideOfRow(2, 3, "outside"), "inside");
  assert.equal(lines.sideOfRow(0, 3, null), null);
  // A's row sets A's side; the far end's sets its opposite.
  assert.equal(lines.layerAPositionFor(0, "inside"), "inside");
  assert.equal(lines.layerAPositionFor(2, "inside"), "outside");
});

test("the hopper ids follow the count and the naming mode; a count still being typed reads as a question", () => {
  assert.equal(lines.hopperRange("A", "standard", 6), "A1–A6");
  assert.equal(lines.hopperRange("B", "standard", 1), "B1");
  assert.equal(lines.hopperRange("A", "main-plus-five", 6), "AM, A1–A5");
  assert.equal(lines.hopperRange("A", "main-plus-five", 2), "AM, A1");
  assert.equal(lines.hopperRange("A", "main-plus-five", 1), "AM");
  assert.equal(lines.hopperRange("A", "standard", ""), "A?");
  assert.equal(lines.hopperSummary(3, "standard", ["6", "4", "6"]), "A1–A6 · B1–B4 · C1–C6");
  // A count not given yet is six; a dropped layer's count goes with it.
  assert.deepEqual(lines.hopperCountsFor(3, ["4"]), ["4", "6", "6"]);
  assert.deepEqual(lines.hopperCountsFor(1, ["4", "5", "6"]), ["4"]);
  assert.deepEqual(lines.hopperCountsFor(0, ["4"]), []);
  // The offered counts are the three, plus the line's own when it is another.
  assert.deepEqual(lines.layerCountChoices(3), [1, 3, 5]);
  assert.deepEqual(lines.layerCountChoices(7), [1, 3, 5, 7]);
});

test("the draft and the definition: what the editor holds, and the shape the application takes", () => {
  const draft = lines.draftOf(LINES[0]);
  assert.equal(draft.lineNumber, "5");
  assert.equal(draft.aliases, "Five");
  assert.deepEqual(draft.hopperCounts, ["6", "4", "6"]);
  const definition = lines.definitionOf(draft);
  assert.equal(definition.lineNumber, 5);
  assert.deepEqual(definition.aliases, ["Five"]);
  assert.deepEqual(definition.hopperCounts, [6, 4, 6]);
  assert.equal(definition.metadata, LINES[0].metadata, "the metadata was not carried back untouched");

  // A new line starts three layers, A outside, six hoppers each.
  const fresh = lines.definitionOf(lines.draftOf(null));
  assert.equal(fresh.id, null);
  assert.ok(Number.isNaN(fresh.lineNumber));
  assert.deepEqual(fresh.hopperCounts, [6, 6, 6]);
  assert.equal(fresh.layerAPosition, "outside");
  assert.equal(fresh.hopperManufacturer, "plast-control");

  // Aliases split on commas and newlines, blanks dropped; a single layer
  // has no side whatever the draft last held.
  const typed = lines.definitionOf(Object.assign(lines.draftOf(null), { aliases: " Five , ,\nCinq ", layerCount: 1, layerAPosition: "inside", displayName: "  Line   9 " }));
  assert.deepEqual(typed.aliases, ["Five", "Cinq"]);
  assert.equal(typed.layerAPosition, null);
  assert.equal(typed.displayName, "Line 9");
  assert.equal(lines.sameDefinition(lines.draftOf(LINES[0]), lines.draftOf(LINES[0])), true);
  assert.equal(lines.sameDefinition(lines.draftOf(LINES[0]), lines.draftOf(LINES[1])), false);
});

test("the definition is checked by the application's own rules before anything is asked", () => {
  const base = lines.definitionOf(Object.assign(lines.draftOf(null), { lineNumber: "9", displayName: "Line 9" }));
  assert.equal(lines.validateDefinition(identity, base, []).valid, true);
  // Against the others: a number, and an active name, belong to one line.
  const clash = lines.definitionOf(Object.assign(lines.draftOf(null), { lineNumber: "5", displayName: "Nine" }));
  assert.match(lines.validateDefinition(identity, clash, [LINES[0]]).message, /defined more than once/);
  const nameClash = lines.definitionOf(Object.assign(lines.draftOf(null), { lineNumber: "9", displayName: "Line 5" }));
  assert.match(lines.validateDefinition(identity, nameClash, [LINES[0]]).message, /belongs to more than one active line/);
  const noName = lines.definitionOf(Object.assign(lines.draftOf(null), { lineNumber: "9", displayName: "" }));
  assert.match(lines.validateDefinition(identity, noName, []).message, /Display name is required/);
  const tooMany = lines.definitionOf(Object.assign(lines.draftOf(null), { lineNumber: "9", displayName: "Line 9", hopperCounts: ["9", "6", "6"] }));
  assert.match(lines.validateDefinition(identity, tooMany, []).message, /Hoppers per layer/);
  // With no module to ask, the application is left to decide alone.
  assert.deepEqual(lines.validateDefinition(null, noName, []), { valid: true });
  assert.deepEqual(lines.validateDefinition({}, noName, []), { valid: true });
});

test("the words a line's row and its summary carry, and the confirmations", () => {
  assert.equal(lines.rowMeta(LINES[0]), "3 layers · A Outside · Cylindrical · Standard");
  assert.equal(lines.rowMeta(LINES[1]), "5 layers · A Inside · Volume · Main + 1–5 · TSM · Inactive",
    "the manufacturer or the inactive mark went missing");
  assert.equal(lines.detailMeta(LINES[0]), "Line number 5 · Updated Sep 1, 2026 · Also Five");
  assert.equal(lines.detailMeta(LINES[1]), "Line number 8");
  assert.match(lines.deactivateLines(LINES[0])[0], /^Deactivate Line 5\? Structured workspace identities will still resolve/);
  assert.match(lines.reactivateLines(LINES[0])[0], /match this line again/);
  assert.match(lines.discardLines(LINES[0])[0], /The line stays as it was last saved/);
});

/* ----------------------------------------------------------------------
 *   Reading and choosing
 * -------------------------------------------------------------------- */

test("nothing is read without an administrator or before the section is shown; the lines come back in line order", async () => {
  const admin = makeAdmin({ state: { signedIn: false, isAdmin: false } });
  const view = boot({ admin });
  await settle();
  assert.deepEqual(admin.calls, []);
  assert.ok(!view.q(".slate-admin__gate").hasAttribute("hidden"));
  admin.set({ signedIn: true, isAdmin: true });
  await settle();
  assert.deepEqual(admin.calls, [], "the section read while it was hidden");
  await view.open();
  assert.deepEqual(admin.calls.map(call => call.action), ["listLineConfigurations"]);
  assert.deepEqual(view.rows().map(row => row.getAttribute("data-line")), ["l-5", "l-8"]);
  assert.equal(view.rows()[0].querySelector(".slate-book__row-meta").textContent, "3 layers · A Outside · Cylindrical · Standard");
  assert.ok(view.rows()[1].classList.contains("is-inactive"));
  assert.equal(view.note().textContent, "2 lines loaded.");
  // The line this device follows is marked, and named in the bar.
  assert.ok(view.rows()[0].classList.contains("is-connected"));
  assert.equal(view.q(".slate-section__subtitle").textContent, "This device is on Line 5");
});

test("the bar and the mark follow the connection without reading the list again", async () => {
  const view = boot();
  await view.open();
  const before = view.admin.calls.length;
  view.connection.set(8);
  await settle();
  assert.equal(view.admin.calls.length, before, "the connection moving read the lines again");
  assert.equal(view.q(".slate-section__subtitle").textContent, "This device is on Line 8");
  assert.ok(view.row("l-8").classList.contains("is-connected"));
  assert.ok(!view.row("l-5").classList.contains("is-connected"));
  view.connection.set(null);
  await settle();
  assert.equal(view.q(".slate-section__subtitle").textContent, "This device is on no line");
});

test("choosing a line fills the editor from it: the fields, the layer rows, the hopper ids", async () => {
  const view = boot();
  await view.open();
  click(view.row("l-5"));
  await settle();
  assert.equal(view.q(".slate-book__detail-name").textContent, "Line 5");
  assert.equal(view.field("lineNumber").value, "5");
  assert.equal(view.field("displayName").value, "Line 5");
  assert.equal(view.field("aliases").value, "Five");
  assert.equal(view.q("[data-tag='current']").textContent, "Current line");
  assert.equal(view.view.getState().dirty, false);
  const layers = view.el.querySelectorAll(".slate-lines__layer");
  assert.deepEqual(layers.map(row => row.getAttribute("data-layer")), ["A", "B", "C"]);
  assert.deepEqual(layers.map(row => row.querySelector("[data-role='hopper-count']").value), ["6", "4", "6"]);
  // The ends offer a side; the middle reads its role.
  assert.ok(layers[0].querySelector("[data-choice='side:0']"));
  assert.ok(layers[2].querySelector("[data-choice='side:2']"));
  assert.equal(layers[1].querySelector("[data-choice='side:1']"), null);
  assert.equal(layers[0].querySelector("[data-value='outside']").getAttribute("aria-checked"), "true");
  assert.equal(layers[2].querySelector("[data-value='inside']").getAttribute("aria-checked"), "true", "the far end did not read the opposite side");
  assert.equal(layers[1].querySelector(".slate-lines__layer-role").textContent, "Core");
  assert.equal(view.q("[data-role='hoppers']").textContent, "A1–A6 · B1–B4 · C1–C6");
  assert.equal(view.chip("hopperGeometry", "cylindrical").getAttribute("aria-checked"), "true");
  assert.equal(view.chip("hopperManufacturer", "tsm").getAttribute("aria-checked"), "false");
  // Save and Discard are withheld until something changes.
  assert.equal(view.action("save").getAttribute("data-able"), "false");
  assert.match(view.action("save").getAttribute("title"), /nothing has changed/);
});

/* ----------------------------------------------------------------------
 *   Editing
 * -------------------------------------------------------------------- */

test("a chip redraws what follows from it: the layer count resizes the rows, a side flips every role", async () => {
  const view = boot();
  await view.open();
  click(view.row("l-5"));
  await settle();
  click(view.chip("layerCount", "5"));
  const layers = view.el.querySelectorAll(".slate-lines__layer");
  assert.deepEqual(layers.map(row => row.getAttribute("data-layer")), ["A", "B", "C", "D", "E"]);
  // What was typed is kept; the new layers start at six.
  assert.deepEqual(layers.map(row => row.querySelector("[data-role='hopper-count']").value), ["6", "4", "6", "6", "6"]);
  assert.equal(view.view.getState().dirty, true);
  assert.ok(view.q("[data-tag='dirty']"), "the unsaved mark did not appear");
  assert.equal(view.action("save").getAttribute("data-able"), "true");

  // The far end's side sets Layer A's opposite.
  click(view.el.querySelectorAll(".slate-lines__layer")[4].querySelector("[data-value='outside']"));
  assert.equal(view.view.getState().draft.layerAPosition, "inside");
  assert.deepEqual(view.el.querySelectorAll(".slate-lines__layer-role").map(node => node.textContent), ["Inside subskin", "Core", "Outside subskin"]);

  // One layer: no side at all - a single-layer line has none to hold.
  click(view.chip("layerCount", "1"));
  assert.equal(view.view.getState().draft.layerAPosition, null);
  assert.equal(view.el.querySelectorAll(".slate-lines__layer").length, 1);
  assert.equal(view.el.querySelector(".slate-lines__layer-role").textContent, "Single layer");
  // And back: a multilayer line needs one, and with the old one forgotten
  // at a single layer it starts from Outside rather than from nothing.
  click(view.chip("layerCount", "3"));
  assert.equal(view.view.getState().draft.layerAPosition, "outside");
  assert.deepEqual(view.el.querySelectorAll(".slate-lines__layer-role").map(node => node.textContent), ["Core"]);
});

test("a typed field is never redrawn under the operator: the hopper ids and the unsaved mark follow in place", async () => {
  const view = boot();
  await view.open();
  click(view.row("l-5"));
  await settle();
  const countInput = view.el.querySelectorAll("[data-role='hopper-count']")[1];
  const before = countInput;
  countInput.value = "2";
  countInput.dispatchEvent({ type: "input", target: countInput });
  assert.ok(view.el.querySelectorAll("[data-role='hopper-count']")[1] === before, "the field was replaced while it was being typed into");
  assert.equal(view.q("[data-role='hoppers']").textContent, "A1–A6 · B1–B2 · C1–C6");
  assert.deepEqual(view.view.getState().draft.hopperCounts, [6, 2, 6]);
  assert.ok(view.q("[data-tag='dirty']"));
  // One digit: the last typed wins, so typing over needs no deleting.
  countInput.value = "25";
  countInput.dispatchEvent({ type: "input", target: countInput });
  assert.equal(countInput.value, "5");
  assert.deepEqual(view.view.getState().draft.hopperCounts, [6, 5, 6]);
  // The line number takes digits only.
  const number = view.type("lineNumber", "5a2");
  assert.equal(view.view.getState().draft.lineNumber, 52);
  assert.ok(number === view.field("lineNumber"));
});

test("a new line takes its name from its number until it is given one, and stands in the list while it is typed", async () => {
  const view = boot();
  await view.open();
  click(view.action("add-line"));
  assert.equal(view.view.getState().focusId, "new");
  assert.equal(view.q(".slate-book__detail-name").textContent, "New Line");
  assert.equal(view.row("new").querySelector(".slate-book__row-name").textContent, "New line");
  assert.match(view.q(".slate-admin__detail-meta").textContent, /Creating its RT Sync workspace is Workspaces' Create Line/);
  view.type("lineNumber", "9");
  assert.equal(view.field("displayName").value, "Line 9");
  assert.equal(view.row("new").querySelector(".slate-book__row-name").textContent, "Line 9");
  // A name of its own is kept, and the number stops writing over it.
  view.type("displayName", "Blown 9");
  view.type("lineNumber", "10");
  assert.equal(view.field("displayName").value, "Blown 9");
  // Cancel drops it entirely.
  click(view.action("discard"));
  assert.equal(view.view.getState().focusId, null);
  assert.equal(view.row("new"), null);
});

test("moving away with unsaved changes asks first; discarding puts the line back as it was saved", async () => {
  const view = boot();
  await view.open();
  click(view.row("l-5"));
  await settle();
  view.type("displayName", "Line Five");
  assert.equal(view.view.getState().dirty, true);
  click(view.row("l-8"));
  assert.deepEqual(view.view.getState().view, { kind: "confirm", action: "discard" });
  assert.match(view.q(".slate-admin__confirm-line").textContent, /Discard the unsaved changes to Line 5\?/);
  assert.equal(view.view.getState().focusId, "l-5", "the line moved before the question was answered");
  click(view.action("cancel-view"));
  assert.equal(view.view.getState().focusId, "l-5");
  assert.equal(view.view.getState().dirty, true);
  click(view.row("l-8"));
  click(view.action("confirm-view"));
  await settle();
  assert.equal(view.view.getState().focusId, "l-8");
  assert.equal(view.view.getState().dirty, false);

  // Discard on the line itself: the fields read as saved again.
  click(view.row("l-5"));
  await settle();
  view.type("displayName", "Something else");
  click(view.action("discard"));
  assert.equal(view.field("displayName").value, "Line 5");
  assert.equal(view.view.getState().dirty, false);
});

/* ----------------------------------------------------------------------
 *   Saving
 * -------------------------------------------------------------------- */

test("a definition that breaks the application's rules is refused here, says which field, and is never sent", async () => {
  const view = boot();
  await view.open();
  click(view.row("l-5"));
  await settle();
  const before = view.admin.calls.length;
  view.type("displayName", "");
  click(view.action("save"));
  await settle();
  assert.equal(view.admin.calls.length, before, "an invalid definition was sent");
  assert.match(view.note().textContent, /Display name is required/);
  assert.ok(view.note().classList.contains("is-error"));
  assert.equal(view.field("displayName").getAttribute("aria-invalid"), "true");
  assert.equal(view.field("lineNumber").getAttribute("aria-invalid"), null);

  // A count out of range marks every count that breaks the one rule.
  view.type("displayName", "Line 5");
  const counts = view.el.querySelectorAll("[data-role='hopper-count']");
  counts[0].value = "9";
  counts[0].dispatchEvent({ type: "input", target: counts[0] });
  click(view.action("save"));
  await settle();
  assert.equal(view.admin.calls.length, before);
  assert.match(view.note().textContent, /Hoppers per layer/);
  assert.equal(view.el.querySelectorAll("[data-role='hopper-count']")[0].getAttribute("aria-invalid"), "true");
  assert.equal(view.el.querySelectorAll("[data-role='hopper-count']")[1].getAttribute("aria-invalid"), null);
});

test("a save sends one saveLineConfiguration carrying the whole definition, then reads the list again", async () => {
  const view = boot();
  await view.open();
  click(view.row("l-5"));
  await settle();
  const before = view.admin.calls.length;
  view.type("aliases", "Five, Cinq");
  click(view.chip("hopperManufacturer", "tsm"));
  click(view.action("save"));
  await settle();
  const sent = view.admin.calls[before];
  assert.equal(sent.action, "saveLineConfiguration");
  assert.equal(sent.args.id, "l-5");
  assert.deepEqual(sent.args.line.aliases, ["Five", "Cinq"]);
  assert.equal(sent.args.line.hopperManufacturer, "tsm");
  assert.deepEqual(sent.args.line.hopperCounts, [6, 4, 6]);
  assert.deepEqual(sent.args.line.metadata, {}, "the metadata was not carried back");
  assert.deepEqual(view.admin.calls.slice(before + 1).map(call => call.action), ["listLineConfigurations"]);
  assert.match(view.note().textContent, /^Line 5 saved\. This device follows it now; other devices on the line use it when they next reload\.$/);
  assert.equal(view.view.getState().dirty, false, "the editor stayed dirty after a save");
  // And the contract takes the definition exactly as sent.
  const normalized = bridge.normalizeArguments("saveLineConfiguration", sent.args);
  assert.ok(!normalized.error, normalized.error && normalized.error.message);
});

test("Enter in a field saves when there is something to save, and does nothing when there is not", async () => {
  const view = boot();
  await view.open();
  click(view.row("l-5"));
  await settle();
  const before = view.admin.calls.length;
  key(view.field("displayName"), "Enter");
  await settle();
  assert.equal(view.admin.calls.length, before, "Enter saved an unchanged line");
  view.type("displayName", "Line Five");
  key(view.field("displayName"), "Enter");
  await settle();
  assert.equal(view.admin.calls[before].action, "saveLineConfiguration");
  assert.equal(view.admin.calls[before].args.line.displayName, "Line Five");
});

test("adding a line sends it with no id, and the line the application answers with becomes the chosen one", async () => {
  const view = boot();
  await view.open();
  const before = view.admin.calls.length;
  click(view.action("add-line"));
  view.type("lineNumber", "9");
  click(view.action("save"));
  await settle();
  const sent = view.admin.calls[before];
  assert.equal(sent.args.id, "", "a new line was sent with an id");
  assert.equal(sent.args.line.lineNumber, 9);
  assert.equal(sent.args.line.displayName, "Line 9");
  assert.equal(view.view.getState().focusId, "l-new");
  assert.equal(view.view.getState().dirty, false);
});

test("a row click while a save is in flight is refused, so the saved line cannot land on another one chosen meanwhile", async () => {
  const admin = makeAdmin({ hold: "saveLineConfiguration" });
  const view = boot({ admin });
  await view.open();
  click(view.row("l-5"));
  await settle();
  view.type("displayName", "Line Five");
  click(view.action("save"));
  await tick();
  assert.equal(view.view.getState().pending, "saveLineConfiguration");

  click(view.row("l-8"));
  await tick();
  assert.equal(view.view.getState().focusId, "l-5", "a row click during a save moved the chosen line");

  admin.release();
  await settle();
  // The answer landed on the line it was asked for, not on another.
  assert.equal(view.view.getState().focusId, "l-5");
  assert.equal(view.view.getState().dirty, false);
  click(view.row("l-8"));
  await settle();
  assert.equal(view.view.getState().focusId, "l-8");
});

test("a refused save keeps the draft as it was typed and marks what the application named", async () => {
  const admin = makeAdmin({ answer: action => (action === "saveLineConfiguration" ? { ok: false, code: "failed", message: "Line number must be between 1 and 999." } : undefined) });
  const view = boot({ admin });
  await view.open();
  click(view.row("l-5"));
  await settle();
  view.type("displayName", "Line Five");
  click(view.action("save"));
  await settle();
  assert.equal(view.note().textContent, "Line number must be between 1 and 999.");
  assert.equal(view.field("displayName").value, "Line Five", "the draft was thrown away on a refusal");
  assert.equal(view.view.getState().dirty, true);
  assert.equal(view.field("lineNumber").getAttribute("aria-invalid"), "true");
});

/* ----------------------------------------------------------------------
 *   Maintenance, and the session
 * -------------------------------------------------------------------- */

test("deactivate and reactivate are one save with one field turned, asked first and withheld while the draft is dirty", async () => {
  const view = boot();
  await view.open();
  click(view.row("l-5"));
  await settle();
  click(view.action("toggle-maintenance"));
  const before = view.admin.calls.length;
  click(view.action("deactivate"));
  assert.deepEqual(view.view.getState().view, { kind: "confirm", action: "deactivate" });
  assert.match(view.q(".slate-admin__confirm-line").textContent, /^Deactivate Line 5\?/);
  assert.equal(view.q(".slate-book__confirm").getAttribute("data-kind"), "delete");
  click(view.action("confirm-view"));
  await settle();
  assert.equal(view.admin.calls[before].action, "saveLineConfiguration");
  assert.equal(view.admin.calls[before].args.line.isActive, false);
  assert.equal(view.admin.calls[before].args.line.displayName, "Line 5", "the rest of the definition was not carried");
  assert.equal(view.note().textContent, "Line 5 deactivated.");

  // An inactive line offers the other way round, and it is not dangerous.
  click(view.row("l-8"));
  await settle();
  click(view.action("toggle-maintenance"));
  assert.ok(view.action("reactivate"));
  click(view.action("reactivate"));
  assert.equal(view.q(".slate-book__confirm").getAttribute("data-kind"), "load");
  click(view.action("cancel-view"));

  // With changes in hand it is withheld, with the reason.
  view.type("displayName", "Line Eight");
  click(view.action("toggle-maintenance"));
  const control = view.action("reactivate");
  assert.equal(control.getAttribute("data-able"), "false");
  assert.match(control.getAttribute("title"), /save or discard the changes first/);
  const after = view.admin.calls.length;
  click(control);
  assert.equal(view.view.getState().view, null);
  assert.equal(view.admin.calls.length, after);
});

test("a session that ends drops every line read under it; signing out shows the gate again", async () => {
  const admin = makeAdmin({ answer: action => (action === "saveLineConfiguration" ? { ok: false, code: "access_denied", message: "Admin access is required." } : undefined) });
  const view = boot({ admin });
  await view.open();
  click(view.row("l-5"));
  await settle();
  view.type("displayName", "Line Five");
  click(view.action("save"));
  await settle();
  assert.equal(view.view.getState().lines, 0);
  assert.equal(view.view.getState().focusId, null);
  assert.equal(view.view.getState().draft, null);
  assert.equal(view.note().textContent, actions.WORDING.accessEnded);

  const other = boot();
  await other.open();
  assert.equal(other.view.getState().lines, 2);
  other.admin.set({ signedIn: false, isAdmin: false, email: "" });
  await settle();
  assert.equal(other.view.getState().lines, 0);
  assert.ok(!other.q(".slate-admin__gate").hasAttribute("hidden"));
  assert.ok(other.q(".slate-book__columns").hasAttribute("hidden"));
});

test("leaving the section closes what was open; with no bridge it explains instead of asking", async () => {
  const view = boot();
  await view.open();
  click(view.row("l-5"));
  await settle();
  click(view.action("toggle-maintenance"));
  click(view.action("deactivate"));
  view.view.onHide();
  assert.equal(view.view.getState().view, null);
  assert.equal(view.view.getState().maintenanceOpen, false);

  const none = boot({ admin: null, connection: null });
  await none.open();
  assert.match(none.q(".slate-admin__gate").textContent, /No application is connected/);
  assert.doesNotThrow(() => none.view.refresh());
});

test("without the application's line rules nothing is checked here: the draft goes as typed and the application decides alone", async () => {
  const doc = makeDocument();
  const admin = makeAdmin();
  const said = [];
  const view = lines.create(doc, { admin, connection: null, say: message => said.push(message) });
  doc.body.appendChild(view.element);
  view.onShow();
  await settle();
  click(view.element.querySelector("[data-line='l-5']"));
  await settle();
  const name = view.element.querySelector("[data-field='displayName']");
  name.value = "";
  name.dispatchEvent({ type: "input", target: name });
  const before = admin.calls.length;
  click(view.element.querySelector("[data-action='save']"));
  await settle();
  // No local check to fail it, so it is asked - and the application's own
  // refusal is what the operator is shown.
  assert.equal(admin.calls[before].action, "saveLineConfiguration");
  assert.equal(admin.calls[before].args.line.displayName, "");
});

test("a producer that does not offer the save withholds every control that would need it", async () => {
  const admin = makeAdmin({ capabilities: ["signIn", "signOut", "listLineConfigurations"] });
  const view = boot({ admin });
  await view.open();
  assert.equal(view.action("add-line").getAttribute("data-able"), "false");
  assert.match(view.action("add-line").getAttribute("title"), /does not offer saveLineConfiguration from Slate/);
  assert.equal(view.action("refresh").getAttribute("data-able"), "true");
  const before = view.admin.calls.length;
  click(view.action("add-line"));
  assert.equal(view.view.getState().focusId, null, "a withheld control opened the editor");
  assert.equal(view.admin.calls.length, before);
  assert.match(view.said[view.said.length - 1], /unavailable: the application does not offer saveLineConfiguration/);
});
