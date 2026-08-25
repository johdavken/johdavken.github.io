"use strict";

// The Help guide's Play link used to be unconditional. It is now the third
// of three states on one host element, and only an administrator ticking a
// box reveals it. These cover the wiring that decides which state shows, the
// separation between the two Supabase sessions involved, and the admin panel
// that does the approving.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const ui = fs.readFileSync("beta-access-ui.js", "utf8");
const cloudSync = fs.readFileSync("cloud-sync.js", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const adminUi = fs.readFileSync("resin-admin-ui.js", "utf8");
const privacy = fs.readFileSync("privacy/index.html", "utf8");

function bannerHost(){
  const start = html.indexOf('<div class="helpPlayBannerHost"');
  assert.notEqual(start, -1, "expected the beta banner host");
  return html.slice(start, html.indexOf("</div>", html.indexOf('data-beta-when="invited"')));
}

/* ----------------------------------------------------------------------
 *   The three states
 * -------------------------------------------------------------------- */

test("one host carries all three states, and the approved one is the original link untouched", () => {
  const host = bannerHost();
  assert.match(host, /id="helpBetaAccess" data-beta-state="loading"/);
  ["none", "pending", "invited"].forEach(state => {
    assert.match(host, new RegExp(`data-beta-when="${state}"`), `missing the ${state} state`);
  });
  // Same destination the banner has always had.
  assert.match(host, /data-beta-when="invited" href="https:\/\/play\.google\.com\/apps\/internaltest\/4699396162063044468"/);
  assert.match(host, /<strong>Get the Android app<\/strong>/);
});

test("the request state asks rather than promises - it is a button, not a link out", () => {
  const host = bannerHost();
  const request = host.slice(host.indexOf('data-beta-when="none"'));
  assert.match(host, /<button class="helpPlayBanner helpPlayBannerAction" id="helpBetaRequestBtn" type="button"/);
  assert.match(request, /<strong>Request beta access<\/strong>/);
  // No href anywhere in the un-approved states: nothing to click through to.
  const preInvited = host.slice(0, host.indexOf('data-beta-when="invited"'));
  assert.doesNotMatch(preInvited, /play\.google\.com/);
});

test("states are mutually exclusive, and 'loading' shows none of them", () => {
  // Hidden unconditionally at the top level; only a matching state re-shows
  // one, so an approved operator never sees a request button flash first.
  assert.match(styles, /\.helpPlayBannerHost > \[data-beta-when\]\{ display: none; \}/);
  const reveal = styles.match(/\.helpPlayBannerHost\[data-beta-state="none"\][\s\S]*?display: flex; \}/);
  assert.ok(reveal, "expected the state-to-element mapping");
  ["none", "pending", "invited"].forEach(state => {
    assert.match(reveal[0], new RegExp(`\\[data-beta-state="${state}"\\] > \\[data-beta-when="${state}"\\]`));
  });
  assert.doesNotMatch(reveal[0], /data-beta-state="loading"/);
});

test("the whole banner stays mobile-only, as the original link was", () => {
  const reveal = styles.indexOf('.helpPlayBannerHost[data-beta-state="none"]');
  const query = styles.lastIndexOf("@media (max-width: 900px), (min-width: 901px) and (pointer: coarse){", reveal);
  assert.notEqual(query, -1, "the state mapping must sit inside the mobile-only media query");
  assert.ok(query < reveal);
});

/* ----------------------------------------------------------------------
 *   Which Supabase session answers which question
 * -------------------------------------------------------------------- */

