// Recipe Import - Scan Job Traveler or Scan Dosing Screen. Parses a photo
// into a structured draft (layer identity, resin components) for the
// operator to review and confirm before anything touches Recipe Setup.
// This function never writes to Postgres and never applies anything - it
// only returns a sanitized draft. Applying a confirmed draft is a
// client-side concern, through the app's existing guarded Recipe Setup
// mutation path. The client's source_type form field ("job_traveler" or
// "dosing_screen") selects which prompt/schema/sanitizer this request uses -
// see schema.ts for why these are two genuinely different shapes, not one
// relaxed in place.
//
// Required environment (Edge Function secrets):
//   SUPABASE_URL       - auto-provided by Supabase to every Edge Function.
//   SUPABASE_ANON_KEY  - auto-provided by Supabase to every Edge Function;
//                         name is unchanged even with the newer
//                         sb_publishable_/sb_secret_ key format. Verify both
//                         names against this project's actual Edge Function
//                         environment before first deploy - not verifiable
//                         from this environment.
//   OPENAI_API_KEY      - set explicitly: `supabase secrets set OPENAI_API_KEY=...`.
//                         Never logged, never returned to the client.
//   OPENAI_MODEL         - set explicitly: `supabase secrets set OPENAI_MODEL=gpt-5.6-luna`.
//                         Deliberately not hardcoded, so the model can be
//                         swapped without a code deploy.
//
// No service-role key is used or needed: workspace membership is checked
// as the caller's own JWT-scoped Supabase client, relying on the existing
// line_workspace_members_select RLS policy (user_id = auth.uid()) - the
// same posture the rest of the app uses, not a special server-only bypass.
// Scanning requires an active workspace connection by design (confirmed
// with the project owner) - there is no "local only" path for this feature.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  MAX_COMPONENTS_PER_LAYER,
  MAX_LAYERS,
  DOSING_SCREEN_COMPONENTS_PER_LAYER,
  sanitizeRecipeScanResult,
  sanitizeDosingScreenScanResult,
  validateImage
} from "./schema.ts";

const SOURCE_TYPES = ["job_traveler", "dosing_screen"] as const;
type SourceType = typeof SOURCE_TYPES[number];

const ALLOWED_ORIGINS = [
  "https://resin.tools",
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/
];

// Best-effort only: reduces accidental double-processing when a client
// retries an in-flight request with the same client-generated request_id.
// Not a correctness guarantee - resets on cold start, not shared across
// concurrent instances/regions. True dedup would need a persistence layer,
// which hasn't been asked for.
const RECENT_REQUEST_TTL_MS = 60_000;
const recentRequests = new Map<string, { expiresAt: number; body: string }>();

function pruneRecentRequests(now: number) {
  for (const [key, entry] of recentRequests) {
    if (entry.expiresAt <= now) recentRequests.delete(key);
  }
}

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  for (const allowed of ALLOWED_ORIGINS) {
    if (typeof allowed === "string" ? allowed === origin : allowed.test(origin)) return origin;
  }
  return null;
}

function corsHeaders(origin: string | null): HeadersInit {
  const matched = allowedOrigin(origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type"
  };
  if (matched) headers["Access-Control-Allow-Origin"] = matched;
  return headers;
}

// Every client-facing error is one of this fixed, generic set - never a
// provider error message, stack trace, or other internal detail.
function errorResponse(status: number, code: string, origin: string | null): Response {
  return new Response(JSON.stringify({ ok: false, error: code }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
  });
}

const ALL_POSITIONS = ["single", "inside", "inside_subskin", "core", "outside_subskin", "outside"];
const HOPPER_DESIGNATIONS = ["H1", "H2", "H3", "H4", "H5", "H6"];

function componentJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      resin_code: { type: ["string", "null"] },
      resin_code_confidence: { type: ["number", "null"] },
      percentage: { type: ["number", "null"] },
      percentage_confidence: { type: ["number", "null"] },
      hopper_designation: { type: ["string", "null"], enum: [...HOPPER_DESIGNATIONS, null] },
      hopper_designation_confidence: { type: ["number", "null"] }
    },
    required: [
      "resin_code", "resin_code_confidence", "percentage", "percentage_confidence",
      "hopper_designation", "hopper_designation_confidence"
    ]
  };
}

function layerJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      position: { type: ["string", "null"], enum: [...ALL_POSITIONS, null] },
      position_confidence: { type: ["number", "null"] },
      layer_percentage: { type: ["number", "null"] },
      layer_percentage_confidence: { type: ["number", "null"] },
      components: { type: "array", maxItems: MAX_COMPONENTS_PER_LAYER, items: componentJsonSchema() }
    },
    required: ["position", "position_confidence", "layer_percentage", "layer_percentage_confidence", "components"]
  };
}

function responseJsonSchema() {
  return {
    name: "job_traveler_scan_result",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        recipe: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: ["string", "null"] },
            layers: { type: "array", maxItems: MAX_LAYERS, items: layerJsonSchema() }
          },
          required: ["name", "layers"]
        }
      },
      required: ["recipe"]
    }
  };
}

const LAYER_LETTERS = ["A", "B", "C", "D", "E"];

function dosingScreenComponentJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      resin_code: { type: ["string", "null"] },
      resin_code_confidence: { type: ["number", "null"] },
      percentage: { type: ["number", "null"] },
      percentage_confidence: { type: ["number", "null"] }
    },
    required: ["resin_code", "resin_code_confidence", "percentage", "percentage_confidence"]
  };
}

function dosingScreenLayerJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      layer_letter: { type: ["string", "null"], enum: [...LAYER_LETTERS, null] },
      layer_letter_confidence: { type: ["number", "null"] },
      layer_percentage: { type: ["number", "null"] },
      layer_percentage_confidence: { type: ["number", "null"] },
      // Exactly this many, always - never omitted - so array position maps
      // reliably to hopper position on the client. minItems === maxItems is
      // deliberate, not a typo.
      components: {
        type: "array",
        minItems: DOSING_SCREEN_COMPONENTS_PER_LAYER,
        maxItems: DOSING_SCREEN_COMPONENTS_PER_LAYER,
        items: dosingScreenComponentJsonSchema()
      }
    },
    required: ["layer_letter", "layer_letter_confidence", "layer_percentage", "layer_percentage_confidence", "components"]
  };
}

function dosingScreenResponseJsonSchema() {
  return {
    name: "dosing_screen_scan_result",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        recipe: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: ["string", "null"] },
            layers: { type: "array", maxItems: MAX_LAYERS, items: dosingScreenLayerJsonSchema() }
          },
          required: ["name", "layers"]
        }
      },
      required: ["recipe"]
    }
  };
}

