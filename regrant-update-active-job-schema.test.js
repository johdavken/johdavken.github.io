"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608050001_regrant_update_active_job.sql"),
  "utf8"
);

test("re-grants EXECUTE on update_active_job to authenticated, with the exact original signature", () => {
  assert.match(sql, /grant execute on function public\.update_active_job\(uuid,jsonb,bigint,uuid\) to authenticated;/i);
});

test("migration is additive: only this one grant statement, nothing else", () => {
  assert.doesNotMatch(sql, /drop function/i);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /alter table/i);
  assert.doesNotMatch(sql, /^\s*create or replace function/im);
  assert.doesNotMatch(sql, /create policy|drop policy|alter policy/i);
  const grants = sql.match(/^\s*grant\s/gim) || [];
  assert.equal(grants.length, 1, "expected exactly one GRANT statement in this migration");
  const revokes = sql.match(/^\s*revoke\s/gim) || [];
  assert.equal(revokes.length, 0, "this migration only restores a grant - it must not revoke anything");
});

test("does not touch permissions on any other function", () => {
  const matches = sql.match(/grant execute on function ([a-z0-9_.]+)/gi) || [];
  assert.equal(matches.length, 1);
  assert.match(matches[0], /public\.update_active_job/i);
});
