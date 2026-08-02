"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const lookup = fs.readFileSync(path.join(__dirname, "resin-lookup.js"), "utf8");

test("Recipe autocomplete receives names from the shared resin catalog", () => {
  assert.match(app, /const resinCatalog = window\.PolynResinCatalog;/);
  assert.match(app, /let resinCatalogRecords = resinCatalog\?\.getResins\?\.\(\) \|\| \[\];/);
  assert.match(app, /commonResinNames = resinCatalogRecords\.map\(resin=>resin\.resin_code\)/);
  assert.match(app, /resinCatalog\?\.subscribe\?\./);
});

test("Resin Lookup passes the shared normalized catalog to its existing search helpers", () => {
  assert.match(app, /findExactResin\(input\.value, resinCatalogRecords\)/);
  assert.match(app, /findResinSuggestions\(input\.value, 20, resinCatalogRecords\)/);
  assert.match(app, /resin\.resin_code/);
  assert.match(app, /resin\.display_description/);
  assert.match(lookup, /require\("\.\/resin-catalog-service\.js"\)/);
  assert.doesNotMatch(lookup, /require\("\.\/resin-data\.js"\)/);
});

test("the lookup helper keeps the shared service fallback available offline", () => {
  const { findExactResin, findResinSuggestions, formatResinResult } = require("./resin-lookup.js");
  const resin = findExactResin("  ms0440 ");
  assert.equal(resin.resin_code, "MS0440");
  assert.deepEqual(formatResinResult(resin), {
    description: "Med. Density Hexene",
    density: "0.926 g/cm³"
  });
  assert.deepEqual(findResinSuggestions("MS0700").slice(0, 2).map(item => item.resin_code), ["MS0700", "MS0700B"]);
});