const PROMPT = [
  "Return only structured JSON matching the provided schema - no prose, no markdown fences.",
  "Use null for anything uncertain. Never invent a resin code or percentage - a guess is worse than null.",
  "Return per-field confidence (0-1, or null) wherever the schema provides a confidence field.",
  "Confidence is a review hint only, not a claim of correctness.",
  "",
  "This is a printed Job Traveler form (QA-030 style, 'PRODUCT BLEND' table). Each column is one physical",
  "film layer. Identify layers by COLUMN POSITION, left to right - not by the printed column header text,",
  "which is often worded inconsistently (e.g. a column may be labeled 'Outer (core)' while structurally",
  "being a sub-skin layer). For the standard layout, map position by column index:",
  "  1 column total: position = 'single'.",
  "  3 columns total: position = 'inside', 'core', 'outside', in that left-to-right order.",
  "  5 columns total: position = 'inside', 'inside_subskin', 'core', 'outside_subskin', 'outside', in that",
  "  left-to-right order.",
  "Return only the layers actually present - do not pad to 5. Do not guess a layer count other than what",
  "the columns actually show.",
  "",
  "Each layer column lists resin components with a percentage. Only include components with a real resin",
  "code and a non-zero percentage - the printed form pads unused rows with a literal '0' resin code and",
  "'0.00%'; omit those entirely rather than returning them as components. A layer's components should sum",
  "to 100%, though you should still report exactly what you read even if a total looks off.",
  "",
  "Handwritten corrections on the form (strikethroughs, replacement values written near a printed one)",
  "override the printed value only when legible and clear. Otherwise use the printed value. If neither is",
  "legible or you are not confident, use null rather than guessing.",
  "",
  "Operators sometimes hand-write a hopper assignment next to a resin component while planning where to",
  "load it - formats include 'H1' through 'H6', 'M' (meaning hopper 1, an alternate naming convention) with",
  "H2-H6 for the rest, or bare numbers '1' through '6'. When present and legible, normalize this to the",
  "hopper_designation field as exactly 'H1' through 'H6' (so 'M' becomes 'H1', bare '3' becomes 'H3').",
  "Leave hopper_designation null when no such handwritten note is present or it isn't legible - do not",
  "invent one."
].join(" ");

const DOSING_SCREEN_PROMPT = [
  "Return only structured JSON matching the provided schema - no prose, no markdown fences.",
  "Use null for anything uncertain. Never invent a resin code or percentage - a guess is worse than null.",
  "Return per-field confidence (0-1, or null) wherever the schema provides a confidence field.",
  "Confidence is a review hint only, not a claim of correctness.",
  "",
  "This is a dosing/material-overview screen from an extrusion line's gravimetric blending controller",
  "(either a live photo of the touchscreen or a printout of the same table) - a 'material overview' grid",
  "with one row per physical film layer and up to six weighed components per row. Rows are already listed",
  "top to bottom in physical layer order (the same order the line's own software displays them in) -",
  "identify each layer by ROW POSITION, top to bottom. Each row is also labeled with a letter (e.g. 'A',",
  "'B', or 'Main' for the first row on lines where that naming convention is enabled) - read that letter",
  "into layer_letter as an informational cross-check only; row position is what actually determines which",
  "layer a row belongs to, not the label text (a row labeled 'Main' is still simply the first row).",
  "Return only the layers actually present - do not pad to 5. Do not guess a layer count other than what",
  "the rows actually show.",
  "",
  "Each row lists up to six weighed components, one per physical hopper, in a fixed left-to-right or",
  "top-to-bottom order matching hopper 1 through hopper 6 (on lines where this dosing naming convention is",
  "enabled, which it is for the lines this scan option supports). You MUST return exactly six component",
  "entries per layer, in that fixed order - for any hopper position with no resin dosed (blank or showing",
  "only zeros), return { resin_code: null, percentage: null } for that position rather than omitting it;",
  "omitting a slot would break the position-to-hopper mapping for every slot after it.",
  "",
  "Each component typically shows two percentage numbers close together: a bold target/setpoint value and",
  "a smaller live/actual reading that fluctuates in real time. Always read the bold setpoint value into",
  "percentage - never the small live/actual reading.",
  "",
  "This screen never prints an overall percentage split between layers (that is a separate thickness/die",
  "setting not shown here) - leave layer_percentage null on every layer; do not guess it from component",
  "percentages or anything else on screen.",
  "",
  "If this is a printout rather than a live screen photo, print quality may degrade specific numbers -",
  "apply the same null-for-illegible rule as any other uncertain value."
].join(" ");

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
  return btoa(binary);
}

