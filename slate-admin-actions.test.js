"use strict";

/* slate-admin-actions.js: Slate's one seam to the administrator tools.
 * Every action's name and arguments are pinned against the bridge's own
 * vocabulary, and the can/reason table is checked in each of the states
 * a device can be in: no bridge, not yet checked, signed out, signed in. */

const test = require("node:test");
const assert = require("node:assert/strict");

const actions = require("./slate/slate-admin-actions.js");
const bridge = require("./station-admin-bridge.js");

/* A fake admin bridge: records requests, answers as told. */
function makeAdmin(options) {
  const settings = options || {};
  const calls = [];
  const access = bridge.project(
    settings.state === null ? null : Object.assign({ ready: true, signedIn: false, isAdmin: false, email: "" }, settings.state || {}),
    Object.assign({ ready: true, userId: "user-1234abcd", deviceId: "dev-5678efgh", deviceLabel: "Line 5 desk" }, settings.device || {})
  );
  return {
    calls,
    isConnected: () => settings.connected !== false,
    capabilities: () => (settings.capabilities || [...bridge.ACTIONS]).slice(),
    getAccess: () => access,
    subscribe: () => () => {},
    async request(action, args) {
      calls.push({ action, args });
      if (typeof settings.answer === "function") {
        const answered = settings.answer(action, args);
        if (answered !== undefined) return answered;
      }
      return { ok: true };
    }
  };
}

const signedIn = options => makeAdmin(Object.assign({ state: { ready: true, signedIn: true, isAdmin: true, email: "ada@example.com" } }, options || {}));

test("every action the seam names is one of the bridge's, and the window is read into a plain access and device", () => {
  assert.deepEqual([...actions.ACTIONS], [...bridge.ACTIONS], "the seam and the bridge name different actions");
  for (const name of Object.values(actions.CONTROL_ACTION)) assert.ok(bridge.ACTIONS.includes(name), `${name} is not a bridge action`);

  const open = signedIn();
  assert.deepEqual(actions.accessOf(open), { ready: true, signedIn: true, email: "ada@example.com" });
  assert.deepEqual(actions.deviceOf(open), { ready: true, label: "Line 5 desk", userIdShort: "user-123", deviceIdShort: "dev-5678" });
  assert.equal(actions.signedIn(open), true);
  assert.equal(actions.ready(open), true);

  // Signed out, and with nothing behind the bridge at all.
  const out = makeAdmin();
  assert.deepEqual(actions.accessOf(out), { ready: true, signedIn: false, email: "" });
  assert.equal(actions.signedIn(out), false);
  assert.deepEqual(actions.accessOf(null), { ready: false, signedIn: false, email: "" });
  assert.deepEqual(actions.deviceOf(null), { ready: false, label: "", userIdShort: "", deviceIdShort: "" });
  assert.equal(actions.signedIn(null), false);
  assert.equal(actions.ready(null), false);
  // An account that is signed in but not an administrator is signed out
  // here: the producer never publishes it as anything else.
  const notAdmin = makeAdmin({ state: { ready: true, signedIn: true, isAdmin: false, email: "bob@example.com" } });
  assert.equal(actions.signedIn(notAdmin), false);
  assert.equal(actions.accessOf(notAdmin).email, "");
});

test("sign-in is offered only while signed out, sign-out only while signed in, and everything else only to an administrator", () => {
  const out = makeAdmin();
  const able = actions.can(out);
  assert.equal(able.signIn, true);
  assert.equal(able.signOut, false);
  for (const control of Object.keys(actions.CONTROL_ACTION)) {
    if (actions.SESSION_CONTROLS.includes(control)) continue;
    assert.equal(able[control], false, `${control} was offered with nobody signed in`);
  }

  const open = actions.can(signedIn());
  assert.equal(open.signIn, false, "sign-in was offered to an administrator already signed in");
  assert.equal(open.signOut, true);
  for (const control of Object.keys(actions.CONTROL_ACTION)) {
    if (control === "signIn") continue;
    assert.equal(open[control], true, `${control} was withheld from an administrator`);
  }

  // A producer that supplied only some of the actions.
  const partial = signedIn({ capabilities: ["signIn", "signOut", "listResins"] });
  const some = actions.can(partial);
  assert.equal(some.listResins, true);
  assert.equal(some.saveResin, false);
  assert.equal(some.listWorkspaces, false);

  // No bridge at all.
  assert.ok(Object.values(actions.can(null)).every(value => value === false));
  assert.ok(Object.values(actions.can(makeAdmin({ connected: false }))).every(value => value === false));
});

