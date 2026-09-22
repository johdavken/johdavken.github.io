"use strict";

/* slate-resin-db.js: the resin catalog, for an administrator. The record
 * the editor holds, the two things it checks on its own, and the one
 * request each change amounts to - pinned by name and arguments. Slate
 * never touches the catalog cache: that is the application's. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key } = require("./tools/slate-test/fake-dom.js");
const resins = require("./slate/slate-resin-db.js");
const actions = require("./slate/slate-admin-actions.js");
const bridge = require("./station-admin-bridge.js");

const RESINS = [
  { id: "r-1", resinCode: "HX204", densityGCm3: 0.951, bulkDensityLbFt3: 44.9, isActive: true, updatedAt: "2026-09-01T10:00:00.000Z" },
  { id: "r-2", resinCode: "LL318", densityGCm3: null, bulkDensityLbFt3: null, isActive: true, updatedAt: "" },
  { id: "r-3", resinCode: "ab120", densityGCm3: 0.92, bulkDensityLbFt3: null, isActive: false, updatedAt: "2026-05-02T10:00:00.000Z" }
];

function makeAdmin(options) {
  const settings = options || {};
  const calls = [];
  const listeners = new Set();
  let stored = (settings.resins || RESINS).map(one => Object.assign({}, one));
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
        if (action === "listResins") return { ok: true, resins: stored.map(one => Object.assign({}, one)) };
        if (action === "saveResin") {
          const saved = Object.assign({ updatedAt: "2026-09-22T10:00:00.000Z" }, args.resin, { id: args.id || "r-new" });
          stored = stored.filter(one => one.id !== saved.id).concat([saved]);
          return { ok: true, resin: saved };
        }
        if (action === "deleteResin") { stored = stored.filter(one => one.id !== args.id); return { ok: true }; }
        return { ok: true };
      };
      if (settings.hold === action) return new Promise(resolve => held.push(() => resolve(produce())));
      return produce();
    }
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); };

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const admin = "admin" in settings ? settings.admin : makeAdmin(settings.adminOptions);
  const said = [];
  const view = resins.create(doc, { admin, say: message => said.push(message) });
  doc.body.appendChild(view.element);
  const el = view.element;
  return {
    doc, admin, said, view, el,
    q: selector => el.querySelector(selector),
    rows: () => el.querySelectorAll("[data-resin]"),
    row: id => el.querySelector(`[data-resin='${id}']`),
    action: name => el.querySelector(`[data-action='${name}']`),
    field: name => el.querySelector(`[data-field='${name}']`),
    note: () => el.querySelector(".slate-book__note"),
    search: () => el.querySelector("[data-role='search']"),
    type(name, value) { const input = el.querySelector(`[data-field='${name}']`); input.value = value; input.dispatchEvent({ type: "input", target: input }); return input; },
    async open() { view.onShow(); await settle(); }
  };
}

/* ----------------------------------------------------------------------
 *   The record
 * -------------------------------------------------------------------- */

test("a record's line reads its densities with their units; unknown is blank, never zero", () => {
  assert.equal(resins.rowMeta(RESINS[0]), "0.951 g/cm³ · 44.9 lb/ft³");
  assert.equal(resins.rowMeta(RESINS[1]), "No densities recorded");
  assert.equal(resins.rowMeta(RESINS[2]), "0.92 g/cm³ · Inactive");
  assert.equal(resins.densityText(0, "g/cm³"), "0 g/cm³", "a real zero is a number, not unknown");
  assert.equal(resins.densityText(null, "g/cm³"), "");
  assert.match(resins.detailMeta(RESINS[0]), /^Updated /);
  assert.equal(resins.detailMeta(RESINS[1]), "A catalog record");
});

