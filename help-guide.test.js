"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const TOPIC_IDS = [
  "helpQuickStart",
  "helpSetup",
  "helpHopperPercentages",
  "helpTimeline",
  "helpCloudSync",
  "helpTools",
  "helpRecipeScan"
];

/**
 * A topic's full markup. Sections now nest <details> subtopics, so slicing to
 * the first </details> would stop at the first subtopic and hide most of the
 * section from every assertion below - the tag depth has to be tracked.
 */
function topic(id){
  const start = html.indexOf(`<details class="helpTopic" id="${id}"`);
  assert.notEqual(start, -1, `expected a ${id} topic`);
  const tags = /<details\b|<\/details>/g;
  tags.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tags.exec(html))){
    depth += match[0] === "</details>" ? -1 : 1;
    if (depth === 0) return html.slice(start, match.index);
  }
  throw new Error(`${id} has an unbalanced <details>`);
}

/**
 * Declared width from the file itself - no image dependency. Screenshots are
 * PNG (IHDR); photographed source documents are JPEG, where PNG would be many
 * times the size for no gain, so both are read here.
 */
function imageWidth(file){
  const bytes = fs.readFileSync(file);
  if (bytes.toString("ascii", 12, 16) === "IHDR") return bytes.readUInt32BE(16);
  assert.equal(bytes.readUInt16BE(0), 0xffd8, `${file} is neither a PNG nor a JPEG`);
  // Walk the JPEG segment chain to a start-of-frame marker; width is the
  // 16-bit big-endian field 7 bytes into that segment.
  let offset = 2;
  while (offset < bytes.length - 9){
    assert.equal(bytes[offset], 0xff, `${file} has a malformed JPEG segment chain`);
    const marker = bytes[offset + 1];
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) return bytes.readUInt16BE(offset + 7);
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error(`${file}: no JPEG start-of-frame marker found`);
}

test("every guide topic opens with a lede rather than dropping straight into steps", () => {
  for (const id of TOPIC_IDS){
    assert.match(topic(id), /<p class="helpLede">/, `${id} should open with a .helpLede`);
  }
});

test("the guide varies its layout instead of repeating one pattern", () => {
  const guide = html.slice(html.indexOf('<div class="helpTopics">'), html.indexOf('id="helpChangelog"'));
  for (const primitive of ["helpSplit", "helpWide", "helpAside", "helpCallout", "helpSteps", "helpGrid"]){
    assert.ok(guide.includes(primitive), `expected the guide to use .${primitive}`);
  }
  // No single topic should be built from just one repeated block.
  for (const id of TOPIC_IDS){
    const body = topic(id);
    const used = ["helpSplit", "helpWide", "helpAside", "helpCallout", "helpSteps", "helpGrid", "helpTip"]
      .filter(p => body.includes(p));
    assert.ok(used.length >= 2, `${id} uses only ${used.join(",") || "no"} layout blocks`);
  }
});

test("every screenshot exists, is described, and declares its real pixel width", () => {
  const guide = html.slice(html.indexOf('<div class="helpTopics">'), html.indexOf('id="helpChangelog"'));
  const figures = [...guide.matchAll(/<figure class="helpShot[^"]*" style="--shot-w:(\d+)px">\s*<img src="([^"]+)" alt="([^"]+)"/g)];
  assert.ok(figures.length >= 15, `expected the guide to be heavily illustrated, found ${figures.length} figures`);
  for (const [, declared, src, alt] of figures){
    assert.ok(src.startsWith("branding/help/"), `${src} should live in branding/help/`);
    assert.ok(fs.existsSync(src), `${src} is referenced but missing from the repo`);
    assert.ok(alt.length > 25, `${src} needs descriptive alt text`);
    // The no-upscale rule: --shot-w must be the asset's true width, so the
    // shot can only ever scale down.
    assert.equal(Number(declared), imageWidth(src), `--shot-w for ${src} must equal its natural width`);
  }
});

test("photographed source documents ship stripped of camera metadata", () => {
  // These are phone photos of paper, not app screenshots: the originals carry
  // device model, capture timestamps and potentially location, and the guide
  // is published on a public site.
  for (const file of fs.readdirSync("branding/help").filter(f => f.endsWith(".jpg"))){
    const bytes = fs.readFileSync(path.join("branding/help", file));
    assert.equal(bytes.includes(Buffer.from("Exif")), false, `${file} still carries an EXIF block`);
    assert.equal(bytes.includes(Buffer.from("samsung")), false, `${file} still names the capture device`);
  }
});

test("no orphaned screenshots are left behind in branding/help", () => {
  const referenced = new Set([...html.matchAll(/branding\/help\/([\w.-]+\.(?:png|jpg))/g)].map(m => m[1]));
  const onDisk = fs.readdirSync("branding/help").filter(f => /\.(png|jpg)$/.test(f));
  const orphans = onDisk.filter(f => !referenced.has(f));
  assert.deepEqual(orphans, [], `unused help assets: ${orphans.join(", ")}`);
});

test("the guide is set on a fixed page measure, and that page can still shrink to fit", () => {
  assert.match(styles, /--help-page:\s*\d+px/, "the guide needs a fixed measure so the layout does not restretch per window");
  // Shots carry a definite width, so without width:100% this column sizes
  // itself from its widest content and overflows narrow parents.
  assert.match(styles, /\.helpTopics\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: var\(--help-page\);/);
});

test("the shot frame gives every screenshot a definite width, not just a cap", () => {
  // A bare max-width lets `auto` grid tracks and floats size themselves from
  // the image's intrinsic pixels instead of its displayed box. The +2px is
  // the frame's own borders under border-box, so the image lands on exactly
  // --shot-w and renders pixel-for-pixel.
  assert.match(styles, /\.helpShot\{[\s\S]*?width: calc\(var\(--shot-w, 100%\) \+ 2px\);[\s\S]*?max-width: 100%;/);
});

test("every split variant collapses to one column on small screens", () => {
  const mobile = styles.slice(styles.indexOf("@media (max-width: 900px)", styles.indexOf(".helpShot{")));
  const block = mobile.slice(0, mobile.indexOf("}\n\n"));
  for (const variant of ["is-narrowMedia", "is-wideMedia", "is-autoMedia"]){
    assert.match(block, new RegExp(`\\.helpSplit\\.${variant}`), `.${variant} must be collapsed on mobile or its shot overflows`);
  }
});

test("Quick Start still routes to each section it names", () => {
  const qs = topic("helpQuickStart");
  const targets = [...qs.matchAll(/href="#(help\w+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(targets)].sort(), ["helpCloudSync", "helpHopperPercentages", "helpSetup", "helpTimeline", "helpTools"]);
  for (const id of new Set(targets)) assert.ok(html.includes(`id="${id}"`), `#${id} should exist`);
  assert.match(qs, /href="#helpHopperPercentages">Recipe<\/a>/);
});
