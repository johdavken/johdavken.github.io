"use strict";

/* The connection bridge (station-connection-bridge.js): the projection's
 * allow-list, the window's read-only face, and the letterbox's contract.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const bridgeModule = require("./station-connection-bridge.js");
const { project, ACTIONS, ARGUMENTS, normalizeArguments } = bridgeModule;

/* cloud-sync's getState() as it looks on a Line 9 desktop that is synced
 * with two other devices. Deliberately carries everything the real object
 * carries, including what must NOT cross. */
function syncedLine9(overrides) {
  return Object.assign({
    enabled: true, available: true, status: "Synced", message: "RT Sync is up to date.",
    userId: "anon-user-desktop", deviceLabel: "Line 9 Desktop", connected: true,
    workspaces: [{ id: "ws-9", name: "Line 9" }, { id: "ws-10", name: "Line 10" }],
    selectedWorkspaceId: "ws-9",
    selectedWorkspace: { id: "ws-9", name: "Line 9", revision: 4, membership: { role: "owner", user_id: "anon-user-desktop" } },
    members: [
      { workspace_id: "ws-9", user_id: "anon-user-desktop", device_id: "dev-desktop", device_label: "Line 9 Desktop", role: "owner", joined_at: "2026-09-01T08:00:00Z", last_seen_at: "2026-09-01T08:00:00Z" },
      { workspace_id: "ws-9", user_id: "anon-user-phone", device_id: "dev-phone", device_label: "Operator Phone", role: "member", joined_at: "2026-09-02T09:30:00Z", last_seen_at: "2026-09-02T09:30:00Z" },
      { workspace_id: "ws-9", user_id: "anon-user-tablet", device_id: "dev-tablet", device_label: "Floor Tablet", role: "member", joined_at: "2026-09-03T10:00:00Z", last_seen_at: "2026-09-03T10:00:00Z" }
    ],
    activeRevision: 12, workspaceRevision: 4, lastSyncAt: "2026-09-11T14:02:00Z",
    pendingCount: 0, pendingSummary: [], generatedCode: "", generatedCodeExpiresAt: "",
    isApplyingRemote: false, deviceId: "dev-desktop"
  }, overrides || {});
}

/* ----------------------------------------------------------------------
 *   Projection
 * -------------------------------------------------------------------- */

test("a synced Line 9 desktop projects as Line 9, synced, three devices, with this desktop marked", () => {
  const status = project(syncedLine9(), { lineNumber: 9, displayName: "Line 9" });
  assert.equal(status.assigned, true);
  assert.deepEqual(status.line, { workspaceId: "ws-9", name: "Line 9", lineNumber: 9, displayName: "Line 9", role: "owner" });
  assert.equal(status.linked, true);
  assert.equal(status.status.key, "synced");
  assert.equal(status.status.label, "Synced");
  assert.equal(status.status.known, true);
  assert.equal(status.deviceCount, 3);
  assert.deepEqual(status.devices.map(device => [device.label, device.role, device.thisDevice]), [
    ["Line 9 Desktop", "owner", true],
    ["Operator Phone", "member", false],
    ["Floor Tablet", "member", false]
  ]);
  assert.deepEqual(status.can, { refresh: true, reconnect: false, addDevice: true, join: true, select: true, leave: false, relabel: true });
  assert.equal(status.line.role, "owner");
  assert.equal(status.deviceLabel, "Line 9 Desktop");
});

test("the line identity is the selected workspace and nothing else - a stale selectedWorkspace object does not count", () => {
  const status = project(syncedLine9({ selectedWorkspace: { id: "ws-10", name: "Line 10" } }), { lineNumber: 10 });
  assert.equal(status.assigned, false);
  assert.equal(status.line, null);
  assert.equal(status.linked, false);
  assert.deepEqual(status.can, { refresh: false, reconnect: false, addDevice: false, join: true, select: true, leave: false, relabel: true });
});