test("the draft holds the densities as text so nothing is rounded under the operator; blank goes back as unknown", () => {
  const draft = resins.draftOf(RESINS[0]);
  assert.deepEqual(draft, { id: "r-1", resinCode: "HX204", densityGCm3: "0.951", bulkDensityLbFt3: "44.9", isActive: true });
  assert.deepEqual(resins.draftOf(RESINS[1]), { id: "r-2", resinCode: "LL318", densityGCm3: "", bulkDensityLbFt3: "", isActive: true });
  assert.deepEqual(resins.draftOf(null), { id: "", resinCode: "", densityGCm3: "", bulkDensityLbFt3: "", isActive: true });

  assert.deepEqual(resins.valuesOf(draft), { id: "r-1", resinCode: "HX204", densityGCm3: 0.951, bulkDensityLbFt3: 44.9, isActive: true });
  // A blank is unknown; something that is not a number goes as NaN, for
  // the application to refuse by name rather than quietly becoming blank.
  const typed = resins.valuesOf(Object.assign(resins.draftOf(null), { resinCode: " NEW ", densityGCm3: "", bulkDensityLbFt3: "heavy" }));
  assert.equal(typed.resinCode, "NEW");
  assert.equal(typed.densityGCm3, null);
  assert.ok(Number.isNaN(typed.bulkDensityLbFt3));
  assert.equal(typed.id, null);
  assert.equal(resins.parseNumberField("  "), null);
  assert.equal(resins.parseNumberField(" 0.951 "), 0.951);
});

test("two drafts are compared as typed, so a field holding something that is not a number still reads as a change", () => {
  const base = resins.draftOf(RESINS[0]);
  assert.equal(resins.sameDraft(base, resins.draftOf(RESINS[0])), true);
  assert.equal(resins.sameDraft(base, Object.assign({}, base, { densityGCm3: "0.9510" })), false);
  assert.equal(resins.sameDraft(base, Object.assign({}, base, { densityGCm3: " 0.951 " })), true, "whitespace alone read as a change");
  assert.equal(resins.sameDraft(base, Object.assign({}, base, { isActive: false })), false);
  assert.equal(resins.sameDraft(null, null), true);
  assert.equal(resins.sameDraft(base, null), false);
});

test("a code belongs to one record, whatever its case; a record is never its own duplicate", () => {
  assert.equal(resins.duplicateCode(RESINS, "hx204", null), true);
  assert.equal(resins.duplicateCode(RESINS, " HX204 ", "r-1"), false);
  assert.equal(resins.duplicateCode(RESINS, "NEW", null), false);
  assert.equal(resins.duplicateCode(RESINS, "", null), false);
  assert.equal(resins.duplicateCode(null, "HX204", null), false);
});

test("the list is in code order whatever the answer's order, and the search matches codes without regard to case", () => {
  assert.deepEqual(resins.sortResins(RESINS).map(resin => resin.resinCode), ["ab120", "HX204", "LL318"]);
  assert.deepEqual(resins.filterResins(RESINS, "ll").map(resin => resin.resinCode), ["LL318"]);
  assert.deepEqual(resins.filterResins(RESINS, "12").map(resin => resin.resinCode), ["ab120"]);
  assert.deepEqual(resins.filterResins(RESINS, "  ").map(resin => resin.resinCode), RESINS.map(resin => resin.resinCode));
  assert.deepEqual(resins.filterResins(RESINS, "zzz"), []);
  // Only codes: a density is not searched.
  assert.deepEqual(resins.filterResins(RESINS, "0.951"), []);
});

test("the confirmations say what the floor UI says, and point at Inactive before Delete", () => {
  assert.match(resins.deactivateLines(RESINS[0])[0], /^Deactivate HX204\? It leaves the active catalog/);
  assert.match(resins.deactivateLines(RESINS[0])[0], /recipes that name it still do/);
  assert.match(resins.reactivateLines(RESINS[0])[0], /returns to the active catalog/);
  assert.match(resins.deleteLines(RESINS[0])[0], /Use Inactive instead/);
  assert.match(resins.deleteLines(RESINS[0])[0], /cannot be undone/);
  assert.match(resins.discardLines(RESINS[0])[0], /The record stays as it was last saved/);
});

/* ----------------------------------------------------------------------
 *   Reading and searching
 * -------------------------------------------------------------------- */

