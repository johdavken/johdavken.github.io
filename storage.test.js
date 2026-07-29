"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { writeJson } = require("./storage.js");

test("reports a successful storage write", () => {
  const values = new Map();
  const storage = {
    setItem(key, value) {
      values.set(key, value);
    }
  };

  const result = writeJson(storage, "config", { lineType: 1 });
  assert.equal(result.ok, true);
  assert.equal(values.get("config"), '{"lineType":1}');
});

test("reports storage quota or availability failures", () => {
  const storage = {
    setItem() {
      throw new Error("Quota exceeded");
    }
  };

  const result = writeJson(storage, "config", {});
  assert.equal(result.ok, false);
  assert.match(result.error.message, /Quota exceeded/);
});