test("the projection carries no identity, credential, revision or queue detail across", () => {
  const status = project(syncedLine9({ generatedCode: "AB12", generatedCodeExpiresAt: "2026-09-11T14:32:00Z" }),
    { lineNumber: 9, joinUrl: "https://resin.tools/?rtSyncCode=AB12" });
  const flat = JSON.stringify(status);
  for (const secret of ["anon-user", "dev-desktop", "dev-phone", "user_id", "device_id", "activeRevision", "workspaceRevision",
    "pendingSummary", "membership", "access", "token"]) {
    assert.ok(!flat.includes(secret), `the descriptor carries "${secret}"`);
  }
  // The remembered lines cross as display facts only - an id to name them
  // by, a name, and what the application resolves for them - never a
  // membership row or a revision.
  assert.deepEqual(project(syncedLine9(), { lineNumber: 9, workspaces: [{ id: "ws-9", lineNumber: 9, displayName: "Line 9" }, { id: "ws-10", lineNumber: 10, displayName: "" }] }).workspaces,
    [{ id: "ws-9", name: "Line 9", lineNumber: 9, displayName: "Line 9" }, { id: "ws-10", name: "Line 10", lineNumber: 10, displayName: "Line 10" }]);
  assert.deepEqual(project(syncedLine9(), { lineNumber: 9 }).workspaces.map(item => item.displayName), ["Line 9", "Line 10"], "without facts a line is named by its workspace");
  assert.deepEqual(project(syncedLine9(), { lineNumber: 9, workspaces: [{ id: "ws-99", lineNumber: 99 }] }).workspaces.map(item => item.id), ["ws-9", "ws-10"], "a fact for a line cloud-sync does not list never crosses");
  // The join code and its link are the two facts the QR view needs, and
  // they only cross while the line is linked.
  assert.deepEqual(status.joinCode, { code: "AB12", expiresAt: "2026-09-11T14:32:00Z", url: "https://resin.tools/?rtSyncCode=AB12" });
  assert.equal(project(syncedLine9({ generatedCode: "AB12", connected: false }), { lineNumber: 9 }).joinCode, null);
});

test("a remembered line that is locally disconnected keeps its name and offers Reconnect, not Refresh", () => {
  const status = project(syncedLine9({ connected: false, status: "Local only", message: "Disconnected on this device. Server membership is preserved." }), { lineNumber: 9 });
  assert.equal(status.assigned, true);
  assert.equal(status.line.displayName, "Line 9");
  assert.equal(status.linked, false);
  assert.equal(status.status.key, "local-only");
  assert.deepEqual(status.can, { refresh: false, reconnect: true, addDevice: false, join: true, select: true, leave: false, relabel: true });
});

test("every cloud-sync status word maps to its own key, and nothing is upgraded to Synced", () => {
  const seen = {};
  for (const word of ["Connecting", "Local only", "Syncing", "Synced", "Pending", "Offline", "Conflict", "Error"]) {
    const status = project(syncedLine9({ status: word }), { lineNumber: 9 });
    seen[word] = status.status.key;
    assert.equal(status.status.label, word);
    assert.equal(status.status.known, true);
  }
  assert.deepEqual(seen, {
    Connecting: "connecting", "Local only": "local-only", Syncing: "syncing", Synced: "synced",
    Pending: "pending", Offline: "offline", Conflict: "conflict", Error: "error"
  });
  // An unknown word passes through under its own key rather than being
  // mapped onto a state the application never reported.
  const odd = project(syncedLine9({ status: "Reticulating" }), { lineNumber: 9 });
  assert.equal(odd.status.key, "reticulating");
  assert.equal(odd.status.known, false);
  // Offline is offline even though the line is linked - `linked` is the
  // operator's link, the status word is the connection.
  const offline = project(syncedLine9({ status: "Offline" }), { lineNumber: 9 });
  assert.equal(offline.linked, true);
  assert.equal(offline.status.key, "offline");
});

test("pending count and last sync cross as numbers and strings; the busy flag closes every action", () => {
  const status = project(syncedLine9({ pendingCount: 2 }), { lineNumber: 9, busy: true, busyAction: "refresh" });
  assert.equal(status.status.pendingCount, 2);
  assert.equal(status.status.lastSyncAt, "2026-09-11T14:02:00Z");
  assert.deepEqual(status.busy, { active: true, action: "refresh" });
  assert.deepEqual(status.can, { refresh: false, reconnect: false, addDevice: false, join: false, select: false, leave: false, relabel: false });
  assert.deepEqual(project(syncedLine9(), { lineNumber: 9 }).busy, { active: false, action: "" });
});

test("an access-revoked Error reads as admin-required and withdraws Reconnect, exactly as the floor UI does", () => {
  const status = project(syncedLine9({ connected: false, status: "Error", message: "This device no longer has access to this line." }), { lineNumber: 9 });
  assert.equal(status.status.adminRequired, true);
  assert.equal(status.can.reconnect, false);
  const plain = project(syncedLine9({ connected: false, status: "Error", message: "Upload failed: timeout" }), { lineNumber: 9 });
  assert.equal(plain.status.adminRequired, false);
  assert.equal(plain.can.reconnect, true);
});

