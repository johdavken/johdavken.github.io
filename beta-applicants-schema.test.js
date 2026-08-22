"use strict";

// Source-level contract for the beta-access database layer. There is no
// local Postgres in this project, so these assert the properties that would
// otherwise only be visible in production: that the client cannot write the
// table, that identity is derived on the server, that the admin-only call is
// gated, and that every function is hardened the way the rest of the schema
// is.
//
// Threat model worth keeping in mind while reading: the Play internal-test
// link this gates is not a secret - Play refuses the install to any account
// not on the tester list. What genuinely matters here is the personal data,
// so the assertions concentrate on who can read and write rows, not on how
// hard it is to see the link.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "supabase/migrations/202608220001_beta_applicants.sql"),
  "utf8"
);

function functionSql(name){
  const match = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "i"));
  assert.ok(match, `Expected SQL function ${name}`);
  return match[0];
}

const WRITERS = [
  "submit_beta_application",
  "admin_set_beta_applicant_invited",
  "delete_beta_application"
];

test("the migration is transactional, like every other migration in the project", () => {
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
});

/* ----------------------------------------------------------------------
 *   Table shape
 * -------------------------------------------------------------------- */

test("a request is one row per identity and one row per address", () => {
  assert.match(sql, /create table if not exists public\.beta_applicants/);
  assert.match(sql, /constraint beta_applicants_user_id_key unique \(user_id\)/);
  assert.match(sql, /constraint beta_applicants_email_key unique \(email\)/);
  // Tied to the auth user, and gone with it.
  assert.match(sql, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
});

test("status is a closed set, and cannot claim to be invited without a timestamp", () => {
  assert.match(sql, /constraint beta_applicants_status_check check \(status in \('pending', 'invited'\)\)/);
  const invariant = sql.match(/constraint beta_applicants_invited_at_check check \([\s\S]*?\n  \)/);
  assert.ok(invariant, "expected the status/invited_at invariant");
  assert.match(invariant[0], /status = 'invited' and invited_at is not null/);
  assert.match(invariant[0], /status = 'pending' and invited_at is null/);
});

test("email and name are bounded at the column, not only in the RPC", () => {
  assert.match(sql, /constraint beta_applicants_email_length check \(char_length\(email\) between 6 and 254\)/);
  assert.match(sql, /constraint beta_applicants_display_name_length check \(char_length\(display_name\) between 1 and 80\)/);
  assert.match(sql, /constraint beta_applicants_email_format check/);
});

/* ----------------------------------------------------------------------
 *   Who can read, who can write
 * -------------------------------------------------------------------- */

test("RLS is on, and a reader sees only their own row unless they are an admin", () => {
  assert.match(sql, /alter table public\.beta_applicants enable row level security;/);
  const policy = sql.match(/create policy beta_applicants_select_self_or_admin[\s\S]*?;\n/);
  assert.ok(policy, "expected the select policy");
  assert.match(policy[0], /for select/);
  assert.match(policy[0], /to authenticated/);
  assert.match(policy[0], /user_id = \(select auth\.uid\(\)\) or \(select public\.is_resin_admin\(\)\)/);
});

test("the client can never write the table directly - there is no write policy at all", () => {
  assert.doesNotMatch(sql, /create policy[\s\S]*?for (insert|update|delete)/i);
  assert.match(sql, /revoke all on table public\.beta_applicants from public, anon, authenticated;/);
  // Read is the only grant; writes must go through the definer functions.
  assert.match(sql, /grant select on table public\.beta_applicants to authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*on table public\.beta_applicants/i);
});

test("every write function is security definer with an empty search_path", () => {
  WRITERS.forEach(name => {
    const body = functionSql(name);
    assert.match(body, /security definer/, `${name} must be security definer`);
    assert.match(body, /set search_path = ''/, `${name} must pin an empty search_path`);
  });
});

test("no write function is reachable anonymously or by the public role", () => {
  WRITERS.forEach(name => {
    const revoke = new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`);
    const grant = new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`);
    assert.match(sql, revoke, `${name} must be revoked from public/anon`);
    assert.match(sql, grant, `${name} must be granted to authenticated only`);
  });
});

/* ----------------------------------------------------------------------
 *   submit_beta_application
 * -------------------------------------------------------------------- */

test("the submitting identity is derived from the session, never taken as an argument", () => {
  const body = functionSql("submit_beta_application");
  assert.match(body, /v_user_id uuid := private\.assert_authenticated\(\)/);
  // Only the two fields a person types are parameters.
  assert.match(body, /function public\.submit_beta_application\(\s*p_email text,\s*p_display_name text\s*\)/);
  assert.doesNotMatch(body, /p_user_id|p_status|p_invited_at/);
});

test("submitting cannot promote a request to invited", () => {
  const body = functionSql("submit_beta_application");
  assert.doesNotMatch(body, /'invited'/);
  assert.doesNotMatch(body, /invited_at\s*=/);
  assert.doesNotMatch(body, /invited_by\s*=/);
});

test("email and name are normalized and re-validated on the server", () => {
  const body = functionSql("submit_beta_application");
  assert.match(body, /lower\(btrim\(coalesce\(p_email, ''\)\)\)/);
  assert.match(body, /regexp_replace\(v_name, '\\s\+', ' ', 'g'\)/);
  assert.match(body, /raise exception using errcode = '22023', message = 'invalid_beta_application'/);
});

// Clearing browser storage destroys the anonymous identity permanently, so
// without this an approved tester who cleared their browser would lose the
// link with no way back. Re-binding hands the existing row to the caller and
// keeps its status; it cannot mint an invitation.
test("re-submitting a known address re-binds it to the current identity, preserving status", () => {
  const body = functionSql("submit_beta_application");
  assert.match(body, /if exists \(select 1 from public\.beta_applicants a where a\.email = v_email\)/);
  assert.match(body, /set user_id = v_user_id/);
  // The identity's previous row is released first, or the unique constraint
  // on user_id would collide with the update.
  assert.match(body, /delete from public\.beta_applicants a\s*\n\s*where a\.user_id = v_user_id and a\.email <> v_email;/);
});

/* ----------------------------------------------------------------------
 *   Admin actions
 * -------------------------------------------------------------------- */

test("only an admin may mark someone invited, and it is reversible", () => {
  const body = functionSql("admin_set_beta_applicant_invited");
  assert.match(body, /v_admin_id uuid := private\.assert_admin\(\)/);
  assert.match(body, /status = case when p_invited then 'invited' else 'pending' end/);
  assert.match(body, /invited_at = case when p_invited then now\(\) else null end/);
  assert.match(body, /invited_by = case when p_invited then v_admin_id else null end/);
  assert.match(body, /message = 'beta_applicant_not_found'/);
});

test("withdrawal is self-service, but removing somebody else's row needs admin", () => {
  const body = functionSql("delete_beta_application");
  assert.match(body, /v_user_id uuid := private\.assert_authenticated\(\)/);
  // No id -> delete my own row.
  assert.match(body, /if p_applicant_id is null then\s*\n\s*delete from public\.beta_applicants a where a\.user_id = v_user_id;/);
  // An id -> admin only.
  assert.match(body, /if not v_is_admin then\s*\n\s*raise exception using errcode = '42501', message = 'admin_access_required';/);
});

test("the table is not published to Realtime - this is a document, not live state", () => {
  assert.doesNotMatch(sql, /supabase_realtime/i);
});
