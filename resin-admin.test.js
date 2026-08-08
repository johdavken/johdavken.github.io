const test = require("node:test");
const assert = require("node:assert/strict");
const adminApi = require("./resin-admin.js");

test("validates required codes, nullable fields, and density bounds", () => {
  assert.equal(adminApi.validateResin({ resin_code: " ", is_active: true }).valid, false);
  assert.equal(adminApi.validateResin({ resin_code: "A", density_g_cm3: "11", is_active: true }).valid, false);
  assert.deepEqual(adminApi.validateResin({ resin_code: " A ", display_description: " ", density_g_cm3: "", information_description: " ", is_active: true }), {
    valid: true,
    value: { resin_code: "A", display_description: null, density_g_cm3: null, bulk_density_lb_ft3: null, information_description: null, is_active: true }
  });
});

test("validates bulk density bounds independently of density (g/cm3) - a trait of the resin, distinct field, own 1-100 lb/ft3 range", () => {
  assert.equal(adminApi.validateResin({ resin_code: "A", bulk_density_lb_ft3: "0.5", is_active: true }).valid, false);
  assert.equal(adminApi.validateResin({ resin_code: "A", bulk_density_lb_ft3: "150", is_active: true }).valid, false);
  const result = adminApi.validateResin({ resin_code: "A", bulk_density_lb_ft3: "37.2", is_active: true });
  assert.equal(result.valid, true);
  assert.equal(result.value.bulk_density_lb_ft3, 37.2);
});

function client({ admin = true, saveError = null, sessionUser = null } = {}){
  const auth = {
    async getSession(){ return { data: { session: sessionUser ? { user: sessionUser } : null } }; },
    async signInWithPassword(){ return { data: { user: { id: "admin-id", email: "admin@example.com" } } }; },
    async signOut(){}
  };
  return { auth, from(table){
    if (table === "admin_users") return { select(){ return this; }, eq(){ return this; }, async maybeSingle(){ return { data: admin ? { user_id: "admin-id" } : null, error: null }; } };
    return {
      select(){ return this; }, eq(){ return this; }, update(){ return this; }, insert(){ return this; },
      async order(){ return { data: [{ id: "1", resin_code: "INACTIVE", is_active: false }], error: null }; },
      async single(){ return { data: saveError ? null : { id: "2", resin_code: "NEW", is_active: true }, error: saveError }; }
    };
  }};
}

test("non-admin accounts are signed out and receive no editor access", async () => {
  const service = adminApi.create({ client: client({ admin: false }) });
  const result = await service.signIn("user@example.com", "password");
  assert.equal(result.ok, false);
  assert.equal(service.getState().isAdmin, false);
  assert.equal((await service.listResins()).ok, false);
});

test("verified admins can list and save resins, refreshing the shared catalog", async () => {
  let refreshes = 0;
  const service = adminApi.create({ client: client(), catalog: { async refreshResins(){ refreshes++; } } });
  assert.equal((await service.signIn("admin@example.com", "password")).ok, true);
  assert.equal((await service.listResins()).resins[0].is_active, false);
  assert.equal((await service.saveResin(null, { resin_code: "NEW", density_g_cm3: "", is_active: true })).ok, true);
  assert.equal((await service.saveResin("2", { resin_code: "NEW", density_g_cm3: "0.918", is_active: false })).ok, true);
  assert.equal(refreshes, 2);
  await service.signOut();
  assert.equal(service.getState().isAdmin, false);
});

test("restores a verified persisted admin session", async () => {
  const service = adminApi.create({ client: client({ sessionUser: { id: "admin-id", email: "admin@example.com" } }) });
  const state = await service.initialize();
  assert.equal(state.isAdmin, true);
  assert.equal(state.email, "admin@example.com");
});

test("failed mutations do not refresh the shared catalog", async () => {
  let refreshes = 0;
  const service = adminApi.create({ client: client({ saveError: { code: "23505", message: "duplicate" } }), catalog: { async refreshResins(){ refreshes++; } } });
  await service.signIn("admin@example.com", "password");
  const result = await service.saveResin(null, { resin_code: "NEW", is_active: true });
  assert.equal(result.ok, false);
  assert.match(result.message, /already exists/i);
  assert.equal(refreshes, 0);
});