test("read-only never withholds an administrator action: administration is not the line's job", () => {
  // The seam takes no read-only option at all - the proof is that `can`
  // ignores anything passed beside the bridge.
  const open = signedIn();
  assert.deepEqual(actions.can(open, { readOnly: true }), actions.can(open));
  assert.equal(actions.can(open, { readOnly: true }).deleteWorkspace, true);
});

test("a withheld control says why, most general first", () => {
  assert.match(actions.reason(null, "listResins"), /no application is connected/);
  assert.match(actions.reason(makeAdmin({ connected: false }), "signIn"), /no application is connected/);
  assert.equal(actions.reason(makeAdmin(), "listResins"), "no administrator is signed in.");
  assert.equal(actions.reason(makeAdmin({ state: { ready: false } }), "listResins"), "administrator access has not been checked yet.");
  assert.equal(actions.reason(makeAdmin(), "signOut"), "no administrator is signed in.");
  assert.equal(actions.reason(signedIn(), "signIn"), "an administrator is already signed in.");
  assert.match(actions.reason(signedIn({ capabilities: ["signIn", "signOut"] }), "saveResin"), /does not offer saveResin from Slate/);
  assert.equal(actions.reason(signedIn(), "saveResin"), "", "an offered control gave a reason");
  assert.equal(actions.reason(makeAdmin(), "signIn"), "");
});

test("each action sends exactly its own request, with the arguments the bridge names", async () => {
  const admin = signedIn();
  await actions.signIn(admin, "  ada@example.com ", " secret ");
  await actions.signOut(admin);
  await actions.listWorkspaces(admin);
  await actions.workspaceDevices(admin, "ws-1");
  await actions.addThisDevice(admin, "ws-1");
  await actions.createLine(admin, "  Line   8 ");
  await actions.renameLine(admin, "ws-1", " Line 9 ");
  await actions.transferOwnership(admin, "ws-1", "member-2");
  await actions.disconnectDevice(admin, "ws-1", "member-2");
  await actions.mergeWorkspace(admin, "ws-1", "ws-2");
  await actions.deleteWorkspace(admin, "ws-1");
  await actions.listLineConfigurations(admin);
  await actions.saveLineConfiguration(admin, "", { lineNumber: 8, displayName: "Line 8" });
  await actions.listResins(admin);
  await actions.saveResin(admin, "r-1", { resinCode: "HX204", densityGCm3: 0.951 });
  await actions.deleteResin(admin, "r-1");

  assert.deepEqual(admin.calls, [
    { action: "signIn", args: { email: "ada@example.com", password: " secret " } },
    { action: "signOut", args: undefined },
    { action: "listWorkspaces", args: undefined },
    { action: "workspaceDevices", args: { id: "ws-1" } },
    { action: "addThisDevice", args: { id: "ws-1" } },
    { action: "createLine", args: { name: "Line 8" } },
    { action: "renameLine", args: { id: "ws-1", name: "Line 9" } },
    { action: "transferOwnership", args: { id: "ws-1", memberId: "member-2" } },
    { action: "disconnectDevice", args: { id: "ws-1", memberId: "member-2" } },
    { action: "mergeWorkspace", args: { id: "ws-1", targetId: "ws-2" } },
    { action: "deleteWorkspace", args: { id: "ws-1" } },
    { action: "listLineConfigurations", args: undefined },
    { action: "saveLineConfiguration", args: { id: "", line: { lineNumber: 8, displayName: "Line 8" } } },
    { action: "listResins", args: undefined },
    { action: "saveResin", args: { id: "r-1", resin: { resinCode: "HX204", densityGCm3: 0.951 } } },
    { action: "deleteResin", args: { id: "r-1" } }
  ]);
  // The password crosses exactly as typed; only the email is tidied.
  assert.equal(admin.calls[0].args.password, " secret ");
  // Every one of the bridge's actions is reachable from the seam.
  assert.deepEqual(admin.calls.map(call => call.action), [...bridge.ACTIONS]);
  // And the bridge accepts each argument object as sent.
  for (const call of admin.calls) {
    if (call.args === undefined) continue;
    const normalized = bridge.normalizeArguments(call.action, call.args);
    assert.ok(!normalized.error, `${call.action}: ${normalized.error && normalized.error.message}`);
  }
});

