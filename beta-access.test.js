"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const betaAccess = require("./beta-access.js");

function memoryStorage(seed = {}){
  const map = new Map(Object.entries(seed));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    _dump: () => Object.fromEntries(map)
  };
}

function transportStub(handlers = {}){
  const calls = [];
  return {
    calls,
    selectOwn: async fields => {
      calls.push(["selectOwn", fields]);
      return handlers.selectOwn ? handlers.selectOwn(fields) : { data: null, error: null };
    },
    rpc: async (name, args) => {
      calls.push([name, args]);
      return handlers.rpc ? handlers.rpc(name, args) : { data: null, error: null };
    }
  };
}

const ROW = {
  id: "a1",
  email: "op@example.com",
  display_name: "Dana Ruiz",
  status: "invited",
  created_at: "2026-08-20T10:00:00Z",
  invited_at: "2026-08-21T10:00:00Z"
};

/* ----------------------------------------------------------------------
 *   Input handling
 * -------------------------------------------------------------------- */

test("obvious typos are caught before a round trip, without pretending to implement RFC 5322", () => {
  ["op@example.com", "a.b+tag@sub.example.co.uk"].forEach(good => {
    assert.equal(betaAccess.isPlausibleEmail(good), true, good);
  });
  ["", "op", "op@example", "op @example.com", "a@b.c", "@example.com"].forEach(bad => {
    assert.equal(betaAccess.isPlausibleEmail(bad), false, bad);
  });
});

test("addresses are lowercased and names have their whitespace collapsed, matching the server", () => {
  assert.equal(betaAccess.normalizeEmail("  OP@Example.COM "), "op@example.com");
  assert.equal(betaAccess.normalizeName("  Dana   Ruiz  "), "Dana Ruiz");
});

test("a malformed submission never reaches the network", async () => {
  const transport = transportStub();
  const service = betaAccess.create({ transport, storage: memoryStorage() });
  const result = await service.submit("not-an-email", "Dana");
  assert.equal(result.ok, false);
  assert.match(result.message, /valid email/);
  assert.deepEqual(transport.calls, []);
});

test("the name is required, not just the address", async () => {
  const transport = transportStub();
  const service = betaAccess.create({ transport, storage: memoryStorage() });
  const result = await service.submit("op@example.com", "   ");
  assert.equal(result.ok, false);
  assert.deepEqual(transport.calls, []);
});

/* ----------------------------------------------------------------------
 *   Submitting
 * -------------------------------------------------------------------- */

test("submitting sends the normalized values and reports the status the server returned", async () => {
  const transport = transportStub({ rpc: () => ({ data: "pending", error: null }) });
  const service = betaAccess.create({ transport, storage: memoryStorage() });
  const result = await service.submit(" OP@Example.com ", "  Dana   Ruiz ");
  assert.equal(result.ok, true);
  assert.equal(result.status, "pending");
  assert.deepEqual(transport.calls, [[
    "submit_beta_application",
    { p_email: "op@example.com", p_display_name: "Dana Ruiz" }
  ]]);
});

test("a server rejection is surfaced as guidance, not as a raw error code", async () => {
  const transport = transportStub({
    rpc: () => ({ data: null, error: { code: "22023", message: "invalid_beta_application" } })
  });
  const service = betaAccess.create({ transport, storage: memoryStorage() });
  const result = await service.submit("op@example.com", "Dana");
  assert.equal(result.ok, false);
  assert.match(result.message, /Enter your name and a valid email address/);
});

test("with no anonymous session yet, submitting says so instead of failing silently", async () => {
  const service = betaAccess.create({ getTransport: () => null, storage: memoryStorage() });
  const result = await service.submit("op@example.com", "Dana");
  assert.equal(result.ok, false);
  assert.match(result.message, /still connecting/i);
});

/* ----------------------------------------------------------------------
 *   Reading status, and the paint cache
 * -------------------------------------------------------------------- */

test("reading maps the row into the shape the banner uses", async () => {
  const transport = transportStub({ selectOwn: () => ({ data: ROW, error: null }) });
  const service = betaAccess.create({ transport, storage: memoryStorage() });
  const result = await service.getMyApplication();
  assert.equal(result.ok, true);
  assert.deepEqual(result.application, {
    id: "a1",
    email: "op@example.com",
    displayName: "Dana Ruiz",
    status: "invited",
    createdAt: "2026-08-20T10:00:00Z",
    invitedAt: "2026-08-21T10:00:00Z"
  });
});

test("no row is a clean 'never applied', not an error", async () => {
  const transport = transportStub({ selectOwn: () => ({ data: null, error: null }) });
  const service = betaAccess.create({ transport, storage: memoryStorage() });
  const result = await service.getMyApplication();
  assert.equal(result.ok, true);
  assert.equal(result.application, null);
});

test("an approved answer is cached so the link paints before the round trip finishes", async () => {
  const storage = memoryStorage();
  const transport = transportStub({ selectOwn: () => ({ data: ROW, error: null }) });
  const service = betaAccess.create({ transport, storage });
  await service.getMyApplication();
  assert.deepEqual(service.cached(), {
    status: "invited",
    email: "op@example.com",
    displayName: "Dana Ruiz"
  });
});

