"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const worker = fs.readFileSync("cloudflare/worker.mjs", "utf8");

test("the public Android App Link association bypasses the authentication redirect", () => {
  const associationGate = worker.slice(worker.indexOf("async fetch(request, env)"), worker.indexOf("const missing"));
  assert.match(associationGate, /request\.method === "GET"/);
  assert.match(associationGate, /url\.pathname === "\/.well-known\/assetlinks\.json"/);
  assert.match(associationGate, /return fetch\(request\);/);
});

test("only the Digital Asset Links statement is public; RT Sync QR URLs stay behind the normal session gate", () => {
  const associationGate = worker.slice(worker.indexOf("async fetch(request, env)"), worker.indexOf("const missing"));
  assert.doesNotMatch(associationGate, /rtSyncCode/);
  assert.match(worker, /if \(!await hasValidSession\(request, env\.SESSION_SECRET\)\)/);
});
