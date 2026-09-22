"use strict";

/* The shell builder is what keeps the standalone harness and the in-app host
 * from forking. These tests check the structure both of them depend on, and
 * the two element choices that exist specifically because Station has to be
 * able to live inside the application's document.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const shell = require("./station/station-shell.js");

function makeNode(name) {
  return {
    nodeName: name.toUpperCase(),
    attributes: {},
    children: [],
    textContent: "",
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    appendChild(child) { this.children.push(child); return child; }
  };
}

const fakeDocument = () => ({ createElement: name => makeNode(name) });

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function find(root, predicate) {
  const out = [];
  walk(root, node => { if (predicate(node)) out.push(node); });
  return out;
}

const built = () => shell.createShell(fakeDocument());

test("the shell carries the token scope, so a host never has to remember to add one", () => {
  const root = built();
  assert.match(root.getAttribute("class"), /\bstation-root\b/);
  assert.equal(root.getAttribute("data-station-app"), "");
});

test("every declared mount point exists exactly once", () => {
  const root = built();
  for (const mount of shell.MOUNTS) {
    const found = find(root, node => node.getAttribute("data-station-mount") === mount);
    assert.equal(found.length, 1, `expected exactly one "${mount}" mount`);
  }
});

test("MOUNTS is the whole list - the shell declares no mount it does not name", () => {
  const root = built();
  const present = find(root, node => node.getAttribute("data-station-mount") !== null)
    .map(node => node.getAttribute("data-station-mount")).sort();
  assert.deepEqual(present, [...shell.MOUNTS].sort());
});

test("the shell builds no <main>, because the application already has one", () => {
  // A second <main> is invalid, and the legacy stylesheet styles bare `main`
  // with its own grid - so a Station <main> would be mis-laid-out inside the
  // application as well.
  const root = built();
  assert.deepEqual(find(root, node => node.nodeName === "MAIN"), []);
  // The machine area is still a labelled landmark.
  const machine = find(root, node => node.getAttribute("data-station-mount") === "machine")[0];
  assert.equal(machine.nodeName, "SECTION");
  assert.equal(machine.getAttribute("aria-label"), "Machine stage");
});

test("the shell uses only elements the legacy stylesheets do not bare-style", () => {
  // `main` is excluded above; `button` is handled by Station's own reset. Any
  // other bare-styled element would arrive here unstyled-by-Station.
  const root = built();
  const used = new Set();
  walk(root, node => used.add(node.nodeName.toLowerCase()));
  assert.ok(!used.has("main"));
  assert.ok(!used.has("input"));
  assert.ok(!used.has("select"));
  assert.ok(!used.has("textarea"));
});

test("the too-small notice is part of the shell, not of a page", () => {
  // Both hosts need it, so it cannot live in the harness's HTML.
  const root = built();
  const notice = find(root, node => /station-too-small/.test(node.getAttribute("class") || ""));
  assert.equal(notice.length, 1);
  assert.match(notice[0].textContent, /1100px/);
});

test("the header is identity, status and the one edit form: the picture's slot, the Station logo, the way back, the two job readouts' slot, the hopper editor's slot, the connection - no tag, no badge, no EXPERIMENTAL", () => {
  const root = built();
  const header = find(root, node => /station-header$/.test(node.getAttribute("class") || ""))[0];
  assert.ok(header);
  assert.deepEqual(header.children.map(node => [node.nodeName, node.getAttribute("class")]), [
    ["DIV", "station-header__avatar"],
    ["H1", "station-header__title"],
    ["A", "station-header__legacy"],
    ["DIV", "station-header__job"],
    ["DIV", "station-header__edit"],
    ["DIV", "station-header__connection"]
  ]);
  // The heading holds the logo (station-logo.js): the mark and the word
  // as paths, named "Station" to a reader - no word set in type beside it.
  const title = header.children[1];
  assert.equal(title.children.length, 1);
  const logo = title.children[0];
  assert.equal(logo.nodeName.toLowerCase(), "svg");
  assert.equal(logo.getAttribute("class"), "station-logo");
  assert.equal(logo.getAttribute("role"), "img");
  assert.equal(logo.getAttribute("aria-label"), "Station");
  assert.ok(find(logo, node => /station-logo__ink/.test(node.getAttribute("class") || "")).length === 1, "the word's paths");
  assert.ok(find(logo, node => /station-logo__hopper/.test(node.getAttribute("class") || "")).length === 1, "the mark");
  assert.equal(find(logo, node => /^(text|image)$/i.test(node.nodeName)).length, 0, "no type, no image: paths only");
  // The picture's slot is a slot: the shell draws nothing in it, and the
  // face and the popover it opens are station-avatar.js's.
  assert.equal(header.children[0].getAttribute("data-station-mount"), "avatar");
  assert.equal(header.children[0].children.length, 0);
  walk(root, node => {
    assert.doesNotMatch(String(node.textContent), /experimental/i);
    assert.doesNotMatch(String(node.getAttribute("class") || ""), /__tag|badge|pill/);
  });
  // Nor is a tag on offer to a host any more.
  const tagged = shell.createShell(fakeDocument(), { tags: ["Experimental", "Live"] });
  assert.equal(find(tagged, node => /experimental|live/i.test(String(node.textContent))).length, 0);
});

test("Legacy is a plain link beside the name - the word alone, no explanation - to the application naming the legacy view", () => {
  const root = built();
  const link = find(root, node => /station-header__legacy/.test(node.getAttribute("class") || ""))[0];
  assert.equal(link.nodeName, "A", "a link: keyboard-reachable and focusable as itself, nothing scripted");
  assert.equal(link.textContent, "Legacy");
  assert.equal(link.getAttribute("data-action"), "legacy");
  assert.ok(link.getAttribute("href"));
  assert.equal(link.getAttribute("role"), null);
  assert.equal(link.getAttribute("target"), null, "the same tab: it is the same application");
  // A fake document with no location is the harness's case.
  assert.equal(link.getAttribute("href"), shell.HARNESS_LEGACY);
  // A host may hand the href in; the document's own location is the default.
  const given = shell.createShell(fakeDocument(), { legacy: "/?demo=x" });
  assert.equal(find(given, node => /station-header__legacy/.test(node.getAttribute("class") || ""))[0].getAttribute("href"), "/?demo=x");
  const located = shell.createShell(Object.assign(fakeDocument(), { location: { href: "https://resin.tools/index.html?view=station&x=1#top" } }));
  assert.equal(find(located, node => /station-header__legacy/.test(node.getAttribute("class") || ""))[0].getAttribute("href"), "/index.html?x=1&view=legacy#top");
});

test("legacyHref names the legacy interface: the page's own URL with ?view=legacy in Station's place and nothing else touched; the harness goes to the application beside it", () => {
  assert.equal(shell.legacyHref("https://resin.tools/?view=station"), "/?view=legacy");
  assert.equal(shell.legacyHref("https://resin.tools/index.html?view=station"), "/index.html?view=legacy");
  assert.equal(shell.legacyHref("https://johdavken.github.io/repo/?demo=three-layer&view=station&rtSyncCode=ABC"), "/repo/?demo=three-layer&rtSyncCode=ABC&view=legacy", "other parameters are kept, in order, under the deployment's own path");
  assert.equal(shell.legacyHref("http://127.0.0.1:8791/?view=station#station"), "/?view=legacy#station");
  assert.equal(shell.legacyHref("https://resin.tools/station/station.html?source=demo&demo=three-layer"), "../index.html", "the standalone harness");
  assert.equal(shell.legacyHref("https://resin.tools/?view=legacy"), "../index.html", "any other view flag is not Station's");
  assert.equal(shell.legacyHref(undefined), "../index.html");
  assert.equal(shell.legacyHref("not a url"), "../index.html");
  // It navigates, and never redirects: the shell holds no script for it.
  const src = fs.readFileSync(path.join(__dirname, "station/station-shell.js"), "utf8");
  assert.doesNotMatch(src, /location\.(assign|replace|href\s*=)|history\./);
  assert.doesNotMatch(src, /addEventListener/);
});

test("the way back is Station's alone: the legacy interface, its stylesheets and app.js carry nothing of the link or the timeline's scale, and the host builds nothing without the flag", () => {
  // The legacy application - its markup, every stylesheet the phone and
  // tablet shells use, and app.js - is untouched by the desktop chrome.
  const legacyFiles = ["index.html", "app.js"].concat(
    fs.readdirSync(__dirname).filter(name => /^(styles-.*|desktop|theme|button-styling)\.css$/.test(name)));
  for (const file of legacyFiles) {
    const text = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(text, /station-header__legacy|station-rundown__range|legacyHref|HARNESS_LEGACY/, `${file} knows about the Station chrome`);
  }
  // The shell is built by the Station modules only, which the host loads
  // only for ?view=station (station-host.test.js); nothing else calls it.
  const callers = fs.readdirSync(__dirname).filter(name => /\.js$/.test(name) && !/\.test\.js$/.test(name))
    .filter(name => /createShell\(/.test(fs.readFileSync(path.join(__dirname, name), "utf8")));
  assert.deepEqual(callers, [], "no top-level file builds the shell");
  const stationCallers = fs.readdirSync(path.join(__dirname, "station")).filter(name => /\.js$/.test(name))
    .filter(name => /createShell\(/.test(fs.readFileSync(path.join(__dirname, "station", name), "utf8")));
  assert.deepEqual(stationCallers, ["station-shell.js", "station.js"]);
});

test("every class the shell emits is in the station- namespace", () => {
  walk(built(), node => {
    for (const name of String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)) {
      assert.ok(name.startsWith("station-"), `shell emitted "${name}" outside the namespace`);
    }
  });
});

test("the shell sets no inline styles", () => {
  walk(built(), node => {
    assert.equal(node.getAttribute("style"), null, "the shell sets presentation in JavaScript");
  });
});

/* ----------------------------------------------------------------------
 *   Three regions, the whole width
 * -------------------------------------------------------------------- */

