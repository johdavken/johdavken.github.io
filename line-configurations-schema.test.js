"use strict";
const test=require("node:test"); const assert=require("node:assert/strict"); const fs=require("node:fs");
const sql=fs.readFileSync("supabase/migrations/202608290001_line_configurations.sql","utf8");
test("line configurations are persistent, extensible, validated, and seeded from Lines 1-15",()=>{
  assert.match(sql,/create table public\.line_configurations/);
  assert.match(sql,/metadata jsonb not null/); assert.match(sql,/layer_count between 1 and 9/);
  assert.equal((sql.match(/\(\d+,'Line \d+'/g)||[]).length,15);
  assert.match(sql,/line_configuration_name_conflict/);
});
test("reads support offline caching while writes remain admin-only",()=>{
  assert.match(sql,/for select to anon, authenticated using \(true\)/);
  assert.match(sql,/perform private\.assert_admin\(\)/g);
  assert.match(sql,/revoke insert, update, delete on public\.line_configurations from anon, authenticated/);
  assert.doesNotMatch(sql,/admin_delete_line_configuration/);
});
