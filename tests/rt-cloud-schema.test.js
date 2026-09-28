"use strict";

// Source-level contract test for the RT Cloud migration. There is no local
// Postgres here, so these assertions pin the SQL that was applied to the
// project (migration 202608280001) - same approach as the other *-schema
// tests in this repo.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const sql = fs.readFileSync("supabase/migrations/202608280001_rt_notes_cloud_backups.sql", "utf8");
const lower = sql.toLowerCase();

test("creates a dedicated backups table isolated from RT Sync", () => {
  assert.match(lower, /create table if not exists public\.rt_notes_cloud_backups/);
  // No RT Sync object is altered.
  assert.doesNotMatch(lower, /alter table public\.(line_workspaces|line_workspace_members|active_jobs|saved_setups|workspace_configurations)/);
  assert.doesNotMatch(lower, /references (public\.)?line_workspaces/);
});

test("the only identifier is the one-way lookup hash - no workspace / device / user linkage for ownership", () => {
  assert.match(lower, /backup_lookup_hash text not null/);
  assert.match(lower, /unique \(backup_lookup_hash\)/);
  assert.match(lower, /rt_notes_cloud_backups_lookup_hash_format[\s\S]*?check \(backup_lookup_hash ~/);
  // Diagnostic columns exist but are nullable and carry no constraint tying
  // them to access.
  assert.match(lower, /source_device_id text\s*,/);
  assert.match(lower, /source_rt_user_id uuid\s*,/);
  assert.doesNotMatch(lower, /source_device_id text not null/);
  assert.doesNotMatch(lower, /source_rt_user_id uuid not null/);
});

test("note content is never a column - only ciphertext + non-sensitive metadata", () => {
  for (const forbidden of ["title", "body", "bodyformat", "folder_name", "note_text", "plaintext"]) {
    assert.ok(!lower.includes(`${forbidden} text`), `no ${forbidden} column`);
  }
  assert.match(lower, /encrypted_payload text not null/);
  assert.match(lower, /kdf_salt text not null/);
  assert.match(lower, /\biv text not null/);
});

test("payload size is bounded", () => {
  assert.match(lower, /rt_notes_cloud_backups_payload_size[\s\S]*?check \(octet_length\(encrypted_payload\) between 1 and \d+\)/);
});

test("RLS is enabled with NO policy, and anon/authenticated have no privileges", () => {
  assert.match(lower, /alter table public\.rt_notes_cloud_backups enable row level security/);
  assert.doesNotMatch(lower, /create policy[\s\S]*on public\.rt_notes_cloud_backups/);
  assert.match(lower, /revoke all on table public\.rt_notes_cloud_backups from public, anon, authenticated/);
  // Service role (the Edge Function) is the only grantee.
  assert.match(lower, /grant all on table public\.rt_notes_cloud_backups to service_role/);
});

test("a per-IP lookup throttle table exists and is equally locked down", () => {
  assert.match(lower, /create table if not exists public\.rt_notes_cloud_lookup_throttle/);
  assert.match(lower, /alter table public\.rt_notes_cloud_lookup_throttle enable row level security/);
  assert.match(lower, /revoke all on table public\.rt_notes_cloud_lookup_throttle from public, anon, authenticated/);
});

test("helper runs with an empty search_path; nothing is added to Realtime", () => {
  assert.match(lower, /create or replace function private\.rt_cloud_touch_updated_at\(\)/);
  assert.match(lower, /set search_path = ''/);
  assert.doesNotMatch(lower, /alter publication supabase_realtime/);
  assert.doesNotMatch(lower, /publication supabase_realtime add/);
});

test("the migration is wrapped in a single transaction", () => {
  assert.match(lower, /^begin;/m);
  assert.match(lower, /commit;\s*$/);
});
