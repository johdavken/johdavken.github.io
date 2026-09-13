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

/* ----------------------------------------------------------------------
 *   Line Configuration: the two actions added for Sudo's second tool
 * -------------------------------------------------------------------- */

test("a line configuration crosses outward by allow-list: the definition's fields, its id and updated time, the side as one of two or null, metadata as a plain clone - never the row", async () => {
  const { bridge } = producer({
    listLineConfigurations: async () => ({ ok: true, lines: [
      { id: "l-8", line_number: 8, lineNumber: "8", displayName: "Line 8", aliases: ["Eight", " ", "Eight", 7], layerCount: "3", layerAPosition: "inside",
        hopperGeometry: "volume", hopperNamingMode: "standard", isActive: true, metadata: { note: "kept", nested: { a: 1 } }, updatedAt: "2026-09-01T00:00:00Z",
        created_at: "x", extra: "dropped" },
      { id: "l-1", lineNumber: 1, displayName: "Line 1", layerCount: 1, layerAPosition: null, hopperGeometry: "volume", hopperNamingMode: "standard", isActive: false, metadata: "bad" },
      { id: "l-x", lineNumber: 5, displayName: "Line 5", layerCount: 3, layerAPosition: "sideways", hopperGeometry: "cylindrical", hopperNamingMode: "standard" },
      { lineNumber: 6, displayName: "no id" }
    ] })
  });
  const result = await bridge.request("listLineConfigurations");
  assert.ok(result.ok && Object.isFrozen(result) && Object.isFrozen(result.lines));
  assert.deepEqual(result.lines.map(line => ({ ...line, aliases: [...line.aliases], metadata: { ...line.metadata } })), [
    { id: "l-8", lineNumber: 8, displayName: "Line 8", aliases: ["Eight"], layerCount: 3, layerAPosition: "inside", hopperGeometry: "volume",
      hopperNamingMode: "standard", isActive: true, metadata: { note: "kept", nested: { a: 1 } }, updatedAt: "2026-09-01T00:00:00Z" },
    { id: "l-1", lineNumber: 1, displayName: "Line 1", aliases: [], layerCount: 1, layerAPosition: null, hopperGeometry: "volume",
      hopperNamingMode: "standard", isActive: false, metadata: {}, updatedAt: "" },
    { id: "l-x", lineNumber: 5, displayName: "Line 5", aliases: [], layerCount: 3, layerAPosition: null, hopperGeometry: "cylindrical",
      hopperNamingMode: "standard", isActive: true, metadata: {}, updatedAt: "" }
  ], "a row without an id is dropped; an unknown side is no side; `created_at` and `extra` do not cross");
  assert.equal(JSON.stringify(result).includes("dropped"), false);
});