async function callOpenAI(
  apiKey: string,
  model: string,
  file: File,
  systemPrompt: string,
  userText: string,
  jsonSchema: Record<string, unknown>
): Promise<unknown> {
  const base64 = await fileToBase64(file);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:${file.type};base64,${base64}` } }
          ]
        }
      ],
      response_format: { type: "json_schema", json_schema: jsonSchema }
    })
  });

  if (!response.ok) {
    // TEMPORARY diagnostic logging (never includes the API key) - remove
    // once the "every scan fails" issue is root-caused. Provider status/body
    // is intentionally not surfaced to the *client* caller of this function -
    // this only goes to the Edge Function's own runtime logs.
    const errorBody = await response.text().catch(() => "");
    console.error("recipe-scan: OpenAI request failed", response.status, errorBody.slice(0, 500));
    throw new Error(`openai_http_${response.status}`);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    console.error("recipe-scan: OpenAI response missing content", JSON.stringify(payload).slice(0, 500));
    throw new Error("openai_missing_content");
  }
  try {
    return JSON.parse(content);
  } catch {
    console.error("recipe-scan: OpenAI content was not valid JSON", content.slice(0, 500));
    throw new Error("openai_invalid_json");
  }
}

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "method_not_allowed", origin);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return errorResponse(401, "unauthorized", origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  const openaiModel = Deno.env.get("OPENAI_MODEL");
  if (!supabaseUrl || !supabaseAnonKey || !openaiApiKey || !openaiModel) {
    return errorResponse(500, "server_misconfigured", origin);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse(400, "invalid_request", origin);
  }

  const workspaceId = form.get("workspace_id");
  const requestId = form.get("request_id");
  const image = form.get("image");
  const sourceType = form.get("source_type");

  if (typeof workspaceId !== "string" || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    return errorResponse(400, "invalid_request", origin);
  }
  if (!(image instanceof File)) {
    return errorResponse(400, "invalid_request", origin);
  }
  if (typeof sourceType !== "string" || !(SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    return errorResponse(400, "invalid_request", origin);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return errorResponse(401, "unauthorized", origin);

  // Server-derived membership check via the caller's own RLS-scoped client -
  // never a client-supplied "am I a member" claim, and no service-role key.
  // Scanning requires an active workspace connection by design.
  const { data: membership, error: membershipError } = await supabase
    .from("line_workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError || !membership) return errorResponse(403, "workspace_access_denied", origin);

  if (typeof requestId === "string" && requestId) {
    const now = Date.now();
    pruneRecentRequests(now);
    const dedupeKey = `${user.id}:${requestId}`;
    const cached = recentRequests.get(dedupeKey);
    if (cached) {
      return new Response(cached.body, {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    }
  }

  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const imageCheck = validateImage(imageBytes, image.type, imageBytes.byteLength);
  if (!imageCheck.ok) return errorResponse(400, imageCheck.error as string, origin);

  const isDosingScreen = (sourceType as SourceType) === "dosing_screen";

  let raw: unknown;
  try {
    raw = await callOpenAI(
      openaiApiKey,
      openaiModel,
      image,
      isDosingScreen ? DOSING_SCREEN_PROMPT : PROMPT,
      isDosingScreen ? "Extract this dosing screen's material overview table." : "Extract this job traveler's product blend table.",
      isDosingScreen ? dosingScreenResponseJsonSchema() : responseJsonSchema()
    );
  } catch {
    return errorResponse(502, "parse_failed", origin);
  }

  const sanitized = isDosingScreen ? sanitizeDosingScreenScanResult(raw) : sanitizeRecipeScanResult(raw);
  if (!sanitized.ok) {
    // TEMPORARY diagnostic logging - remove once root-caused.
    console.error("recipe-scan: sanitize rejected the AI response", sourceType, JSON.stringify(sanitized.errors).slice(0, 500));
    return errorResponse(502, "parse_failed", origin);
  }

  const responseBody = JSON.stringify({ ok: true, result: sanitized.value });
  if (typeof requestId === "string" && requestId) {
    recentRequests.set(`${user.id}:${requestId}`, { expiresAt: Date.now() + RECENT_REQUEST_TTL_MS, body: responseBody });
  }
  return new Response(responseBody, {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
  });
}

Deno.serve(handleRequest);
