"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

// RT Sync link codes are case-insensitive - joinWorkspace() already
// uppercases before the RPC call - but on mobile the on-screen keyboard
// otherwise defaults to lowercase, which looks wrong next to a printed/
// shared code that's always shown in caps. Force the field to caps as the
// operator types, on both the markup (keyboard hint) and JS (guaranteed) side.

test("the join-code input hints mobile keyboards to auto-capitalize, with autocorrect/spellcheck off since it's a code, not a word", () => {
  const start = html.indexOf('id="lineSyncJoinCode"');
  assert.notEqual(start, -1);
  const tag = html.slice(html.lastIndexOf("<input", start), html.indexOf("/>", start) + 2);
  assert.match(tag, /autocapitalize="characters"/);
  assert.match(tag, /autocorrect="off"/);
  assert.match(tag, /spellcheck="false"/);
});

test("an input listener force-uppercases the field's displayed value as the operator types, since autocapitalize is only a hint some keyboards ignore", () => {
  const start = app.indexOf('$("lineSyncJoinCode")?.addEventListener("input"');
  assert.notEqual(start, -1);
  const body = app.slice(start, app.indexOf("});", start) + 3);
  assert.match(body, /event\.target\.value\.toUpperCase\(\)/);
  assert.match(body, /if \(event\.target\.value !== upper\) event\.target\.value = upper;/,
    "only reassign .value when it actually changes, to avoid clobbering cursor position on every keystroke");
});

test("joinWorkspace itself still uppercases+trims before the RPC call, so pasted or programmatically-set lowercase codes work too, not just typed ones", () => {
  const cloudSync = fs.readFileSync("cloud-sync.js", "utf8");
  assert.match(cloudSync, /p_link_code: String\(code \|\| ""\)\.trim\(\)\.toUpperCase\(\),/);
});
