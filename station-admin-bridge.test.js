"use strict";

/* The admin bridge (station-admin-bridge.js): a window onto administrator
 * access and a letterbox for the admin actions. What is pinned: the window
 * carries no session, no client and no full identity; the letterbox's
 * vocabulary is closed; arguments are checked and rebuilt; every answer is
 * frozen and carries only what the action's shape allows - never a raw
 * row, never a throw; and the producer's handle is the only thing that
 * can publish or disconnect.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const bridgeModule = require("./station-admin-bridge.js");

const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

function producer(overrides) {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const env = {
    calls: [],
    admin: { ready: true, signedIn: true, isAdmin: true, email: "admin@example.com", userId: "user-admin-1" },
    device: { ready: true, userId: "anon-user-1234567890", deviceId: "device-abcdefghijkl", deviceLabel: "Desk A" }
  };
  const record = name => async args => { env.calls.push({ name, args }); return (overrides && overrides[name]) ? overrides[name](args) : { ok: true }; };
  const actions = {};
  for (const name of bridgeModule.ACTIONS) actions[name] = record(name);
  const handle = bridge.connect({ read: () => bridgeModule.project(env.admin, env.device), actions });
  return { bridge, env, handle };
}

/* ----------------------------------------------------------------------
 *   The window
 * -------------------------------------------------------------------- */

test("project() carries access as three facts and this device as a label and two short ids - never a session, a client, or a full identity", () => {
  const out = bridgeModule.project(
    { ready: true, signedIn: true, isAdmin: true, email: "admin@example.com", userId: "user-admin-1", client: {}, token: "t" },
    { ready: true, userId: "anon-user-1234567890", deviceId: "device-abcdefghijkl", deviceLabel: "Desk A", secret: "x" }
  );
  assert.deepEqual(out, {
    access: { ready: true, signedIn: true, email: "admin@example.com" },
    device: { ready: true, label: "Desk A", userIdShort: "anon-use", deviceIdShort: "device-a" }
  });
  assert.equal(JSON.stringify(out).includes("user-admin-1"), false, "the admin user id does not cross");
  assert.equal(JSON.stringify(out).includes("1234567890"), false, "the full anonymous identity does not cross");
});

test("project() reads a signed-in non-admin, an unfinished check, and nothing at all as signed out", () => {
  assert.equal(bridgeModule.project({ ready: true, signedIn: true, isAdmin: false, email: "x@y" }, null).access.signedIn, false);
  assert.equal(bridgeModule.project({ ready: true, signedIn: true, isAdmin: false, email: "x@y" }, null).access.email, "", "no email for a signed-out reading");
  assert.deepEqual(bridgeModule.project({ ready: false }, null).access, { ready: false, signedIn: false, email: "" });
  assert.deepEqual(bridgeModule.project(null, null), {
    access: { ready: false, signedIn: false, email: "" },
    device: { ready: false, label: "", userIdShort: "", deviceIdShort: "" }
  });
});

test("the window is the state bridge's: frozen, revisioned, one notification per publish, null with no producer", async () => {
  const fresh = bridgeModule.create({ scheduler: run => run() });
  assert.equal(fresh.getAccess(), null);
  assert.equal(fresh.isConnected(), false);
  const { bridge, env, handle } = producer();
  const seen = [];
  bridge.subscribe(snapshot => seen.push(snapshot));
  const first = bridge.getAccess();
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.access) && Object.isFrozen(first.device));
  assert.equal(first.access.signedIn, true);
  env.admin = { ready: true, signedIn: false, isAdmin: false, email: "" };
  handle.publish();
  assert.equal(bridge.getAccess().access.signedIn, false);
  assert.equal(seen.length, 1, "one publish, one notification (the connect notification ran before the subscription)");
  assert.equal(handle.disconnect(), true);
  assert.equal(bridge.isConnected(), false);
  assert.equal(bridge.getAccess(), null);
  await tick();
});

/* ----------------------------------------------------------------------
 *   The letterbox
 * -------------------------------------------------------------------- */

test("the vocabulary is closed: an unknown action is refused at connect and at request, and a missing producer answers unavailable", async () => {
  const fresh = bridgeModule.create({ scheduler: run => run() });
  assert.throws(() => fresh.connect({ read: () => ({}), actions: { dropTable: async () => ({ ok: true }) } }), /unknown action "dropTable"/);
  assert.deepEqual(await fresh.request("listWorkspaces"), { ok: false, code: "unavailable", message: "No application is connected to Station's administrator tools." });
  assert.deepEqual(await fresh.request("dropTable"), { ok: false, code: "unknown_action", message: '"dropTable" is not an administrator action.' });
  assert.deepEqual([...fresh.capabilities()], []);
  const { bridge } = producer();
  assert.deepEqual([...bridge.capabilities()], [...bridgeModule.ACTIONS]);
  const partial = bridgeModule.create({ scheduler: run => run() });
  partial.connect({ read: () => ({}), actions: { signOut: async () => ({ ok: true }) } });
  assert.deepEqual([...partial.capabilities()], ["signOut"]);
  assert.equal((await partial.request("deleteWorkspace", { id: "w" })).code, "unavailable");
});