test("with no bridge every action answers unavailable and nothing is sent; a thrown or empty answer is a failure, never a throw", async () => {
  const none = await actions.listResins(null);
  assert.deepEqual(none, { ok: false, code: "unavailable", message: actions.NO_BRIDGE });
  assert.equal((await actions.signIn(null, "a@b", "x")).code, "unavailable");

  const thrower = signedIn({ answer: () => { throw new Error("the network went"); } });
  const threw = await actions.listWorkspaces(thrower);
  assert.deepEqual(threw, { ok: false, code: "failed", message: "the network went" });

  const silent = signedIn({ answer: () => null });
  assert.deepEqual(await actions.listWorkspaces(silent), { ok: false, code: "failed", message: actions.WORDING.noAnswer });
});

test("a refusal that means the session has ended is named; an ordinary refusal is not", () => {
  assert.equal(actions.accessLost({ ok: false, code: "not_authenticated" }), true);
  assert.equal(actions.accessLost({ ok: false, code: "access_denied" }), true);
  assert.equal(actions.accessLost({ ok: false, code: "not_found" }), false);
  assert.equal(actions.accessLost({ ok: true }), false);
  assert.equal(actions.accessLost(null), false);
  for (const code of actions.LOST_CODES) assert.ok(bridge.ERROR_CODES.includes(code), `${code} is not a bridge error code`);
});

test("a resin code the catalog already holds comes back with the record it collided with, found in what the section last read", async () => {
  const known = [{ id: "r-1", resinCode: "HX204" }, { id: "r-2", resinCode: "LL318" }];
  const admin = signedIn({ answer: () => ({ ok: false, code: "duplicate_code", message: "That resin code already exists." }) });
  const collided = await actions.saveResin(admin, "", { resinCode: " ll318 " }, known);
  assert.equal(collided.ok, false);
  assert.equal(collided.code, "duplicate_code");
  assert.equal(collided.field, "resinCode");
  assert.deepEqual(collided.existing, { id: "r-2", resinCode: "LL318" });
  // Its own record never counts as the collision.
  const itself = await actions.saveResin(admin, "r-2", { resinCode: "LL318" }, known);
  assert.equal(itself.existing, null);
  // Any other refusal is handed back exactly as the bridge gave it.
  const refused = signedIn({ answer: () => ({ ok: false, code: "failed", message: "Density must be between 0.001 and 10." }) });
  const result = await actions.saveResin(refused, "r-1", { resinCode: "HX204" }, known);
  assert.deepEqual(result, { ok: false, code: "failed", message: "Density must be between 0.001 and 10." });
  assert.equal(result.existing, undefined);
});

test("names and codes are compared as the application compares them", () => {
  assert.equal(actions.cleanName("  Line   8  "), "Line 8");
  assert.equal(actions.cleanName(null), "");
  assert.equal(actions.sameCode(" hx204 ", "HX204"), true);
  assert.equal(actions.sameCode("HX 204", "HX204"), false, "whitespace inside a code was collapsed");
  assert.equal(actions.findByCode(null, "HX204"), null);
  assert.equal(actions.findByCode([{ id: "r-1", resinCode: "HX204" }], "hx204").id, "r-1");
});
