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
const counts=fs.readFileSync("supabase/migrations/202609130001_line_configuration_hopper_counts.sql","utf8");
test("hoppers per layer is one integer per layer, 1 to 6, backfilled to six, and saved through the same admin procedure with an optional trailing argument",()=>{
  assert.match(counts,/add column hopper_counts integer\[\] not null default '\{\}'/);
  assert.match(counts,/set hopper_counts = array_fill\(6, array\[layer_count\]\)/);
  assert.match(counts,/check \(cardinality\(hopper_counts\) = layer_count and array_position\(hopper_counts, null\) is null and hopper_counts <@ array\[1,2,3,4,5,6\]\)/);
  assert.match(counts,/alter column hopper_counts drop default/);
  assert.match(counts,/drop function public\.admin_save_line_configuration\(uuid,integer,text,text\[\],integer,text,text,text,boolean,jsonb\);/);
  assert.match(counts,/p_is_active boolean, p_metadata jsonb, p_hopper_counts integer\[\] default null/);
  assert.match(counts,/coalesce\(p_hopper_counts, array_fill\(6, array\[p_layer_count\]\)\)/);
  assert.match(counts,/security definer set search_path = ''/);
  assert.match(counts,/perform private\.assert_admin\(\)/);
  assert.match(counts,/revoke all on function public\.admin_save_line_configuration\(uuid,integer,text,text\[\],integer,text,text,text,boolean,jsonb,integer\[\]\) from public, anon/);
  assert.match(counts,/grant execute on function public\.admin_save_line_configuration\(uuid,integer,text,text\[\],integer,text,text,text,boolean,jsonb,integer\[\]\) to authenticated/);
  assert.doesNotMatch(counts,/admin_delete_line_configuration/);
});
