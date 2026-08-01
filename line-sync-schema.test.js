"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202607310001_line_sync.sql"),
  "utf8"
);

function functionSql(name){
  const match = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "i"));
  assert.ok(match, `Expected SQL function ${name}`);
  return match[0];
}

test("workspace membership supports multiple lines and role-based ownership", () => {
  assert.match(sql, /primary key \(workspace_id, user_id\)/i);
  assert.doesNotMatch(sql, /unique\s*\(user_id\)/i);
  assert.match(sql, /line_workspace_role as enum \('owner', 'member'\)/i);
  assert.match(sql, /transfer_workspace_ownership\(p_workspace_id uuid, p_new_owner_user_id uuid\)/i);
});

test("workspace creation is idempotent and operation IDs are bound to their creator", () => {
  assert.match(sql, /creation_operation_id uuid not null unique/i);
  const body = functionSql("create_workspace");
  assert.match(body, /on conflict \(creation_operation_id\) do nothing/i);
  assert.match(body, /where w\.creation_operation_id = p_operation_id/i);
  assert.match(body, /v_workspace\.created_by <> v_user_id/i);
  assert.match(body, /m\.workspace_id = a\.workspace_id[\s\S]*m\.user_id = v_user_id/i);
});

test("active jobs require the current payload version while saved setups allow legacy versions", () => {
  assert.match(sql, /unsupported_active_job_version/i);
  assert.match(sql, /not in \('0\.17'\)/i);
  assert.match(sql, /not in \('0\.14', '0\.15', '0\.16', '0\.17'\)/i);
  assert.match(sql, /assert_active_job_payload\(p_payload, true\)/i);
});

test("all saved-setup SECURITY DEFINER lookups are workspace scoped", () => {
  for (const name of ["create_saved_setup", "update_saved_setup", "rename_saved_setup", "delete_saved_setup"]){
    const body = functionSql(name);
    for (const lookup of body.matchAll(/where\s+s\.id\s*=\s*p_setup_id[\s\S]*?(?:;|returning)/gi)) {
      assert.match(lookup[0], /s\.workspace_id\s*=\s*p_workspace_id/i, `${name} has an unscoped setup lookup`);
    }
  }
});

test("link codes are stored as digests in a private schema", () => {
  assert.match(sql, /create table private\.workspace_link_codes/i);
  assert.match(sql, /code_digest bytea not null unique/i);
  assert.doesNotMatch(sql, /workspace_link_codes[\s\S]{0,300}\blink_code\s+text/i);
  assert.match(sql, /expires_at > created_at/i);
});

test("link-code generation qualifies output-column names used in SQL queries", () => {
  const body = functionSql("generate_link_code");
  assert.match(body, /delete from private\.workspace_link_codes c[\s\S]*c\.expires_at <= now\(\)[\s\S]*c\.workspace_id = p_workspace_id/i);
  assert.doesNotMatch(body, /delete from private\.workspace_link_codes\s+where\s+expires_at/i);
});

test("join_workspace avoids output-column ambiguity in its conflict target", () => {
  const body = functionSql("join_workspace");
  assert.match(body, /on conflict on constraint line_workspace_members_pkey do update/i);
  assert.doesNotMatch(body, /on conflict \(workspace_id, user_id\)/i);
});

test("shared tables use RLS and client writes are RPC-only", () => {
  for (const table of ["line_workspaces", "line_workspace_members", "active_jobs", "saved_setups"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /revoke all on public\.active_jobs from anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.update_active_job[\s\S]*to authenticated/i);
});