test("nothing is read without an administrator or before the section is shown; the catalog comes back in code order with its counts", async () => {
  const admin = makeAdmin({ state: { signedIn: false, isAdmin: false } });
  const view = boot({ admin });
  await settle();
  assert.deepEqual(admin.calls, []);
  admin.set({ signedIn: true, isAdmin: true });
  await settle();
  assert.deepEqual(admin.calls, [], "the section read while it was hidden");
  await view.open();
  assert.deepEqual(admin.calls.map(call => call.action), ["listResins"]);
  assert.deepEqual(view.rows().map(row => row.querySelector(".slate-book__row-name").textContent), ["ab120", "HX204", "LL318"]);
  assert.ok(view.rows()[0].classList.contains("is-inactive"));
  assert.equal(view.rows()[1].querySelector(".slate-book__row-meta").textContent, "0.951 g/cm³ · 44.9 lb/ft³");
  assert.equal(view.note().textContent, "3 resin records loaded.");
  assert.equal(view.q(".slate-section__subtitle").textContent, "2 active · 1 inactive");
  assert.equal(view.q(".slate-resins__count").textContent, "3 records");
});

test("the search narrows the rows and says how many of how many, without disturbing the field", async () => {
  const view = boot();
  await view.open();
  const field = view.search();
  field.value = "l";
  field.dispatchEvent({ type: "input", target: field });
  assert.ok(view.search() === field, "the search field was replaced while it was being typed into");
  assert.deepEqual(view.rows().map(row => row.querySelector(".slate-book__row-name").textContent), ["LL318"]);
  assert.equal(view.q(".slate-resins__count").textContent, "1 of 3");
  field.value = "zzz";
  field.dispatchEvent({ type: "input", target: field });
  assert.equal(view.q(".slate-book__empty").textContent, "No matching resin records.");
  field.value = "";
  field.dispatchEvent({ type: "input", target: field });
  assert.equal(view.rows().length, 3);
  assert.equal(view.q(".slate-resins__count").textContent, "3 records");
  assert.equal(view.admin.calls.length, 1, "searching asked the application");
});

