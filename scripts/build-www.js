"use strict";

// Deterministic copy step: produces the Capacitor webDir (www/) from the
// canonical web source files in the repo root - this is not a second,
// independently maintained copy of the app, it is regenerated from source
// on every run and must never be hand-edited. Run before `npx cap sync`.
//
// Uses an EXPLICIT ALLOWLIST, derived by parsing index.html's own src=/
// href= attributes, rather than copying the whole repo and excluding
// dev/test/tooling paths. A blocklist has to be kept in sync by hand every
// time a new dev/test/tooling file (or directory) shows up anywhere in the
// repo; this allowlist only grows when index.html itself references
// something new, which is discovered automatically. Anything not actually
// loaded by index.html - the test suite, Supabase migrations, the
// Cloudflare worker, docs, git metadata, screenshots, icon/splash source
// resources, this script itself - is structurally excluded, not
// remembered.
//
// build-www.test.js asserts the output never contains any of those
// categories, so a future index.html reference to something that
// shouldn't ship (e.g. a `<script src="foo.test.js">` typo) fails loudly
// instead of silently bundling it.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "www");
const INDEX_HTML_RELATIVE = "index.html";

function localRuntimeReferences(html) {
  const refs = new Set();
  const pattern = /(?:src|href)="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html))) {
    const raw = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//") || raw.startsWith("#")) continue;
    const withoutQuery = raw.split("?")[0].split("#")[0];
    if (withoutQuery) refs.add(withoutQuery);
  }
  return [...refs];
}

// The web app manifest is the one referenced file that itself references more
// files: its icons live in JSON, not in an index.html src=/href=, so the parser
// above cannot see them and www/ would ship a manifest pointing at icons that
// were never copied. Follow exactly this one level - manifest icon `src`s - so
// the allowlist stays derived from what the app actually declares rather than
// from a hand-kept list. Root-absolute srcs ("/icons/...") are the correct form
// for the resin.tools deployment and are resolved back to repo-relative paths.
function manifestIconReferences(manifestRelativePath) {
  const manifestPath = path.join(ROOT, manifestRelativePath);
  if (!fs.existsSync(manifestPath)) return [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`build-www: ${manifestRelativePath} is not valid JSON (${error.message}).`);
  }
  const refs = new Set();
  for (const icon of manifest.icons || []) {
    const raw = typeof icon?.src === "string" ? icon.src : "";
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
    const withoutQuery = raw.split("?")[0].split("#")[0].replace(/^\//, "");
    if (withoutQuery) refs.add(withoutQuery);
  }
  return [...refs];
}

function buildWww() {
  const html = fs.readFileSync(path.join(ROOT, INDEX_HTML_RELATIVE), "utf8");
  const htmlRefs = localRuntimeReferences(html);
  const manifestRefs = htmlRefs
    .filter(ref => ref.endsWith(".webmanifest"))
    .flatMap(manifestIconReferences);
  const files = [...new Set([INDEX_HTML_RELATIVE, ...htmlRefs, ...manifestRefs])];

  fs.rmSync(OUT, { recursive: true, force: true });

  let count = 0;
  for (const relativePath of files) {
    const srcPath = path.join(ROOT, relativePath);
    if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
      throw new Error(`build-www: index.html references "${relativePath}", but that file does not exist.`);
    }
    const destPath = path.join(OUT, relativePath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    count += 1;
  }

  return { count, files };
}

if (require.main === module) {
  const { count } = buildWww();
  console.log(`build-www: copied ${count} files referenced by index.html into ${path.relative(ROOT, OUT)}/`);
}

module.exports = { buildWww, localRuntimeReferences, ROOT, OUT };