test("a save's arguments are rebuilt field by field - integers, collapsed names, an alias list, N/A as null, a boolean, a metadata clone - and a field of the wrong kind is refused before the application is asked", async () => {
  const { bridge, env } = producer({
    saveLineConfiguration: async ({ id, line }) => ({ ok: true, line: { id: id || "l-new", ...line, updatedAt: "2026-09-13T00:00:00Z" } })
  });
  const metadata = { note: "kept" };
  const result = await bridge.request("saveLineConfiguration", { id: " l-8 ", line: {
    lineNumber: "8", displayName: "  Line   8 ", aliases: [" Eight ", "", "Eight", "L8"], layerCount: "3", layerAPosition: "inside",
    hopperGeometry: " volume ", hopperNamingMode: "standard", isActive: "yes", metadata, id: "smuggled", created_at: "x"
  } });
  assert.ok(result.ok);
  assert.deepEqual(env.calls[0].args, { id: "l-8", line: {
    lineNumber: 8, displayName: "Line 8", aliases: ["Eight", "L8"], layerCount: 3, layerAPosition: "inside",
    hopperGeometry: "volume", hopperNamingMode: "standard", isActive: true, metadata: { note: "kept" }
  } });
  assert.ok(Object.isFrozen(env.calls[0].args.line));
  assert.notEqual(env.calls[0].args.line.metadata, metadata, "the metadata is a clone");
  assert.deepEqual({ ...result.line, aliases: [...result.line.aliases], metadata: { ...result.line.metadata } }, {
    id: "l-8", lineNumber: 8, displayName: "Line 8", aliases: ["Eight", "L8"], layerCount: 3, layerAPosition: "inside",
    hopperGeometry: "volume", hopperNamingMode: "standard", isActive: true, metadata: { note: "kept" }, updatedAt: "2026-09-13T00:00:00Z"
  });
  // Create: no id crosses as an empty one; N/A and "" are null.
  await bridge.request("saveLineConfiguration", { line: { lineNumber: 1, displayName: "Line 1", layerCount: 1, layerAPosition: "n/a", hopperGeometry: "volume", hopperNamingMode: "standard", isActive: false } });
  assert.equal(env.calls[1].args.id, "");
  assert.equal(env.calls[1].args.line.layerAPosition, null);
  assert.equal(env.calls[1].args.line.isActive, false);
  assert.deepEqual(env.calls[1].args.line.metadata, {});
  const before = env.calls.length;
  const valid = { lineNumber: 8, displayName: "Line 8", layerCount: 3, layerAPosition: "inside", hopperGeometry: "volume", hopperNamingMode: "standard" };
  for (const [bad, field, message] of [
    [{ ...valid, lineNumber: "eight" }, "lineNumber", "A line number is required."],
    [{ ...valid, displayName: "   " }, "displayName", "A display name is required."],
    [{ ...valid, layerCount: 2.5 }, "layerCount", "A layer count is required."],
    [{ ...valid, layerAPosition: "sideways" }, "layerAPosition", "Layer A must be Inside, Outside, or N/A."],
    [{ ...valid, hopperGeometry: "" }, "hopperGeometry", "A hopper geometry is required."],
    [{ ...valid, hopperNamingMode: 3 }, "hopperNamingMode", "A hopper naming mode is required."]
  ]) {
    assert.deepEqual(await bridge.request("saveLineConfiguration", { line: bad }), { ok: false, code: "bad_argument", message, field });
  }
  assert.deepEqual(await bridge.request("saveLineConfiguration", { id: "l-8" }), { ok: false, code: "bad_argument", message: "A line configuration is required.", field: "line" });
  assert.deepEqual(await bridge.request("saveLineConfiguration", { line: [] }), { ok: false, code: "bad_argument", message: "A line configuration is required.", field: "line" });
  assert.equal(env.calls.length, before, "nothing malformed reached the application");
  // What the values may BE is not the bridge's to say: an out-of-range
  // number or a count without a side crosses to the service, which
  // validates by line-identity's rules.
  await bridge.request("saveLineConfiguration", { line: { ...valid, lineNumber: 1000, layerAPosition: null } });
  assert.equal(env.calls.length, before + 1);
});

/* ----------------------------------------------------------------------
 *   Resin Database: the three actions added for Sudo's third tool
 * -------------------------------------------------------------------- */

test("the failure codes are a closed list, and duplicate_code is among them so a refused resin save survives the letterbox with its own code", () => {
  assert.deepEqual([...bridgeModule.ERROR_CODES], [
    "unknown_action", "unavailable", "bad_argument", "not_authenticated", "access_denied",
    "not_ready", "not_found", "invalid_name", "duplicate_code", "failed"
  ]);
  assert.deepEqual([...bridgeModule.RESIN_FIELDS], ["resinCode", "densityGCm3", "bulkDensityLbFt3", "isActive"]);
});

test("a resin crosses outward by allow-list: code, two densities as a number or null, active, id and updated time - never the row", async () => {
  const { bridge } = producer({
    listResins: async () => ({ ok: true, resins: [
      { id: "r-1", resinCode: "LL 1001", densityGCm3: "0.92", bulkDensityLbFt3: 35.5, isActive: true, updatedAt: "2026-09-01T00:00:00Z", resin_code: "smuggled", created_at: "x", extra: "dropped" },
      { id: "r-2", resinCode: "HD 200", densityGCm3: "", bulkDensityLbFt3: null, isActive: false },
      { id: "r-3", resinCode: "PP 3", densityGCm3: "abc", bulkDensityLbFt3: 0 },
      { resinCode: "no id" }
    ] })
  });
  const result = await bridge.request("listResins");
  assert.ok(result.ok && Object.isFrozen(result) && Object.isFrozen(result.resins) && Object.isFrozen(result.resins[0]));
  assert.deepEqual(result.resins.map(resin => ({ ...resin })), [
    { id: "r-1", resinCode: "LL 1001", densityGCm3: 0.92, bulkDensityLbFt3: 35.5, isActive: true, updatedAt: "2026-09-01T00:00:00Z" },
    { id: "r-2", resinCode: "HD 200", densityGCm3: null, bulkDensityLbFt3: null, isActive: false, updatedAt: "" },
    { id: "r-3", resinCode: "PP 3", densityGCm3: null, bulkDensityLbFt3: 0, isActive: true, updatedAt: "" }
  ], "a row without an id is dropped; a non-number is null; an absent active flag reads active; the raw column names do not cross");
  assert.equal(JSON.stringify(result).includes("dropped"), false);
  assert.equal(JSON.stringify(result).includes("smuggled"), false);
});