test("with RT Sync disabled or unavailable nothing is offered, and a workspace that maps to no line keeps its own name", () => {
  const disabled = project(syncedLine9({ enabled: false, available: false, status: "Local only" }), { lineNumber: 9 });
  assert.deepEqual(disabled.can, { refresh: false, reconnect: false, addDevice: false, join: false, select: false, leave: false, relabel: false });
  const unavailable = project(syncedLine9({ available: false }), { lineNumber: 9 });
  assert.equal(unavailable.can.addDevice, false, "a join code needs the RT Sync client");
  assert.equal(unavailable.can.refresh, true, "a refresh may still try - it is how the client comes back");
  const unmapped = project(syncedLine9({ selectedWorkspace: { id: "ws-9", name: "East Wing" } }), { lineNumber: null });
  assert.equal(unmapped.line.lineNumber, null);
  assert.equal(unmapped.line.displayName, "East Wing");
  assert.equal(project(null), null);
  assert.equal(project(undefined), null);
});

/* ----------------------------------------------------------------------
 *   The window
 * -------------------------------------------------------------------- */

test("with no producer the status is null, the actions are unavailable, and nothing throws", async () => {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  assert.equal(bridge.isConnected(), false);
  assert.equal(bridge.getStatus(), null);
  assert.deepEqual([...bridge.capabilities()], []);
  const result = await bridge.request("refresh");
  assert.equal(result.ok, false);
  assert.equal(result.code, "unavailable");
  assert.ok(Object.isFrozen(result));
});

test("the producer's read is projected lazily, cloned, frozen, and re-read only after a publish", () => {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  let reads = 0;
  let state = syncedLine9();
  const handle = bridge.connect({ read: () => { reads += 1; return project(state, { lineNumber: 9 }); } });
  assert.equal(reads, 0, "connect reads nothing on its own");
  const first = bridge.getStatus();
  assert.equal(reads, 1);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.devices) && Object.isFrozen(first.devices[0]));
  assert.equal(bridge.getStatus(), first, "the same revision is the same object");
  assert.equal(reads, 1);
  state = syncedLine9({ status: "Offline" });
  assert.equal(bridge.getStatus().status.key, "synced", "without a publish nothing is re-read");
  handle.publish();
  assert.equal(bridge.getStatus().status.key, "offline");
  assert.equal(reads, 2);
});

test("subscribers are told once per tick however many publishes arrive, and disconnect tells them with null", () => {
  const queued = [];
  const bridge = bridgeModule.create({ scheduler: run => queued.push(run) });
  const seen = [];
  bridge.subscribe(status => seen.push(status ? status.status.key : null));
  const handle = bridge.connect({ read: () => project(syncedLine9(), { lineNumber: 9 }) });
  handle.publish(); handle.publish(); handle.publish();
  assert.equal(queued.length, 1, "connect and three publishes coalesce into one notification");
  queued.splice(0).forEach(run => run());
  assert.deepEqual(seen, ["synced"]);
  handle.disconnect();
  queued.splice(0).forEach(run => run());
  assert.deepEqual(seen, ["synced", null]);
  assert.equal(bridge.isConnected(), false);
});

test("a second producer is refused, and the module surface gives consumers no publish", () => {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  bridge.connect({ read: () => null });
  assert.throws(() => bridge.connect({ read: () => null }), /already connected/);
  assert.throws(() => bridgeModule.create().connect({}), /requires a read function/);
  for (const key of ["publish", "disconnect"]) assert.equal(bridge[key], undefined);
  assert.ok(Object.isFrozen(bridge));
});

/* ----------------------------------------------------------------------
 *   The letterbox
 * -------------------------------------------------------------------- */

