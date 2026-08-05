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
  assert.match(body, /async function callOpenAI\(apiKey: string, model: string, file: File\)/);
  assert.match(body, /model,/, "the request body must pass the parameter through, not a literal string");
});

test("the actual API call site passes the env-sourced model, not a literal", () => {
  assert.match(source, /callOpenAI\(openaiApiKey, openaiModel, image\)/);
});