test("the operator's status is read through the anonymous RT Sync session, not the admin one", () => {
  // resin-admin.js runs a second client under its own storage key; asking it
  // "my row" would ask about the administrator's identity.
  assert.match(cloudSync, /function getBetaAccessTransport\(\)\{/);
  assert.match(cloudSync, /if \(!client \|\| !state\.available \|\| !state\.userId\) return null;/);
  assert.match(cloudSync, /selectOwn: \(fields\) => client\.from\("beta_applicants"\)\.select\(fields\)\.maybeSingle\(\)/);
  assert.match(cloudSync, /\n      getBetaAccessTransport,/);
  // Exposed as a narrow bridge, never the client itself.
  assert.match(app, /window\.PolynBetaAccessBridge = \{\s*\n\s*getTransport: \(\) => lineSync\?\.getBetaAccessTransport\?\.\(\) \|\| null\s*\n\s*\};/);
  assert.doesNotMatch(app, /PolynBetaAccessBridge[\s\S]{0,200}getClient/);
});

test("the UI takes each session from its own source", () => {
  assert.match(ui, /getTransport: \(\) => root\.PolynBetaAccessBridge\?\.getTransport\?\.\(\) \|\| null/);
  assert.match(ui, /getAdminClient: \(\) => root\.PolynResinAdminInstance\?\.getClient\?\.\(\) \|\| null/);
});

test("a failed status read leaves the previous answer standing", () => {
  const fn = ui.slice(ui.indexOf("async function refreshStatus()"));
  const body = fn.slice(0, fn.indexOf("\n  }") + 4);
  assert.match(body, /if \(result\.ok\) application = result\.application;/);
});

test("the banner is primed from cache first, then reconciled", () => {
  assert.match(ui, /function primeFromCache\(\)\{[\s\S]*?service\.cached\(\)/);
  assert.match(ui, /function hook\(\)\{\s*\n\s*primeFromCache\(\);/);
  // Re-read when Help is opened, which is the only time the banner is on screen.
  assert.match(ui, /\[data-workspace-target="helpBlock"\][\s\S]*?refreshStatus\(\)/);
});

/* ----------------------------------------------------------------------
 *   Admin panel
 * -------------------------------------------------------------------- */

test("Beta Applicants is an admin workspace panel, revealed only to admins", () => {
  assert.match(html, /<details class="block card workspacePanel adminResinPanel" id="betaApplicantsBlock">/);
  assert.match(html, /<button id="betaApplicantsButton" class="footerAdminDestination sudoAccessAction" type="button" data-admin-only="true" data-workspace-target="betaApplicantsBlock" hidden>/);
  assert.match(adminUi, /betaApplicantsButton\.hidden = !adminAccess;/);
});

test("it is not a restorable workspace preference - nobody should land in an admin panel on load", () => {
  const list = app.slice(app.indexOf("const DETAILS_IDS = ["), app.indexOf("const HOPPERS_PER_LAYER"));
  assert.doesNotMatch(list, /betaApplicantsBlock/);
});

test("the row shows who asked, where they are, and the checkbox that decides it", () => {
  assert.match(ui, /box\.type = "checkbox";/);
  assert.match(ui, /box\.checked = applicant\.status === serviceApi\.STATUS_INVITED;/);
  assert.match(ui, /setInvited\(applicant\.id, box\.checked\)/);
  assert.match(ui, /mail\.textContent = applicant\.email;/);
  assert.match(ui, /who\.textContent = applicant\.displayName;/);
  assert.match(ui, /status\.textContent = applicant\.status === serviceApi\.STATUS_INVITED \? "Invited" : "Pending";/);
  // The checkbox names the administrator's action; the pill names the state
  // it produces. They must not both say "Invited".
  assert.match(ui, /boxText\.textContent = "Added";/);
  assert.match(ui, /`Added \$\{applicant\.email\} to internal testing on Google Play`/);
});

test("a rejected tick snaps back instead of lying about the stored state", () => {
  const handler = ui.slice(ui.indexOf('box.addEventListener("change"'));
  const body = handler.slice(0, handler.indexOf("\n      });") + 9);
  assert.match(body, /box\.checked = applicant\.status === serviceApi\.STATUS_INVITED;/);
  assert.match(body, /setMessage\("betaApplicantsMessage", result\.message, "warn"\)/);
});

test("the panel says plainly that ticking the box does not talk to Google", () => {
  const panel = html.slice(html.indexOf('id="betaApplicantsBlock"'), html.indexOf('id="betaApplicantsList"'));
  assert.match(panel, /it does not send anything to Google/);
});

/* ----------------------------------------------------------------------
 *   Personal data
 * -------------------------------------------------------------------- */

test("the request form says where the details go before asking for them", () => {
  const dialog = html.slice(html.indexOf('id="betaRequestDialog"'), html.indexOf('id="adminLoginDialog"'));
  assert.match(dialog, /go to the Resin\.Tools administrator/);
  assert.match(dialog, /id="betaRequestName"/);
  assert.match(dialog, /id="betaRequestEmail"/);
  // Withdrawal is reachable from the same place the request was made.
  assert.match(dialog, /id="betaRequestWithdraw"/);
});

test("withdrawing is confirmed and described as a deletion", () => {
  assert.match(ui, /confirm\("Withdraw your beta access request\? Your name and email are deleted\."\)/);
});

test("the privacy policy covers the collection it previously ruled out", () => {
  assert.match(privacy, /<h2>Android beta access requests<\/h2>/);
  assert.match(privacy, /name and email address you type/);
  assert.match(privacy, /withdraw a request from the same place you made it/);
  // The anonymous-sign-in paragraph no longer reads as a claim about the
  // whole app.
  assert.match(privacy, /no name, no email address, no password, and nothing to sign up for\. \(Requesting Android beta access is separate and optional/);
  assert.match(privacy, /<li><strong>A beta access request<\/strong>/);
});
