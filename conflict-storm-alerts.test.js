"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const stormsApi = require("./conflict-storm-alerts.js");

const migration = fs.readFileSync("supabase/migrations/202608260001_admin_conflict_storm_alerts.sql", "utf8");
const ui = fs.readFileSync("database-health-ui.js", "utf8");
const workspaceUi = fs.readFileSync("workspace-recovery-ui.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function fakeClient(handlers = {}){
  const calls = [];
  return {
    calls,
    async rpc(name, args){
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) return { data: null, error: { message: `unhandled rpc ${name}` } };
      return handler(args);
    }
  };
}

/* ----------------------------------------------------------------------
 *   Migration contract - the circuit breaker gets a read-only admin window
 * -------------------------------------------------------------------- */

test("the RPC is admin-gated the same way every other admin recovery action is", () => {
  assert.match(migration, /perform private\.assert_admin\(\);/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.admin_list_conflict_storms\(\) from public, anon;/);
  assert.match(migration, /grant execute on function public\.admin_list_conflict_storms\(\) to authenticated;/);
});

test("only rows where the breaker has actually tripped are returned, not every ordinary conflict", () => {
  assert.match(migration, /where g\.blocked_until is not null/);
  assert.match(migration, /and g\.blocked_until > now\(\) - interval '1 hour'/);
});

test("is_active distinguishes a live block from one that has already cleared", () => {
  assert.match(migration, /g\.blocked_until > now\(\)\s*$/m);
});

test("the result names the workspace and, where still a member, the device - not just raw ids", () => {
  assert.match(migration, /join public\.line_workspaces w on w\.id = g\.workspace_id/);
  assert.match(migration, /left join public\.line_workspace_members m\s*\n\s*on m\.workspace_id = g\.workspace_id and m\.user_id = g\.user_id/);
});

test("reads the locked-down guard table only through this security-definer function, never grants it directly", () => {
  assert.doesNotMatch(migration, /grant \w+ on table private\.active_job_conflict_guards/);
  assert.match(migration, /from private\.active_job_conflict_guards g/);
});

/* ----------------------------------------------------------------------
 *   Service module
 * -------------------------------------------------------------------- */

test("with no client, list fails locally without a network attempt", async () => {
  const service = stormsApi.create({});
  const result = await service.list();
  assert.equal(result.ok, false);
  assert.deepEqual(result.storms, []);
});

test("list calls the admin RPC and returns rows unmodified", async () => {
  const rows = [{ workspace_id: "ws-1", workspace_name: "Line 8", user_id: "u-1", device_label: "Line 8 tablet", conflict_count: 14, blocked_until: "2026-08-26T12:00:00Z", updated_at: "2026-08-26T11:59:00Z", is_active: true }];
  const client = fakeClient({ admin_list_conflict_storms: () => ({ data: rows, error: null }) });
  const service = stormsApi.create({ client });
  const result = await service.list();
  assert.equal(result.ok, true);
  assert.deepEqual(result.storms, rows);
  assert.equal(client.calls[0].name, "admin_list_conflict_storms");
});

test("an RPC error is translated to a friendly, non-technical message", async () => {
  const client = fakeClient({ admin_list_conflict_storms: () => ({ data: null, error: { message: "admin_access_required" } }) });
  const service = stormsApi.create({ client });
  const result = await service.list();
  assert.equal(result.ok, false);
  assert.equal(result.message, "Admin access is required.");
});

/* ----------------------------------------------------------------------
 *   UI wiring
 * -------------------------------------------------------------------- */

test("polling is keyed on admin sign-in, not on the panel being open - unlike the CPU/memory poller above it", () => {
  const stormsBlock = ui.slice(ui.indexOf("const stormsApi = root.PolynConflictStormAlerts;"));
  assert.match(stormsBlock, /const isAdmin = !!root\.PolynResinAdminInstance\?\.getState\(\)\.isAdmin;/);
  assert.match(stormsBlock, /setInterval\(refreshStorms, api\.REFRESH_MS\)/);
  assert.match(stormsBlock, /clearInterval\(stormsTimer\)/);
  assert.match(stormsBlock, /admin\?\.subscribe\(syncStorms\)/);
});

test("the nav badge only counts storms that are still active, and hides at zero", () => {
  assert.match(ui, /const activeCount = rows\.filter\(row => row\.is_active\)\.length;/);
  assert.match(ui, /badge\.hidden = activeCount === 0;/);
});

test("each row's action hands the admin straight to that workspace in Workspace Management", () => {
  assert.match(ui, /root\.PolynWorkspaceRecoveryUI\?\.openWorkspace\(row\.workspace_id\)/);
  assert.match(workspaceUi, /async function openWorkspace\(workspaceId\)\{/);
  assert.match(workspaceUi, /root\.PolynWorkspaceRecoveryUI = \{ openWorkspace \};/);
});

test("workspace name and device label render as text, never interpolated into markup", () => {
  const stormsBlock = ui.slice(ui.indexOf("function renderStorms"), ui.indexOf("let stormsTimer"));
  assert.doesNotMatch(stormsBlock, /innerHTML/);
  assert.match(stormsBlock, /title\.textContent = row\.workspace_name/);
  assert.match(stormsBlock, /meta\.textContent = /);
});

test("stopping admin access clears the storm list along with stopping the poll", () => {
  assert.match(ui, /renderStorms\(\[\]\);/);
});

/* ----------------------------------------------------------------------
 *   Badge styling reuses the notification bell's severity language
 * -------------------------------------------------------------------- */

test("the nav badge is scoped to its own host so it never disturbs the shared admin-row grid", () => {
  assert.match(styles, /\.conflictStormBadgeHost\{ position:relative; \}/);
  assert.match(styles, /\.conflictStormBadge\{[\s\S]*?position:absolute;/);
  assert.match(styles, /\.conflictStormBadge\[hidden\]\{ display:none!important; \}/);
});

test("an active storm row reads visually distinct from a resolved one", () => {
  assert.match(styles, /\.conflictStormRow\.active\{[\s\S]*?border-color:var\(--bad\);/);
});
