"use strict";

// Source-level contract test for the new migration (no local Postgres/
// Supabase instance configured in this environment) - see
// receiver-weight-profile-geometry-schema.test.js for the equivalent tests
// against the 202608080001 migration this one extends via
// `create or replace function`, and workspace-configurations-schema.test.js
// for the original 202608020003 migration both of them build on. NOT
// applied to the live project; this only checks the migration file itself
// is well-formed and backward compatible.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608150004_receiver_weight_profile_gallons.sql"),
  "utf8"
);
const previousSql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608080001_receiver_weight_profile_geometry.sql"),
  "utf8"
);

test("the migration re-creates the same private function (create or replace, not a new one) so the existing RPCs keep calling it unchanged", () => {
  assert.match(sql, /create or replace function private\.assert_workspace_configuration_payload\(/);
  assert.match(sql, /language plpgsql/);
  assert.match(sql, /security definer|immutable/);
  assert.match(sql, /set search_path = ''/);
  assert.doesNotMatch(sql, /create or replace function public\./, "should not touch the public RPCs themselves - they already delegate to this function");
});

test("every distinct error message that existed in the previous (usable_heights_in/circumferences_in) migration also appears here unchanged", () => {
  const messages = [...previousSql.matchAll(/message = '([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(messages.length > 0);
  for (const message of messages) {
    assert.match(sql, new RegExp(`message = '${message}'`), `expected unchanged prior message ${message} to survive`);
  }
});

test("usable_gallons is validated only when present - absence is not an error, matching profiles saved before volume-mode Smart Hoppers existed", () => {
  assert.match(sql, /if v_layer \? 'usable_gallons' then/);
  // Gated behind its own "if v_layer ? 'usable_gallons'" check, so a
  // payload missing the key entirely skips validation for it rather than
  // failing - same treatment already given to usable_heights_in and
  // circumferences_in.
});

test("usable_gallons, when present, must be exactly 6 non-negative numeric values", () => {
  assert.match(sql, /jsonb_array_length\(v_layer->'usable_gallons'\) <> 6/);
  assert.match(sql, /\(v_layer->'usable_gallons'->>v_hopper_index\)::numeric < 0/);
  assert.match(sql, /message = 'invalid_hopper_usable_gallons'/);
  assert.match(sql, /message = 'invalid_hopper_usable_gallon'/);
});

test("usable_gallons validation only applies on the receiver_weight_profile branch, not the recipe branch - a recipe payload can't carry physical-equipment fields at all", () => {
  const recipeBranchStart = sql.indexOf("else\n      if p_payload ? 'hoppers_per_layer'");
  assert.notEqual(recipeBranchStart, -1);
  const recipeBranch = sql.slice(recipeBranchStart, sql.indexOf("end if;\n  end loop;", recipeBranchStart));
  assert.doesNotMatch(recipeBranch, /usable_gallons/);
});

test("this migration is purely additive relative to the previous one - the usable_heights_in/circumferences_in checks are untouched", () => {
  assert.match(sql, /if v_layer \? 'usable_heights_in' then/);
  assert.match(sql, /if v_layer \? 'circumferences_in' then/);
  assert.doesNotMatch(sql, /packing_factors/);
});
