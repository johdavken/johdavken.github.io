// RT Cloud - encrypted disaster-recovery backup for RT Notes.
//
// This is BACKUP AND RECOVERY, not live Notes sync. The device's IndexedDB
// stays authoritative; one Recovery Code maps to exactly one current
// encrypted snapshot. There is no Realtime, no per-note storage, no history.
//
// The function is deployed with verify_jwt = false ON PURPOSE: RT Cloud must
// work with no RT Sync session at all, on a brand-new install with brand-new
// RT Sync identities. The credential is the client-derived `lookup_hash`
// (base64url(SHA-256("rtcloud/lookup/v1\n" || recovery_code))) - a one-way
// value. The raw Recovery Code never reaches this function. Encryption and
// decryption are entirely client-side; this function only stores and returns
// an opaque ciphertext blob plus non-sensitive metadata. It can never read a
// note title, body, bodyFormat, folder name, or folder relationship.
//
// RT Sync Device ID / anonymous RT User ID, if sent, are stored as nullable
// diagnostic columns only. They are never used for lookup, ownership, or
// access control.
//
// Required environment (all auto-provided by Supabase to Edge Functions):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   - service-role client; this table has RLS
//                                 enabled with NO policies, so the Edge
//                                 Function is the only access path.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = [
  "https://resin.tools",
  "https://localhost",
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/
];

const ACTIONS = ["enable", "backup", "restore", "status", "delete"] as const;
type Action = typeof ACTIONS[number];

const LOOKUP_HASH_RE = /^[A-Za-z0-9_-]{40,64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ciphertext is base64 of at most ~1.5 MiB (matches the DB CHECK). Allow a
// little slack here; the database constraint is the hard ceiling.
const MAX_PAYLOAD_CHARS = 2_400_000;
const MAX_BODY_BYTES = 3_200_000;
const MAX_SALT_CHARS = 128;
const MAX_IV_CHARS = 64;
const MAX_DEVICE_ID_CHARS = 128;

// Per-IP throttle for restore/status (recovery lookup is effectively
// authentication). The Recovery Code's own entropy is the real defence; this
// just blunts automated hammering.
const THROTTLE_WINDOW_MS = 10 * 60_000;
const THROTTLE_MAX_ATTEMPTS = 30;
const THROTTLE_BLOCK_MS = 15 * 60_000;

// Best-effort in-flight de-dup by client request_id. Not a correctness
// guarantee (resets on cold start) - matches the recipe-scan function.
const RECENT_TTL_MS = 60_000;
const recentRequests = new Map<string, { expiresAt: number; body: string }>();

function pruneRecent(now: number) {
  for (const [k, v] of recentRequests) if (v.expiresAt <= now) recentRequests.delete(k);
}

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  for (const rule of ALLOWED_ORIGINS) {
    if (typeof rule === "string" ? rule === origin : rule.test(origin)) return origin;
  }
  return null;
}

function cors(origin: string | null): HeadersInit {
  const matched = allowedOrigin(origin);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-supabase-api-version"
  };
  if (matched) headers["Access-Control-Allow-Origin"] = matched;
  return headers;
}

// Every client-facing failure is one of a fixed, generic set. Never a
// database error, stack trace, or any hint about how close a guess was.
function fail(status: number, code: string, origin: string | null): Response {
  console.warn(`rt-cloud:${code}`);
  return new Response(JSON.stringify({ ok: false, error: code }), { status, headers: cors(origin) });
}

function ok(body: Record<string, unknown>, origin: string | null): Response {
  return new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: cors(origin) });
}

function isBase64(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxChars &&
    BASE64_RE.test(value)
  );
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i < min || i > max ? fallback : i;
}

function diagnosticDeviceId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_DEVICE_ID_CHARS
    ? value
    : null;
}

function diagnosticUserId(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0].trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}

type Supa = ReturnType<typeof createClient>;

