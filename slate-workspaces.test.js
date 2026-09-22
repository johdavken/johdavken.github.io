"use strict";

/* slate-workspaces.js: the lines and their devices, for an administrator.
 * Every request it makes is pinned by name and arguments, every change is
 * confirmed in place first, and nothing is read without a session. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key } = require("./tools/slate-test/fake-dom.js");
const workspaces = require("./slate/slate-workspaces.js");
const actions = require("./slate/slate-admin-actions.js");
const bridge = require("./station-admin-bridge.js");

const LINES = [
  { id: "ws-1", name: "Line 5", memberCount: 2, recipeCount: 4, profileCount: 1, createdAt: "2026-01-04T10:00:00.000Z", lastActivityAt: "2026-09-20T08:00:00.000Z", thisDevice: false },
  { id: "ws-2", name: "Line 8", memberCount: 1, recipeCount: 0, profileCount: 0, createdAt: "2026-02-01T10:00:00.000Z", lastActivityAt: "", thisDevice: true }
];
const DEVICES = [
  { memberId: "m-owner", label: "Line 5 desk", role: "owner", lastSeenAt: "2026-09-21T12:00:00.000Z", thisDevice: false },
  { memberId: "m-me", label: "This browser", role: "member", lastSeenAt: "", thisDevice: true }
];

/* A fake admin bridge: records every request, answers as told, and can
 * move its session the way a sign-out elsewhere would. */
