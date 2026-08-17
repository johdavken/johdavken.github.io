const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const health = require("./database-health.js");
const functionSource = fs.readFileSync("supabase/functions/database-health/index.ts", "utf8");
const parserSource = fs.readFileSync("supabase/functions/database-health/metrics.ts", "utf8");
const ui = fs.readFileSync("database-health-ui.js", "utf8");

test("health endpoint retains JWT authentication and checks the existing admin_users source of truth", () => {
  assert.match(functionSource, /auth\.getUser\(\)/);
  assert.match(functionSource, /from\("admin_users"\)/);
  assert.match(functionSource, /admin_access_required/);
  assert.doesNotMatch(functionSource, /verify_jwt\s*=\s*false/);
});

test("CORS permits the standard Supabase browser invocation headers", () => {
  assert.match(functionSource, /authorization, apikey, content-type, x-client-info, x-supabase-api-version/);
});

test("the metrics secret is server-only and only sanitized fields are returned", () => {
  assert.match(functionSource, /Deno\.env\.get\("METRICS_SECRET_KEY"\)/);
  assert.match(functionSource, /Basic \$\{btoa\(`service_role:\$\{metricsSecret\}`\)\}/);
  assert.doesNotMatch(fs.readFileSync("database-health-ui.js", "utf8"), /METRICS_SECRET_KEY|privileged\/metrics/);
  assert.match(functionSource, /cpuPercent: metrics\.cpuPercent, connections: metrics\.connections, memoryPercent: metrics\.memoryPercent, sampledAt/);
});

test("Prometheus parser has documented CPU gauge extraction and omits unavailable optional metrics", () => {
  assert.match(parserSource, /node_cpu_seconds_total/);
  assert.match(parserSource, /pgbouncer_databases_current_connections/);
  assert.match(parserSource, /return \{ cpuPercent, connections, memoryPercent \}/);
  assert.match(parserSource, /if \(!samples\) return null/);
  assert.match(parserSource, /NaN\|\[\+\-\]\?Inf/);
  assert.match(parserSource, /if \(!Number\.isFinite\(value\)\) continue/);
});

test("client polling starts only for a visible panel, is limited to 60 seconds, and stops on close", async () => {
  let visible = false, intervalDelay, cleared = 0, calls = 0;
  const service = health.create({
    isVisible: () => visible,
    invoke: async () => { calls++; return { ok:true, cpuPercent:3.8, sampledAt:new Date().toISOString() }; },
    interval: fn => { intervalDelay = health.REFRESH_MS; return fn; },
    clear: () => { cleared++; }
  });
  service.start();
  assert.equal(calls, 0, "normal non-admin/non-visible use makes no request");
  visible = true; service.start();
  assert.equal(intervalDelay, 60_000);
  await Promise.resolve();
  assert.equal(calls, 1);
  visible = false; await service.refresh();
  assert.equal(cleared, 1);
});

test("UI invokes only through the existing authenticated admin client and stops when access is removed", () => {
  assert.match(ui, /functions\.invoke\("database-health", \{ body:\{ cpuCursor \} \}\)/);
  assert.match(ui, /if \(!admin\?\.getState\(\)\.isAdmin\) return/);
  assert.match(ui, /health\.stop\(\)/);
  assert.match(ui, /Database metrics unavailable/);
  assert.match(ui, /response\.error\.context\?\.clone\?\.\(\)\.json\(\)/);
});

test("CPU continuity uses a short-lived signed cursor instead of Edge memory or database persistence", () => {
  assert.match(functionSource, /crypto\.subtle\.sign\("HMAC"/);
  assert.match(functionSource, /crypto\.subtle\.verify\("HMAC"/);
  assert.match(functionSource, /CPU_CURSOR_MAX_AGE_MS = 5 \* 60_000/);
  assert.match(functionSource, /readCpuCursor\(requestedCursor, projectRef, metricsSecret\)/);
  assert.match(functionSource, /snapshot \? await createCpuCursor\(snapshot, projectRef, metricsSecret\) : null/);
  assert.doesNotMatch(functionSource, /lastCpuByProject|\.from\("database_health/);
});

test("manual refresh keeps the CPU baseline and last reading when the upstream counter has not advanced", () => {
  assert.match(functionSource, /snapshot\.total <= previousCpu\.total/);
  assert.match(functionSource, /unchangedCpu && typeof requestedCursor === "string"/);
  assert.match(ui, /samples\.at\(-1\)/);
  assert.match(ui, /api\.status\(displayedCpu\)/);
});

test("upstream failures expose fixed diagnostics without logging credentials", () => {
  for (const code of ["metrics_auth_failed", "metrics_upstream_failed", "metrics_response_malformed", "metrics_timeout", "metrics_network_error"]){
    assert.match(functionSource, new RegExp(code));
  }
  assert.match(functionSource, /console\.warn\(`database-health:\$\{code\}`\)/);
  assert.doesNotMatch(functionSource, /console\.(?:log|warn|error)\([^\n]*(?:metricsSecret|authHeader|upstream\.text)/);
});
