"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202607310001_line_sync.sql"),
  "utf8"
);

test("workspace membership supports multiple lines and role-based ownership", () => {
  assert.match(sql, /primary key \(workspace_id, user_id\)/i);
  assert.doesNotMatch(sql, /unique\s*\(user_id\)/i);
  assert.match(sql, /line_workspace_role as enum \('owner', 'member'\)/i);
  assert.match(sql, /transfer_workspace_ownership\(p_workspace_id uuid, p_new_owner_user_id uuid\)/i);
});

test("link codes are stored as digests in a private schema", () => {
  assert.match(sql, /create table private\.workspace_link_codes/i);
  assert.match(sql, /code_digest bytea not null unique/i);
  assert.doesNotMatch(sql, /workspace_link_codes[\s\S]{0,300}\blink_code\s+text/i);
  assert.match(sql, /expires_at > created_at/i);
});

test("shared tables use RLS and client writes are RPC-only", () => {
  for (const table of ["line_workspaces", "line_workspace_members", "active_jobs", "saved_setups"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /revoke all on public\.active_jobs from anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.update_active_job[\s\S]*to authenticated/i);
});