function makeAdmin(options) {
  const settings = options || {};
  const calls = [];
  const listeners = new Set();
  let state = Object.assign({ ready: true, signedIn: true, isAdmin: true, email: "ada@example.com" }, settings.state || {});
  let deviceState = Object.assign({ ready: true, userId: "user-1234abcd", deviceId: "dev-5678efgh", deviceLabel: "This browser" }, settings.device || {});
  let access = bridge.project(state, deviceState);
  function publish() { access = bridge.project(state, deviceState); for (const listener of listeners) listener(access); }
  return {
    calls,
    isConnected: () => settings.connected !== false,
    capabilities: () => (settings.capabilities || [...bridge.ACTIONS]).slice(),
    getAccess: () => access,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { state = Object.assign({}, state, next); publish(); },
    setDevice(next) { deviceState = Object.assign({}, deviceState, next); publish(); },
    async request(action, args) {
      calls.push({ action, args });
      if (typeof settings.answer === "function") {
        const answered = settings.answer(action, args, calls);
        if (answered !== undefined) return answered;
      }
      if (action === "listWorkspaces") return { ok: true, workspaces: (settings.lines || LINES).map(one => Object.assign({}, one)) };
      if (action === "workspaceDevices") return { ok: true, devices: (settings.devices || DEVICES).map(one => Object.assign({}, one)) };
      if (action === "addThisDevice") return { ok: true, alreadyMember: false, role: "member" };
      if (action === "createLine") return { ok: true, id: "ws-3", name: args.name };
      if (action === "mergeWorkspace") return { ok: true, recipesMerged: 3, profilesMerged: 1 };
      return { ok: true };
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
  const view = workspaces.create(doc, { admin, say: message => said.push(message) });
  doc.body.appendChild(view.element);
  const el = view.element;
  const q = selector => el.querySelector(selector);
  return {
    doc, admin, said, view, el, q,
    rows: () => el.querySelectorAll("[data-workspace]"),
    row: id => el.querySelector(`[data-workspace='${id}']`),
    action: name => el.querySelector(`[data-action='${name}']`),
    note: () => el.querySelector(".slate-book__note"),
    async open() { view.onShow(); await settle(); }
  };
}

/* ----------------------------------------------------------------------
 *   The pure parts
 * -------------------------------------------------------------------- */

test("the words under a line, beside it, and about this device", () => {
  assert.equal(workspaces.rowMeta(LINES[0]), "2 members · 4 recipes · 1 profile");
  assert.equal(workspaces.rowMeta({ memberCount: 1, recipeCount: 1, profileCount: 1 }), "1 member · 1 recipe · 1 profile");
  assert.match(workspaces.detailMeta(LINES[0]), /^Created .+ · 2 members · 4 recipes · 1 weight profile$/);
  assert.equal(workspaces.detailMeta({ memberCount: 0, recipeCount: 0, profileCount: 0, createdAt: "" }), "0 members · 0 recipes · 0 weight profiles");
  assert.equal(workspaces.deviceStatus({ ready: false, label: "Desk" }, LINES), "Desk · RT Sync identity not ready");
  assert.equal(workspaces.deviceStatus({ ready: true, label: "Desk" }, LINES), "Desk · RT Sync ready · on Line 8");
  assert.equal(workspaces.deviceStatus({ ready: true, label: "" }, []), "This device · RT Sync ready · on no line");
  assert.equal(workspaces.formatWhen(""), "");
  assert.equal(workspaces.formatDate("not a date"), "");
});

test("the confirmations say what the floor UI says: what it will do, and what it will not", () => {
  const add = workspaces.addDeviceLines(LINES[0], "This browser");
  assert.equal(add[0], "Workspace: Line 5");
  assert.equal(add[1], "Device: This browser");
  assert.ok(add.includes("This will:"));
  assert.ok(add.includes("This will not:"));
  assert.ok(add.some(line => /transfer workspace ownership/.test(line)));
  assert.ok(add.some(line => /delete the previous device membership/.test(line)));

  const owner = workspaces.ownershipLines(LINES[0], "This browser");
  assert.ok(owner.some(line => /demote the previous owner/.test(line)));
  assert.ok(owner.some(line => /cannot verify that from here/.test(line)));

  assert.match(workspaces.disconnectLines({ label: "Old desk", role: "member", thisDevice: false })[0], /^Disconnect Old desk from this workspace\?$/);
  assert.match(workspaces.disconnectLines({ label: "Old desk", role: "owner", thisDevice: false })[0], /workspace owner/);
  assert.match(workspaces.disconnectLines({ label: "Me", role: "member", thisDevice: true })[0], /just recovered/);
  assert.match(workspaces.deleteLines(LINES[0])[0], /cannot be undone/);
  assert.match(workspaces.mergeLines(LINES[0], LINES[1])[0], /“Line 5”, its active job, and its linked-device memberships will then be permanently deleted/);
});

/* ----------------------------------------------------------------------
 *   Reading
 * -------------------------------------------------------------------- */

test("nothing is read without an administrator, or before the section is shown; signing in and opening reads the lines once", async () => {
  const admin = makeAdmin({ state: { signedIn: false, isAdmin: false } });
  const view = boot({ admin });
  await settle();
  assert.deepEqual(admin.calls, [], "the section read something signed out");
  assert.ok(!view.q(".slate-admin__gate").hasAttribute("hidden"));
  assert.match(view.q(".slate-admin__gate").textContent, /No administrator is signed in/);
  assert.ok(view.q(".slate-book__columns").hasAttribute("hidden"));

  // Signed in, but the section has never been shown: still nothing.
  admin.set({ signedIn: true, isAdmin: true });
  await settle();
  assert.deepEqual(admin.calls, [], "the section read while it was hidden");
  assert.ok(!view.q(".slate-book__columns").hasAttribute("hidden"), "the panes stayed hidden to an administrator");

  await view.open();
  assert.deepEqual(admin.calls.map(call => call.action), ["listWorkspaces"]);
  assert.deepEqual(view.rows().map(row => row.getAttribute("data-workspace")), ["ws-1", "ws-2"]);
  assert.equal(view.rows()[0].querySelector(".slate-book__row-meta").textContent, "2 members · 4 recipes · 1 profile");
  assert.ok(view.rows()[1].classList.contains("is-connected"), "the line this device is on is not marked");
  assert.equal(view.note().textContent, "2 lines loaded.");
  assert.ok(view.note().classList.contains("is-ok"));
  assert.equal(view.q(".slate-section__subtitle").textContent, "This browser · RT Sync ready · on Line 8");

  // Shown again: read once per session, not once per visit.
  await view.open();
  assert.deepEqual(admin.calls.map(call => call.action), ["listWorkspaces"]);
});

test("choosing a line reads its devices and draws them; choosing it again lets it go; Refresh reads the list again", async () => {
  const view = boot();
  await view.open();
  click(view.row("ws-1"));
  await settle();
  assert.deepEqual(view.admin.calls[1], { action: "workspaceDevices", args: { id: "ws-1" } });
  assert.equal(view.view.getState().focusId, "ws-1");
  assert.equal(view.q(".slate-book__detail-name").textContent, "Line 5");
  const devices = view.el.querySelectorAll(".slate-admin__device-row");
  assert.deepEqual(devices.map(row => row.getAttribute("data-member")), ["m-owner", "m-me"]);
  assert.equal(devices[0].querySelector(".slate-admin__device-role").textContent, "owner");
  assert.match(devices[0].querySelector(".slate-admin__device-seen").textContent, /^seen /);
  assert.equal(devices[1].querySelector(".slate-admin__device-seen").textContent, "never seen");
  assert.ok(devices[1].classList.contains("is-this-device"));
  assert.equal(devices[1].querySelector(".slate-admin__device-self").textContent, "this device");
  // Only a member is offered ownership; both may be disconnected.
  assert.equal(devices[0].querySelector("[data-action='make-owner']"), null, "the owner was offered ownership");
  assert.ok(devices[1].querySelector("[data-action='make-owner']"));
  assert.equal(view.el.querySelectorAll("[data-action='disconnect']").length, 2);

  click(view.row("ws-1"));
  await settle();
  assert.equal(view.view.getState().focusId, null);
  assert.equal(view.q(".slate-book__detail-name"), null);

  const before = view.admin.calls.length;
  click(view.action("refresh"));
  await settle();
  assert.deepEqual(view.admin.calls.slice(before).map(call => call.action), ["listWorkspaces"]);
});

test("a line the application no longer lists is let go; a refusal is said and the list is kept", async () => {
  let lines = LINES;
  const admin = makeAdmin({ answer: action => (action === "listWorkspaces" ? { ok: true, workspaces: lines.map(one => Object.assign({}, one)) } : undefined) });
  const view = boot({ admin });
  await view.open();
  click(view.row("ws-1"));
  await settle();
  assert.equal(view.view.getState().focusId, "ws-1");
  lines = [LINES[1]];
  click(view.action("refresh"));
  await settle();
  assert.equal(view.view.getState().focusId, null, "the chosen line survived its disappearance");
  assert.equal(view.view.getState().devices, 0);

  const refused = boot({ admin: makeAdmin({ answer: action => (action === "listWorkspaces" ? { ok: false, code: "failed", message: "The database is unreachable." } : undefined) }) });
  await refused.open();
  assert.equal(refused.note().textContent, "The database is unreachable.");
  assert.ok(refused.note().classList.contains("is-error"));
  assert.equal(refused.view.getState().loaded, false);
});

/* ----------------------------------------------------------------------
 *   The procedures
 * -------------------------------------------------------------------- */

test("Add This Device asks first, with the floor UI's words, and sends one addThisDevice; Cancel sends nothing", async () => {
  const view = boot();
  await view.open();
  click(view.row("ws-1"));
  await settle();
  const before = view.admin.calls.length;
  click(view.action("add-this-device"));
  assert.deepEqual(view.view.getState().view, { kind: "confirm", action: "addThisDevice" });
  assert.equal(view.admin.calls.length, before, "asking dispatched");
  assert.match(view.q(".slate-admin__confirm-title").textContent, /Put This Device Back On The Line/);
  const lines = view.el.querySelectorAll(".slate-admin__confirm-line").map(node => node.textContent);
  assert.ok(lines.includes("Workspace: Line 5"));
  assert.ok(lines.includes("• transfer workspace ownership."));

  click(view.action("cancel-view"));
  assert.equal(view.view.getState().view, null);
  assert.equal(view.admin.calls.length, before);

  click(view.action("add-this-device"));
  click(view.action("confirm-view"));
  await settle();
  assert.deepEqual(view.admin.calls[before], { action: "addThisDevice", args: { id: "ws-1" } });
  // And the list is read again, then the line.
  assert.deepEqual(view.admin.calls.slice(before + 1).map(call => call.action), ["listWorkspaces", "workspaceDevices"]);
  assert.equal(view.note().textContent, "This device is now on Line 5.");
  assert.equal(view.view.getState().view, null);
});

test("Escape closes an open confirmation or entry without sending anything", async () => {
  const view = boot();
  await view.open();
  click(view.row("ws-1"));
  await settle();
  const before = view.admin.calls.length;
  click(view.action("add-this-device"));
  key(view.el, "Escape");
  assert.equal(view.view.getState().view, null);
  click(view.action("rename-line"));
  assert.deepEqual(view.view.getState().view, { kind: "entry", action: "rename" });
  key(view.el, "Escape");
  assert.equal(view.view.getState().view, null);
  assert.equal(view.admin.calls.length, before);
});

test("Rename opens on the current name and sends one renameLine; an empty name is refused here", async () => {
  const view = boot();
  await view.open();
  click(view.row("ws-1"));
  await settle();
  const before = view.admin.calls.length;
  click(view.action("rename-line"));
  const field = view.q("[data-field='name']");
  assert.equal(field.value, "Line 5");
  field.value = "   ";
  click(view.action("confirm-entry"));
  await settle();
  assert.equal(view.admin.calls.length, before, "a blank name was sent");
  assert.equal(view.note().textContent, "Enter a line name.");
  assert.equal(field.getAttribute("aria-invalid"), "true");

  field.value = "  Line   Five  ";
  key(field, "Enter");
  await settle();
  assert.deepEqual(view.admin.calls[before], { action: "renameLine", args: { id: "ws-1", name: "Line Five" } });
  assert.equal(view.note().textContent, "Renamed the line to Line Five.");
});

test("Create Line takes a name and connects this device; it is withheld while the RT Sync identity is not ready", async () => {
  const view = boot();
  await view.open();
  const before = view.admin.calls.length;
  click(view.action("create-line"));
  const field = view.q("[data-field='name']");
  field.value = "Line 9";
  click(view.action("confirm-entry"));
  await settle();
  assert.deepEqual(view.admin.calls[before], { action: "createLine", args: { name: "Line 9" } });
  assert.equal(view.note().textContent, "Created Line 9 and connected this device.");

  // With no identity yet, the control says so and asks nothing.
  view.admin.setDevice({ ready: false });
  await settle();
  const after = view.admin.calls.length;
  assert.equal(view.action("create-line").getAttribute("data-able"), "false");
  assert.match(view.action("create-line").getAttribute("title"), /RT Sync identity is not ready/);
  click(view.action("create-line"));
  assert.equal(view.view.getState().view, null);
  assert.equal(view.admin.calls.length, after);
  assert.match(view.said[view.said.length - 1], /unavailable: this device's RT Sync identity is not ready/);
});

test("Make Owner and Disconnect each name their member; Disconnect is the dangerous one", async () => {
  const view = boot();
  await view.open();
  click(view.row("ws-1"));
  await settle();
  const before = view.admin.calls.length;

  click(view.el.querySelector("[data-action='make-owner'][data-member='m-me']"));
  assert.deepEqual(view.view.getState().view, { kind: "confirm", action: "transferOwnership" });
  assert.equal(view.q(".slate-book__confirm").getAttribute("data-kind"), "load");
  click(view.action("confirm-view"));
  await settle();
  assert.deepEqual(view.admin.calls[before], { action: "transferOwnership", args: { id: "ws-1", memberId: "m-me" } });
  assert.match(view.note().textContent, /^This browser owns Line 5 now\.$/);

  const next = view.admin.calls.length;
  click(view.el.querySelector("[data-action='disconnect'][data-member='m-owner']"));
  assert.equal(view.q(".slate-book__confirm").getAttribute("data-kind"), "delete");
  assert.match(view.q(".slate-admin__confirm-line").textContent, /Disconnect Line 5 desk/);
  click(view.action("confirm-view"));
  await settle();
  assert.deepEqual(view.admin.calls[next], { action: "disconnectDevice", args: { id: "ws-1", memberId: "m-owner" } });
  assert.match(view.note().textContent, /Its next RT Sync request will be denied/);
});

test("maintenance is folded away; ownership to this device needs it on the line, and a merge needs a target", async () => {
  const view = boot();
  await view.open();
  click(view.row("ws-1"));
  await settle();
  const fold = view.action("toggle-maintenance");
  assert.equal(fold.getAttribute("aria-expanded"), "false");
  assert.ok(view.q(".slate-admin__maintenance-body").hasAttribute("hidden"));
  click(fold);
  assert.equal(view.view.getState().maintenanceOpen, true);
  assert.ok(!view.q(".slate-admin__maintenance-body").hasAttribute("hidden"));

  // This device is a member of ws-1 in the fake, so ownership is offered.
  assert.equal(view.action("transfer-to-this-device").getAttribute("data-able"), "true");
  // A merge needs its target chosen first.
  const merge = view.action("merge");
  assert.equal(merge.getAttribute("data-able"), "false");
  assert.match(merge.getAttribute("title"), /choose the line to merge into first/);
  const chips = view.el.querySelectorAll("[data-target]");
  assert.deepEqual(chips.map(chip => chip.getAttribute("data-target")), ["ws-2"], "the line itself was offered as a merge target");
  click(chips[0]);
  assert.equal(view.view.getState().mergeTargetId, "ws-2");
  assert.equal(view.el.querySelector("[data-target='ws-2']").getAttribute("aria-checked"), "true");
  assert.equal(view.action("merge").getAttribute("data-able"), "true");

  const before = view.admin.calls.length;
  click(view.action("merge"));
  assert.match(view.q(".slate-admin__confirm-line").textContent, /Merge “Line 5” into “Line 8”/);
  click(view.action("confirm-view"));
  await settle();
  assert.deepEqual(view.admin.calls[before], { action: "mergeWorkspace", args: { id: "ws-1", targetId: "ws-2" } });
  assert.equal(view.note().textContent, "Merged 3 recipes and 1 weight profile into Line 8; deleted Line 5.");
  assert.equal(view.view.getState().focusId, null, "the merged line stayed chosen");
});

test("Delete asks with the whole sentence and lets the line go afterwards", async () => {
  const view = boot();
  await view.open();
  click(view.row("ws-1"));
  await settle();
  click(view.action("toggle-maintenance"));
  const before = view.admin.calls.length;
  click(view.action("delete"));
  assert.match(view.q(".slate-admin__confirm-line").textContent, /Permanently delete “Line 5”\?/);
  click(view.action("confirm-view"));
  await settle();
  assert.deepEqual(view.admin.calls[before], { action: "deleteWorkspace", args: { id: "ws-1" } });
  assert.equal(view.note().textContent, "Deleted Line 5.");
  assert.equal(view.view.getState().focusId, null);
  assert.equal(view.view.getState().devices, 0);
});

test("a refused procedure keeps the line and says the application's words", async () => {
  const admin = makeAdmin({ answer: action => (action === "deleteWorkspace" ? { ok: false, code: "failed", message: "Another device is using that line." } : undefined) });
  const view = boot({ admin });
  await view.open();
  click(view.row("ws-1"));
  await settle();
  click(view.action("toggle-maintenance"));
  click(view.action("delete"));
  click(view.action("confirm-view"));
  await settle();
  assert.equal(view.note().textContent, "Another device is using that line.");
  assert.ok(view.note().classList.contains("is-error"));
  assert.equal(view.view.getState().focusId, "ws-1", "the line was let go on a refusal");
  assert.equal(view.rows().length, 2);
});

/* ----------------------------------------------------------------------
 *   The session
 * -------------------------------------------------------------------- */

test("a session that ends mid-request drops everything read under it and says so", async () => {
  const admin = makeAdmin({ answer: action => (action === "workspaceDevices" ? { ok: false, code: "not_authenticated", message: "Admin sign-in is required." } : undefined) });
  const view = boot({ admin });
  await view.open();
  assert.equal(view.rows().length, 2);
  click(view.row("ws-1"));
  await settle();
  assert.equal(view.view.getState().loaded, false, "the list survived the session ending");
  assert.equal(view.view.getState().workspaces, 0);
  assert.equal(view.view.getState().focusId, null);
  assert.equal(view.note().textContent, actions.WORDING.accessEnded);
});

test("signing out drops the list and shows the gate again; signing back in reads afresh", async () => {
  const view = boot();
  await view.open();
  assert.equal(view.rows().length, 2);
  view.admin.set({ signedIn: false, isAdmin: false, email: "" });
  await settle();
  assert.equal(view.view.getState().workspaces, 0);
  assert.equal(view.view.getState().loaded, false);
  assert.ok(!view.q(".slate-admin__gate").hasAttribute("hidden"));
  assert.ok(view.q(".slate-book__columns").hasAttribute("hidden"));
  const before = view.admin.calls.length;
  view.admin.set({ signedIn: true, isAdmin: true, email: "ada@example.com" });
  await settle();
  assert.deepEqual(view.admin.calls.slice(before).map(call => call.action), ["listWorkspaces"]);
  assert.equal(view.rows().length, 2);
});

test("leaving the section closes what was open, and with no bridge the section explains instead of asking", async () => {
  const view = boot();
  await view.open();
  click(view.row("ws-1"));
  await settle();
  click(view.action("toggle-maintenance"));
  click(view.action("rename-line"));
  view.view.onHide();
  assert.equal(view.view.getState().view, null);
  assert.equal(view.view.getState().maintenanceOpen, false);
  const before = view.admin.calls.length;
  view.admin.set({ signedIn: true });
  await settle();
  assert.equal(view.admin.calls.length, before, "a publish read the list while the section was away");

  const none = boot({ admin: null });
  await none.open();
  assert.match(none.q(".slate-admin__gate").textContent, /No application is connected/);
  assert.ok(none.q(".slate-book__columns").hasAttribute("hidden"));
  assert.doesNotThrow(() => none.view.refresh());
});

test("a producer that offers only some of the actions withholds the rest with the reason", async () => {
  const admin = makeAdmin({ capabilities: ["signIn", "signOut", "listWorkspaces", "workspaceDevices"] });
  const view = boot({ admin });
  await view.open();
  assert.equal(view.action("create-line").getAttribute("data-able"), "false");
  assert.match(view.action("create-line").getAttribute("title"), /does not offer createLine from Slate/);
  click(view.row("ws-1"));
  await settle();
  assert.equal(view.action("rename-line").getAttribute("data-able"), "false");
  assert.equal(view.action("add-this-device").getAttribute("data-able"), "false");
  const before = view.admin.calls.length;
  click(view.action("add-this-device"));
  assert.equal(view.view.getState().view, null, "a withheld control opened its confirmation");
  assert.equal(view.admin.calls.length, before);
});
