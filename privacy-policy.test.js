"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { localRuntimeReferences } = require("./scripts/build-www.js");

const policy = fs.readFileSync("privacy/index.html", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");

/* -----------------------------------------------------------------------
 *   The document itself
 * --------------------------------------------------------------------- */

test("the policy is served at /privacy as a directory index, so the published URL needs no extension", () => {
  assert.ok(fs.existsSync("privacy/index.html"), "expected privacy/index.html");
  assert.match(policy, /<title>Privacy Policy[^<]*<\/title>/);
  assert.match(policy, /<h1>Privacy Policy<\/h1>/);
  assert.match(policy, /Last updated/);
});

test("every data flow that leaves the device has its own section - local storage, RT Sync, and Scan Recipe", () => {
  const headings = [...policy.matchAll(/<h2>([^<]+)<\/h2>/g)].map(match => match[1]);
  assert.ok(headings.some(h => /stays on your device/i.test(h)), `expected a local-data section, got ${headings}`);
  assert.ok(headings.some(h => /RT Sync/i.test(h)), `expected an RT Sync section, got ${headings}`);
  assert.ok(headings.some(h => /Scan Recipe/i.test(h)), `expected a Scan Recipe section, got ${headings}`);
  assert.ok(headings.some(h => /Contact/i.test(h)), `expected a contact section, got ${headings}`);
});

test("the RT Sync section names what actually reaches Supabase, including that the identity is anonymous", () => {
  const section = sectionBody("RT Sync and shared workspaces");
  assert.match(section, /anonymous/i);
  assert.match(section, /Supabase/);
  assert.match(section, /device (ID|label)/i);
  assert.match(section, /receiver weight profile/i);
  // Shared, not private: a workspace's data is readable by every member, and
  // the policy has to say so rather than implying per-device privacy.
  assert.match(section, /member of a workspace can read and change/i);
});

test("the Scan Recipe section says the image is sent for processing and names both processors", () => {
  const section = sectionBody("Scan Recipe");
  assert.match(section, /Supabase/);
  assert.match(section, /OpenAI/);
  assert.match(section, /image is sent/i);
});

test("Google Play's required statements are present and unambiguous", () => {
  assert.match(policy, /does not serve ads/i);
  assert.match(policy, /does not sell personal data/i);
});

test("the contact section is reachable, not just named", () => {
  assert.match(policy, /<a href="mailto:[^"]+@[^"]+">/);
});

/* -----------------------------------------------------------------------
 *   Claims the code cannot back up
 * --------------------------------------------------------------------- */

// The policy is only allowed to describe handling that is verifiable from
// this repo. These are the categories that are NOT: nothing in the code or
// configuration establishes an encryption posture, a retention schedule, a
// deletion guarantee, or what Supabase/OpenAI do with a request once it
// reaches them. Asserting their absence keeps a later well-meaning edit
// from quietly turning the policy into a promise the app cannot keep.
test("the policy makes no encryption claim", () => {
  assert.doesNotMatch(policy, /encrypt/i);
});

test("the policy promises no retention period or deletion guarantee", () => {
  assert.doesNotMatch(policy, /\b(guarantee|permanently delet|retention period|retained for|deleted within|deleted after)/i);
});

test("the policy does not characterize what the third-party processors do with data - it links to their own policies instead", () => {
  assert.doesNotMatch(policy, /(Supabase|OpenAI)[^.]{0,80}(does not (store|retain|train)|never (stores|retains|uses))/i);
  assert.match(policy, /href="https:\/\/supabase\.com\/privacy"/);
  assert.match(policy, /href="https:\/\/openai\.com\/policies\/privacy-policy\/"/);
});

/* -----------------------------------------------------------------------
 *   Typography and theme
 * --------------------------------------------------------------------- */

test("the policy takes the app's theme palettes but stays a standalone document - no app shell, no app script", () => {
  assert.match(policy, /<link rel="stylesheet" href="\.\.\/theme\.css/);
  assert.doesNotMatch(policy, /href="\.\.\/styles\.css/);
  assert.doesNotMatch(policy, /src="\.\.\/app\.js/);
  // Same base family as the app's body rule, so the two read as one site.
  assert.match(policy, /font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;/);
});

test("the policy reads the operator's saved theme from the same key the app writes, and honours exactly the themes applyTheme can produce", () => {
  const sessionKey = app.match(/const LS_SESSION_KEY = "([^"]+)"/);
  assert.ok(sessionKey, "expected app.js to define LS_SESSION_KEY");
  assert.ok(
    policy.includes(`localStorage.getItem("${sessionKey[1]}")`),
    `the policy page should read ${sessionKey[1]}, the key app.js persists the theme under`
  );

  // applyTheme() migrates every stored value onto one of these three; a theme
  // this page accepts but the app can never produce would be a page that
  // renders in a palette the operator has no way to see in the app itself.
  const applyTheme = app.slice(app.indexOf("function applyTheme("), app.indexOf("function applyDensity("));
  const appThemes = new Set([...applyTheme.matchAll(/\["[a-z-]+", "([a-z-]+)"\]/g)].map(match => match[1]));
  const allowed = policy.match(/var ALLOWED = \[([^\]]+)\]/);
  assert.ok(allowed, "expected the theme allowlist on the policy page");
  const pageThemes = new Set([...allowed[1].matchAll(/"([a-z-]+)"/g)].map(match => match[1]));
  assert.deepEqual([...pageThemes].sort(), [...appThemes].sort());

  // Industrial Slate is applyTheme()'s fallback, so it is the markup default
  // here too - the page must never render unstyled while the script runs.
  assert.match(policy, /<html lang="en" data-theme="industrial-slate">/);
});

/* -----------------------------------------------------------------------
 *   Reaching it from the app
 * --------------------------------------------------------------------- */

test("Help carries a Privacy Policy link, inside the guide body rather than buried in a topic", () => {
  const guideStart = html.indexOf('<div class="blockBody helpGuide">');
  assert.notEqual(guideStart, -1, "expected the Help guide body");
  // Same end marker the other Help tests use: the guide body's own close,
  // followed by the Help panel's. The link sits after the topic list, so the
  // slice has to run to the end of the panel rather than to the last topic.
  const guideEnd = html.indexOf("</div>\n    </div>\n  </details>", guideStart);
  assert.notEqual(guideEnd, -1, "expected the Help guide body to close before the next panel");
  const guide = html.slice(guideStart, guideEnd);
  const start = guide.indexOf('<div class="helpPrivacy">');
  assert.notEqual(start, -1, "expected a helpPrivacy block in the Help guide body");
  const block = guide.slice(start, guide.indexOf("</div>", start));
  assert.match(block, /href="https:\/\/resin\.tools\/privacy"/);
  assert.match(block, />Privacy Policy</);
  // Same treatment as the Play banner above it: the bundled Android app has
  // no local copy of this page, so it must open outside the app shell rather
  // than navigating the WebView off the app.
  assert.match(block, /target="_blank"/);
  assert.match(block, /rel="noopener"/);
});

test("the Help link renders at every width - it is not gated behind a mobile-only or desktop-only rule", () => {
  assert.match(styles, /\.helpPrivacy\{/);
  const rule = styles.slice(styles.indexOf(".helpPrivacy{"), styles.indexOf("}", styles.indexOf(".helpPrivacy{")) + 1);
  assert.doesNotMatch(rule, /display:\s*none/);
});

test("the Help link's absolute URL keeps it out of build-www's allowlist, so the Android build does not try to copy a page that isn't a file", () => {
  const refs = localRuntimeReferences(html);
  assert.ok(!refs.some(ref => /privacy/i.test(ref)), `build-www should not treat the policy URL as a local file: ${refs.filter(r => /privacy/i.test(r))}`);
});

/* -----------------------------------------------------------------------
 *   Helpers
 * --------------------------------------------------------------------- */

function sectionBody(heading){
  const start = policy.indexOf(`<h2>${heading}</h2>`);
  assert.notEqual(start, -1, `expected a "${heading}" section`);
  const next = policy.indexOf("<h2>", start + 4);
  return policy.slice(start, next === -1 ? policy.length : next);
}
