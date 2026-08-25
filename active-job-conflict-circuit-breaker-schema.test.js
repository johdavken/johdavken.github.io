"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608250001_active_job_conflict_circuit_breaker.sql"),
  "utf8"
);

test("stale active-job writes return the authoritative row instead of logging an exception", () => {
  assert.match(sql, /create table if not exists private\.active_job_conflict_guards/i);
  assert.match(sql, /insert into private\.active_job_conflict_guards as guard/i);
  assert.match(sql, /returning blocked_until into v_blocked_until/i);
  assert.match(sql, /select a\.workspace_id, a\.payload, a\.revision, a\.last_operation_id, a\.updated_at, a\.updated_by\s*from public\.active_jobs a\s*where a\.workspace_id = p_workspace_id;/i);
  assert.doesNotMatch(sql, /message\s*=\s*'revision_conflict'/i);
});

test("the durable guard starts backoff after twelve conflicts in ten seconds", () => {
  assert.match(sql, /guard\.window_started_at <= now\(\) - interval '10 seconds'/i);
  assert.match(sql, /guard\.conflict_count \+ 1 >= 12/i);
  assert.match(sql, /now\(\) \+ interval '60 seconds'/i);
  assert.match(sql, /perform pg_sleep\(0\.25\)/i);
});

test("the client recognizes an authoritative remote row as a conflict", () => {
  const source = fs.readFileSync(path.join(__dirname, "cloud-sync.js"), "utf8");
  const flush = source.slice(
    source.indexOf("async function flushActiveJob("),
    source.indexOf("function notifyActiveJobMutation(")
  );
  assert.match(flush, /row\.operation_id !== pending\.operationId/);
  assert.match(flush, /!activeJobLib\?\.activeJobsEqual\?\.\(pending\.payload, row\.payload\)/);
  assert.match(flush, /await resolveActiveConflict\(pending, row, \{ alreadyCounted: true \}\)/);
});