test("the shell is a header, the stage, the run-down timeline and a status bar - no side column, no recipe band under the stage", () => {
  const root = built();
  const shell = find(root, node => /\bstation-shell\b/.test(node.getAttribute("class") || ""))[0];
  // The Handbook's slot, the utility surfaces' slot and the machine
  // rail's slot are the three children that are not regions: all are
  // laid over the stage's own cell (shell.css) and take no track.
  assert.deepEqual(shell.children.map(node => [node.nodeName, node.getAttribute("class")]),
    [["HEADER", "station-header"], ["SECTION", "station-machine"], ["DIV", "station-handbook-slot"], ["DIV", "station-utility-slot"], ["DIV", "station-rail-slot"], ["SECTION", "station-timeline"], ["FOOTER", "station-status"]]);
  assert.deepEqual([...require("./station/station-shell.js").MOUNTS], ["avatar", "machine", "timeline", "status", "job", "edit", "connection", "handbook", "utility", "rail"]);
  const slot = shell.children[2];
  assert.equal(slot.getAttribute("data-station-mount"), "handbook");
  assert.equal(slot.children.length, 0, "the shell reserves the slot and draws nothing in it");
  const utility = shell.children[3];
  assert.equal(utility.getAttribute("data-station-mount"), "utility");
  assert.equal(utility.children.length, 0, "the shell reserves the utility slot and draws nothing in it");
  const rail = shell.children[4];
  assert.equal(rail.getAttribute("data-station-mount"), "rail");
  assert.equal(rail.children.length, 0, "the shell reserves the rail's slot and draws nothing in it");
  // The timeline row is a mount and nothing else: no heading, no title,
  // no card - the component begins with its Now anchor.
  const timeline = shell.children[5];
  assert.equal(timeline.getAttribute("data-station-mount"), "timeline");
  assert.equal(timeline.getAttribute("aria-label"), "Run-down timeline");
  assert.equal(timeline.children.length, 0);
  // The header carries the picture's slot first, then the job controls'
  // slot, then the hopper editor's, before the line console's.
  const header = shell.children[0];
  const slots = header.children.filter(node => node.getAttribute("data-station-mount")).map(node => node.getAttribute("data-station-mount"));
  assert.deepEqual(slots, ["avatar", "job", "edit", "connection"]);
  // Nothing of the old columns survives: no nav, no aside, no heading, no
  // recipe strip - and no element with nothing in it holding a place.
  walk(root, node => {
    assert.ok(!["NAV", "ASIDE", "H2"].includes(node.nodeName), `the shell still builds a <${node.nodeName.toLowerCase()}>`);
    assert.doesNotMatch(String(node.getAttribute("class") || ""), /sidebar|inspector|recipe-strip|station-nav|section__heading/);
  });
});

