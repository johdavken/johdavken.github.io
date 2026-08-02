"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const payloads = require("./workspace-configuration-payloads.js");

const sql = fs.readFileSync(path.join(__dirname, "supabase/migrations/202608020003_workspace_configurations.sql"), "utf8");

function functionSql(name){
  const match = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "i"));
  assert.ok(match, `Expected SQL function ${name}`);
  return match[0];
}

test("workspace configurations use one versioned table with two isolated naming namespaces", () => {
  assert.match(sql, /create table public\.workspace_configurations/i);
  for (const column of ["id uuid primary key", "workspace_id uuid not null", "configuration_type text not null", "name text not null", "normalized_name text not null", "schema_version integer not null", "payload jsonb not null", "favorite boolean not null", "created_by uuid not null", "updated_by uuid not null", "created_at timestamptz", "updated_at timestamptz"]) {
    assert.match(sql, new RegExp(column, "i"));
  }
  assert.match(sql, /configuration_type in \('receiver_weight_profile', 'recipe'\)/i);
  assert.match(sql, /unique \(workspace_id, configuration_type, normalized_name\)/i);
  assert.doesNotMatch(sql, /\brevision\b/i);
  assert.doesNotMatch(sql, /last_operation_id/i);
});

test("the write trigger is the only normalized-name authority and equivalent names collide", () => {
  assert.match(sql, /name = btrim\(name\) and char_length\(name\) between 1 and 100/i);
  assert.match(sql, /new\.name := regexp_replace\(btrim\(new\.name\), '\\s\+', ' ', 'g'\)/i);
  assert.match(sql, /new\.normalized_name := private\.normalize_setup_name\(new\.name\)/i);
  assert.match(sql, /unique \(workspace_id, configuration_type, normalized_name\)/i);
  for (const name of ["create_workspace_configuration", "rename_workspace_configuration", "duplicate_workspace_configuration"]) {
    assert.doesNotMatch(functionSql(name), /normalized_name/i, `${name} must rely on the trigger`);
  }
  assert.equal("Heavy   Black".trim().replace(/\s+/g, " ").toLowerCase(), "heavy black");
  assert.equal("  heavy black  ".trim().replace(/\s+/g, " ").toLowerCase(), "heavy black");
});

test("database constraints enforce favorite scope, payload type, version, and size", () => {
  assert.match(sql, /configuration_type = 'recipe' or favorite = false/i);
  assert.match(sql, /schema_version = 1/i);
  assert.match(sql, /jsonb_typeof\(payload\) = 'object'/i);
  assert.match(sql, /octet_length\(payload::text\) <= 131072/i);
});