test("a request reaches the producer's own action exactly once and its answer comes back frozen", async () => {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const calls = [];
  bridge.connect({
    read: () => null,
    actions: {
      refresh: async () => { calls.push("refresh"); return { ok: true }; },
      generateJoinCode: async () => { calls.push("code"); return true; },
      renderJoinQr: async () => ({ ok: true, code: "AB12", svg: "<svg/>" })
    }
  });
  assert.deepEqual([...bridge.capabilities()], ["refresh", "generateJoinCode", "renderJoinQr"]);
  const refreshed = await bridge.request("refresh");
  assert.deepEqual(refreshed, { ok: true });
  assert.ok(Object.isFrozen(refreshed));
  assert.deepEqual(calls, ["refresh"]);
  // A bare true from the application's own action runner is a success.
  assert.deepEqual(await bridge.request("generateJoinCode"), { ok: true });
  const qr = await bridge.request("renderJoinQr");
  assert.deepEqual(qr, { ok: true, code: "AB12", svg: "<svg/>" });
  assert.ok(Object.isFrozen(qr));
  // An action the producer did not hand over is unavailable, not an error
  // in Station.
  const reconnect = await bridge.request("reconnect");
  assert.equal(reconnect.code, "unavailable");
  assert.deepEqual(calls, ["refresh", "code"]);
});

test("a throwing, rejecting or false-returning action becomes a failure value with the application's own message", async () => {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  bridge.connect({
    read: () => null,
    actions: {
      refresh: async () => { throw new Error("The shared line changed on another device."); },
      reconnect: () => { throw new TypeError("sync"); },
      generateJoinCode: async () => false,
      renderJoinQr: async () => ({ ok: false, code: "failed", message: "No join code has been generated." })
    }
  });
  const thrown = await bridge.request("refresh");
  assert.deepEqual(thrown, { ok: false, code: "failed", message: "The shared line changed on another device." });
  assert.equal((await bridge.request("reconnect")).code, "failed");
  assert.equal((await bridge.request("generateJoinCode")).code, "failed");
  assert.equal((await bridge.request("renderJoinQr")).message, "No join code has been generated.");
});

test("the vocabulary is closed: an unknown action is refused at request time and at connect time", async () => {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  assert.throws(() => bridge.connect({ read: () => null, actions: { deleteWorkspace: async () => true } }), /unknown action "deleteWorkspace"/);
  assert.equal(bridge.isConnected(), false, "a refused connect leaves nothing connected");
  bridge.connect({ read: () => null, actions: { refresh: async () => true } });
  const result = await bridge.request("deleteWorkspace");
  assert.equal(result.code, "unknown_action");
  assert.deepEqual([...ACTIONS], ["refresh", "reconnect", "generateJoinCode", "renderJoinQr", "joinWorkspace", "selectWorkspace", "leaveWorkspace", "relabelDevice"]);
  assert.deepEqual(Object.keys(ARGUMENTS), [...ACTIONS], "every action declares its arguments, even when there are none");
});

/* ----------------------------------------------------------------------
 *   The phone panel's four: arguments are checked before the closure runs
 * -------------------------------------------------------------------- */

test("a join code is rebuilt upper-cased and trimmed; a bad code, a missing id or a blank device name is refused by field and the closure never runs", async () => {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const seen = [];
  bridge.connect({
    read: () => null,
    actions: {
      joinWorkspace: async args => { seen.push(["join", args]); return true; },
      selectWorkspace: async args => { seen.push(["select", args]); return true; },
      leaveWorkspace: async args => { seen.push(["leave", args]); return true; },
      relabelDevice: async args => { seen.push(["relabel", args]); return true; },
      refresh: async args => { seen.push(["refresh", args]); return true; }
    }
  });
  assert.deepEqual(await bridge.request("joinWorkspace", { code: " ab12 ", label: "  Line 9   phone " }), { ok: true });
  assert.deepEqual(seen.pop(), ["join", { code: "AB12", label: "Line 9 phone" }]);
  assert.deepEqual(await bridge.request("joinWorkspace", { code: "AB12" }), { ok: true });
  assert.deepEqual(seen.pop(), ["join", { code: "AB12" }], "a blank label is left to cloud-sync, which keeps the current one");
  for (const bad of [{ code: "ab1" }, { code: "AB 12" }, { code: 1234 }, {}, null]) {
    const refused = await bridge.request("joinWorkspace", bad);
    assert.deepEqual(refused, { ok: false, code: "bad_argument", message: "Enter the four-character link code.", field: "code" });
  }
  assert.deepEqual(await bridge.request("selectWorkspace", { id: " ws-10 " }), { ok: true });
  assert.deepEqual(seen.pop(), ["select", { id: "ws-10" }]);
  assert.equal((await bridge.request("selectWorkspace", {})).field, "id");
  assert.equal((await bridge.request("relabelDevice", { label: "   " })).field, "label");
  assert.equal((await bridge.request("relabelDevice", { label: "x".repeat(200) })).ok, true);
  assert.equal(seen.pop()[1].label.length, 80, "a label is cut to the floor UI's own field length");
  assert.deepEqual(await bridge.request("leaveWorkspace", { anything: true }), { ok: true });
  assert.deepEqual(seen.pop(), ["leave", {}], "a zero-argument action receives nothing it did not declare");
  assert.deepEqual(await bridge.request("refresh", { code: "zzz" }), { ok: true });
  assert.deepEqual(seen.pop(), ["refresh", {}]);
  assert.equal(seen.length, 0, "a refused argument never reached a closure");
  assert.ok(Object.isFrozen(normalizeArguments("joinWorkspace", { code: "AB12" }).args));
});

