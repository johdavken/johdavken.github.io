"use strict";

/* One logical view of styles.css, for the test suite.
 *
 * WHY THIS EXISTS
 *
 * styles.css was ~600 KB in a single file. It is now eleven consecutive parts
 * that index.html links in the same order. Concatenating those parts
 * reproduces the original bytes exactly, so the cascade is unchanged by
 * construction - a positional cut cannot move one rule past another.
 *
 * What a cut WOULD break is the test suite: 110 test files read styles.css
 * as text, and many locate a rule by its offset in that text. Repointing
 * them at whichever part now holds each rule would mean touching thousands
 * of assertions, and - the real danger, demonstrated while normalising the
 * shell breakpoint - an anchor that silently relocates keeps passing while
 * guarding something else.
 *
 * So the tests never learn about the split. They ask for the stylesheet and
 * get the whole thing, byte-for-byte identical to the single file they read
 * before. css-source.test.js pins that identity.
 *
 * ORDER IS DERIVED, NOT DECLARED
 *
 * The part list comes from index.html's own <link> tags, in document order,
 * which is exactly the order the browser cascades them. A hand-kept list
 * here could drift from what the page actually loads, and then the suite
 * would be asserting against a stylesheet no browser ever sees. This is the
 * same reasoning scripts/build-www.js uses for its copy allowlist.
 *
 * A part is any linked stylesheet named styles.css or styles-<name>.css.
 * theme.css, desktop.css and button-styling.css are separate stylesheets
 * with their own identities, not parts of this one, and tests that want
 * them read them directly.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PART_NAME = /^styles(-[a-z0-9-]+)?\.css$/;

// Stylesheet hrefs from index.html, in document order, cache-busting query
// stripped. Document order is cascade order, so it is also concatenation
// order.
function linkedStylesheets() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const hrefs = [];
  const pattern = /<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html))) hrefs.push(match[1].split("?")[0]);
  return hrefs;
}

const STYLE_PARTS = linkedStylesheets().filter(href => PART_NAME.test(path.basename(href)));

/** The full stylesheet as the browser cascades it. */
function readStyles() {
  return STYLE_PARTS.map(part => fs.readFileSync(path.join(ROOT, part), "utf8")).join("");
}

/** Every styles*.css file present on disk, whether or not index.html links it. */
function stylePartFilesOnDisk() {
  return fs.readdirSync(ROOT).filter(name => PART_NAME.test(name)).sort();
}

/* The name the base stylesheet still goes by.
 *
 * No file called styles.css exists any more - it is the eleven styles-*.css
 * parts. But several tests reason about the stylesheets AS a set, keyed or
 * ordered by name: "which sheet declares this token", "in what order do these
 * three sheets get to override each other". For those, the parts are not
 * eleven participants in the cascade, they are one, and splitting them into
 * eleven keys would change what the test is asserting rather than just where
 * it reads from. So the set keeps one entry under this name. */
const BASE_STYLESHEET = "styles.css";

/** One stylesheet by name, where the base name means all of its parts joined. */
function readStylesheet(name) {
  if (name === BASE_STYLESHEET) return readStyles();
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

/* Which part carries a given rule.
 *
 * Several tests were written to assert "the stylesheet holding this fix got a
 * fresh ?v=", back when there was one stylesheet to name. Rather than freeze
 * a part name into those tests - which would then be wrong the moment a rule
 * moves between parts - they ask for it by content. Returns null if no part
 * contains the text, which is itself worth failing on.
 */
function partContaining(needle) {
  for (const part of STYLE_PARTS) {
    if (fs.readFileSync(path.join(ROOT, part), "utf8").includes(needle)) return part;
  }
  return null;
}

/** The ?v= tag index.html links a stylesheet with, or null if untagged. */
function cacheTagOf(file) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`href="${escaped}\\?v=([0-9.]+)"`).exec(html);
  return found ? found[1] : null;
}

module.exports = {
  STYLE_PARTS,
  BASE_STYLESHEET,
  readStyles,
  readStylesheet,
  stylePartFilesOnDisk,
  partContaining,
  cacheTagOf,
};