test("arguments are checked and rebuilt per action; nothing else that was passed crosses", async () => {
  const { bridge, env } = producer();
  const bad = await bridge.request("signIn", { email: "a@b", password: "" });
  assert.deepEqual(bad, { ok: false, code: "bad_argument", message: "A password is required.", field: "password" });
  assert.equal(env.calls.length, 0, "a refused request reaches no action");
  await bridge.request("signIn", { email: "  a@b  ", password: " secret ", extra: "no" });
  assert.deepEqual(env.calls[0].args, { email: "a@b", password: " secret " }, "the email is trimmed, the password taken as typed, the extra dropped");
  await bridge.request("renameLine", { id: " w-1 ", name: "  Line   10 " });
  assert.deepEqual(env.calls[1].args, { id: "w-1", name: "Line 10" });
  assert.equal((await bridge.request("renameLine", { id: "w-1", name: "   " })).field, "name");
  assert.equal((await bridge.request("workspaceDevices", {})).field, "id");
  assert.equal((await bridge.request("transferOwnership", { id: "w-1" })).field, "memberId");
  const same = await bridge.request("mergeWorkspace", { id: "w-1", targetId: "w-1" });
  assert.deepEqual(same, { ok: false, code: "bad_argument", message: "Choose a different target workspace.", field: "targetId" });
  await bridge.request("signOut", { anything: 1 });
  assert.deepEqual(env.calls[env.calls.length - 1].args, {});
});

test("an answer is rebuilt by allow-list for its action: a workspace and a device carry their public fields and nothing else", async () => {
  const { bridge } = producer({
    listWorkspaces: async () => ({ ok: true, workspaces: [
      { id: "w-1", name: "Line 10", memberCount: "3", recipeCount: 8, profileCount: 1, createdAt: "2026-01-03T00:00:00Z", lastActivityAt: "2026-09-12T00:00:00Z", thisDevice: 1, owner_user_id: "secret" },
      { id: "", name: "orphan" }
    ] }),
    workspaceDevices: async () => ({ ok: true, devices: [
      { memberId: "anon-1", label: "Desk A", role: "owner", lastSeenAt: "2026-09-12T10:00:00Z", thisDevice: true, session: "s" },
      { memberId: "anon-2", label: "", role: "weird", lastSeenAt: null, thisDevice: false }
    ] }),
    addThisDevice: async () => ({ ok: true, alreadyMember: "yes", role: "member", raw: {} }),
    createLine: async () => ({ ok: true, id: "w-9", name: "Line 9", workspace: { secret: true } }),
    mergeWorkspace: async () => ({ ok: true, recipesMerged: "2", profilesMerged: -1 })
  });
  const list = await bridge.request("listWorkspaces");
  assert.ok(Object.isFrozen(list) && Object.isFrozen(list.workspaces) && Object.isFrozen(list.workspaces[0]));
  assert.deepEqual(list.workspaces, [{
    id: "w-1", name: "Line 10", memberCount: 3, recipeCount: 8, profileCount: 1,
    createdAt: "2026-01-03T00:00:00Z", lastActivityAt: "2026-09-12T00:00:00Z", thisDevice: true
  }], "the id-less row is dropped; the owner id never crosses");
  const devices = await bridge.request("workspaceDevices", { id: "w-1" });
  assert.deepEqual(devices.devices, [
    { memberId: "anon-1", label: "Desk A", role: "owner", lastSeenAt: "2026-09-12T10:00:00Z", thisDevice: true },
    { memberId: "anon-2", label: "", role: "member", lastSeenAt: "", thisDevice: false }
  ], "an unknown role reads as member; a session never crosses");
  assert.deepEqual(await bridge.request("addThisDevice", { id: "w-1" }), { ok: true, alreadyMember: true, role: "member" });
  assert.deepEqual(await bridge.request("createLine", { name: "Line 9" }), { ok: true, id: "w-9", name: "Line 9" });
  assert.deepEqual(await bridge.request("mergeWorkspace", { id: "w-1", targetId: "w-2" }), { ok: true, recipesMerged: 2, profilesMerged: 0 });
  assert.deepEqual(await bridge.request("signOut"), { ok: true });
});

test("a failure keeps its code when the bridge knows it, becomes `failed` otherwise, and a throw is an answer rather than an exception", async () => {
  const { bridge } = producer({
    deleteWorkspace: async () => ({ ok: false, code: "not_authenticated", message: "Admin sign-in is required." }),
    renameLine: async () => ({ ok: false, code: "table_locked", message: "no" }),
    disconnectDevice: async () => { throw new Error("boom"); },
    signIn: async () => false
  });
  assert.deepEqual(await bridge.request("deleteWorkspace", { id: "w" }), { ok: false, code: "not_authenticated", message: "Admin sign-in is required." });
  assert.deepEqual(await bridge.request("renameLine", { id: "w", name: "n" }), { ok: false, code: "failed", message: "no" });
  assert.deepEqual(await bridge.request("disconnectDevice", { id: "w", memberId: "m" }), { ok: false, code: "failed", message: "boom" });
  assert.deepEqual(await bridge.request("signIn", { email: "a@b", password: "p" }), { ok: false, code: "failed", message: "The application did not complete the action." });
});

test("the handle is the only way to publish or disconnect, and the module surface is frozen", () => {
  for (const forbidden of ["publish", "disconnect", "setAccess", "state"]) assert.equal(bridgeModule[forbidden], undefined);
  assert.ok(Object.isFrozen(bridgeModule));
  assert.ok(Object.isFrozen(bridgeModule.ACTIONS) && Object.isFrozen(bridgeModule.ARGUMENTS) && Object.isFrozen(bridgeModule.ERROR_CODES));
  const { bridge, handle } = producer();
  assert.ok(Object.isFrozen(handle));
  assert.throws(() => bridge.connect({ read: () => ({}), actions: {} }), /already connected/);
  handle.disconnect();
  assert.equal(handle.disconnect(), false, "a second disconnect is a no-op");
});
