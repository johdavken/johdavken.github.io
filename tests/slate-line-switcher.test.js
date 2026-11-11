"use strict";

/* slate-line-switcher.js: a phone's Lines sheet - the lines this device has
 * joined, one tap to make another this device's line, through the sync
 * module (handed in as `select`). A refusal keeps the sheet and changes
 * nothing; opening it changes nothing. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeDocument, click } = require("../tools/slate-test/fake-dom.js");
const switcher = require("../slate/slate-line-switcher.js");
const dismiss = require("../slate/slate-dismiss.js");

const LINE_10 = { id: "ws-10", name: "Line 10", lineNumber: 10, displayName: "Line 10" };
const LINE_9 = { id: "ws-9", name: "Line 9", lineNumber: 9, displayName: "Line 9" };
const PRINTER = { id: "ws-p", name: "Printer", lineNumber: null, displayName: "Printer" };

function status(over) {
  return Object.assign({
    enabled: true,
    assigned: true,
    linked: true,
    line: { workspaceId: "ws-10", lineNumber: 10, displayName: "Line 10" },
    workspaces: [LINE_10, LINE_9, PRINTER],
    status: { key: "synced", label: "Synced" },
    can: { select: true, join: true }
  }, over || {});
}

/* A sheet over a status the test moves, with `select` answered by hand. */
function harness(options) {
  const settings = options || {};
  const doc = makeDocument();
  const state = { status: settings.status || status(), asked: [], answers: [], synced: [], toggles: [] };
  const sheet = switcher.create(doc, {
    status: () => state.status,
    select: id => new Promise(resolve => { state.asked.push(id); state.answers.push(resolve); }),
    openSync: settings.noSync ? undefined : options => state.synced.push(options),
    onToggle: open => state.toggles.push(open)
  });
  doc.body.appendChild(sheet.element);
  const rows = () => sheet.element.querySelectorAll(".slate-lines__line");
  const row = id => sheet.element.querySelector(`[data-line-id='${id}']`);
  const note = () => sheet.element.querySelector(".slate-lines__note");
  return { doc, sheet, state, rows, row, note };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test("the rows: numbered lines in number order then the rest by name, this device's line marked, and what a tap would do", () => {
  const rows = switcher.rowsFor(status());
  assert.deepEqual(rows.map(one => [one.id, one.number, one.name, one.current, one.action]), [
    ["ws-9", "9", "Line 9", false, "select"],
    ["ws-10", "10", "Line 10", true, null],
    ["ws-p", "", "Printer", false, "select"]
  ]);
  // Disconnected, this device's line is a reconnect.
  assert.equal(switcher.rowsFor(status({ linked: false })).find(one => one.current).action, "reconnect");
  // No RT Sync, no rows.
  for (const none of [null, status({ enabled: false })]) assert.deepEqual(switcher.rowsFor(none), []);
  // No line assigned: every remembered line is a choice.
  assert.ok(switcher.rowsFor(status({ assigned: false, line: null })).every(one => one.action === "select"));
});

test("opening changes nothing: it draws the lines, raises the sheet and asks for nothing", () => {
  const { sheet, state, rows, row } = harness();
  assert.ok(sheet.element.hasAttribute("hidden"), "the sheet is up before it is asked for");
  sheet.open();
  assert.ok(!sheet.element.hasAttribute("hidden"));
  assert.equal(sheet.isOpen(), true);
  assert.deepEqual(state.toggles, [true]);
  assert.equal(rows().length, 3);
  assert.deepEqual(state.asked, [], "opening asked for a switch");
  const current = row("ws-10");
  assert.ok(current.classList.contains("is-current"));
  assert.equal(current.getAttribute("aria-current"), "true");
  assert.ok(current.hasAttribute("disabled"), "this device's connected line is a choice");
  assert.equal(current.querySelector(".slate-lines__number").textContent, "10");
  assert.equal(current.querySelector(".slate-lines__sub").textContent, "This device's line · Synced");
  assert.ok(current.querySelector(".slate-lines__check"));
  assert.equal(sheet.element.querySelector("[data-lines-do='join']").textContent, "Join another line");
  assert.ok(!row("ws-9").hasAttribute("disabled"));
  assert.equal(row("ws-p").querySelector(".slate-lines__number").textContent, "–");
  sheet.close();
  assert.ok(sheet.element.hasAttribute("hidden"));
  assert.deepEqual(state.toggles, [true, false]);
});

test("a tap on another line asks for it once, holds the sheet while it is asked, and closes when it lands", async () => {
  const { sheet, state, row } = harness();
  sheet.open();
  click(row("ws-9"));
  assert.deepEqual(state.asked, ["ws-9"]);
  assert.equal(sheet.pending(), "ws-9");
  assert.equal(row("ws-9").querySelector(".slate-lines__sub").textContent, "Switching…");
  // Every row is held while one is asked: no second switch on top.
  for (const one of sheet.element.querySelectorAll(".slate-lines__line")) assert.ok(one.hasAttribute("disabled"));
  click(row("ws-p"));
  assert.deepEqual(state.asked, ["ws-9"], "a second tap asked again");
  state.answers[0]({ ok: true });
  await tick();
  assert.equal(sheet.isOpen(), false, "the sheet stayed up after the switch");
  assert.equal(sheet.pending(), null);
});

test("a refused switch keeps the sheet up with the reason, and the rows live again; nothing else is asked", async () => {
  const { sheet, state, row, note } = harness();
  sheet.open();
  click(row("ws-9"));
  state.answers[0]({ ok: false, message: "That line is not remembered on this device." });
  await tick();
  assert.equal(sheet.isOpen(), true);
  assert.equal(note().textContent, "That line is not remembered on this device.");
  assert.ok(note().classList.contains("is-error"));
  assert.ok(!note().hasAttribute("hidden"));
  assert.ok(!row("ws-9").hasAttribute("disabled"));
  assert.deepEqual(state.asked, ["ws-9"]);
  assert.deepEqual(state.synced, []);
  // Reopened, the old reason is gone.
  sheet.close();
  sheet.open();
  assert.ok(note().hasAttribute("hidden"));
});

test("a select that throws reads as a refusal, not a crash", async () => {
  const doc = makeDocument();
  const sheet = switcher.create(doc, { status: () => status(), select: () => Promise.reject(new Error("offline")) });
  sheet.open();
  click(sheet.element.querySelector("[data-line-id='ws-9']"));
  await tick();
  assert.equal(sheet.isOpen(), true);
  assert.equal(sheet.element.querySelector(".slate-lines__note").textContent, "offline");
});

test("this device's line, disconnected, is a tap to reconnect - the RT Sync panel's Reconnect, not a select", async () => {
  const doc = makeDocument();
  const asked = [];
  let reconnects = 0;
  const sheet = switcher.create(doc, {
    status: () => status({ linked: false }),
    select: id => { asked.push(id); return Promise.resolve({ ok: true }); },
    reconnect: () => { reconnects += 1; return Promise.resolve({ ok: true }); }
  });
  sheet.open();
  const row = sheet.element.querySelector("[data-line-id='ws-10']");
  assert.equal(row.querySelector(".slate-lines__sub").textContent, "Disconnected · tap to reconnect");
  assert.ok(!row.hasAttribute("disabled"));
  click(row);
  await tick();
  assert.equal(reconnects, 1);
  assert.deepEqual(asked, [], "a reconnect was asked as a select");
  assert.equal(sheet.isOpen(), false);
  // Without the bridge's leave to reconnect, the row is not live.
  const held = switcher.create(makeDocument(), { status: () => status({ linked: false, can: { select: true, join: true, reconnect: false } }), select: () => Promise.resolve({ ok: true }) });
  held.open();
  assert.ok(held.element.querySelector("[data-line-id='ws-10']").hasAttribute("disabled"));
});

test("the foot opens the full RT Sync panel, or its join form; the sheet goes as the panel comes", () => {
  const { sheet, state } = harness();
  sheet.open();
  click(sheet.element.querySelector("[data-lines-do='panel']"));
  assert.equal(sheet.isOpen(), false);
  sheet.open();
  click(sheet.element.querySelector("[data-lines-do='join']"));
  assert.deepEqual(state.synced, [{ join: false }, { join: true }]);
  assert.deepEqual(state.asked, []);
});

test("with no line remembered the sheet says so and holds only the foot; with no RT Sync it says that, and nothing is live", () => {
  const empty = harness({ status: status({ assigned: false, line: null, workspaces: [] }) });
  empty.sheet.open();
  assert.equal(empty.rows().length, 0);
  assert.equal(empty.note().textContent, "This device has not joined a line yet.");
  assert.ok(!empty.sheet.element.querySelector("[data-lines-do='join']").hasAttribute("disabled"));
  assert.equal(empty.sheet.element.querySelector("[data-lines-do='join']").textContent, "Join a line");

  const off = harness({ status: status({ enabled: false }) });
  off.sheet.open();
  assert.equal(off.rows().length, 0);
  assert.equal(off.note().textContent, "RT Sync is not available on this build.");
  for (const button of off.sheet.element.querySelectorAll(".slate-lines__action")) assert.ok(button.hasAttribute("disabled"));
});

test("without the bridge's leave to select, the lines are drawn and none is live", () => {
  const { sheet, rows } = harness({ status: status({ can: { select: false, join: true } }) });
  sheet.open();
  assert.ok(rows().every(one => one.hasAttribute("disabled")));
});

test("an open sheet follows the status: a line joined elsewhere appears; a shut one is not redrawn", () => {
  const { sheet, state, rows } = harness();
  sheet.update();
  assert.equal(rows().length, 0, "a shut sheet was drawn");
  sheet.open();
  state.status = status({ workspaces: [LINE_10, LINE_9] });
  sheet.update();
  assert.equal(rows().length, 2);
});

test("Back closes it first, and Escape does", () => {
  const { sheet, doc } = harness();
  sheet.open();
  assert.ok(dismiss.depth() >= 1, "the sheet is not on the Back key's stack");
  assert.equal(dismiss.dismissTop(), true);
  assert.equal(sheet.isOpen(), false);
  sheet.open();
  for (const handler of sheet.element.listeners.keydown || []) handler({ type: "keydown", key: "Escape", stopPropagation() {} });
  assert.equal(sheet.isOpen(), false);
  assert.ok(doc);
});

test("the sheet requests nothing itself, dispatches nothing and keeps no timer: switching is the sync module's", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "slate", "slate-line-switcher.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\.request\s*\(|dispatch|setTimeout|setInterval|Bridge|localStorage/);
});

test("on a phone the sheet rises from the foot like every other sheet, and is drawn nowhere else", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "slate", "styles", "components", "phone.css"), "utf8");
  assert.match(css, /\.slate-root\[data-input="touch"\]\[data-viewport="phone"\] \.slate-lines:not\(\[hidden\]\) \{\n  position: fixed;/);
  assert.match(css, /\n\.slate-lines \{\n  display: none;\n\}/);
});
