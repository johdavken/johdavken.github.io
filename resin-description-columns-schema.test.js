"use strict";

// Source-level contract test for the migration that drops display_description
// and information_description from public.resins (no local Postgres/Supabase
// instance configured in this environment). Application code was updated to
// stop selecting, writing, or searching by either column before this
// migration exists - see resin-catalog-service.js/resin-admin.js's
// REMOTE_FIELDS/RESIN_FIELDS constants - so dropping them is safe. NOT
// applied to the live project by this test; it only checks the migration
// file itself is well-formed. Modeled on resin-bulk-density-schema.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const sql = fs.readFileSync("supabase/migrations/202608160001_drop_resin_description_columns.sql", "utf8");

test("drops both display_description and information_description from public.resins", () => {
  assert.match(sql, /alter table public\.resins drop column display_description;/);
  assert.match(sql, /alter table public\.resins drop column information_description;/);
});

test("no other schema object is touched - this is a narrow, additive-in-history drop", () => {
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(sql, /create table|create policy|drop table|drop policy/);
});
