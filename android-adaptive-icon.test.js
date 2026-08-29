const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

// The launcher mark is drawn to the safe zone in the source SVG, so Android
// must not add another inset. These tests guard the source and XML invariants.
// `npx capacitor-assets generate` rewrites these two files with a 16.7% inset
// on both layers - re-apply the hand-written versions if it is ever run again.

const SAFE_RADIUS = 33; // Android guarantees the inner 66 units of the 108 grid.
const CENTRE = 54;

for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
  test(`${name} draws both adaptive-icon layers without an inset`, () => {
    const icon = fs.readFileSync(`android/app/src/main/res/mipmap-anydpi-v26/${name}`, "utf8");
    assert.match(icon, /<background android:drawable="@mipmap\/ic_launcher_background" \/>/);
    assert.match(icon, /<foreground android:drawable="@mipmap\/ic_launcher_foreground" \/>/);
    assert.doesNotMatch(icon, /android:inset/);
  });
}

test("the launcher background colour matches the icon's background layer", () => {
  const values = fs.readFileSync("android/app/src/main/res/values/ic_launcher_background.xml", "utf8");
  assert.match(values, /<color name="ic_launcher_background">#FAF4ED<\/color>/i);
});

test("Layer Stack foreground art stays inside the adaptive-icon safe circle", () => {
  const svg = fs.readFileSync("branding/resin-tools/layer-stack-rose-pine-light-launcher.svg", "utf8");
  const foreground = svg.match(/<g id="fg">([\s\S]*?)<\/g>/);
  assert.ok(foreground, "the launcher SVG must expose the art as <g id=\"fg\">");

  const paths = [...foreground[1].matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(paths.length > 0, "expected at least one path in the foreground group");

  for (const d of paths) {
    // Absolute move/line commands only, so every number pair is a vertex.
    assert.doesNotMatch(d, /[a-gi-z]/, `path uses relative commands, which this check cannot read: ${d}`);

    const numbers = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    assert.equal(numbers.length % 2, 0, `path has an odd coordinate count: ${d}`);

    for (let i = 0; i < numbers.length; i += 2) {
      const dx = numbers[i] - CENTRE;
      const dy = numbers[i + 1] - CENTRE;
      const radius = Math.hypot(dx, dy);
      assert.ok(
        radius <= SAFE_RADIUS + 1e-9,
        `vertex ${numbers[i]},${numbers[i + 1]} sits ${radius.toFixed(2)} units from centre, outside the ${SAFE_RADIUS}-unit safe circle`,
      );
    }
  }
});
