"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { localRuntimeReferences } = require("./scripts/build-www.js");

const policy = fs.readFileSync("privacy/index.html", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const theme = fs.readFileSync("theme.css", "utf8");
const cloudSync = fs.readFileSync("cloud-sync.js", "utf8");
const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");

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

test("the RT Sync section names what actually reaches Supabase", () => {
  const section = sectionBody("RT Sync and shared workspaces");
  assert.match(section, /anonymous/i);
  assert.match(section, /Supabase/);
  assert.match(section, /device (ID|label)/i);
  assert.match(section, /receiver weight profile/i);
  // Shared, not private: a workspace's data is readable by every member, and
  // the policy has to say so rather than implying per-device privacy.
  assert.match(section, /member of a workspace can read and change/i);
});

// Supabase anonymous sign-in creates a durable auth.users row and every
// membership, active job and configuration write is attributed to its id.
// That is pseudonymous, not anonymous, and the section has to say so rather
// than implying the identity is untraceable or purely local.
test("the RT Sync section calls the identity pseudonymous and does not claim it lives only on the device", () => {
  const section = sectionBody("RT Sync and shared workspaces");
  assert.match(section, /pseudonymous/i);
  assert.match(section, /record is created in Supabase/i);
  assert.doesNotMatch(section, /stored only in that browser/i);
  // signInAnonymously is the mechanism, so the word still belongs - but as
  // the name of the sign-in, not as a claim about what can be linked.
  assert.match(cloudSync, /signInAnonymously/, "the policy describes anonymous sign-in; cloud-sync.js should still use it");
});

// The blanket "nothing leaves your device unless you use RT Sync or Scan
// Recipe" was too strong: the app also reads the shared resin catalog from
// Supabase. The claim is scoped to the job data the section actually lists.
test("the local-data section scopes its claim to uploads of job data, not to all network activity", () => {
  const section = sectionBody("What stays on your device");
  assert.doesNotMatch(section, /is not sent anywhere/i);
  assert.match(section, /None of it is uploaded unless/i);
  assert.match(section, /resin catalog/i);
});

test("the Scan Recipe section says the image is sent for processing and names both processors", () => {
  const section = sectionBody("Scan Recipe");
  assert.match(section, /Supabase/);
  assert.match(section, /OpenAI/);
  assert.match(section, /image is sent/i);
});

// The policy states the app requests no camera or photo-library permission.
// That is only true while the merged Android manifest stays as it is: the
// Capacitor Camera plugin skips its runtime prompt precisely because CAMERA
// is undeclared ("if it is not defined in the manifest then we don't need to
// prompt", CameraPlugin.kt), and adding one would silently make this
// paragraph false. This test is the tripwire.
test("the Camera and photos section matches the permissions the Android app actually declares", () => {
  const declared = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(declared, ["android.permission.INTERNET"], "the app's declared permissions changed - re-check the Camera and photos wording");

  const pluginManifest = "node_modules/@capacitor/camera/android/src/main/AndroidManifest.xml";
  if (fs.existsSync(pluginManifest)){
    assert.doesNotMatch(fs.readFileSync(pluginManifest, "utf8"), /<uses-permission/, "the Camera plugin now merges a permission of its own - re-check the wording");
  }

  const section = sectionBody("Camera and photos");
  assert.match(section, /requests no camera permission and no photo-library permission/i);
  assert.doesNotMatch(section, /asks for camera access|access to your photos/i);
});

test("Google Play's required statements are present and unambiguous", () => {
  assert.match(policy, /does not serve ads/i);
  assert.match(policy, /does not sell personal data/i);
});

test("the contact section is reachable and is named as the route for deletion requests", () => {
  assert.match(policy, /<a href="mailto:[^"]+@[^"]+">/);
  const section = sectionBody("Contact");
  assert.match(section, /delete workspace or job data/i);
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

// Every other path on resin.tools is behind Cloudflare authentication. A
// privacy policy has to render for someone with no account and no access to
// the rest of the site - a Play reviewer, most obviously - so this page may
// not depend on anything it does not carry itself.
test("the page fetches nothing: no stylesheet, script, font, image or other asset outside /privacy/", () => {
  assert.doesNotMatch(policy, /<script/i, "the page must work with no JavaScript at all");
  assert.doesNotMatch(policy, /<img/i);
  assert.doesNotMatch(policy, /@import/i);
  assert.doesNotMatch(policy, /url\(/i, "no CSS may reference a file - background images and font files included");
  assert.doesNotMatch(policy, /\.\.\//, "nothing may reach up out of /privacy/");
  assert.doesNotMatch(policy, /<link rel="stylesheet"/i);
  assert.match(policy, /<style>/, "the CSS has to be inline");

  // Anything that would make the browser issue a request. Fragment and
  // mailto targets never do; a data: URI carries its own payload. What is
  // left has to be either a link in the policy's own prose or the link back
  // to the app - navigation the reader chooses, not a load this page needs.
  const allowed = new Set(["/", "https://supabase.com/privacy", "https://openai.com/policies/privacy-policy/"]);
  const fetchable = [...policy.matchAll(/\b(?:src|srcset|poster|data|action|href)\s*=\s*"([^"]*)"/g)]
    .map(match => match[1])
    .filter(value => value && !/^(?:#|mailto:|data:)/.test(value));
  for (const value of fetchable){
    assert.ok(allowed.has(value), `${value} is a new outbound reference - only the app link and the two processors' privacy policies belong here`);
  }
});

test("the mark is drawn inline from the app's own path data, not fetched as an SVG file", () => {
  assert.match(policy, /<svg class="docLogo" viewBox="0 0 196 104"/);
  // Search from the logo, not the top of the file - the favicon's data: URI
  // is itself an SVG, and closes before this one opens.
  const logoStart = policy.indexOf('<svg class="docLogo"');
  const logo = policy.slice(logoStart, policy.indexOf("</svg>", logoStart));
  // The same five rhombus paths the app's header draws, so the two marks are
  // the same shape rather than a hand-redrawn approximation.
  for (const path of html.match(/<path class="rtLayer\w+" d="[^"]+"\/>/g).slice(0, 5)){
    assert.ok(logo.includes(path), `expected the app's own ${path.match(/rtLayer\w+/)[0]} path`);
  }
});

test("typography stays the app's: system fonts only, same families the app sets", () => {
  // Same base family as the app's body rule, so the two read as one site.
  assert.match(policy, /font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;/);
  assert.match(styles, /font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;/);
  // No webfont of any kind - nothing to fetch, nothing to fall back from.
  assert.doesNotMatch(policy, /@font-face|fonts\.googleapis|fonts\.gstatic/i);
});

// The palette is copied out of theme.css rather than linked, which means
// nothing makes it follow along when a theme is retuned. This is the guard:
// it re-reads theme.css and fails if any token here has drifted from the
// Industrial Slate pair it was taken from.
test("the inlined palette still matches Industrial Slate in theme.css", () => {
  const light = pageTokens(policy.slice(0, policy.indexOf("@media (prefers-color-scheme: dark)")));
  const dark = pageTokens(policy.slice(policy.indexOf("@media (prefers-color-scheme: dark)")));
  assert.ok(Object.keys(light).length > 8, "expected the light palette inline on the page");
  assert.ok(Object.keys(dark).length > 8, "expected a dark palette inline on the page");

  assertMatchesTheme(light, "industrial-slate");
  assertMatchesTheme(dark, "industrial-slate-dark");

  // Every token the dark block overrides has to exist in the light block
  // too, or that token falls back to a light value on a dark background.
  for (const token of Object.keys(dark)){
    assert.ok(token in light, `${token} is set for dark but never defined for light`);
  }
});

test("light and dark follow the reader's own system setting, since there is no script to read a stored preference", () => {
  assert.match(policy, /@media \(prefers-color-scheme: dark\)/);
  assert.match(policy, /<meta name="color-scheme" content="light dark">/);
  // No data-theme attribute to go stale against theme.css's selectors.
  assert.match(policy, /<html lang="en">/);
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

// Custom properties declared in a chunk of the policy page's inline CSS.
function pageTokens(chunk){
  const start = chunk.indexOf(":root{");
  if (start === -1) return {};
  const block = chunk.slice(start, chunk.indexOf("}", start));
  return declarations(block);
}

// ...and in one of theme.css's palette blocks.
function themeTokens(name){
  const start = theme.indexOf(`[data-theme="${name}"]{`);
  assert.notEqual(start, -1, `expected theme.css to still define ${name}`);
  return declarations(theme.slice(start, theme.indexOf("}", start)));
}

function declarations(block){
  const out = {};
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[match[1]] = match[2].trim();
  return out;
}

function assertMatchesTheme(tokens, name){
  const source = themeTokens(name);
  for (const [token, value] of Object.entries(tokens)){
    // --radius-row comes from styles.css's density scale, not the palette.
    if (!(token in source)) continue;
    assert.equal(value, source[token], `${token} has drifted from ${name} in theme.css`);
  }
}

function sectionBody(heading){
  const start = policy.indexOf(`<h2>${heading}</h2>`);
  assert.notEqual(start, -1, `expected a "${heading}" section`);
  const next = policy.indexOf("<h2>", start + 4);
  return policy.slice(start, next === -1 ? policy.length : next);
}
