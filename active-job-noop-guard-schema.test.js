"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608040001_active_job_noop_guard.sql"),
  "utf8"
);
const baseSql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202607310001_line_sync.sql"),
  "utf8"
);

function functionSql(source, name){
  const match = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "i"));
  assert.ok(match, `Expected SQL function ${name}`);
  return match[0];
}

const body = functionSql(sql, "update_active_job");

const opIdCheck = /select a\.workspace_id, a\.payload, a\.revision, a\.last_operation_id, a\.updated_at, a\.updated_by\s*from public\.active_jobs a\s*where a\.workspace_id = p_workspace_id and a\.last_operation_id = p_operation_id;\s*if found then return; end if;/i;
const noopBlock = /return query\s*select a\.workspace_id, a\.payload, a\.revision, a\.last_operation_id, a\.updated_at, a\.updated_by\s*from public\.active_jobs a\s*where a\.workspace_id = p_workspace_id\s*and a\.revision = p_expected_revision\s*and a\.payload = p_payload;\s*if found then return; end if;/i;
const updateBlock = /update public\.active_jobs a\s*set payload = p_payload,\s*revision = a\.revision \+ 1,\s*last_operation_id = p_operation_id,\s*updated_at = now\(\),\s*updated_by = v_user_id\s*where a\.workspace_id = p_workspace_id and a\.revision = p_expected_revision\s*returning a\.workspace_id, a\.payload, a\.revision, a\.last_operation_id, a\.updated_at, a\.updated_by;/i;

// --- Source-level contract tests -----------------------------------------
// No live Postgres/Supabase instance is configured for this repo, so these
// assert the SQL text implements the required control flow rather than
// executing it and observing runtime rows. See the report for what this
// does and does not prove.

test("1. identical payload + matching revision: the no-op SELECT matches and returns before the UPDATE", () => {
  assert.match(body, noopBlock);
  const noopIndex = body.search(noopBlock);
  const updateIndex = body.indexOf("update public.active_jobs a");
  assert.ok(noopIndex > -1 && updateIndex > -1 && noopIndex < updateIndex,
    "the no-op branch must return before the UPDATE is ever reached");
});

test("2. revision does not increment on a no-op: the no-op branch is a pure SELECT, no `revision + 1`", () => {
  const match = body.match(noopBlock)[0];
  assert.doesNotMatch(match, /\bupdate\b/i);
  assert.doesNotMatch(match, /revision\s*\+\s*1/i);
});

test("3. updated_at does not change on a no-op: the no-op branch never calls now()", () => {
  const match = body.match(noopBlock)[0];
  assert.doesNotMatch(match, /now\(\)/i);
  assert.doesNotMatch(match, /updated_at\s*=/i);
});

test("4. last_operation_id does not change on a no-op: the no-op branch has no SET clause at all", () => {
  const match = body.match(noopBlock)[0];
  assert.doesNotMatch(match, /\bset\b/i);
  assert.doesNotMatch(match, /last_operation_id\s*=\s*p_operation_id/i);
  assert.doesNotMatch(match, /updated_by\s*=/i);
});

test("5. a materially different payload still updates and increments revision: existing UPDATE preserved unchanged, after the no-op check", () => {
  const original = functionSql(baseSql, "update_active_job");
  assert.match(original, updateBlock);
  assert.match(body, updateBlock);
  const noopIndex = body.search(noopBlock);
  const updateIndex = body.search(updateBlock);
  assert.ok(noopIndex < updateIndex, "a payload mismatch must fall through the no-op check into the real UPDATE");
});

test("6. a stale expected revision with an identical payload still raises revision_conflict", () => {
  // The no-op check requires a.revision = p_expected_revision, so a stale
  // revision can never satisfy it regardless of payload equality - it falls
  // through to the UPDATE, which also can't match a stale revision, and the
  // existing revision_conflict raise (unchanged) still fires.
  const noopWhere = body.match(/where a\.workspace_id = p_workspace_id\s*and a\.revision = p_expected_revision\s*and a\.payload = p_payload;/i);
  assert.ok(noopWhere, "no-op check must require the expected revision to match, not payload equality alone");
  assert.match(body, /if not found then\s*raise exception using errcode = '40001', message = 'revision_conflict';\s*end if;/i);
});

test("7. reusing the same operation ID still preserves the existing idempotency behavior, checked before the no-op guard", () => {
  const original = functionSql(baseSql, "update_active_job");
  assert.match(original, opIdCheck);
  assert.match(body, opIdCheck);
  const opIdIndex = body.search(opIdCheck);
  const noopIndex = body.search(noopBlock);
  assert.ok(opIdIndex > -1 && noopIndex > -1 && opIdIndex < noopIndex,
    "the operation-id idempotency check must run before, and independently of, the new no-op check");
});

// --- Supplementary structural/safety checks -------------------------------

test("migration is additive: only redefines update_active_job, changes nothing else", () => {
  assert.doesNotMatch(sql, /drop function/i);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /alter table/i);
  assert.doesNotMatch(sql, /create policy|drop policy|alter policy/i);
  assert.doesNotMatch(sql, /^\s*(grant|revoke)\s/im);
  const matches = sql.match(/create or replace function/gi) || [];
  assert.equal(matches.length, 1, "expected exactly one function redefinition in this migration");
});

test("signature, return shape, SECURITY DEFINER, and search_path are unchanged from the original", () => {
  const original = functionSql(baseSql, "update_active_job");
  const signature = /create or replace function public\.update_active_job\(\s*p_workspace_id uuid,\s*p_payload jsonb,\s*p_expected_revision bigint,\s*p_operation_id uuid\s*\)/i;
  assert.match(original, signature);
  assert.match(body, signature);
  const returnsShape = /returns table \(\s*workspace_id uuid,\s*payload jsonb,\s*revision bigint,\s*operation_id uuid,\s*updated_at timestamptz,\s*updated_by uuid\s*\)/i;
  assert.match(original, returnsShape);
  assert.match(body, returnsShape);
  assert.match(body, /language plpgsql\s*security definer\s*set search_path = ''/i);
});

test("step 1-2 (authentication, membership, payload validation) preserved exactly", () => {
  assert.match(body, /v_user_id uuid := private\.assert_authenticated\(\);/i);
  assert.match(body, /if not private\.current_user_is_member\(p_workspace_id\) then/i);
  assert.match(body, /errcode = '42501', message = 'workspace_access_denied'/i);
  assert.match(body, /perform private\.assert_active_job_payload\(p_payload\);/i);
});

test("comment explains this protects against duplicate saves and unnecessary WAL/Realtime work", () => {
  assert.match(sql, /duplicate/i);
  assert.match(sql, /WAL/);
  assert.match(sql, /Realtime/i);
});
