"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("supabase/functions/recipe-scan/index.ts", "utf8");

test("the OpenAI model is read from an env var, never hardcoded", () => {
  assert.doesNotMatch(source, /model:\s*"gpt-/i, "no literal model name should ever be hardcoded here");
  assert.match(source, /const openaiModel = Deno\.env\.get\("OPENAI_MODEL"\);/);
});

test("OPENAI_MODEL is required alongside the other secrets - a missing model name fails closed, not with a silent default", () => {
  const guardStart = source.indexOf("if (!supabaseUrl || !supabaseAnonKey || !openaiApiKey || !openaiModel) {");
  assert.notEqual(guardStart, -1, "expected the misconfiguration guard to include openaiModel");
});

test("callOpenAI takes the model as a parameter and forwards it verbatim into the request body", () => {
  const fnStart = source.indexOf("async function callOpenAI(");
  const fnEnd = source.indexOf("\n}", fnStart);
  const body = source.slice(fnStart, fnEnd);
  assert.match(body, /async function callOpenAI\(\s*apiKey: string,\s*model: string,\s*file: File,/);
  assert.match(body, /model,/, "the request body must pass the parameter through, not a literal string");
});

test("callOpenAI also takes the prompt, user text, and JSON schema as parameters - not hardcoded to Job Traveler's, so Dosing Screen can pass its own", () => {
  const fnStart = source.indexOf("async function callOpenAI(");
  const fnEnd = source.indexOf("\n}", fnStart);
  const body = source.slice(fnStart, fnEnd);
  assert.match(body, /systemPrompt: string,/);
  assert.match(body, /userText: string,/);
  assert.match(body, /jsonSchema: Record<string, unknown>/);
  assert.match(body, /content: systemPrompt/);
  assert.match(body, /text: userText/);
  assert.match(body, /json_schema: jsonSchema/);
});

test("the actual API call site passes the env-sourced model and branches prompt/schema on source_type - Job Traveler vs Dosing Screen vs Heat Sheet", () => {
  assert.match(source, /const systemPrompt = isDosingScreen \? DOSING_SCREEN_PROMPT : isHeatSheet \? HEAT_SHEET_PROMPT : PROMPT;/);
  assert.match(source, /const jsonSchema = isDosingScreen \? dosingScreenResponseJsonSchema\(\) : isHeatSheet \? heatSheetResponseJsonSchema\(\) : responseJsonSchema\(\);/);
  assert.match(source, /raw = await callOpenAI\(openaiApiKey, openaiModel, image, systemPrompt, userText, jsonSchema\);/);
});

test("source_type is required and validated against the known set before anything else happens", () => {
  assert.match(source, /const SOURCE_TYPES = \["job_traveler", "dosing_screen", "heat_sheet"\] as const;/);
  assert.match(source, /if \(typeof sourceType !== "string" \|\| !\(SOURCE_TYPES as readonly string\[\]\)\.includes\(sourceType\)\)/);
});

test("dosing_screen requests are sanitized with sanitizeDosingScreenScanResult, heat_sheet with sanitizeHeatSheetScanResult, job_traveler with sanitizeRecipeScanResult", () => {
  const sanitizedStart = source.indexOf("const sanitized = isDosingScreen");
  const sanitizedEnd = source.indexOf(";", sanitizedStart);
  const body = source.slice(sanitizedStart, sanitizedEnd);
  assert.match(body, /sanitizeDosingScreenScanResult\(raw\)/);
  assert.match(body, /sanitizeHeatSheetScanResult\(raw\)/);
  assert.match(body, /sanitizeRecipeScanResult\(raw\)/);
});

test("heat_sheet result logging joins the dosing screen diagnostic condition, not a separate branch", () => {
  assert.match(source, /if \(isDosingScreen \|\| isHeatSheet\) \{/);
});

// --- setpoint vs actual: multiple redundant cues, not just bold-vs-small ---
// A real printout showed the model picking the wrong number depending on
// capture method (camera vs. loaded file) - image quality made a
// bold-weight-only cue unreliable. Position and the '%' symbol are
// independent of font rendering and should hold even when boldness doesn't.

test("the dosing prompt gives position as a cue for setpoint vs actual, independent of font weight", () => {
  const promptStart = source.indexOf("const DOSING_SCREEN_PROMPT = [");
  const promptEnd = source.indexOf("].join(\" \");", promptStart);
  const prompt = source.slice(promptStart, promptEnd);
  assert.match(prompt, /positioned ABOVE the other one/);
  assert.match(prompt, /positioned BELOW the setpoint/);
});

test("the dosing prompt gives the '%' symbol as a second independent cue - only the actual reading has one directly attached", () => {
  const promptStart = source.indexOf("const DOSING_SCREEN_PROMPT = [");
  const promptEnd = source.indexOf("].join(\" \");", promptStart);
  const prompt = source.slice(promptStart, promptEnd);
  assert.match(prompt, /no '%' symbol directly attached/);
  assert.match(prompt, /with a '%' symbol printed immediately next to it/);
});

test("the dosing prompt tells the model to prefer position when cues conflict, rather than leaving it to guess", () => {
  const promptStart = source.indexOf("const DOSING_SCREEN_PROMPT = [");
  const promptEnd = source.indexOf("].join(\" \");", promptStart);
  const prompt = source.slice(promptStart, promptEnd);
  assert.match(prompt, /if they conflict, prefer position/);
});

test("the dosing prompt recognizes the literal 'NOT USED' label for a genuinely empty slot, distinct from a real component reading 0.00%", () => {
  const promptStart = source.indexOf("const DOSING_SCREEN_PROMPT = [");
  const promptEnd = source.indexOf("].join(\" \");", promptStart);
  const prompt = source.slice(promptStart, promptEnd);
  assert.match(prompt, /literal text 'NOT USED'/);
  assert.match(prompt, /not an empty slot; report its actual resin_code and a/);
});

test("the dosing prompt tells the model to strip the descriptive suffix from a resin code cell (e.g. 'MS0440 - Med. Den' -> 'MS0440')", () => {
  const promptStart = source.indexOf("const DOSING_SCREEN_PROMPT = [");
  const promptEnd = source.indexOf("].join(\" \");", promptStart);
  const prompt = source.slice(promptStart, promptEnd);
  assert.match(prompt, /drop everything from the dash onward/);
});

// --- two failure modes seen on a real scan: components silently reordered,
// layer_percentage confused with the row's own component total -----------

test("the dosing prompt explicitly forbids reordering/compacting components - a null slot must stay at its true position, not get pushed to the end", () => {
  const promptStart = source.indexOf("const DOSING_SCREEN_PROMPT = [");
  const promptEnd = source.indexOf("].join(\" \");", promptStart);
  const prompt = source.slice(promptStart, promptEnd);
  assert.match(prompt, /do not reorder or compact the six positions/);
  assert.match(prompt, /\[real, real, null, real, real, real\]/);
  assert.match(prompt, /NOT \[real, real, real,/);
});

test("the dosing prompt explicitly distinguishes layer_percentage from a row's own component total, since the two coincidentally both approach 100%", () => {
  const promptStart = source.indexOf("const DOSING_SCREEN_PROMPT = [");
  const promptEnd = source.indexOf("].join(\" \");", promptStart);
  const prompt = source.slice(promptStart, promptEnd);
  assert.match(prompt, /the six components/);
  assert.match(prompt, /will almost always sum to \(approximately\) 100%/);
  assert.match(prompt, /completely unrelated to/);
  assert.match(prompt, /Do not calculate, derive, or infer layer_percentage/);
});

// --- Heat Sheet: layers identified by block order (like Job Traveler's
// column order, ambiguous without an orientation answer), unused hoppers
// simply omitted (not padded, unlike Dosing Screen), layer_letter carried
// only as an informational cross-check, and the layer percentage can sit in
// one of two different spots on this specific form. -----------------------

function heatSheetPromptBody() {
  const promptStart = source.indexOf("const HEAT_SHEET_PROMPT = [");
  const promptEnd = source.indexOf("].join(\" \");", promptStart);
  return source.slice(promptStart, promptEnd);
}

test("the heat sheet prompt identifies layers by block position top to bottom, not by any written letter", () => {
  const prompt = heatSheetPromptBody();
  assert.match(prompt, /identify each layer by BLOCK\s*",\s*"POSITION, top to bottom/);
  assert.match(prompt, /not by any letter that may or may not be written on the form/);
});

test("the heat sheet prompt treats a written layer letter as an informational cross-check only, never authoritative", () => {
  const prompt = heatSheetPromptBody();
  assert.match(prompt, /layer_letter as an informational cross-check only/);
  assert.match(prompt, /block position is what/);
});

test("the heat sheet prompt says an unused hopper is never printed at all - no padding row, unlike Dosing Screen's fixed slots", () => {
  const prompt = heatSheetPromptBody();
  assert.match(prompt, /an unused hopper is not printed at all/);
  assert.match(prompt, /no padding row, no '0' resin code/);
});

test("the heat sheet prompt ignores the LOT NUMBERS column and the normally-blank LBS column", () => {
  const prompt = heatSheetPromptBody();
  assert.match(prompt, /LOT NUMBERS column can always be ignored/);
  assert.match(prompt, /LBS column is normally blank on/);
});

test("the heat sheet prompt covers both places the layer's own percentage can appear, with a count-based rule to tell them apart", () => {
  const prompt = heatSheetPromptBody();
  assert.match(prompt, /In its own separate spot near the block/);
  assert.match(prompt, /As the topmost entry directly in the % column itself/);
  assert.match(prompt, /the % column will have exactly one more entry than there are SILO rows/);
  assert.match(prompt, /if the % column has exactly as many entries as SILO rows, none of them is the layer/);
});

test("the heat sheet prompt reuses Job Traveler's hopper_designation normalization rules verbatim", () => {
  const prompt = heatSheetPromptBody();
  assert.match(prompt, /'H1' through 'H6', 'M' \(meaning hopper 1, an alternate naming convention\)/);
  assert.match(prompt, /Leave hopper_designation null when no such handwritten note is present/);
});

// --- fileToBase64: a large, high-resolution photo (e.g. a dense
// handwritten form photographed for legibility) exceeded the Edge
// Function's memory limit with a naive one-byte-at-a-time string build. ---

test("fileToBase64 builds the binary string in chunks, not one String.fromCharCode call per byte - the latter exceeded the Edge Function's memory limit on a large photo", () => {
  const fnStart = source.indexOf("async function fileToBase64(");
  const fnEnd = source.indexOf("\n}", fnStart);
  const body = source.slice(fnStart, fnEnd);
  assert.doesNotMatch(body, /binary \+= String\.fromCharCode\(buffer\[i\]\);/, "must not concatenate one character at a time - this is what exceeded the memory limit");
  assert.match(body, /binary \+= String\.fromCharCode\(\.\.\.buffer\.subarray\(i, i \+ chunkSize\)\);/);
});

test("heatSheetLayerJsonSchema requires layer_letter alongside position, both optional, matching the prompt's cross-check-only rule", () => {
  const fnStart = source.indexOf("function heatSheetLayerJsonSchema()");
  const fnEnd = source.indexOf("\n}", fnStart);
  const body = source.slice(fnStart, fnEnd);
  assert.match(body, /layer_letter: \{ type: \["string", "null"\], enum: \[\.\.\.LAYER_LETTERS, null\] \}/);
  assert.match(body, /components: \{ type: "array", maxItems: MAX_COMPONENTS_PER_LAYER, items: componentJsonSchema\(\) \}/);
});

// --- ALLOWED_ORIGINS: the Android app was hitting CORS failures on every
// scan attempt - the bundled Capacitor WebView's real origin
// (https://localhost, confirmed via on-device diagnostics: `Loading app at
// https://localhost`) wasn't in the allowlist, so the browser blocked the
// response before the client ever saw it, regardless of what the server
// actually returned. ---

test("the Capacitor Android app's real origin (https://localhost, no port) is explicitly allowed - not folded into the localhost dev-server regexes, which require a port and http (not https)", () => {
  const listStart = source.indexOf("const ALLOWED_ORIGINS = [");
  const listEnd = source.indexOf("];", listStart);
  const body = source.slice(listStart, listEnd);
  assert.match(body, /"https:\/\/localhost"/);
});

test("the dev-server regexes still require http (not https) and a port, so they can never accidentally match the native app's origin", () => {
  const listStart = source.indexOf("const ALLOWED_ORIGINS = [");
  const listEnd = source.indexOf("];", listStart);
  const body = source.slice(listStart, listEnd);
  assert.match(body, /\/\^http:\\\/\\\/localhost:\\d\+\$\//);
  assert.doesNotMatch(body, /\/\^https:\\\/\\\/localhost/, "must not be a regex that could also match arbitrary https localhost ports");
});

test("ALLOWED_ORIGINS is not a wildcard - CORS is still origin-scoped, not opened up for every caller", () => {
  assert.doesNotMatch(source, /Access-Control-Allow-Origin["'\s:]*\*/);
  assert.doesNotMatch(source, /ALLOWED_ORIGINS\s*=\s*\[\s*"\*"/);
});
