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
