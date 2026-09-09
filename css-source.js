"use strict";

/* One logical view of styles.css, for the test suite.
 *
 * WHY THIS EXISTS
 *
 * styles.css is ~600 KB in a single file, and the plan is to cut it into
 * consecutive parts that index.html links in the same order. Concatenating
 * those parts reproduces today's bytes exactly, so the cascade is unchanged
 * by construction - a positional cut cannot move one rule past another.
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

module.exports = { STYLE_PARTS, readStyles, stylePartFilesOnDisk };
