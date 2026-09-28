"use strict";

/* slate-sync.js: the RT Sync trigger and panel, Line Identity first, and
 * the eight connection actions behind their `can` flags. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key } = require("../tools/slate-test/fake-dom.js");
const sync = require("../slate/slate-sync.js");

function statusOf(overrides) {
  return Object.assign({
    enabled: true, available: true, assigned: true, linked: true,
    line: { workspaceId: "ws-1", name: "line-5", lineNumber: 5, displayName: "Line 5", role: "member" },
    workspaces: [{ id: "ws-1", name: "line-5", lineNumber: 5, displayName: "Line 5" }],
    deviceLabel: "Floor PC",
    status: { key: "synced", label: "Synced", known: true, message: "", pendingCount: 0, lastSyncAt: null, adminRequired: false },
    devices: [{ label: "Floor PC", role: "member", joinedAt: null, lastSeenAt: null, thisDevice: true }, { label: "Tablet", role: "owner", joinedAt: null, lastSeenAt: null, thisDevice: false }],
    deviceCount: 2,
    joinCode: null,
    busy: { active: false, action: null },
    can: { refresh: true, reconnect: false, addDevice: true, join: true, select: true, leave: true, relabel: true }
  }, overrides || {});
}

function makeConnection(initial, answers) {
  const listeners = new Set();
  const requests = [];
  let status = initial;
  return {
    requests,
    getStatus: () => status,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async request(name, args) {
      requests.push({ name, args });
      const answer = answers && answers[name];
      return typeof answer === "function" ? answer(args) : (answer || { ok: true });
    },
    set(next) { status = next; for (const listener of listeners) listener(); }
  };
}

function makeAdmin(signedIn) {
  return { getAccess: () => ({ access: { ready: true, signedIn, email: signedIn ? "a@b" : "" }, device: {} }), subscribe() { return () => {}; } };
}

function boot(status, options) {
  const settings = options || {};
  const doc = makeDocument();
  const connection = status === null ? null : makeConnection(status, settings.answers);
  const view = sync.create(doc, { connection, admin: settings.admin || null, lineIdentity: settings.lineIdentity || null, now: settings.now, timers: settings.timers });
  doc.body.appendChild(view.element);
  return { doc, connection, view };
}

function buttons(view) {
  return view.panel.querySelectorAll("button").map(button => [button.textContent, button.getAttribute("data-action"), button.hasAttribute("disabled")]);
}

async function settle() { await new Promise(resolve => setImmediate(resolve)); }

test("the trigger summarises the line, the status and the devices; with no status the whole thing stays hidden", () => {
  assert.deepEqual(sync.summarize(statusOf()), { line: "Line 5", state: "Synced", devices: "2 devices", text: "Line 5 · Synced · 2 devices" });
  assert.equal(sync.summarize(statusOf({ assigned: false, line: null, deviceCount: 0, status: { key: "local", label: "Local only", pendingCount: 0 } })).text, "No line · Local only");
  assert.equal(sync.summarize(statusOf({ status: { key: "pending", label: "Pending", pendingCount: 3 } })).state, "Pending (3)");
  assert.equal(sync.summarize(null), null);

  const { view } = boot(statusOf());
  assert.ok(!view.element.hasAttribute("hidden"));
  assert.equal(view.trigger.querySelector(".slate-sync__summary").textContent, "Synced");
  assert.equal(view.trigger.querySelector(".slate-sync__gauge-number").textContent, "5");
  assert.equal(view.trigger.getAttribute("data-state"), "synced");
  assert.equal(view.trigger.getAttribute("aria-label"), "RT Sync — Line 5 · Synced · 2 devices");
  assert.equal(view.trigger.getAttribute("aria-haspopup"), "dialog");

  const none = boot(null);
  assert.ok(none.view.element.hasAttribute("hidden"));
  const harness = boot(undefined);
  harness.connection.set(null);
  assert.ok(harness.view.element.hasAttribute("hidden"));
});

test("the trigger's ring: the number in the middle, a lit tick per device from the top with this device first, the line named when it has no number", () => {
  assert.deepEqual(sync.gaugeTicks(statusOf()), ["this", "other"]);
  assert.deepEqual(sync.gaugeTicks(statusOf({ devices: [{ thisDevice: false }], deviceCount: 3 })), ["other", "other", "other"]);
  assert.deepEqual(sync.gaugeTicks(statusOf({ deviceCount: 40 })).length, 20);
  assert.deepEqual(sync.gaugeTicks(statusOf({ assigned: false })), []);
  assert.deepEqual(sync.gaugeTicks(null), []);

  const { view, connection } = boot(statusOf());
  const ticks = view.trigger.querySelectorAll(".slate-sync__tick");
  assert.equal(ticks.length, 20);
  assert.ok(ticks[0].classList.contains("is-lit") && ticks[0].classList.contains("is-this-device"));
  assert.ok(ticks[1].classList.contains("is-lit") && !ticks[1].classList.contains("is-this-device"));
  assert.ok(!ticks[2].classList.contains("is-lit"));
  assert.ok(view.trigger.querySelector(".slate-sync__gauge").getAttribute("aria-hidden") === "true");

  connection.set(statusOf({ line: { workspaceId: "ws-1", name: "line-12", lineNumber: 12, displayName: "Line 12", role: "member" } }));
  assert.equal(view.trigger.querySelector(".slate-sync__gauge-number").textContent, "12");
  assert.ok(view.trigger.querySelector(".slate-sync__gauge").classList.contains("is-wide"));

  connection.set(statusOf({ line: { workspaceId: "ws-1", name: "pilot", lineNumber: null, displayName: "Pilot", role: "member" } }));
  assert.equal(view.trigger.querySelector(".slate-sync__gauge-number").textContent, "–");
  assert.equal(view.trigger.querySelector(".slate-sync__summary").textContent, "Pilot · Synced");

  connection.set(statusOf({ assigned: false, line: null, deviceCount: 0, devices: [], status: { key: "local", label: "Local only", pendingCount: 0 } }));
  assert.equal(view.trigger.querySelector(".slate-sync__gauge-number").textContent, "–");
  assert.equal(view.trigger.querySelector(".slate-sync__summary").textContent, "Local only");
  assert.equal(view.trigger.getAttribute("data-state"), "local");
  assert.equal(view.trigger.querySelectorAll(".slate-sync__tick.is-lit").length, 0);
});

test("the panel opens on the trigger, leads with the Line Identity, and closes on Escape, Close or an outside press", () => {
  const { doc, view } = boot(statusOf());
  click(view.trigger);
  assert.equal(view.isOpen(), true);
  assert.equal(view.trigger.getAttribute("aria-expanded"), "true");
  assert.ok(!view.panel.hasAttribute("hidden"));
  assert.equal(view.panel.getAttribute("role"), "dialog");
  const first = view.panel.children[0];
  assert.ok(first.classList.contains("slate-sync__identity"), "the panel does not lead with the Line Identity");
  assert.equal(first.querySelector(".slate-sync__line").textContent, "Line 5");
  // The number leads, LINE up its side; the name is then said, not shown twice.
  assert.ok(first.classList.contains("is-numbered"));
  assert.equal(first.querySelector(".slate-sync__numeral-value").textContent, "5");
  assert.equal(first.querySelector(".slate-sync__numeral-word").textContent, "LINE");
  assert.equal(first.querySelector(".slate-sync__numeral").getAttribute("aria-hidden"), "true");
  // Without line-identity there is nothing to add under a plain "Line 5".
  assert.deepEqual(first.querySelectorAll(".slate-sync__fact").map(node => node.textContent), []);
  assert.equal(first.querySelector(".slate-sync__role").textContent, "member");
  assert.equal(first.querySelector(".slate-sync__device-label").textContent, "This device: Floor PC");
  assert.equal(view.panel.querySelector(".slate-sync__state").textContent, "Synced");
  assert.deepEqual(view.panel.querySelectorAll(".slate-sync__devices .slate-sync__item-label").map(node => node.textContent), ["Floor PC", "Tablet"]);

  const escape = key(view.panel, "Escape");
  assert.equal(escape._stopped, true, "Escape was not stopped at the panel");
  assert.equal(view.isOpen(), false);
  assert.equal(view.trigger.focused, true);

  click(view.trigger);
  const outside = doc.createElement("div");
  doc.body.appendChild(outside);
  doc.listeners.pointerdown[0]({ target: outside });
  assert.equal(view.isOpen(), false);
  assert.equal((doc.listeners.pointerdown || []).length, 0, "the outside listener was not removed");

  click(view.trigger);
  click(view.panel.querySelector("[data-action='close']"));
  assert.equal(view.isOpen(), false);
});

test("the can flags gate the buttons, and the guidance names the situation", () => {
  const { view } = boot(statusOf({ can: { refresh: false, reconnect: false, addDevice: false, join: false, select: false, leave: false, relabel: false } }));
  click(view.trigger);
  const found = buttons(view);
  assert.deepEqual(found.filter(one => one[1] !== "close").map(one => [one[1], one[2]]),
    [["relabel", true], ["refresh", true], ["generateJoinCode", true], ["leaveWorkspace", true]]);

  const live = boot(statusOf());
  click(live.view.trigger);
  assert.deepEqual(buttons(live.view).filter(one => one[1] !== "close").map(one => [one[1], one[2]]),
    [["relabel", false], ["refresh", false], ["generateJoinCode", false], ["join", false], ["leaveWorkspace", false]]);

  // Disconnected: Reconnect leads.
  const off = boot(statusOf({ linked: false, status: { key: "offline", label: "Offline", pendingCount: 2, message: "No connection." }, can: { reconnect: true } }));
  click(off.view.trigger);
  assert.equal(off.view.panel.querySelector("[data-action='reconnect']").hasAttribute("disabled"), false);
  assert.equal(off.view.panel.querySelector("[data-action='refresh']"), null);
  assert.equal(off.view.panel.querySelector(".slate-sync__pending").textContent, "2 changes waiting to sync");
  assert.equal(off.view.panel.querySelector(".slate-sync__message").textContent, "No connection.");
  assert.match(off.view.panel.querySelector(".slate-sync__guidance").textContent, /disconnected/);

  // Unassigned: the join form is open and the identity says so.
  const none = boot(statusOf({ assigned: false, line: null, devices: [], deviceCount: 0, can: { join: true } }));
  click(none.view.trigger);
  assert.equal(none.view.panel.querySelector(".slate-sync__line").textContent, sync.NO_LINE);
  assert.ok(none.view.panel.querySelector(".slate-sync__input--code"));
  assert.equal(none.view.panel.querySelector("[data-action='leaveWorkspace']"), null);
  assert.match(sync.guidance(statusOf({ enabled: false })), /not available/);
  assert.match(sync.guidance(statusOf({ status: { adminRequired: true } })), /administrator/);
});

test("each action sends exactly its request: refresh, reconnect, add device (code then QR), leave (two-step)", async () => {
  const { view, connection } = boot(statusOf({ can: { refresh: true, reconnect: true, addDevice: true, join: true, select: true, leave: true, relabel: true } }), {
    answers: { generateJoinCode: { ok: true }, renderJoinQr: { ok: true, code: "AB12", svg: "<svg></svg>" } }
  });
  click(view.trigger);
  click(view.panel.querySelector("[data-action='refresh']"));
  await settle();
  click(view.panel.querySelector("[data-action='reconnect']"));
  await settle();
  click(view.panel.querySelector("[data-action='generateJoinCode']"));
  await settle();
  await settle();
  assert.deepEqual(connection.requests.map(one => one.name), ["refresh", "reconnect", "generateJoinCode", "renderJoinQr"]);
  assert.equal(view.panel.querySelector(".slate-sync__code").textContent, "AB12");
  assert.equal(view.panel.querySelector(".slate-sync__qr-image").innerHTML, "<svg></svg>");

  const leave = view.panel.querySelector("[data-action='leaveWorkspace']");
  click(leave);
  await settle();
  assert.equal(connection.requests.length, 4, "leave went on the first click");
  assert.ok(view.panel.querySelector("[data-action='leaveWorkspace']").hasAttribute("data-armed"));
  click(view.panel.querySelector("[data-action='leaveWorkspace']"));
  await settle();
  assert.equal(connection.requests[4].name, "leaveWorkspace");
});

test("joining sends a four-character upper-cased code with an optional label, and refuses a bad code locally", async () => {
  const { view, connection } = boot(statusOf({ assigned: false, line: null, can: { join: true } }));
  click(view.trigger);
  const code = view.panel.querySelector(".slate-sync__input--code");
  code.value = "ab1";
  click(view.panel.querySelector("[data-action='joinWorkspace']"));
  await settle();
  assert.equal(connection.requests.length, 0);
  assert.match(view.panel.querySelector(".slate-sync__note").textContent, /four letters or digits/);

  const codeAgain = view.panel.querySelector(".slate-sync__input--code");
  codeAgain.value = " ab12 ";
  view.panel.querySelector("[aria-label='Device label (optional)']").value = "  Tablet  ";
  key(codeAgain, "Enter");
  await settle();
  assert.deepEqual(connection.requests, [{ name: "joinWorkspace", args: { code: "AB12", label: "Tablet" } }]);
});

test("renaming the device sends relabelDevice with the trimmed label; an empty one is refused locally", async () => {
  const { view, connection } = boot(statusOf());
  click(view.trigger);
  click(view.panel.querySelector("[data-action='relabel']"));
  const input = view.panel.querySelector(".slate-sync__inline .slate-sync__input");
  assert.equal(input.value, "Floor PC");
  input.value = "   ";
  click(view.panel.querySelector("[data-action='relabelDevice']"));
  await settle();
  assert.equal(connection.requests.length, 0);
  view.panel.querySelector(".slate-sync__inline .slate-sync__input").value = " Line 5 desk ";
  click(view.panel.querySelector("[data-action='relabelDevice']"));
  await settle();
  assert.deepEqual(connection.requests, [{ name: "relabelDevice", args: { label: "Line 5 desk" } }]);
});

test("the lines list is offered only to a signed-in administrator with a choice, and selecting sends the id", async () => {
  const two = statusOf({ workspaces: [{ id: "ws-1", displayName: "Line 5" }, { id: "ws-2", displayName: "Line 11" }] });
  assert.equal(sync.offersLines(two, makeAdmin(false)), false);
  assert.equal(sync.offersLines(two, null), false);
  assert.equal(sync.offersLines(statusOf(), makeAdmin(true)), false, "one line is not a choice");
  assert.equal(sync.offersLines(two, makeAdmin(true)), true);

  const { view, connection } = boot(two, { admin: makeAdmin(true) });
  click(view.trigger);
  const lines = view.panel.querySelector(".slate-sync__lines");
  assert.ok(lines, "the lines section is missing");
  assert.deepEqual(lines.querySelectorAll(".slate-sync__item-label").map(node => node.textContent), ["Line 5", "Line 11"]);
  assert.equal(lines.querySelectorAll("[data-action='selectWorkspace']").length, 1, "the current line offered itself");
  click(lines.querySelector("[data-action='selectWorkspace']"));
  await settle();
  assert.deepEqual(connection.requests, [{ name: "selectWorkspace", args: { id: "ws-2" } }]);

  const operator = boot(two, { admin: makeAdmin(false) });
  click(operator.view.trigger);
  assert.equal(operator.view.panel.querySelector(".slate-sync__lines"), null);
});

test("a failed request shows the application's message; a status change redraws the trigger but not a form being typed into", async () => {
  const { view, connection } = boot(statusOf(), { answers: { refresh: { ok: false, code: "failed", message: "The line could not be reached." } } });
  click(view.trigger);
  click(view.panel.querySelector("[data-action='refresh']"));
  await settle();
  assert.equal(view.panel.querySelector(".slate-sync__note").textContent, "The line could not be reached.");
  assert.ok(view.panel.querySelector(".slate-sync__note").classList.contains("is-error"));

  click(view.panel.querySelector("[data-action='relabel']"));
  const input = view.panel.querySelector(".slate-sync__inline .slate-sync__input");
  input.value = "typing";
  connection.set(statusOf({ status: { key: "syncing", label: "Syncing", pendingCount: 1 } }));
  assert.equal(view.trigger.querySelector(".slate-sync__summary").textContent, "Syncing (1)");
  assert.equal(view.trigger.getAttribute("aria-label"), "RT Sync — Line 5 · Syncing (1) · 2 devices");
  assert.ok(view.panel.querySelector(".slate-sync__inline .slate-sync__input") === input, "the form was rebuilt under the operator");
  assert.equal(input.value, "typing");
});

test("every one of the bridge's eight actions is reachable from the panel", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "slate/slate-sync.js"), "utf8");
  for (const action of sync.ACTIONS) assert.ok(src.includes(`"${action}"`), `${action} is never requested`);
  const bridge = require("../station-connection-bridge.js");
  assert.deepEqual([...sync.ACTIONS].sort(), [...bridge.ACTIONS].sort());
});

test("under the numeral: the line's own name when it is not just its number, its maker and its layers", () => {
  const identity = {
    lineManufacturer: n => (n === 10 ? { id: "reifenhauser", name: "Reifenhäuser", short: "Reifenhäuser" } : null),
    definitionForLine: n => (n === 10 ? { lineNumber: 10, layerCount: 5 } : n === 2 ? { lineNumber: 2, layerCount: 1 } : null)
  };
  assert.deepEqual(sync.lineFacts({ lineNumber: 10, displayName: "Line 10", name: "Line 10" }, identity), ["Reifenhäuser", "5-layer"]);
  assert.deepEqual(sync.lineFacts({ lineNumber: 10, displayName: "Big Blue", name: "line-10" }, identity), ["Big Blue", "Reifenhäuser", "5-layer"]);
  assert.deepEqual(sync.lineFacts({ lineNumber: 2, displayName: "Line 2", name: "Mono two" }, identity), ["Mono two", "Mono-layer"]);
  assert.deepEqual(sync.lineFacts({ lineNumber: null, displayName: "Pilot", name: "pilot" }, identity), ["Pilot", "pilot"]);
  assert.deepEqual(sync.lineFacts(null, identity), []);

  const { view } = boot(statusOf({ line: { workspaceId: "ws-1", name: "line-10", lineNumber: 10, displayName: "Line 10", role: "owner" } }), { lineIdentity: identity });
  click(view.trigger);
  assert.deepEqual(view.panel.querySelectorAll(".slate-sync__fact").map(node => node.textContent), ["Reifenhäuser", "5-layer"]);
  assert.equal(view.panel.querySelector(".slate-sync__numeral-value").textContent, "10");
  assert.equal(view.panel.querySelector(".slate-sync__role").textContent, "owner");
});

test("the status stands beside the logo's streams, which carry its key", () => {
  const { view, connection } = boot(statusOf());
  click(view.trigger);
  const rotor = view.panel.querySelector(".slate-sync__rotor");
  assert.ok(rotor, "no rotor beside the status");
  assert.equal(rotor.getAttribute("data-state"), "synced");
  assert.equal(rotor.getAttribute("aria-hidden"), "true");
  assert.equal(view.panel.querySelectorAll(".slate-sync__rotor .slate-logo__stream").length, 5);
  connection.set(statusOf({ status: { key: "pending", label: "Pending", pendingCount: 2 } }));
  assert.equal(view.panel.querySelector(".slate-sync__rotor").getAttribute("data-state"), "pending");
  assert.match(view.panel.querySelector(".slate-sync__rotor").style.getPropertyValue("--slate-sync-phase"), /^-\d+\.\d\ds$/);

  // No line: no numeral, and the name says so.
  const none = boot(statusOf({ assigned: false, line: null, devices: [], deviceCount: 0 }));
  click(none.view.trigger);
  assert.equal(none.view.panel.querySelector(".slate-sync__numeral"), null);
  assert.ok(!none.view.panel.children[0].classList.contains("is-numbered"));
});

test("a shown join code offers New code, which mints another and draws its QR; a code past its time says so, faded, and New code leads", async () => {
  const at = Date.UTC(2026, 8, 26, 23, 0, 0);
  let clock = at;
  const pending = [];
  const timers = { setTimeout(fn, ms) { pending.push({ fn, ms }); return pending.length; }, clearTimeout(id) { if (pending[id - 1]) pending[id - 1].fn = null; } };
  const codeFor = (code, minutes) => ({ code, expiresAt: new Date(at + minutes * 60e3).toISOString(), url: "" });

  assert.equal(sync.isExpired("", at), false);
  assert.equal(sync.isExpired(new Date(at + 1).toISOString(), at), false);
  assert.equal(sync.isExpired(new Date(at).toISOString(), at), true);
  assert.equal(sync.isExpired("not a date", at), false);

  const { view, connection } = boot(statusOf({ joinCode: codeFor("K7Q2", 15) }), {
    now: () => clock, timers,
    answers: { generateJoinCode: () => { connection.set(statusOf({ joinCode: codeFor("ZX90", 30) })); return { ok: true }; }, renderJoinQr: { ok: true, code: "ZX90", svg: "<svg id='new'></svg>" } }
  });
  click(view.trigger);
  const section = () => view.panel.querySelector(".slate-sync__join-code");
  assert.equal(view.panel.querySelector(".slate-sync__code").textContent, "K7Q2");
  assert.match(view.panel.querySelector(".slate-sync__expires").textContent, /^Expires /);
  assert.ok(!section().hasAttribute("data-expired"));
  const renew = view.panel.querySelector("[data-action='newJoinCode']");
  assert.equal(renew.textContent, "New code");
  assert.equal(renew.hasAttribute("disabled"), false);
  assert.ok(!renew.classList.contains("slate-sync__button--primary"));

  // The panel redraws itself when the code runs out.
  const armed = pending.filter(one => one.fn);
  assert.equal(armed.length, 1, "no redraw was set for the code's expiry");
  assert.equal(armed[0].ms, 15 * 60e3 + 250);
  clock = at + 15 * 60e3 + 250;
  const fire = armed[0].fn;
  armed[0].fn = null;
  fire();
  assert.ok(section().hasAttribute("data-expired"));
  assert.match(view.panel.querySelector(".slate-sync__expires").textContent, /^Expired .* make a new code to try again$/);
  assert.ok(view.panel.querySelector("[data-action='newJoinCode']").classList.contains("slate-sync__button--primary"));
  assert.equal(pending.filter(one => one.fn).length, 0, "an expired code set another redraw");

  // New code: mint, then draw.
  click(view.panel.querySelector("[data-action='newJoinCode']"));
  await settle();
  await settle();
  assert.deepEqual(connection.requests.map(one => one.name), ["generateJoinCode", "renderJoinQr"]);
  assert.equal(view.panel.querySelector(".slate-sync__code").textContent, "ZX90");
  assert.equal(view.panel.querySelector(".slate-sync__qr-image").innerHTML, "<svg id='new'></svg>");
  assert.ok(!section().hasAttribute("data-expired"));

  // Closing clears the redraw.
  view.close(false);
  assert.equal(pending.filter(one => one.fn).length, 0, "the redraw outlived the panel");

  // Withheld while the bridge says no device can be added.
  const off = boot(statusOf({ joinCode: codeFor("K7Q2", 15), can: { addDevice: false } }), { now: () => at, timers });
  click(off.view.trigger);
  assert.ok(off.view.panel.querySelector("[data-action='newJoinCode']").hasAttribute("disabled"));
});