// Returns true when the caller is currently throttled. Runs BEFORE any access
// to the backups table.
async function isThrottled(supa: Supa, ipHash: string): Promise<boolean> {
  const now = Date.now();
  const { data: row } = await supa
    .from("rt_notes_cloud_lookup_throttle")
    .select("window_started_at, attempts, blocked_until")
    .eq("ip_hash", ipHash)
    .maybeSingle();

  if (row?.blocked_until && new Date(row.blocked_until).getTime() > now) return true;

  const windowStart = row ? new Date(row.window_started_at).getTime() : 0;
  if (!row || now - windowStart > THROTTLE_WINDOW_MS) {
    await supa
      .from("rt_notes_cloud_lookup_throttle")
      .upsert(
        {
          ip_hash: ipHash,
          window_started_at: new Date(now).toISOString(),
          attempts: 1,
          blocked_until: null
        },
        { onConflict: "ip_hash" }
      );
    return false;
  }

  const attempts = (row.attempts || 0) + 1;
  const blockedUntil =
    attempts > THROTTLE_MAX_ATTEMPTS ? new Date(now + THROTTLE_BLOCK_MS).toISOString() : null;
  await supa
    .from("rt_notes_cloud_lookup_throttle")
    .update({ attempts, blocked_until: blockedUntil })
    .eq("ip_hash", ipHash);
  return !!blockedUntil;
}

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return fail(405, "method_not_allowed", origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return fail(500, "server_misconfigured", origin);

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return fail(413, "payload_too_large", origin);
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return fail(400, "invalid_request", origin);
  }
  if (raw.length > MAX_BODY_BYTES) return fail(413, "payload_too_large", origin);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "invalid_request", origin);
  }
  if (!body || typeof body !== "object") return fail(400, "invalid_request", origin);

  const action = body.action as string;
  if (!(ACTIONS as readonly string[]).includes(action)) return fail(400, "invalid_request", origin);

  const lookupHash = body.lookup_hash;
  if (typeof lookupHash !== "string" || !LOOKUP_HASH_RE.test(lookupHash)) {
    return fail(400, "invalid_request", origin);
  }

  const requestId = typeof body.request_id === "string" ? body.request_id.slice(0, 100) : "";

  const supa = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ---- request de-dup (write actions only) ----------------------------
  if (requestId && (action === "enable" || action === "backup" || action === "delete")) {
    const now = Date.now();
    pruneRecent(now);
    const key = `${lookupHash}:${action}:${requestId}`;
    const cached = recentRequests.get(key);
    if (cached) return new Response(cached.body, { status: 200, headers: cors(origin) });
  }

  try {
    if (action === "restore" || action === "status") {
      const ipHash = await sha256Hex(`rtcloud/throttle/v1\n${clientIp(req)}`);
      if (await isThrottled(supa, ipHash)) return fail(429, "rate_limited", origin);

      const { data: row, error } = await supa
        .from("rt_notes_cloud_backups")
        .select(
          "kdf_salt, iv, encrypted_payload, encryption_version, payload_version, revision, last_backup_at, created_at"
        )
        .eq("backup_lookup_hash", lookupHash)
        .maybeSingle();
      if (error) return fail(502, "storage_error", origin);
      if (!row) return ok({ exists: false }, origin);

      if (action === "status") {
        return ok(
          {
            exists: true,
            revision: row.revision,
            payload_version: row.payload_version,
            encryption_version: row.encryption_version,
            last_backup_at: row.last_backup_at,
            created_at: row.created_at
          },
          origin
        );
      }
      return ok(
        {
          exists: true,
          kdf_salt: row.kdf_salt,
          iv: row.iv,
          encrypted_payload: row.encrypted_payload,
          encryption_version: row.encryption_version,
          payload_version: row.payload_version,
          revision: row.revision,
          last_backup_at: row.last_backup_at
        },
        origin
      );
    }

    if (action === "delete") {
      const { error } = await supa
        .from("rt_notes_cloud_backups")
        .delete()
        .eq("backup_lookup_hash", lookupHash);
      if (error) return fail(502, "storage_error", origin);
      const res = ok({ deleted: true }, origin);
      if (requestId) {
        recentRequests.set(`${lookupHash}:delete:${requestId}`, {
          expiresAt: Date.now() + RECENT_TTL_MS,
          body: JSON.stringify({ ok: true, deleted: true })
        });
      }
      return res;
    }

    // ---- enable / backup: crypto fields required ----------------------
    const kdfSalt = body.kdf_salt;
    const iv = body.iv;
    const payload = body.encrypted_payload;
    if (!isBase64(kdfSalt, MAX_SALT_CHARS)) return fail(400, "invalid_request", origin);
    if (!isBase64(iv, MAX_IV_CHARS)) return fail(400, "invalid_request", origin);
    if (!isBase64(payload, MAX_PAYLOAD_CHARS)) return fail(400, "invalid_request", origin);

    const encryptionVersion = clampInt(body.encryption_version, 1, 1, 32);
    const payloadVersion = clampInt(body.payload_version, 2, 1, 32);
    const sourceDeviceId = diagnosticDeviceId(body.source_device_id);
    const sourceRtUserId = diagnosticUserId(body.source_rt_user_id);
    const nowIso = new Date().toISOString();

    if (action === "enable") {
      const { error } = await supa.from("rt_notes_cloud_backups").insert({
        backup_lookup_hash: lookupHash,
        kdf_salt: kdfSalt,
        iv,
        encrypted_payload: payload,
        encryption_version: encryptionVersion,
        payload_version: payloadVersion,
        revision: 1,
        source_device_id: sourceDeviceId,
        source_rt_user_id: sourceRtUserId,
        last_backup_at: nowIso
      });
      if (error) {
        // Unique violation -> a backup already exists for this Recovery Code.
        // Do not overwrite it on "enable"; tell the client so it can adopt
        // the existing backup instead.
        if ((error as { code?: string }).code === "23505") {
          const res = ok({ created: false, already_exists: true }, origin);
          if (requestId) {
            recentRequests.set(`${lookupHash}:enable:${requestId}`, {
              expiresAt: Date.now() + RECENT_TTL_MS,
              body: JSON.stringify({ ok: true, created: false, already_exists: true })
            });
          }
          return res;
        }
        return fail(502, "storage_error", origin);
      }
      const res = ok({ created: true, revision: 1 }, origin);
      if (requestId) {
        recentRequests.set(`${lookupHash}:enable:${requestId}`, {
          expiresAt: Date.now() + RECENT_TTL_MS,
          body: JSON.stringify({ ok: true, created: true, revision: 1 })
        });
      }
      return res;
    }

    // action === "backup": update the existing row, bump revision.
    const { data: current, error: readErr } = await supa
      .from("rt_notes_cloud_backups")
      .select("revision")
      .eq("backup_lookup_hash", lookupHash)
      .maybeSingle();
    if (readErr) return fail(502, "storage_error", origin);
    if (!current) return fail(404, "not_found", origin);

    const nextRevision = Number(current.revision || 0) + 1;
    const { error: updErr } = await supa
      .from("rt_notes_cloud_backups")
      .update({
        kdf_salt: kdfSalt,
        iv,
        encrypted_payload: payload,
        encryption_version: encryptionVersion,
        payload_version: payloadVersion,
        revision: nextRevision,
        source_device_id: sourceDeviceId,
        source_rt_user_id: sourceRtUserId,
        last_backup_at: nowIso
      })
      .eq("backup_lookup_hash", lookupHash);
    if (updErr) return fail(502, "storage_error", origin);

    const res = ok({ revision: nextRevision }, origin);
    if (requestId) {
      recentRequests.set(`${lookupHash}:backup:${requestId}`, {
        expiresAt: Date.now() + RECENT_TTL_MS,
        body: JSON.stringify({ ok: true, revision: nextRevision })
      });
    }
    return res;
  } catch {
    return fail(502, "storage_error", origin);
  }
}

Deno.serve(handle);