// The banner must never demote an approved operator because the network
// blinked, so a failed read reports !ok and leaves the cache untouched for
// the caller to keep using.
test("a failed read does not overwrite the cached answer", async () => {
  const storage = memoryStorage();
  const good = betaAccess.create({
    transport: transportStub({ selectOwn: () => ({ data: ROW, error: null }) }),
    storage
  });
  await good.getMyApplication();

  const broken = betaAccess.create({
    transport: transportStub({ selectOwn: () => ({ data: null, error: { message: "network down" } }) }),
    storage
  });
  const result = await broken.getMyApplication();
  assert.equal(result.ok, false);
  assert.equal(broken.cached().status, "invited");
});

test("a corrupt or unknown cached status is ignored rather than trusted", () => {
  [ "not json", JSON.stringify({ status: "approved" }), JSON.stringify(null) ].forEach(raw => {
    const service = betaAccess.create({
      transport: transportStub(),
      storage: memoryStorage({ [betaAccess.CACHE_KEY]: raw })
    });
    assert.equal(service.cached(), null, raw);
  });
});

test("withdrawing clears the cache as well as the row", async () => {
  const storage = memoryStorage();
  const transport = transportStub({
    selectOwn: () => ({ data: ROW, error: null }),
    rpc: () => ({ data: true, error: null })
  });
  const service = betaAccess.create({ transport, storage });
  await service.getMyApplication();
  const result = await service.withdraw();
  assert.equal(result.ok, true);
  assert.equal(service.cached(), null);
  assert.deepEqual(transport.calls.at(-1), ["delete_beta_application", { p_applicant_id: null }]);
});

test("storage being unavailable degrades to no cache, never to a thrown error", async () => {
  const hostile = {
    getItem(){ throw new Error("denied"); },
    setItem(){ throw new Error("denied"); },
    removeItem(){ throw new Error("denied"); }
  };
  const service = betaAccess.create({
    transport: transportStub({ selectOwn: () => ({ data: ROW, error: null }) }),
    storage: hostile
  });
  assert.equal(service.cached(), null);
  const result = await service.getMyApplication();
  assert.equal(result.ok, true);
  assert.equal(result.application.status, "invited");
});

/* ----------------------------------------------------------------------
 *   Admin surface
 * -------------------------------------------------------------------- */

function adminClientStub(handlers = {}){
  const calls = [];
  return {
    calls,
    from(table){
      calls.push(["from", table]);
      const builder = {
        select(fields){ calls.push(["select", fields]); return builder; },
        order(column, opts){
          calls.push(["order", column, opts]);
          return Promise.resolve(handlers.rows || { data: [], error: null });
        }
      };
      return builder;
    },
    rpc(name, args){
      calls.push([name, args]);
      return Promise.resolve(handlers.rpc ? handlers.rpc(name, args) : { data: true, error: null });
    }
  };
}

test("the admin list reads newest first, through the admin client rather than the anonymous one", async () => {
  const adminClient = adminClientStub({ rows: { data: [ROW], error: null } });
  const transport = transportStub();
  const service = betaAccess.create({ transport, adminClient, storage: memoryStorage() });
  const result = await service.listApplicants();
  assert.equal(result.ok, true);
  assert.equal(result.applicants.length, 1);
  assert.equal(result.applicants[0].displayName, "Dana Ruiz");
  assert.deepEqual(adminClient.calls[0], ["from", "beta_applicants"]);
  assert.deepEqual(adminClient.calls.at(-1), ["order", "created_at", { ascending: false }]);
  // The operator's transport is not involved in the admin path at all.
  assert.deepEqual(transport.calls, []);
});

test("the checkbox maps to one reversible RPC call", async () => {
  const adminClient = adminClientStub();
  const service = betaAccess.create({ transport: transportStub(), adminClient, storage: memoryStorage() });
  await service.setInvited("a1", true);
  assert.deepEqual(adminClient.calls.at(-1), [
    "admin_set_beta_applicant_invited",
    { p_applicant_id: "a1", p_invited: true }
  ]);
  await service.setInvited("a1", false);
  assert.deepEqual(adminClient.calls.at(-1), [
    "admin_set_beta_applicant_invited",
    { p_applicant_id: "a1", p_invited: false }
  ]);
});

test("admin actions without an admin session say so rather than calling anything", async () => {
  const service = betaAccess.create({ transport: transportStub(), getAdminClient: () => null, storage: memoryStorage() });
  for (const result of [
    await service.listApplicants(),
    await service.setInvited("a1", true),
    await service.removeApplicant("a1")
  ]){
    assert.equal(result.ok, false);
    assert.match(result.message, /Admin sign-in is required/);
  }
});

test("an admin-gated failure from the server is reported as a permission problem", async () => {
  const adminClient = adminClientStub({
    rpc: () => ({ data: null, error: { code: "42501", message: "admin_access_required" } })
  });
  const service = betaAccess.create({ transport: transportStub(), adminClient, storage: memoryStorage() });
  const result = await service.setInvited("a1", true);
  assert.equal(result.ok, false);
  assert.match(result.message, /Admin access is required/);
});
