"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608150001_active_job_stale_noop_guard.sql"),
  "utf8"
);

function functionSql(source){
  const match = source.match(/create or replace function public\.update_active_job\([\s\S]*?\n\$\$;/i);
  assert.ok(match, "Expected update_active_job definition");
  return match[0];
}

const body = functionSql(sql);
const equalPayloadNoop = /return query\s*select a\.workspace_id, a\.payload, a\.revision, a\.last_operation_id, a\.updated_at, a\.updated_by\s*from public\.active_jobs a\s*where a\.workspace_id = p_workspace_id\s*and a\.payload = p_payload;\s*if found then return; end if;/i;

test("an equal active-job payload settles without requiring the caller revision to match", () => {
  assert.match(body, equalPayloadNoop);
  const noOpIndex = body.search(equalPayloadNoop);
  const updateIndex = body.indexOf("update public.active_jobs a");
  assert.ok(noOpIndex > -1 && noOpIndex < updateIndex);
  assert.doesNotMatch(body.match(equalPayloadNoop)[0], /p_expected_revision/i);
});

test("a non-equal stale payload still uses optimistic concurrency and conflicts", () => {
  assert.match(body, /where a\.workspace_id = p_workspace_id and a\.revision = p_expected_revision/i);
  assert.match(body, /errcode = '40001', message = 'revision_conflict'/i);
});

test("the stale no-op is read-only and keeps operation-id idempotency first", () => {
  const noOp = body.match(equalPayloadNoop)[0];
  assert.doesNotMatch(noOp, /\bupdate\b|now\(\)|last_operation_id\s*=/i);
  assert.ok(body.indexOf("a.last_operation_id = p_operation_id") < body.search(equalPayloadNoop));
});