test("Leave is withdrawn from the owner and offered to a member; the owner's reason is the application's own", () => {
  const owner = project(syncedLine9(), { lineNumber: 9 });
  assert.equal(owner.can.leave, false);
  const member = project(syncedLine9({ selectedWorkspace: { id: "ws-9", name: "Line 9", membership: { role: "member" } } }), { lineNumber: 9 });
  assert.equal(member.line.role, "member");
  assert.equal(member.can.leave, true);
  assert.equal(project(syncedLine9({ available: false }), { lineNumber: 9 }).can.join, false, "joining needs the client");
  assert.equal(project(syncedLine9({ workspaces: [] }), { lineNumber: 9 }).can.select, false, "nothing to choose from");
});

test("disconnecting withdraws the actions along with the window", async () => {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const handle = bridge.connect({ read: () => project(syncedLine9(), { lineNumber: 9 }), actions: { refresh: async () => true } });
  assert.equal((await bridge.request("refresh")).ok, true);
  assert.equal(handle.disconnect(), true);
  assert.equal(handle.disconnect(), false);
  assert.equal((await bridge.request("refresh")).code, "unavailable");
  assert.equal(bridge.getStatus(), null);
});

/* ----------------------------------------------------------------------
 *   Questions: the application asks, a console answers
 * -------------------------------------------------------------------- */

test("with no answerer the application is told null and asks its own way; an answerer turns the ask into a promise of an allowed answer, with the details frozen and rebuilt", async () => {
  const bridge = bridgeModule.create();
  assert.deepEqual(bridgeModule.QUESTIONS, { conflict: ["remote", "local", "cancel"] });
  assert.equal(bridge.ask("conflict", { localRevision: 1, remoteRevision: 2 }), null);
  assert.equal(bridge.answers("conflict"), false);
  const seen = [];
  const off = bridge.answer("conflict", details => { seen.push(details); return "local"; });
  assert.equal(bridge.answers("conflict"), true);
  const asked = bridge.ask("conflict", { localRevision: "3", remoteRevision: 5, extra: "dropped" });
  assert.ok(asked && typeof asked.then === "function");
  assert.equal(await asked, "local");
  assert.deepEqual(seen, [{ localRevision: 3, remoteRevision: 5 }]);
  assert.ok(Object.isFrozen(seen[0]));
  assert.equal(await bridge.ask("conflict", null), "local");
  assert.deepEqual(seen[1], { localRevision: null, remoteRevision: null });
  assert.equal(off(), true);
  assert.equal(off(), false);
  assert.equal(bridge.ask("conflict", {}), null);
});

test("an answer outside the kind's list, a throw, a rejection or a non-answer all read as the safe answer; the last answerer registered answers; an unknown kind is never asked", async () => {
  const bridge = bridgeModule.create();
  bridge.answer("conflict", () => "discard");
  assert.equal(await bridge.ask("conflict", {}), "cancel");
  bridge.answer("conflict", () => { throw new Error("boom"); });
  assert.equal(await bridge.ask("conflict", {}), "cancel");
  bridge.answer("conflict", () => Promise.reject(new Error("no")));
  assert.equal(await bridge.ask("conflict", {}), "cancel");
  bridge.answer("conflict", () => undefined);
  assert.equal(await bridge.ask("conflict", {}), "cancel");
  bridge.answer("conflict", async () => "remote");
  assert.equal(await bridge.ask("conflict", {}), "remote");
  assert.equal(typeof bridge.answer("weather", () => "sunny"), "function");
  assert.equal(bridge.answers("weather"), false);
  assert.equal(bridge.ask("weather", {}), null);
  assert.equal(typeof bridge.answer("conflict", "not a function"), "function");
  // The module surface offers the same three, on the shared bridge.
  for (const name of ["ask", "answer", "answers"]) assert.equal(typeof bridgeModule[name], "function");
});