test("a resin save's arguments are rebuilt field by field - trimmed code, each density a number or null, a boolean - and a field of the wrong kind is refused before the application is asked; the VALUES are the service's to judge", async () => {
  const { bridge, env } = producer({
    saveResin: async ({ id, resin }) => ({ ok: true, resin: { id: id || "r-new", ...resin, updatedAt: "2026-09-13T00:00:00Z" } })
  });
  const result = await bridge.request("saveResin", { id: " r-1 ", resin: {
    resinCode: "  ll 1001 ", densityGCm3: "0.92", bulkDensityLbFt3: "  ", isActive: "yes", id: "smuggled", resin_code: "x", created_at: "x"
  } });
  assert.ok(result.ok);
  assert.deepEqual(env.calls[0].args, { id: "r-1", resin: { resinCode: "ll 1001", densityGCm3: 0.92, bulkDensityLbFt3: null, isActive: true } },
    "the code is trimmed and its case kept; a blank density is null; anything else is dropped");
  assert.ok(Object.isFrozen(env.calls[0].args) && Object.isFrozen(env.calls[0].args.resin));
  assert.deepEqual({ ...result.resin }, { id: "r-1", resinCode: "ll 1001", densityGCm3: 0.92, bulkDensityLbFt3: null, isActive: true, updatedAt: "2026-09-13T00:00:00Z" });
  // Create: no id crosses as an empty one; a number stays a number; false stays false.
  await bridge.request("saveResin", { resin: { resinCode: "HD 200", densityGCm3: 0.955, bulkDensityLbFt3: null, isActive: false } });
  assert.deepEqual(env.calls[1].args, { id: "", resin: { resinCode: "HD 200", densityGCm3: 0.955, bulkDensityLbFt3: null, isActive: false } });
  const before = env.calls.length;
  for (const [bad, field, message] of [
    [{ resinCode: "   ", densityGCm3: 1 }, "resinCode", "A resin code is required."],
    [{ resinCode: 7 }, "resinCode", "A resin code is required."],
    [{ resinCode: "X", densityGCm3: "abc" }, "densityGCm3", "Density must be blank or a number."],
    [{ resinCode: "X", bulkDensityLbFt3: {} }, "bulkDensityLbFt3", "Bulk density must be blank or a number."]
  ]) {
    assert.deepEqual(await bridge.request("saveResin", { resin: bad }), { ok: false, code: "bad_argument", message, field });
  }
  assert.deepEqual(await bridge.request("saveResin", { id: "r-1" }), { ok: false, code: "bad_argument", message: "A resin is required.", field: "resin" });
  assert.deepEqual(await bridge.request("saveResin", { resin: [] }), { ok: false, code: "bad_argument", message: "A resin is required.", field: "resin" });
  assert.equal(env.calls.length, before, "nothing malformed reached the application");
  // An out-of-range density is a VALUE: it crosses, and the service refuses it in its own words.
  await bridge.request("saveResin", { resin: { resinCode: "X", densityGCm3: 50 } });
  assert.equal(env.calls.length, before + 1);
  assert.equal(env.calls[before].args.resin.densityGCm3, 50);
});

test("a delete names its resin; a duplicate-code refusal from the application keeps its code across the letterbox", async () => {
  const { bridge, env } = producer({
    saveResin: async () => ({ ok: false, code: "duplicate_code", message: "That resin code already exists." }),
    deleteResin: async () => ({ ok: true, rows: 1 })
  });
  assert.deepEqual(await bridge.request("deleteResin", {}), { ok: false, code: "bad_argument", message: "A resin is required.", field: "id" });
  assert.deepEqual(await bridge.request("deleteResin", { id: " r-1 " }), { ok: true }, "a delete answers ok and nothing else");
  assert.deepEqual(env.calls[0].args, { id: "r-1" });
  assert.deepEqual(await bridge.request("saveResin", { resin: { resinCode: "LL 1001" } }), { ok: false, code: "duplicate_code", message: "That resin code already exists." });
  // The workspace wording stays for the workspace actions.
  assert.deepEqual(await bridge.request("deleteWorkspace", {}), { ok: false, code: "bad_argument", message: "A workspace is required.", field: "id" });
});
