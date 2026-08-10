"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608030001_admin_workspace_recovery.sql"),
  "utf8"
);
const baseSql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202607310001_line_sync.sql"),
  "utf8"
);
const incidentSql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608100001_admin_workspace_incident_controls.sql"),
  "utf8"
);
const mergeSql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608100002_admin_workspace_merge.sql"),
  "utf8"
);

function incidentFunctionSql(name){
  const match = incidentSql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "i"));
  assert.ok(match, `Expected incident SQL function ${name}`);
  return match[0];
}

function functionSql(name){
  const match = sql.match(new RegExp(`create or replace function (?:public|private)\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "i"));
  assert.ok(match, `Expected SQL function ${name}`);
  return match[0];
}

test("recovery is additive and reuses the existing admin authorization system", () => {
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /drop function/i);
  assert.doesNotMatch(sql, /alter table public\.line_workspace_members/i);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /drop policy/i);
  assert.doesNotMatch(sql, /create table public\.admin_users/i);
  assert.match(sql, /create or replace function private\.assert_admin\(\)/i);
  assert.match(functionSql("assert_admin"), /public\.is_resin_admin\(\)/);
});

test("every new privileged RPC requires a verified admin and rejects non-admin authenticated callers", () => {
  for (const name of [
    "admin_list_line_workspaces",
    "admin_get_workspace_details",
    "admin_add_device_to_workspace",
    "admin_remove_workspace_member",
    "admin_transfer_workspace_ownership"
  ]) {
    const body = functionSql(name);
    assert.match(body, /private\.assert_admin\(\)/, `${name} must require admin authorization`);
  }
  assert.match(functionSql("assert_admin"), /admin_access_required/);
});

test("all new functions use an empty search path and are schema-qualified", () => {
  for (const name of [
    "assert_admin",
    "is_anonymous_rt_sync_identity",
    "admin_list_line_workspaces",
    "admin_get_workspace_details",
    "admin_add_device_to_workspace",
    "admin_remove_workspace_member",
    "admin_transfer_workspace_ownership"
  ]) {
    const body = functionSql(name);
    assert.match(body, /set search_path = ''/i, `${name} must use an empty search path`);
  }
  assert.doesNotMatch(sql, /\bfrom\s+line_workspace_members\b/i, "table references must be schema-qualified");
  assert.doesNotMatch(sql, /\bfrom\s+line_workspaces\b/i, "table references must be schema-qualified");
});

test("execution is restricted to authenticated and revoked from public and anon", () => {
  const signatures = {
    admin_list_line_workspaces: "uuid",
    admin_get_workspace_details: "uuid",
    admin_add_device_to_workspace: "uuid,uuid,uuid,text",
    admin_remove_workspace_member: "uuid,uuid",
    admin_transfer_workspace_ownership: "uuid,uuid"
  };
  for (const [name, signature] of Object.entries(signatures)) {
    const escaped = signature.replace(/[()]/g, "\\$&");
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(${escaped}\\) from public, anon`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${escaped}\\) to authenticated`, "i"));
  }
  assert.doesNotMatch(sql, /to\s+service_role/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test("the workspace list RPC exposes only summary fields, never join-code or secret material", () => {
  const body = functionSql("admin_list_line_workspaces");
  assert.doesNotMatch(body, /workspace_link_codes/i);
  assert.doesNotMatch(body, /code_digest/i);
  assert.doesNotMatch(body, /link_code_pepper/i);
  assert.doesNotMatch(body, /\bpayload\b/i);
  assert.match(body, /member_count/i);
  assert.match(body, /recipe_count/i);
  assert.match(body, /receiver_weight_profile_count/i);
  assert.match(body, /is_current_device_member/i);
});

test("recovery validates the workspace exists and the target is a current anonymous RT Sync identity", () => {
  const body = functionSql("admin_add_device_to_workspace");
  assert.match(body, /workspace_not_found/i);
  assert.match(body, /private\.is_anonymous_rt_sync_identity\(p_target_user_id\)/i);
  assert.match(body, /invalid_target_identity/i);
  const identity = functionSql("is_anonymous_rt_sync_identity");
  assert.match(identity, /auth\.users/i);
  assert.match(identity, /is_anonymous/i);
});

test("recovery adds an ordinary member row, is idempotent, and never rewrites role or deletes prior members", () => {
  const body = functionSql("admin_add_device_to_workspace");
  assert.match(body, /insert into public\.line_workspace_members/i);
  assert.match(body, /'member'/);
  assert.match(body, /on conflict on constraint line_workspace_members_pkey do update/i);
  assert.doesNotMatch(body, /on conflict \(workspace_id, user_id\)/i);
  assert.doesNotMatch(body, /role\s*=\s*excluded\.role/i);
  assert.doesNotMatch(body, /role\s*=\s*'owner'/i);
  assert.doesNotMatch(body, /delete from public\.line_workspace_members/i);
  assert.doesNotMatch(body, /workspace_configurations/i);
  assert.doesNotMatch(body, /active_jobs/i);
  assert.doesNotMatch(body, /saved_setups/i);
  assert.match(body, /already_member/i);
});

test("a device_id collision with this workspace's own stale membership is the normal recovery case, not a failure", () => {
  const body = functionSql("admin_add_device_to_workspace");
  assert.match(body, /when unique_violation then/i);
  assert.match(body, /update public\.line_workspace_members m\s*\n\s*set device_id = extensions\.gen_random_uuid\(\)/i);
  assert.match(body, /where m\.workspace_id = p_workspace_id\s*\n\s*and m\.device_id = p_device_id\s*\n\s*and m\.user_id <> p_target_user_id/i);
  // The retry re-inserts with the now-freed device_id, and only a second,
  // genuinely unresolvable collision still surfaces device_already_in_use.
  const uniqueViolationBranch = body.slice(body.indexOf("when unique_violation then"));
  const occurrences = (uniqueViolationBranch.match(/device_already_in_use/gi) || []).length;
  assert.equal(occurrences, 1, "device_already_in_use should only be reachable after the reclaim retry also fails");
  assert.doesNotMatch(body, /delete from public\.line_workspace_members/i, "the stale row must be kept, only its device_id changes");
});

test("the device_id reclaim verifies exactly one row changed instead of silently continuing", () => {
  const body = functionSql("admin_add_device_to_workspace");
  assert.match(body, /v_reclaimed_count integer/i);
  assert.match(body, /get diagnostics v_reclaimed_count = row_count/i);
  assert.match(body, /if v_reclaimed_count <> 1 then/i);
  assert.match(body, /device_id_reclaim_failed/i);
  // The row-count check must sit between the reclaim UPDATE and the retry
  // INSERT, not after the fact.
  const reclaimIndex = body.indexOf("set device_id = extensions.gen_random_uuid()");
  const diagnosticsIndex = body.indexOf("get diagnostics v_reclaimed_count = row_count");
  const retryInsertIndex = body.indexOf("insert into public.line_workspace_members", reclaimIndex + 1);
  assert.ok(reclaimIndex > -1 && diagnosticsIndex > reclaimIndex && retryInsertIndex > diagnosticsIndex,
    "row-count check must run after the reclaim UPDATE and before the retry INSERT");
});

test("member removal protects the workspace owner and requires an existing membership", () => {
  const body = functionSql("admin_remove_workspace_member");
  assert.match(body, /membership_not_found/i);
  assert.match(body, /owner_cannot_be_removed/i);
  assert.match(body, /v_role = 'owner'::public\.line_workspace_role/i);
  assert.doesNotMatch(body, /delete from public\.line_workspaces\b/i);
});

test("incident controls let admins revoke any device, including an owner, and delete a workspace", () => {
  const disconnect = incidentFunctionSql("admin_remove_workspace_member");
  const removeWorkspace = incidentFunctionSql("admin_delete_line_workspace");
  assert.match(disconnect, /private\.assert_admin\(\)/);
  assert.match(disconnect, /membership_not_found/i);
  assert.match(disconnect, /delete from public\.line_workspace_members/i);
  assert.doesNotMatch(disconnect, /owner_cannot_be_removed/i);
  assert.match(removeWorkspace, /private\.assert_admin\(\)/);
  assert.match(removeWorkspace, /for update/i);
  assert.match(removeWorkspace, /delete from public\.line_workspaces/i);
  assert.match(incidentSql, /revoke execute on function public\.delete_workspace\(uuid,bigint\) from authenticated/i);
  assert.match(incidentSql, /grant execute on function public\.admin_delete_line_workspace\(uuid\) to authenticated/i);
  assert.doesNotMatch(incidentSql, /service_role/i);
});

test("workspace merging is admin-only, copies configurations to the target, and deletes the source atomically", () => {
  const body = mergeSql.match(/create or replace function public\.admin_merge_line_workspaces\([\s\S]*?\n\$\$;/i)?.[0];
  assert.ok(body, "Expected admin_merge_line_workspaces SQL function");
  assert.match(body, /private\.assert_admin\(\)/);
  assert.match(body, /p_source_workspace_id = p_target_workspace_id/i);
  assert.match(body, /for update/i);
  assert.match(body, /from public\.workspace_configurations/i);
  assert.match(body, /workspace_id = p_target_workspace_id/i);
  assert.match(body, /private\.normalize_setup_name/i);
  assert.match(body, /delete from public\.line_workspaces where id = p_source_workspace_id/i);
  assert.match(mergeSql, /revoke all on function public\.admin_merge_line_workspaces\(uuid,uuid\) from public, anon/i);
  assert.match(mergeSql, /grant execute on function public\.admin_merge_line_workspaces\(uuid,uuid\) to authenticated/i);
  assert.doesNotMatch(mergeSql, /service_role/i);
});

test("recovery actions are recorded in a private audit table with no secret payload data", () => {
  assert.match(sql, /create table private\.workspace_recovery_audit/i);
  for (const column of ["workspace_id uuid not null", "admin_user_id uuid not null", "target_user_id uuid not null", "device_id uuid", "action text not null", "created_at timestamptz not null"]) {
    assert.match(sql, new RegExp(column, "i"));
  }
  assert.match(sql, /action in \('add_device', 'remove_member', 'transfer_ownership'\)/i);
  assert.doesNotMatch(sql, /workspace_recovery_audit[\s\S]{0,400}\bpassword\b/i);
  assert.doesNotMatch(sql, /workspace_recovery_audit[\s\S]{0,400}\btoken\b/i);
});

test("ownership transfer is a distinct, explicit admin action requiring the new owner to already be a member", () => {
  const body = functionSql("admin_transfer_workspace_ownership");
  assert.match(body, /new_owner_must_be_a_member/i);
  assert.match(body, /where m\.workspace_id = p_workspace_id and m\.user_id = p_new_owner_user_id/i);
  assert.match(body, /v_previous_owner is distinct from p_new_owner_user_id/i);
  assert.match(body, /set role = 'member'::public\.line_workspace_role[\s\S]*where m\.workspace_id = p_workspace_id and m\.role = 'owner'::public\.line_workspace_role/i);
  assert.match(body, /set role = 'owner'::public\.line_workspace_role[\s\S]*where m\.workspace_id = p_workspace_id and m\.user_id = p_new_owner_user_id/i);
  assert.match(body, /'transfer_ownership'/);
  assert.doesNotMatch(body, /delete from public\.line_workspace_members/i);
  assert.doesNotMatch(functionSql("admin_add_device_to_workspace"), /admin_transfer_workspace_ownership/i);
});

test("ownership transfer locks this workspace's membership rows before reading or changing roles", () => {
  const body = functionSql("admin_transfer_workspace_ownership");
  assert.match(body, /perform 1\s*\n\s*from public\.line_workspace_members m\s*\n\s*where m\.workspace_id = p_workspace_id\s*\n\s*for update/i);
  // The lock must be acquired before the membership check, owner lookup, and
  // role updates, so concurrent transfers can't interleave.
  const lockIndex = body.search(/for update/i);
  const memberCheckIndex = body.indexOf("new_owner_must_be_a_member");
  const ownerSelectIndex = body.indexOf("select m.user_id into v_previous_owner");
  const firstUpdateIndex = body.indexOf("set role = 'member'::public.line_workspace_role");
  assert.ok(lockIndex > -1, "expected a for update lock");
  assert.ok(lockIndex < memberCheckIndex, "lock must precede the membership check");
  assert.ok(lockIndex < ownerSelectIndex, "lock must precede the owner lookup");
  assert.ok(lockIndex < firstUpdateIndex, "lock must precede the role updates");
});

test("direct client writes to membership remain restricted and existing RLS is untouched by this migration", () => {
  assert.match(baseSql, /revoke all on public\.line_workspace_members from anon, authenticated/i);
  assert.match(baseSql, /alter table public\.line_workspace_members enable row level security/i);
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete)\s+on\s+public\.line_workspace_members/i);
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete)\s+on\s+public\.line_workspaces/i);
});
