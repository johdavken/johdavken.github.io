"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

// Source-level contract test (no local Postgres/Supabase instance
// configured in this environment). NOT applied to the live project yet -
// see the migration's own header comment.

const sql = fs.readFileSync("supabase/migrations/202608080002_resin_bulk_density.sql", "utf8");

test("adds bulk_density_lb_ft3 as a nullable column on the existing resins table (not a new table, not required)", () => {
  assert.match(sql, /alter table public\.resins\s*\n\s*add column bulk_density_lb_ft3 numeric\(8,3\)/);
  assert.doesNotMatch(sql, /not null/i, "must stay nullable - unmeasured resins simply won't have it yet");
});

test("bulk density is constrained to a sane 1-100 lb/ft³ range when present, same null-or-in-range pattern as the existing density_g_cm3 constraint", () => {
  assert.match(sql, /check \(bulk_density_lb_ft3 is null or bulk_density_lb_ft3 between 1 and 100\)/);
});
