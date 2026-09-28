"use strict";

// Source-level checks on the RT Cloud Edge Function. It is Deno/TypeScript
// and cannot run under node:test, so these pin its security-relevant shape -
// the same style as recipe-scan-edge-function.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const src = fs.readFileSync("supabase/functions/rt-cloud/index.ts", "utf8");
const config = fs.readFileSync("supabase/config.toml", "utf8");

test("deployed unauthenticated at the gateway, on purpose", () => {
  assert.match(config, /\[functions\.rt-cloud\]\s*\nverify_jwt = false/);
});

test("strict CORS allow-list, no wildcard", () => {
  assert.match(src, /const ALLOWED_ORIGINS = \[/);
  assert.match(src, /"https:\/\/resin\.tools"/);
  assert.doesNotMatch(src, /Access-Control-Allow-Origin"\]\s*=\s*"\*"/);
  assert.doesNotMatch(src, /"Access-Control-Allow-Origin":\s*"\*"/);
});

test("the credential is the client-derived lookup hash, validated before any DB access", () => {
  assert.match(src, /const LOOKUP_HASH_RE = \/\^\[A-Za-z0-9_-\]\{40,64\}\$\//);
  // lookup_hash is validated in the handler before createClient/queries run.
  const handlerStart = src.indexOf("async function handle(");
  const firstDbCall = src.indexOf(".from(", handlerStart);
  const lookupCheck = src.indexOf("LOOKUP_HASH_RE.test(lookupHash)", handlerStart);
  assert.ok(lookupCheck !== -1 && lookupCheck < firstDbCall, "lookup hash is checked before the first .from()");
  // No RT Sync / workspace / auth.uid lookups anywhere.
  assert.doesNotMatch(src, /line_workspace|auth\.getUser|auth\.uid|workspace_id/);
});

test("service-role key comes from the environment and is never returned to the client", () => {
  assert.match(src, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.doesNotMatch(src, /service.?role.?key\s*[:=]\s*["']/i);
  // The key variable is only handed to createClient, never serialised.
  assert.doesNotMatch(src, /JSON\.stringify\([^)]*serviceKey/);
});

test("all five actions are implemented", () => {
  assert.match(src, /const ACTIONS = \["enable", "backup", "restore", "status", "delete"\]/);
  for (const a of ["enable", "backup", "restore", "status", "delete"]) {
    assert.match(src, new RegExp(`action === "${a}"`));
  }
});

test("restore / status responses carry no note or folder content", () => {
  const cols = (src.match(/\.select\(\s*"?([^)]*?)"?\s*\)/g) || []).map((m) =>
    m.replace(/\s+/g, " ").trim()
  );
  // Exactly three reads: throttle row, the backups payload row, a revision.
  assert.equal(cols.length, 3);
  assert.ok(cols.some((c) => c.includes("window_started_at, attempts, blocked_until")));
  assert.ok(cols.some((c) => c === '.select( "revision" )' || c.includes('"revision"')));
  const payloadSelect = cols.find((c) => c.includes("encrypted_payload"));
  assert.ok(payloadSelect, "the backups read pulls the ciphertext");
  for (const forbidden of ["title", "note_body", "folder_name", "plaintext", "bodyformat"]) {
    assert.ok(!payloadSelect.toLowerCase().includes(forbidden), `no ${forbidden} column read`);
  }
});

test("recovery lookup is rate-limited before touching the backups table", () => {
  assert.match(src, /isThrottled\(/);
  assert.match(src, /rt_notes_cloud_lookup_throttle/);
  assert.match(src, /return fail\(429, "rate_limited"/);
  const restoreBranch = src.indexOf('action === "restore" || action === "status"');
  const throttleCall = src.indexOf("await isThrottled(", restoreBranch);
  const backupSelect = src.indexOf('.from("rt_notes_cloud_backups")', restoreBranch);
  assert.ok(throttleCall !== -1 && throttleCall < backupSelect, "throttle check precedes the backup lookup");
});

test("errors are generic codes only - never a DB error, body, or stack", () => {
  assert.match(src, /function fail\(status: number, code: string/);
  assert.match(src, /\{ ok: false, error: code \}/);
  assert.doesNotMatch(src, /error\.message|error\.stack|JSON\.stringify\(error\)/);
  // Request size is bounded.
  assert.match(src, /MAX_BODY_BYTES/);
  assert.match(src, /payload_too_large/);
});

test("no Realtime usage", () => {
  assert.doesNotMatch(src, /\.channel\s*\(|\.subscribe\s*\(|removeChannel|RealtimeChannel/);
});
