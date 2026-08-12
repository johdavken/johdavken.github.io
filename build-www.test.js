"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildWww, localRuntimeReferences, ROOT, OUT } = require("./scripts/build-www.js");

// This runs the real build (writes www/, same as `npm run build:android`)
// and inspects its actual output - not just the script's source - so a
// future change to build-www.js that reintroduces a blocklist, or widens
// what counts as a "local reference", gets caught by what it actually
// produces, not by what it currently intends to do.

function allFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

test("build-www produces www/ from an explicit allowlist, not a blocklist over the repo", () => {
  buildWww();
  assert.ok(fs.existsSync(OUT));
  const files = allFiles(OUT).map(f => path.relative(OUT, f));
  assert.ok(files.length > 0);
  // A sanity ceiling, not an exact contract: the repo tracks ~370 files, so
  // this catches "the whole repo got copied" while leaving room for the
  // runtime set to grow normally (62 at the time of writing).
  assert.ok(files.length < 90, `expected a small, explicit runtime set, got ${files.length} files`);
});

test("www/ never contains tests, migrations, the Cloudflare worker, git/dev metadata, or build tooling", () => {
  buildWww();
  const files = allFiles(OUT).map(f => path.relative(OUT, f));
  const forbidden = [
    { pattern: /\.test\.js$/, label: "test files" },
    { pattern: /\.sql$/, label: "SQL migrations" },
    { pattern: /(^|\/)\.git(\/|$)/, label: "git metadata" },
    { pattern: /(^|\/)supabase(\/|$)/, label: "Supabase project (migrations/seeds/functions)" },
    { pattern: /(^|\/)cloudflare(\/|$)/, label: "Cloudflare worker source" },
    { pattern: /(^|\/)node_modules(\/|$)/, label: "npm dependencies" },
    { pattern: /(^|\/)android(\/|$)/, label: "Android native project/build output" },
    { pattern: /(^|\/)scripts(\/|$)/, label: "build tooling" },
    { pattern: /(^|\/)resources(\/|$)/, label: "icon/splash generation source" },
    { pattern: /(^|\/)test(\/|$)/, label: "legacy test fixtures" },
    { pattern: /(^|\/)artifacts(\/|$)/, label: "agent scratch artifacts" },
    { pattern: /(^|\/)previews(\/|$)/, label: "design preview screenshots" },
    { pattern: /^README\.md$/i, label: "README" },
    { pattern: /^CLAUDE\.md$/i, label: "project instructions" },
    { pattern: /^\.mcp\.json$/, label: "MCP credentials" },
    { pattern: /^package(-lock)?\.json$/, label: "npm package manifest" },
    { pattern: /^CNAME$/, label: "GitHub Pages domain config" },
    { pattern: /^capacitor\.config\.(json|ts)$/, label: "Capacitor config (native-side only)" }
  ];
  for (const file of files) {
    for (const { pattern, label } of forbidden) {
      assert.doesNotMatch(file, pattern, `www/${file} matched forbidden category "${label}"`);
    }
  }
});

test("www/ does contain the real runtime entry point and its scripts (the allowlist isn't accidentally empty)", () => {
  buildWww();
  for (const expected of ["index.html", "app.js", "styles.css", "android-back-button.js"]) {
    assert.ok(fs.existsSync(path.join(OUT, expected)), `expected www/${expected} to exist`);
  }
});

test("localRuntimeReferences only picks up local, non-CDN paths from index.html's own src=/href=", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const refs = localRuntimeReferences(html);
  assert.ok(refs.includes("app.js"));
  assert.ok(refs.includes("styles.css"));
  for (const ref of refs) {
    assert.doesNotMatch(ref, /^https?:\/\//, `"${ref}" should have been filtered as external`);
    assert.doesNotMatch(ref, /\?/, `"${ref}" should have had its query string stripped`);
  }
});

test("build-www throws loudly instead of silently skipping if index.html references a file that doesn't exist", () => {
  assert.throws(() => {
    const fakeHtml = '<script src="definitely-not-a-real-file.js"></script>';
    const files = ["index.html", ...localRuntimeReferences(fakeHtml)];
    for (const relativePath of files) {
      const srcPath = path.join(ROOT, relativePath);
      if (relativePath !== "index.html" && !fs.existsSync(srcPath)) {
        throw new Error(`build-www: index.html references "${relativePath}", but that file does not exist.`);
      }
    }
  }, /does not exist/);
});