test("choosing a record fills the editor; the densities read exactly as stored", async () => {
  const view = boot();
  await view.open();
  click(view.row("r-1"));
  assert.equal(view.q(".slate-book__detail-name").textContent, "HX204");
  assert.equal(view.field("resinCode").value, "HX204");
  assert.equal(view.field("densityGCm3").value, "0.951");
  assert.equal(view.field("bulkDensityLbFt3").value, "44.9");
  assert.equal(view.view.getState().dirty, false);
  assert.equal(view.action("save").getAttribute("data-able"), "false");
  assert.match(view.q(".slate-lines__reach").textContent, /refreshes this device's active catalog now/);
  // An inactive record says so, and offers the way back.
  click(view.row("r-3"));
  assert.equal(view.q("[data-tag='inactive']").textContent, "Inactive");
  click(view.action("toggle-maintenance"));
  assert.ok(view.action("reactivate"));
  assert.equal(view.action("deactivate"), null);
});

/* ----------------------------------------------------------------------
 *   Editing and saving
 * -------------------------------------------------------------------- */

test("a typed field is never redrawn under the operator; the unsaved mark follows in place", async () => {
  const view = boot();
  await view.open();
  click(view.row("r-1"));
  const field = view.field("densityGCm3");
  field.value = "0.9";
  field.dispatchEvent({ type: "input", target: field });
  assert.ok(view.field("densityGCm3") === field, "the field was replaced while it was being typed into");
  assert.equal(view.view.getState().dirty, true);
  assert.ok(view.q("[data-tag='dirty']"));
  assert.equal(view.action("save").getAttribute("data-able"), "true");
  // Back to what it was: the mark goes with it.
  field.value = "0.951";
  field.dispatchEvent({ type: "input", target: field });
  assert.equal(view.view.getState().dirty, false);
  assert.equal(view.q("[data-tag='dirty']"), null);
});

test("the two things this section knows on its own are refused here and never sent: a missing code, and one another record holds", async () => {
  const view = boot();
  await view.open();
  click(view.row("r-1"));
  const before = view.admin.calls.length;
  view.type("resinCode", "   ");
  click(view.action("save"));
  await settle();
  assert.equal(view.admin.calls.length, before, "a blank code was sent");
  assert.equal(view.note().textContent, resins.CODE_NEEDED);
  assert.equal(view.field("resinCode").getAttribute("aria-invalid"), "true");

  view.type("resinCode", "ll318");
  click(view.action("save"));
  await settle();
  assert.equal(view.admin.calls.length, before, "a code another record holds was sent");
  assert.equal(view.note().textContent, resins.CODE_TAKEN);
  assert.equal(view.field("resinCode").getAttribute("aria-invalid"), "true");
  // Typing again clears the mark on that field.
  view.type("resinCode", "HX205");
  assert.equal(view.field("resinCode").getAttribute("aria-invalid"), null);
});

test("a save sends one saveResin carrying the record, then reads the catalog again", async () => {
  const view = boot();
  await view.open();
  click(view.row("r-1"));
  const before = view.admin.calls.length;
  view.type("bulkDensityLbFt3", "45.2");
  click(view.action("save"));
  await settle();
  assert.deepEqual(view.admin.calls[before], {
    action: "saveResin",
    args: { id: "r-1", resin: { id: "r-1", resinCode: "HX204", densityGCm3: 0.951, bulkDensityLbFt3: 45.2, isActive: true } }
  });
  assert.deepEqual(view.admin.calls.slice(before + 1).map(call => call.action), ["listResins"]);
  assert.equal(view.note().textContent, "Resin saved. The active catalog has been refreshed.");
  assert.equal(view.view.getState().dirty, false);
  // The contract takes the record exactly as sent.
  const normalized = bridge.normalizeArguments("saveResin", view.admin.calls[before].args);
  assert.ok(!normalized.error, normalized.error && normalized.error.message);
});

test("adding a record sends it with no id and stands in the list under its code while it is typed", async () => {
  const view = boot();
  await view.open();
  const before = view.admin.calls.length;
  click(view.action("add-resin"));
  assert.equal(view.view.getState().focusId, "new");
  assert.equal(view.row("new").querySelector(".slate-book__row-name").textContent, "New resin");
  view.type("resinCode", "MB-WHITE");
  assert.equal(view.row("new").querySelector(".slate-book__row-name").textContent, "MB-WHITE");
  view.type("densityGCm3", "1.2");
  click(view.action("save"));
  await settle();
  assert.deepEqual(view.admin.calls[before], {
    action: "saveResin",
    args: { id: "", resin: { id: null, resinCode: "MB-WHITE", densityGCm3: 1.2, bulkDensityLbFt3: null, isActive: true } }
  });
  assert.equal(view.view.getState().focusId, "r-new");
  assert.equal(view.view.getState().dirty, false);
});

test("a row click while a save is in flight is refused, so the saved record cannot land on another one chosen meanwhile", async () => {
  const admin = makeAdmin({ hold: "saveResin" });
  const view = boot({ admin });
  await view.open();
  click(view.row("r-1"));
  view.type("densityGCm3", "0.952");
  click(view.action("save"));
  await tick();
  assert.equal(view.view.getState().pending, "saveResin");

  click(view.row("r-2"));
  await tick();
  assert.equal(view.view.getState().focusId, "r-1", "a row click during a save moved the chosen record");

  admin.release();
  await settle();
  // The answer landed on the record it was asked for, not on another.
  assert.equal(view.view.getState().focusId, "r-1");
  assert.equal(view.view.getState().dirty, false);
  click(view.row("r-2"));
  await settle();
  assert.equal(view.view.getState().focusId, "r-2");
});

test("a refusal from the application keeps the draft and marks the field it names, by field or by its words", async () => {
  const answers = [
    { ok: false, code: "failed", message: "Density must be between 0.001 and 10 g/cm³.", field: "densityGCm3" },
    { ok: false, code: "duplicate_code", message: "That resin code already exists." }
  ];
  const admin = makeAdmin({ answer: action => (action === "saveResin" ? answers.shift() : undefined) });
  const view = boot({ admin });
  await view.open();
  click(view.row("r-1"));
  view.type("densityGCm3", "99");
  click(view.action("save"));
  await settle();
  assert.equal(view.note().textContent, "Density must be between 0.001 and 10 g/cm³.");
  assert.equal(view.field("densityGCm3").getAttribute("aria-invalid"), "true");
  assert.equal(view.field("resinCode").getAttribute("aria-invalid"), null);
  assert.equal(view.field("densityGCm3").value, "99", "the draft was thrown away on a refusal");
  assert.equal(view.view.getState().dirty, true);

  // No field named: the message's own words decide.
  view.type("resinCode", "SOMETHING");
  click(view.action("save"));
  await settle();
  assert.equal(view.field("resinCode").getAttribute("aria-invalid"), "true");
});

test("Enter in a field saves when there is something to save; moving away with changes asks first", async () => {
  const view = boot();
  await view.open();
  click(view.row("r-1"));
  const before = view.admin.calls.length;
  key(view.field("resinCode"), "Enter");
  await settle();
  assert.equal(view.admin.calls.length, before, "Enter saved an unchanged record");
  view.type("resinCode", "HX205");
  click(view.row("r-2"));
  assert.deepEqual(view.view.getState().view, { kind: "confirm", action: "discard" });
  assert.match(view.q(".slate-admin__confirm-line").textContent, /Discard the unsaved changes to HX204\?/);
  click(view.action("cancel-view"));
  assert.equal(view.view.getState().focusId, "r-1");
  key(view.field("resinCode"), "Enter");
  await settle();
  assert.equal(view.admin.calls[before].action, "saveResin");
  assert.equal(view.admin.calls[before].args.resin.resinCode, "HX205");
});

/* ----------------------------------------------------------------------
 *   Maintenance
 * -------------------------------------------------------------------- */

test("Inactive is a save with one field turned, asked on its own and withheld while the draft is dirty", async () => {
  const view = boot();
  await view.open();
  click(view.row("r-1"));
  click(view.action("toggle-maintenance"));
  const before = view.admin.calls.length;
  click(view.action("deactivate"));
  assert.deepEqual(view.view.getState().view, { kind: "confirm", action: "deactivate" });
  assert.equal(view.q(".slate-book__confirm").getAttribute("data-kind"), "delete");
  click(view.action("confirm-view"));
  await settle();
  assert.equal(view.admin.calls[before].action, "saveResin");
  assert.equal(view.admin.calls[before].args.resin.isActive, false);
  assert.equal(view.admin.calls[before].args.resin.resinCode, "HX204", "the rest of the record was not carried");
  assert.equal(view.admin.calls[before].args.resin.densityGCm3, 0.951);
  assert.equal(view.note().textContent, "HX204 deactivated.");

  // With changes in hand both maintenance acts are withheld, with the reason.
  view.type("resinCode", "HX206");
  click(view.action("toggle-maintenance"));
  for (const name of ["reactivate", "delete"]) {
    const control = view.action(name);
    assert.equal(control.getAttribute("data-able"), "false", name);
    assert.match(control.getAttribute("title"), /save or discard the changes first/, name);
  }
  const after = view.admin.calls.length;
  click(view.action("delete"));
  assert.equal(view.view.getState().view, null);
  assert.equal(view.admin.calls.length, after);
});

test("Delete is permanent, asked for on its own, and lets the record go afterwards", async () => {
  const view = boot();
  await view.open();
  click(view.row("r-2"));
  click(view.action("toggle-maintenance"));
  const before = view.admin.calls.length;
  click(view.action("delete"));
  assert.match(view.q(".slate-admin__confirm-line").textContent, /^Permanently delete LL318\?/);
  click(view.action("cancel-view"));
  assert.equal(view.admin.calls.length, before, "cancelling deleted the record");
  click(view.action("toggle-maintenance"));
  click(view.action("delete"));
  click(view.action("confirm-view"));
  await settle();
  assert.deepEqual(view.admin.calls[before], { action: "deleteResin", args: { id: "r-2" } });
  assert.equal(view.note().textContent, "LL318 deleted.");
  assert.equal(view.view.getState().focusId, null);
  assert.equal(view.view.getState().resins, 2);
  assert.equal(view.row("r-2"), null);
});

test("a refused delete keeps the record and says the application's words", async () => {
  const admin = makeAdmin({ answer: action => (action === "deleteResin" ? { ok: false, code: "failed", message: "A recipe still names that resin." } : undefined) });
  const view = boot({ admin });
  await view.open();
  click(view.row("r-2"));
  click(view.action("toggle-maintenance"));
  click(view.action("delete"));
  click(view.action("confirm-view"));
  await settle();
  assert.equal(view.note().textContent, "A recipe still names that resin.");
  assert.equal(view.view.getState().resins, 3);
  assert.equal(view.view.getState().focusId, "r-2");
});

/* ----------------------------------------------------------------------
 *   The session, and what this section may not do
 * -------------------------------------------------------------------- */

test("a session that ends drops the catalog, the search and the draft", async () => {
  const admin = makeAdmin({ answer: action => (action === "deleteResin" ? { ok: false, code: "not_authenticated", message: "Admin sign-in is required." } : undefined) });
  const view = boot({ admin });
  await view.open();
  const field = view.search();
  field.value = "l";
  field.dispatchEvent({ type: "input", target: field });
  click(view.row("r-2"));
  click(view.action("toggle-maintenance"));
  click(view.action("delete"));
  click(view.action("confirm-view"));
  await settle();
  assert.equal(view.view.getState().resins, 0);
  assert.equal(view.view.getState().query, "");
  assert.equal(view.search().value, "");
  assert.equal(view.view.getState().draft, null);
  assert.equal(view.note().textContent, actions.WORDING.accessEnded);

  const other = boot();
  await other.open();
  other.admin.set({ signedIn: false, isAdmin: false, email: "" });
  await settle();
  assert.ok(!other.q(".slate-admin__gate").hasAttribute("hidden"));
  assert.ok(other.q(".slate-book__columns").hasAttribute("hidden"));
});

test("leaving closes what was open; with no bridge it explains; a producer without the delete withholds only that", async () => {
  const view = boot();
  await view.open();
  click(view.row("r-1"));
  click(view.action("toggle-maintenance"));
  click(view.action("deactivate"));
  view.view.onHide();
  assert.equal(view.view.getState().view, null);
  assert.equal(view.view.getState().maintenanceOpen, false);

  const none = boot({ admin: null });
  await none.open();
  assert.match(none.q(".slate-admin__gate").textContent, /No application is connected/);
  assert.doesNotThrow(() => none.view.refresh());

  const partial = boot({ admin: makeAdmin({ capabilities: ["signIn", "signOut", "listResins", "saveResin"] }) });
  await partial.open();
  click(partial.row("r-1"));
  click(partial.action("toggle-maintenance"));
  assert.equal(partial.action("save").getAttribute("data-able"), "false", "save needs a change first");
  assert.equal(partial.action("deactivate").getAttribute("data-able"), "true");
  const remove = partial.action("delete");
  assert.equal(remove.getAttribute("data-able"), "false");
  assert.match(remove.getAttribute("title"), /does not offer deleteResin from Slate/);
  const before = partial.admin.calls.length;
  click(remove);
  assert.equal(partial.view.getState().view, null);
  assert.equal(partial.admin.calls.length, before);
});

test("the section never touches the application's resin catalog: that is the application's to refresh", () => {
  // The prose says the rule; the code is what is checked against it.
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/slate-resin-db.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["PolynResinCatalog", "refreshResins", "getResins", "clearResinCache", "resin_code"]) {
    assert.ok(!source.includes(forbidden), `slate-resin-db.js reaches for ${forbidden}`);
  }
});