test("payload validation separates profile and recipe boundaries while retaining unknown resin strings", () => {
  const body = sql.match(/create or replace function private\.assert_workspace_configuration_payload\([\s\S]*?\n\$\$;/i)?.[0];
  assert.ok(body, "Expected workspace configuration validator");
  assert.match(body, /p_configuration_type not in \('receiver_weight_profile', 'recipe'\)/i);
  assert.match(body, /invalid_receiver_weight_profile_payload/i);
  assert.match(body, /v_layer \? 'receiver_weights_lb'/i);
  assert.match(body, /invalid_recipe_layer/i);
  assert.match(body, /jsonb_typeof\(v_hopper->'resin_name'\) not in \('null', 'string'\)/i);
  assert.match(body, /char_length\(v_hopper->>'resin_name'\) > 100/i);
  assert.match(body, /invalid_recipe_hopper_percentages/i);
  assert.match(body, /p_payload->>'schema_version' <> '1'/i);
});

test("recipe Hopper 1 validation has parity with the Phase 1 strict automatic-remainder contract", () => {
  const recipe = {
    schema_version: 1,
    line_type: 1,
    hopper_naming_mode: "standard",
    layers: [{
      name: "A",
      layer_pct: 100,
      hoppers: [
        { resin_name: "H1", pct: 70 },
        { resin_name: "H2", pct: 30 },
        { resin_name: null, pct: 0 },
        { resin_name: null, pct: 0 },
        { resin_name: null, pct: 0 },
        { resin_name: null, pct: 0 }
      ]
    }]
  };
  assert.equal(payloads.validateRecipePayload(recipe).valid, true);
  recipe.layers[0].hoppers[0].pct = 69.99;
  assert.equal(payloads.validateRecipePayload(recipe).valid, false);
  recipe.layers[0].hoppers[0].pct = 0;
  recipe.layers[0].hoppers[1].pct = 101;
  assert.equal(payloads.validateRecipePayload(recipe).valid, false);

  const validator = sql.match(/create or replace function private\.assert_workspace_configuration_payload\([\s\S]*?\n\$\$;/i)?.[0];
  assert.match(validator, /v_secondary_total > 100\.0001/i);
  assert.match(validator, /abs\(v_hopper_total - 100\) > 0\.0001/i);
  assert.match(validator, /abs\(\(v_layer->'hoppers'->0->>'pct'\)::numeric - \(100 - v_secondary_total\)\) > 0\.0001/i);
});

test("member-only reads, RLS, and direct-write revocation reuse the existing workspace helper", () => {
  assert.match(sql, /alter table public\.workspace_configurations enable row level security/i);
  assert.match(sql, /alter table public\.workspace_configurations force row level security/i);
  assert.match(sql, /for select to authenticated[\s\S]*private\.current_user_is_member\(workspace_id\)/i);
  assert.match(sql, /revoke all on public\.workspace_configurations from anon, authenticated/i);
  assert.match(sql, /grant select on public\.workspace_configurations to authenticated/i);
  assert.doesNotMatch(sql, /add table public\.workspace_configurations/i);
  assert.doesNotMatch(sql, /alter publication/i);
});

test("configuration RPCs are security-definer, workspace scoped, and restricted to authenticated callers", () => {
  const signatures = {
    create_workspace_configuration: "uuid,uuid,text,text,integer,jsonb,boolean",
    update_workspace_configuration: "uuid,uuid,integer,jsonb",
    rename_workspace_configuration: "uuid,uuid,text",
    duplicate_workspace_configuration: "uuid,uuid,text",
    delete_workspace_configuration: "uuid,uuid",
    set_workspace_configuration_favorite: "uuid,uuid,boolean"
  };
  for (const [name, signature] of Object.entries(signatures)) {
    const body = functionSql(name);
    assert.match(body, /security definer[\s\S]*set search_path = ''/i, `${name} must use an empty search path`);
    assert.match(body, /private\.assert_authenticated\(\)/i, `${name} must require authentication`);
    assert.match(body, /private\.current_user_is_member\(p_workspace_id\)/i, `${name} must check membership`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(${signature.replace(/[()]/g, "\\$&")}\\) from public, anon`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signature.replace(/[()]/g, "\\$&")}\\) to authenticated`, "i"));
  }
});

test("mutations preserve ownership/type and enforce duplicate, delete, and favorite behavior", () => {
  assert.match(functionSql("update_workspace_configuration"), /select c\.configuration_type into v_type[\s\S]*c\.id = p_configuration_id and c\.workspace_id = p_workspace_id/i);
  assert.match(functionSql("rename_workspace_configuration"), /duplicate_workspace_configuration_name/i);
  assert.match(functionSql("duplicate_workspace_configuration"), /extensions\.gen_random_uuid\(\)/i);
  assert.match(functionSql("duplicate_workspace_configuration"), /where c\.id = p_source_configuration_id and c\.workspace_id = p_workspace_id/i);
  assert.match(functionSql("delete_workspace_configuration"), /delete from public\.workspace_configurations c[\s\S]*c\.id = p_configuration_id and c\.workspace_id = p_workspace_id/i);
  assert.match(functionSql("set_workspace_configuration_favorite"), /configuration_type <> 'recipe' and p_favorite/i);
});
