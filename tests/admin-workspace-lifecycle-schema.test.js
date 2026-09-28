"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const sql = fs.readFileSync("supabase/migrations/20260829215404_admin_workspace_lifecycle.sql", "utf8");

function fn(name){
  const match = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "i"));
  assert.ok(match, `Expected ${name}`);
  return match[0];
}

test("Sudo lifecycle RPCs are admin-gated, use a safe search path, and retain existing RLS", () => {
  for (const name of ["admin_create_line_workspace", "admin_rename_line_workspace"]){
    const body = fn(name);
    assert.match(body, /private\.assert_admin\(\)/);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path = ''/i);
  }
  assert.doesNotMatch(sql, /create policy|drop policy|alter table .* enable row level security/i);
  assert.match(sql, /revoke all on function public\.admin_create_line_workspace\(text,uuid,uuid,text,jsonb\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.admin_rename_line_workspace\(uuid,text\) to authenticated/i);
});

test("creating a line assigns the verified RT Sync desktop as owner and validates the ordinary active-job payload", () => {
  const body = fn("admin_create_line_workspace");
  assert.match(body, /private\.is_anonymous_rt_sync_identity\(p_target_user_id\)/);
  assert.match(body, /perform private\.assert_active_job_payload\(p_initial_active_job\)/);
  assert.match(body, /created_by, creation_operation_id/);
  assert.match(body, /p_target_user_id, p_device_id, v_label, 'owner'/);
  assert.match(body, /insert into public\.active_jobs/);
  assert.doesNotMatch(body, /service_role|workspace_link_codes|code_digest/i);
});

test("renaming is an administrator-only revision update", () => {
  const body = fn("admin_rename_line_workspace");
  assert.match(body, /for update/i);
  assert.match(body, /revision = w\.revision \+ 1/);
  assert.match(body, /workspace_not_found/i);
});
