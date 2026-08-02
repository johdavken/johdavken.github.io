const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const sql = fs.readFileSync("supabase/migrations/202608020002_resin_admin.sql", "utf8");

test("admin migration uses database-backed authorization and no delete policy", () => {
  assert.match(sql, /create table public\.admin_users/);
  assert.match(sql, /references auth\.users\(id\)/);
  assert.match(sql, /create or replace function public\.is_resin_admin\(\)/);
  assert.match(sql, /for insert[\s\S]*with check \(\(select public\.is_resin_admin\(\)\)\)/);
  assert.match(sql, /for update[\s\S]*using \(\(select public\.is_resin_admin\(\)\)\)/);
  assert.doesNotMatch(sql, /for delete/);
  assert.match(sql, /revoke delete on public\.resins/);
});

test("admin migration validates trimmed codes and allowed density range", () => {
  assert.match(sql, /resin_code = btrim\(resin_code\)/);
  assert.match(sql, /density_g_cm3 between 0\.001 and 10/);
});
