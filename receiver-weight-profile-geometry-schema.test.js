"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Source-level contract test for the new migration (no local Postgres/
// Supabase instance configured in this environment) - see
// workspace-configurations-schema.test.js for the equivalent tests against
// the original 202608020003 migration this one extends via
// `create or replace function`. NOT applied to the live project; this only
// checks the migration file itself is well-formed and backward compatible.

const sql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608080001_receiver_weight_profile_geometry.sql"),
  "utf8"
);
const baseSql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608020003_workspace_configurations.sql"),
  "utf8"
);

test("the migration re-creates the same private function (create or replace, not a new one) so the existing RPCs keep calling it unchanged", () => {
  assert.match(sql, /create or replace function private\.assert_workspace_configuration_payload\(/);
  assert.match(sql, /language plpgsql/);
  assert.match(sql, /security definer|immutable/);
  assert.match(sql, /set search_path = ''/);
  assert.doesNotMatch(sql, /create or replace function public\./, "should not touch the public RPCs themselves - they already delegate to this function");
});

test("all the original validation rules survive unchanged - schema version, line type, hopper naming, layer count/order, receiver_weights_lb, and the recipe-side checks", () => {
  for (const fragment of [
    "unsupported_workspace_configuration_schema_version",
    "invalid_workspace_configuration_line_type",
    "invalid_workspace_configuration_hopper_naming_mode",
    "invalid_workspace_configuration_layers",
    "invalid_workspace_configuration_layer_name",
    "invalid_receiver_weight_profile_payload",
    "invalid_receiver_weight",
    "invalid_recipe_layer",
    "invalid_recipe_hopper",
    "invalid_recipe_hopper_percentages",
    "invalid_recipe_layer_percentages"
  ]) {
    assert.match(sql, new RegExp(fragment), `expected the original check for ${fragment} to still be present`);
  }
});

test("Smart Hoppers geometry (usable_heights_in, circumferences_in, packing_factors) is validated only when present - absence is not an error, matching profiles saved before this feature existed", () => {
  assert.match(sql, /if v_layer \? 'usable_heights_in' then/);
  assert.match(sql, /if v_layer \? 'circumferences_in' then/);
  assert.match(sql, /if v_layer \? 'packing_factors' then/);
  // Each is gated behind its own "if v_layer ? '...'" check, so a payload
  // missing the key entirely skips validation for it rather than failing.
});

test("each geometry array, when present, must be exactly 6 numeric values - usable height/circumference non-negative, packing factor between 0.58 and 0.68 (matching the client's own range)", () => {
  assert.match(sql, /jsonb_array_length\(v_layer->'usable_heights_in'\) <> 6/);
  assert.match(sql, /\(v_layer->'usable_heights_in'->>v_hopper_index\)::numeric < 0/);
  assert.match(sql, /jsonb_array_length\(v_layer->'circumferences_in'\) <> 6/);
  assert.match(sql, /\(v_layer->'circumferences_in'->>v_hopper_index\)::numeric < 0/);
  assert.match(sql, /jsonb_array_length\(v_layer->'packing_factors'\) <> 6/);
  assert.match(sql, /\(v_layer->'packing_factors'->>v_hopper_index\)::numeric not between 0\.58 and 0\.68/);
});

test("geometry validation only applies on the receiver_weight_profile branch, not the recipe branch - a recipe payload can't carry physical-equipment fields at all", () => {
  const recipeBranchStart = sql.indexOf("else\n      if p_payload ? 'hoppers_per_layer'");
  assert.notEqual(recipeBranchStart, -1);
  const recipeBranch = sql.slice(recipeBranchStart, sql.indexOf("end if;\n  end loop;", recipeBranchStart));
  assert.doesNotMatch(recipeBranch, /usable_heights_in/);
  assert.doesNotMatch(recipeBranch, /circumferences_in/);
  assert.doesNotMatch(recipeBranch, /packing_factors/);
});

test("this migration is additive - every distinct error message that existed in the base migration's receiver_weight_profile branch also appears here unchanged", () => {
  const baseBranchStart = baseSql.indexOf("if p_configuration_type = 'receiver_weight_profile' then");
  const baseBranch = baseSql.slice(baseBranchStart, baseSql.indexOf("else", baseBranchStart));
  const messages = [...baseBranch.matchAll(/message = '([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(messages.length > 0);
  for (const message of messages) {
    assert.match(sql, new RegExp(`message = '${message}'`), `expected unchanged base message ${message} to survive`);
  }
});
