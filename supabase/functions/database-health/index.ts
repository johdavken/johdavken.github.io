import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { cpuSnapshot, extractDatabaseHealth, type CpuSnapshot } from "./metrics.ts";

const ALLOWED_ORIGINS = ["https://resin.tools", "https://localhost", /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
const lastCpuByProject = new Map<string, CpuSnapshot>();

function cors(origin: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS.some(rule => typeof rule === "string" ? rule === origin : rule.test(origin));
  // functions.invoke adds apikey and x-client-info in addition to the caller
  // JWT. Allow those standard Supabase SDK headers so browser preflight can
  // reach the authenticated handler; authorization is still verified below.
  return { "Content-Type": "application/json", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version", ...(allowed ? { "Access-Control-Allow-Origin": origin } : {}) };
}
function error(status: number, code: string, origin: string | null) {
  // Fixed diagnostic code only: never log headers, secrets, environment
  // values, upstream bodies, or thrown error messages.
  console.warn(`database-health:${code}`);
  return new Response(JSON.stringify({ ok: false, error: code }), { status, headers: cors(origin) });
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return error(405, "method_not_allowed", origin);

  const authHeader = req.headers.get("authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const metricsSecret = Deno.env.get("METRICS_SECRET_KEY");
  if (!authHeader) return error(401, "unauthorized", origin);
  if (!supabaseUrl || !anonKey || !metricsSecret) return error(500, "server_misconfigured", origin);

  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return error(401, "unauthorized", origin);
  // This is the same source of truth and RLS-protected verification used by
  // Resin Database administration; no client claim or parallel role is used.
  const { data: admin, error: adminError } = await caller.from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (adminError || !admin) return error(403, "admin_access_required", origin);

  try {
    const host = new URL(supabaseUrl).hostname;
    const projectRef = host.split(".")[0];
    if (!projectRef) return error(500, "server_misconfigured", origin);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let upstream: Response | null = null;
    try {
      upstream = await fetch(`${new URL(supabaseUrl).origin}/customer/v1/privileged/metrics`, {
        headers: { Authorization: `Basic ${btoa(`service_role:${metricsSecret}`)}` }, signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
    if (!upstream || upstream.status === 401 || upstream.status === 403) return error(502, "metrics_auth_failed", origin);
    if (!upstream.ok) return error(502, "metrics_upstream_failed", origin);
    const payload = await upstream.text();
    const metrics = extractDatabaseHealth(payload, lastCpuByProject.get(projectRef) || null);
    if (!metrics) return error(502, "metrics_response_malformed", origin);
    const snapshot = cpuSnapshot(payload);
    if (snapshot) lastCpuByProject.set(projectRef, snapshot);
    return new Response(JSON.stringify({ ok: true, cpuPercent: metrics.cpuPercent, connections: metrics.connections, memoryPercent: metrics.memoryPercent, sampledAt: new Date().toISOString() }), { headers: cors(origin) });
  } catch (caught) {
    return error(502, caught instanceof DOMException && caught.name === "AbortError" ? "metrics_timeout" : "metrics_network_error", origin);
  }
});