test("the stylesheet reserves no track for a side column or a strip: one column, four rows, and the tokens for the old widths are gone", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  // Rules only: the file's comments are allowed to say what is no longer there.
  const codeOnly = text => text.replace(/\/\*[\s\S]*?\*\//g, "");
  const css = codeOnly(fs.readFileSync(path.join(__dirname, "station/styles/shell.css"), "utf8"));
  const tokens = codeOnly(fs.readFileSync(path.join(__dirname, "station/styles/tokens.css"), "utf8"));
  assert.match(css, /\.station-shell \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  // The timeline's row is `auto`: sized by its component, never a share of
  // the height the stage would otherwise have.
  assert.match(css, /grid-template-rows: var\(--station-header-height\) minmax\(0, 1fr\) auto var\(--station-status-height\);/);
  assert.match(css, /grid-template-areas:\s*"header"\s*"machine"\s*"timeline"\s*"status";/);
  // The Handbook's slot shares the stage's area and is inert to the pointer
  // itself: a fifth row would be a track, and a slot that took clicks would
  // cover the hoppers Blend Edit works on.
  assert.match(css, /\.station-handbook-slot \{[^}]*grid-area: machine;[^}]*pointer-events: none;/);
  assert.match(css, /\.station-utility-slot \{[^}]*grid-area: machine;[^}]*pointer-events: none;/);
  // The rail's slot: the same cell, under the two above in the stack, so a
  // surface laid across the stage covers what reaches under it rather than
  // meeting it (the column itself stands in the launcher's cleared corner).
  assert.match(css, /\.station-rail-slot \{[^}]*grid-area: machine;[^}]*z-index: 4;[^}]*pointer-events: none;/);
  for (const gone of ["sidebar", "inspector", "recipe-strip", "station-nav", "section__heading", "strip"]) {
    assert.doesNotMatch(css, new RegExp(gone), `shell.css still styles ${gone}`);
  }
  for (const token of ["--station-sidebar-width", "--station-inspector-width", "--station-recipe-strip-height"]) {
    assert.doesNotMatch(tokens, new RegExp(token));
    assert.doesNotMatch(css, new RegExp(token));
  }
  // The stage's cell is the whole width: it sets no max-width and no margin
  // that would centre it in a narrower band.
  const machine = css.slice(css.indexOf(".station-machine {"), css.indexOf("}", css.indexOf(".station-machine {")));
  assert.doesNotMatch(machine, /max-width|margin/);
  // And the recipe strip's stylesheet is gone, not merely unlinked.
  assert.ok(!fs.existsSync(path.join(__dirname, "station/styles/components/recipe-strip.css")));
  for (const file of ["station/station.html", "station-host.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), "utf8"), /recipe-strip\.css/);
  }
});
