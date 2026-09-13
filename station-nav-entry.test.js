"use strict";

/* The Legacy rail's foot carries one link into Station, labelled
 * "Station (Beta)". It replaced the desktop-only Dashboard overview, which is
 * gone entirely - not hidden. These tests pin the new product boundary from
 * both sides: the way in from Legacy, the way back from Station, the touch
 * guard around both, and the absence of every piece of the old Dashboard.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { enclosingMedia } = require("./css-media");
const shell = require("./station/station-shell.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

const html = read("index.html");
const app = read("app.js");
const host = read("station-host.js");
const desktop = read("desktop.css");
const shellCss = read("styles-shell.css");

const navStart = html.indexOf('<nav class="workspaceNav"');
const nav = html.slice(navStart, html.indexOf("</nav>", navStart));
const footer = nav.slice(nav.indexOf('class="workspaceNavFooter"'));

/* ----------------------------------------------------------------------
 *   The way in: Station (Beta)
 * -------------------------------------------------------------------- */

test("the rail foot carries exactly one Station (Beta) link, below the version and a divider, after every working section", () => {
  const anchors = [...footer.matchAll(/<a\b[^>]*>/g)];
  assert.equal(anchors.length, 1, "one link in the rail foot");
  const anchor = anchors[0][0];
  assert.match(anchor, /id="workspaceNavStation"/);
  assert.match(anchor, /class="workspaceNavButton workspaceNavStation"/);
  const entry = footer.slice(footer.indexOf(anchor), footer.indexOf("</a>"));
  assert.match(entry, /<span>Station \(Beta\)<\/span>/, "the visible label is exactly Station (Beta)");
  assert.doesNotMatch(entry, /data-workspace-target|workspaceTileIcon|<small/, "a link out, not a panel switch: no target, icon, or caption");
  // Order inside the foot: version, divider, then the link.
  const version = footer.indexOf('class="desktopRailVersion"');
  const divider = footer.indexOf('class="workspaceNavFooterDivider"');
  assert.ok(version > -1 && divider > version && footer.indexOf(anchor) > divider);
  assert.ok(nav.indexOf('class="workspaceNavFooter"') > nav.indexOf('id="workspaceNavSudo"'), "the foot follows every working section");
});

test("the link is the existing Station route - the same flag and value station-host.js switches on, nothing else", () => {
  const anchor = /<a\b[^>]*id="workspaceNavStation"[^>]*>/.exec(footer)[0];
  const href = /href="([^"]*)"/.exec(anchor)[1];
  assert.equal(href, "?view=station");
  const flag = /const FLAG = "([^"]+)";/.exec(host)[1];
  const value = /const VALUE = "([^"]+)";/.exec(host)[1];
  assert.equal(href, `?${flag}=${value}`, "index.html and station-host.js agree on the route");
  // A relative query href keeps whatever path the deployment lives under.
  assert.equal(new URL(href, "https://johdavken.github.io/repo/index.html").href, "https://johdavken.github.io/repo/index.html?view=station");
  assert.equal(new URL(href, "https://resin.tools/").href, "https://resin.tools/?view=station");
  // No second route: nothing else in the application document links to Station.
  assert.equal((html.match(/href="[^"]*view=station[^"]*"/g) || []).length, 1);
  assert.doesNotMatch(app, /view=station/, "app.js does not build a Station URL of its own");
});

test("Station -> Legacy is the unchanged existing link, and the two routes round-trip", () => {
  for (const origin of ["https://resin.tools/", "https://johdavken.github.io/repo/index.html", "http://127.0.0.1:8791/"]) {
    const station = new URL("?view=station", origin);
    const back = new URL(shell.legacyHref(station.href), station.href);
    assert.equal(back.href, new URL(origin).href, `${origin} -> Station -> Legacy lands back where it started`);
  }
  assert.match(read("station/station-shell.js"), /"station-header__legacy", "Legacy"/, "Station still shows the plain Legacy link");
  assert.doesNotMatch(read("station/station-shell.js"), /Station \(Beta\)/, "Station is not renamed inside Station");
});

