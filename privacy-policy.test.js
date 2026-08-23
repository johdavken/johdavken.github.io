"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { localRuntimeReferences } = require("./scripts/build-www.js");

const policy = fs.readFileSync("privacy/index.html", "utf8");
const deletion = fs.readFileSync("privacy/delete-data/index.html", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const theme = fs.readFileSync("theme.css", "utf8");
const cloudSync = fs.readFileSync("cloud-sync.js", "utf8");
const androidBuild = fs.readFileSync("android/app/build.gradle", "utf8");

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
// What ships in the APK is the *merged* manifest: the app's own
// AndroidManifest.xml plus whatever every installed Capacitor plugin
// contributes via its own <uses-permission> entries. A first version of this
// test checked only the app manifest and only the camera plugin, and missed
// that @capacitor/local-notifications merges three permissions of its own
// (confirmed against the actual assembleRelease output) - so the published
// policy claimed one declared permission when the shipped APK carried four.
// This scans every plugin actually present under node_modules, the same set
// `npx cap sync` wires into the build, so a future plugin addition or
// version bump that changes what gets merged fails this test instead of
// silently drifting from the built APK.
test("the Camera and photos section matches every permission merged into the Android app, app manifest plus every plugin", () => {
  const glob = require("node:fs").readdirSync("node_modules/@capacitor", { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => `node_modules/@capacitor/${entry.name}/android/src/main/AndroidManifest.xml`)
    .filter(path => fs.existsSync(path));
  assert.ok(glob.length >= 3, "expected at least the app, camera and local-notifications plugin manifests");

  const declared = new Set();
  for (const path of [...glob, "android/app/src/main/AndroidManifest.xml"]){
    const source = fs.readFileSync(path, "utf8");
    for (const match of source.matchAll(/<uses-permission android:name="([^"]+)"/g)) declared.add(match[1]);
  }

  const expected = new Set([
    "android.permission.INTERNET",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.permission.WAKE_LOCK",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.VIBRATE",
    "android.permission.SCHEDULE_EXACT_ALARM",
    "android.permission.USE_FULL_SCREEN_INTENT"
  ]);
  assert.deepEqual([...declared].sort(), [...expected].sort(), "the merged permission set changed - re-check the Camera and photos wording");
  assert.ok(!declared.has("android.permission.CAMERA"), "a camera permission appeared - the policy says none is requested");
  assert.ok(
    ![...declared].some(name => /STORAGE|MEDIA_IMAGES|MEDIA_VIDEO/.test(name)),
    "a photo-library permission appeared - the policy says none is requested"
  );

  const section = sectionBody("Camera and photos");
  assert.match(section, /declares seven permissions/i);
  assert.match(section, /requests no camera permission and no photo-library permission/i);
  assert.doesNotMatch(section, /declares one permission/i);
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
const PUBLIC_PAGES = [
  {
    label: "/privacy/",
    source: policy,
    // Anything that would make the browser issue a request. Fragment and
    // mailto targets never do; a data: URI carries its own payload. What is
    // left has to be navigation the reader chooses - the app, the deletion
    // page, or the two processors' own policies - not a load this page needs.
    allowed: [
      "/",
      "/privacy/delete-data/",
      "https://supabase.com/privacy",
      "https://openai.com/policies/privacy-policy/",
      // Beta access requests put the applicant's address on Google Play's
      // tester list, so Google becomes a processor for it.
      "https://policies.google.com/privacy"
    ]
  },
  {
    label: "/privacy/delete-data/",
    source: deletion,
    allowed: ["/privacy/"]
  }
];

for (const page of PUBLIC_PAGES){
  test(`${page.label} fetches nothing: no stylesheet, script, font, image or other asset`, () => {
    assert.doesNotMatch(page.source, /<script/i, "the page must work with no JavaScript at all");
    assert.doesNotMatch(page.source, /<img/i);
    assert.doesNotMatch(page.source, /@import/i);
    assert.doesNotMatch(page.source, /url\(/i, "no CSS may reference a file - background images and font files included");
    assert.doesNotMatch(page.source, /\.\.\//, "nothing may reach up out of /privacy/");
    assert.doesNotMatch(page.source, /<link rel="stylesheet"/i);
    assert.match(page.source, /<style>/, "the CSS has to be inline");

    const allowed = new Set(page.allowed);
    const fetchable = [...page.source.matchAll(/\b(?:src|srcset|poster|data|action|href)\s*=\s*"([^"]*)"/g)]
      .map(match => match[1])
      .filter(value => value && !/^(?:#|mailto:|data:)/.test(value));
    for (const value of fetchable){
      assert.ok(allowed.has(value), `${value} is a new outbound reference on ${page.label}`);
    }
  });

  test(`${page.label} makes no encryption, retention or deletion-timing promise`, () => {
    assert.doesNotMatch(page.source, /encrypt/i);
    assert.doesNotMatch(page.source, /\b(guarantee|permanently delet|retention period|retained for|deleted within|deleted after|within \d+ (hours|days))/i);
  });
}

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
 *   The deletion page
 * --------------------------------------------------------------------- */

test("the deletion page is served at /privacy/delete-data/ and leads with the request heading", () => {
  assert.ok(fs.existsSync("privacy/delete-data/index.html"), "expected privacy/delete-data/index.html");
  assert.match(deletion, /<title>Request Data Deletion[^<]*<\/title>/);
  assert.match(deletion, /<h1>Request Data Deletion<\/h1>/);
});

test("the deletion page covers every removal route, and only routes that exist", () => {
  // Self-service, in the order the page presents them.
  assert.match(deletion, /Clear site data for resin\.tools/i);
  assert.match(deletion, /Select the saved recipe or receiver weight profile[\s\S]{0,160}Delete<\/strong>/i);
  assert.match(deletion, /Leave RT Sync<\/strong> control removes this device's membership/i);
  // Deleting a whole workspace is admin-only - admin_delete_line_workspace is
  // revoked from ordinary members - so the page must route it through contact
  // rather than implying an in-app control.
  assert.match(deletion, /Email the address above/i);
  assert.match(deletion, /administrator action/i);
});

test("the deletion page's contact address is the one the Privacy Policy already publishes", () => {
  const address = policy.match(/<a href="mailto:([^"]+)">/);
  assert.ok(address, "expected a contact address on the Privacy Policy");
  assert.match(deletion, new RegExp(`<a href="mailto:${address[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
});

test("the deletion page asks only for what identifies a workspace, not for personal details", () => {
  assert.match(deletion, /workspace name/i);
  assert.match(deletion, /device label/i);
  assert.match(deletion, /do not send personal details/i);
});

test("the deletion page repeats the Scan Recipe position without contradicting the policy", () => {
  assert.match(deletion, /does not save the image or the extracted result to the Resin\.Tools database/);
  assert.ok(
    policy.includes("does not save the image or the extracted result to the Resin.Tools database"),
    "the two pages must state the Scan Recipe position in the same words"
  );
});

test("the deletion page is honest about what clearing a device does not reach", () => {
  assert.match(deletion, /does not remove the anonymous authentication record/i);
  assert.match(deletion, /does not remove anything already stored in a shared workspace/i);
});

test("the two public pages link to each other", () => {
  assert.match(deletion, /href="\/privacy\/"/, "the deletion page must link back to the policy");
  const removing = sectionBody("Removing data");
  assert.match(removing, /href="\/privacy\/delete-data\/"/, "Removing data must link to the deletion page");
});

test("the deletion page carries the same inlined Industrial Slate palette as the policy", () => {
  const light = pageTokens(deletion.slice(0, deletion.indexOf("@media (prefers-color-scheme: dark)")));
  const dark = pageTokens(deletion.slice(deletion.indexOf("@media (prefers-color-scheme: dark)")));
  assertMatchesTheme(light, "industrial-slate");
  assertMatchesTheme(dark, "industrial-slate-dark");
  assert.match(deletion, /font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;/);
  assert.match(deletion, /<svg class="docLogo" viewBox="0 0 196 104"/);
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
  const block = guide.slice(start, guide.indexOf("\n      </div>", start));
  assert.match(block, /href="https:\/\/resin\.tools\/privacy"/);
  assert.match(block, />Privacy Policy</);
  // The deletion route sits beside it as a second plain link, not a button
  // and not a section of its own.
  assert.match(block, /href="https:\/\/resin\.tools\/privacy\/delete-data\/"/);
  assert.match(block, />Delete Data</);
  assert.equal((block.match(/class="helpPrivacyLink"/g) || []).length, 2);
  assert.doesNotMatch(block, /<button/);
  // Same treatment as the Play banner above it: the bundled Android app has
  // no local copy of these pages, so they must open outside the app shell
  // rather than navigating the WebView off the app.
  assert.equal((block.match(/target="_blank"/g) || []).length, 2);
  assert.equal((block.match(/rel="noopener"/g) || []).length, 2);
  const version = androidBuild.match(/versionName "([^"]+)"/);
  assert.ok(version, "expected Android's release versionName");
  assert.match(block, new RegExp(`class="helpAppVersion"[^>]*>v${version[1]}<`));
  assert.match(html, new RegExp(`class="mobileFooterVersion"[^>]*>v${version[1]}<`));
  assert.match(styles, /\.helpPrivacy\{[\s\S]*?grid-template-columns: minmax\(0,1fr\) auto/);
  assert.match(styles, /\.helpAppVersion\{[\s\S]*?justify-self: end/);
  assert.match(styles, /\.mobileFooterVersion\{[\s\S]*?bottom:calc\(var\(--app-dock-height\) \+ env\(safe-area-inset-bottom\) \+ 2px\);[\s\S]*?text-align:center/);
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
