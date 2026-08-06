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

test("the actual API call site passes the env-sourced model and branches prompt/schema on source_type - Job Traveler vs Dosing Screen", () => {
  assert.match(source, /callOpenAI\(\s*openaiApiKey,\s*openaiModel,\s*image,\s*isDosingScreen \? DOSING_SCREEN_PROMPT : PROMPT,/);
  assert.match(source, /isDosingScreen \? dosingScreenResponseJsonSchema\(\) : responseJsonSchema\(\)/);
});

test("source_type is required and validated against the known set before anything else happens", () => {
  assert.match(source, /const SOURCE_TYPES = \["job_traveler", "dosing_screen"\] as const;/);
  assert.match(source, /if \(typeof sourceType !== "string" \|\| !\(SOURCE_TYPES as readonly string\[\]\)\.includes\(sourceType\)\)/);
});

test("dosing_screen requests are sanitized with sanitizeDosingScreenScanResult, job_traveler with sanitizeRecipeScanResult", () => {
  assert.match(source, /const sanitized = isDosingScreen \? sanitizeDosingScreenScanResult\(raw\) : sanitizeRecipeScanResult\(raw\);/);
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
