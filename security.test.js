"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

test("configuration names are rendered as text, not HTML", () => {
  const start = source.indexOf("function recipeStatus");
  const end = source.indexOf("function refreshConfigDropdown", start);
  const recipeStatusSource = source.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(recipeStatusSource, /message\.textContent = msg/);
  assert.doesNotMatch(recipeStatusSource, /innerHTML\s*=/);
});

test("resin names are assigned through safe DOM properties", () => {
  assert.match(source, /resinInput\.value = hopper\.resinName/);
  assert.match(source, /querySelector\("\[data-resin-name\]"\)\.textContent = r\.displayName/);
  assert.match(source, /resinChip\.textContent = h\.resinName/);
  assert.doesNotMatch(source, /\$\{(?:h\.resinName|r\.displayName)[^}]*\}/);
});

test("representative injection payloads are not embedded in HTML templates", () => {
  const payloads = [
    '<img src=x onerror="globalThis.injected=true">',
    '<script>globalThis.injected=true</script>'
  ];

  for (const payload of payloads) {
    assert.equal(source.includes(payload), false);
  }
});
