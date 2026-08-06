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
  sanitizeHeatSheetScanResult,
  validateImage
} from "./schema.ts";

const SOURCE_TYPES = ["job_traveler", "dosing_screen", "heat_sheet"] as const;
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

function heatSheetLayerJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      position: { type: ["string", "null"], enum: [...ALL_POSITIONS, null] },
      position_confidence: { type: ["number", "null"] },
      layer_letter: { type: ["string", "null"], enum: [...LAYER_LETTERS, null] },
      layer_letter_confidence: { type: ["number", "null"] },
      layer_percentage: { type: ["number", "null"] },
      layer_percentage_confidence: { type: ["number", "null"] },
      components: { type: "array", maxItems: MAX_COMPONENTS_PER_LAYER, items: componentJsonSchema() }
    },
    required: [
      "position", "position_confidence", "layer_letter", "layer_letter_confidence",
      "layer_percentage", "layer_percentage_confidence", "components"
    ]
  };
}

function heatSheetResponseJsonSchema() {
  return {
    name: "heat_sheet_scan_result",
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
            layers: { type: "array", maxItems: MAX_LAYERS, items: heatSheetLayerJsonSchema() }
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
  "entries per layer, in that fixed order - for any hopper position with no resin dosed, return",
  "{ resin_code: null, percentage: null } for that position rather than omitting it; omitting a slot would",
  "break the position-to-hopper mapping for every slot after it. An unused position is usually labeled with",
  "the literal text 'NOT USED' where the resin code would otherwise be - that is the signal for a genuinely",
  "empty slot. Do not confuse this with a component that has a real resin code but currently reads 0.00% -",
  "that is a real, assigned component at zero, not an empty slot; report its actual resin_code and a",
  "percentage of 0, not null.",
  "",
  "CRITICAL - do not reorder or compact the six positions. Each output position is that exact numbered",
  "position on screen, nothing else - never move a real component earlier to close a gap, and never push a",
  "null/unused position later to the end of the array. If position 3 is unused but 1, 2, 4, 5, and 6 have real",
  "components, the correct output order is [real, real, null, real, real, real] - NOT [real, real, real,",
  "real, real, null]. A component's array index must always match the physical position it was printed in,",
  "with no exceptions, even when that means a null value sits in the middle of the array.",
  "",
  "The resin code cell often has a longer description appended after a dash, e.g. 'MS0440 - Med. Den' or",
  "'A0600 - 10% GMS Antiblock'. Extract only the short code itself (e.g. 'MS0440', 'A0600') into resin_code -",
  "drop everything from the dash onward.",
  "",
  "Each component shows two numbers, one directly below the other, not just one. Telling them apart matters -",
  "read only the first of these into percentage, never the second:",
  "  1. The SETPOINT (what you want): the larger/bolder number, positioned ABOVE the other one, printed as a",
  "  bare number with no '%' symbol directly attached to it (e.g. '66.00').",
  "  2. The ACTUAL/live reading (ignore this one): a smaller number positioned BELOW the setpoint, usually in",
  "  a shaded box, with a '%' symbol printed immediately next to it (e.g. '66.21 %'). This is a real-time",
  "  measurement that fluctuates around the setpoint and is never what should be reported.",
  "Position (setpoint above, actual below) and the presence of a '%' symbol (actual only) are both reliable",
  "cues on their own - if a photo's lighting or angle makes bold-vs-regular weight hard to judge, rely on",
  "position and the '%' symbol instead. All three cues should agree; if they conflict, prefer position.",
  "",
  "This screen never prints an overall percentage split between layers (that is a separate thickness/die",
  "setting not shown here) - leave layer_percentage null on every layer. Specifically: the six components",
  "within a single row will almost always sum to (approximately) 100% - that is simply how gravimetric",
  "dosing works, each hopper's share of that ONE layer's own blend. This is completely unrelated to",
  "layer_percentage, which is that layer's share of the overall multi-layer film - a different, separate",
  "number that is not printed anywhere on this screen. Do not calculate, derive, or infer layer_percentage",
  "from a row's component percentages, their total, or anything else visible here - it must be null.",
  "",
  "If this is a printout rather than a live screen photo, print quality may degrade specific numbers -",
  "apply the same null-for-illegible rule as any other uncertain value."
].join(" ");

const HEAT_SHEET_PROMPT = [
  "Return only structured JSON matching the provided schema - no prose, no markdown fences.",
  "Use null for anything uncertain. Never invent a resin code or percentage - a guess is worse than null.",
  "Return per-field confidence (0-1, or null) wherever the schema provides a confidence field.",
  "Confidence is a review hint only, not a claim of correctness.",
  "",
  "This is a printed 'BLENDER / LAYER SETTINGS' heat sheet - a stack of blocks, each with its own SILO,",
  "LBS, %, and LOT NUMBERS columns. Each block is one physical film layer. Blocks are stacked top to",
  "bottom in physical layer order (the same order the line runs them) - identify each layer by BLOCK",
  "POSITION, top to bottom, not by any letter that may or may not be written on the form. Return only the",
  "layers actually present - do not pad to 5. Do not guess a layer count other than what the blocks",
  "actually show.",
  "",
  "Some operators write a single letter (A-E) near a block as an informal label - read that into",
  "layer_letter as an informational cross-check only if present and legible; block position is what",
  "actually determines which layer a block belongs to, never the letter. Leave layer_letter null when no",
  "such label is present.",
  "",
  "Each block's SILO column lists one row per resin actually used in that layer. Unlike a fixed-slot form,",
  "an unused hopper is not printed at all - there is no padding row, no '0' resin code, nothing to skip.",
  "Only include a component for a SILO row that is actually written. The LBS column is normally blank on",
  "this form and can be ignored. The LOT NUMBERS column can always be ignored - never extract it.",
  "",
  "Each SILO row's resin code may occasionally have a longer description appended after a dash - extract",
  "only the short code itself, dropping everything from the dash onward, same as any other resin code.",
  "",
  "Every SILO row has its own component percentage in the % column, one per row, top to bottom, matching",
  "the SILO rows in the same order. In addition, the block as a whole has its own layer percentage - the",
  "share of the overall film this whole layer represents, separate from any individual SILO's percentage.",
  "This layer percentage is written in one of two places, and both are common:",
  "  1. In its own separate spot near the block (often to the left of the % column, roughly level with the",
  "  block as a whole rather than any specific SILO row) - not part of the per-SILO % column at all.",
  "  2. As the topmost entry directly in the % column itself, printed above the per-SILO percentages - in",
  "  this layout the % column will have exactly one more entry than there are SILO rows, and the first",
  "  (topmost) one is the layer percentage, not tied to any SILO.",
  "A useful check: if the % column has exactly as many entries as SILO rows, none of them is the layer",
  "percentage - it must be written separately, and if you can't find it, leave layer_percentage null rather",
  "than guessing which SILO's percentage it might be. If the % column has exactly one more entry than SILO",
  "rows, the extra topmost one is the layer percentage and the rest map one-to-one to the SILO rows below it.",
  "",
  "Operators sometimes hand-write a hopper assignment next to a resin component while planning where to",
  "load it - formats include 'H1' through 'H6', 'M' (meaning hopper 1, an alternate naming convention) with",
  "H2-H6 for the rest, or bare numbers '1' through '6'. When present and legible, normalize this to the",
  "hopper_designation field as exactly 'H1' through 'H6' (so 'M' becomes 'H1', bare '3' becomes 'H3').",
  "Leave hopper_designation null when no such handwritten note is present or it isn't legible - do not",
  "invent one.",
  "",
  "Handwritten corrections on the form (strikethroughs, replacement values written near a printed one)",
  "override the printed value only when legible and clear. Otherwise use the printed value. If neither is",
  "legible or you are not confident, use null rather than guessing."
].join(" ");

// Chunked rather than one String.fromCharCode call per byte - a large,
// high-resolution photo (multiple MB, common for a dense handwritten form
// where legibility matters) turned that into millions of individual string
// concatenations and exceeded the Edge Function's memory limit before ever
// reaching OpenAI. 8192 is an arbitrary but safely small spread-argument
// count; it doesn't need to be a multiple of 3 since btoa runs once at the
// end, not per chunk.
async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < buffer.length; i += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunkSize));
  }
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
  const isHeatSheet = (sourceType as SourceType) === "heat_sheet";

  const systemPrompt = isDosingScreen ? DOSING_SCREEN_PROMPT : isHeatSheet ? HEAT_SHEET_PROMPT : PROMPT;
  const userText = isDosingScreen
    ? "Extract this dosing screen's material overview table."
    : isHeatSheet
    ? "Extract this heat sheet's blender/layer settings table."
    : "Extract this job traveler's product blend table.";
  const jsonSchema = isDosingScreen ? dosingScreenResponseJsonSchema() : isHeatSheet ? heatSheetResponseJsonSchema() : responseJsonSchema();

  let raw: unknown;
  try {
    raw = await callOpenAI(openaiApiKey, openaiModel, image, systemPrompt, userText, jsonSchema);
  } catch {
    return errorResponse(502, "parse_failed", origin);
  }

  const sanitized = isDosingScreen
    ? sanitizeDosingScreenScanResult(raw)
    : isHeatSheet
    ? sanitizeHeatSheetScanResult(raw)
    : sanitizeRecipeScanResult(raw);
  if (!sanitized.ok) {
    // TEMPORARY diagnostic logging - remove once root-caused.
    console.error("recipe-scan: sanitize rejected the AI response", sourceType, JSON.stringify(sanitized.errors).slice(0, 500));
    return errorResponse(502, "parse_failed", origin);
  }
  if (isDosingScreen || isHeatSheet) {
    // TEMPORARY diagnostic logging - remove once the layer_percentage/
    // component-ordering prompt behavior is confirmed against real scans.
    // Never logs the image itself, just the sanitized structure.
    const layers = (sanitized.value as { recipe: { layers: Array<{ layer_percentage: number | null; components: Array<{ resin_code: string | null }> }> } }).recipe.layers;
    console.log(`recipe-scan: ${sourceType} result`, JSON.stringify(layers.map((l) => ({
      layer_percentage: l.layer_percentage,
      resin_codes: l.components.map((c) => c.resin_code)
    }))).slice(0, 1000));
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