/* ----------------------------------------------------------------------
 *   The touch guard
 * -------------------------------------------------------------------- */

test("the rail foot is hidden by default and shown only by the existing desktop/fine-pointer rule - no new breakpoint", () => {
  assert.match(shellCss, /^\.workspaceNavFooter\{display:none\}/m, "hidden in the shared shell stylesheet");
  const footerRule = desktop.indexOf(".workspaceNavFooter{");
  const linkRule = desktop.indexOf(".workspaceNavStation{");
  assert.ok(footerRule > -1 && linkRule > -1);
  assert.equal(enclosingMedia(desktop, footerRule), "@media (min-width: 901px) and (pointer: fine)");
  assert.equal(enclosingMedia(desktop, linkRule), "@media (min-width: 901px) and (pointer: fine)");
  assert.match(desktop, /\.workspaceNavStation\{[^}]*text-decoration:none;/, "an <a> in the rail reads like its neighbours");
  // Nothing in the mobile/touch navigation structure changed: the touch
  // shell's home tiles are still driven by data-workspace-target buttons and
  // the Station link carries none.
  assert.doesNotMatch(html, /workspaceNavStation[^>]*data-workspace-target/);
});

test("Legacy attaches no navigation handler that would turn the link into a panel switch", () => {
  assert.doesNotMatch(app, /workspaceNavStation/, "the link is a link; app.js never touches it");
  // The generic nav hookup only ever routes ids that name a .workspacePanel,
  // so a click on the link (no data-workspace-target) is a no-op there and
  // the browser follows the href.
  const fn = app.slice(app.indexOf("function setWorkspacePanel("), app.indexOf("activeWorkspaceId = id;"));
  assert.match(fn, /if \(!target\?\.classList\.contains\("workspacePanel"\)\) return;/);
});

/* ----------------------------------------------------------------------
 *   The Dashboard is gone
 * -------------------------------------------------------------------- */

test("no Dashboard navigation entry, panel, or logo entry point remains in the application document", () => {
  assert.doesNotMatch(nav, /<span>Dashboard<\/span>/);
  assert.doesNotMatch(html, /id="workspaceNavDashboard"|workspaceNavDashboard|dashboardPanel|dashboardBackButton|workspaceBrandDashboard/);
  assert.match(html, /<div class="workspaceBrand">\s*<svg class="resinToolsSidebarIcon/, "the sidebar mark is a plain brand again, not a button");
  assert.doesNotMatch(html, /<div class="mobileBrand"[^>]*role="button"/);
  // The word survives only in the Changelog's history entries.
  const changelogStart = html.indexOf('id="changelogBlock"');
  const before = html.slice(0, changelogStart);
  const after = html.slice(html.indexOf("</details>", changelogStart));
  assert.doesNotMatch(before + after, /Dashboard/);
});

test("app.js carries no Dashboard state, rendering, or handlers", () => {
  assert.doesNotMatch(app, /dashboardActive|setDashboardActive|renderDashboard|nextDashboardActionGroup|syncStatusSeverity|dashboard[A-Z]\w*/);
});

test("no stylesheet keeps a Dashboard selector", () => {
  const css = fs.readdirSync(ROOT).filter(f => f.endsWith(".css"));
  for (const file of css) {
    assert.doesNotMatch(read(file), /\.dashboard|#dashboard|dashboardActive/, `${file} still styles the Dashboard`);
  }
});

test("no Dashboard module, asset, test, or cache tag remains", () => {
  const files = fs.readdirSync(ROOT);
  assert.equal(files.filter(f => /dashboard/i.test(f)).length, 0, "no dashboard-named file at the root");
  assert.doesNotMatch(html, /src="[^"]*dashboard|href="[^"]*dashboard/i);
  assert.doesNotMatch(read("script-cache-tags.json") + read("css-cache-tags.json"), /dashboard/i);
});
