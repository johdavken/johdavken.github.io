"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const zlib = require("node:zlib");

const SAFE_RADIUS = 33;
const FOREGROUND_SCALE = 0.75;
const SOURCE_RADIUS = 43;
// Rosé Pine Light `text`. The launcher vector cannot read a CSS custom
// property, so the ink is inlined - these tests are what keep it in step with
// --icon-ink in branding/resin-tools/rt-confluence-icon.svg.
const ICON_INK = "#575279";
const STREAM_COLORS = ["B4637A", "D7827E", "EA9D34", "907AA9", "56949F"];

// Minimal 8-bit non-interlaced PNG reader. `pngjs` would do this in one line,
// but it is only present as a transitive dependency of qrcode - depending on it
// here would break the suite the moment that tree changes, and the project is
// deliberately dependency-light. Only the alpha channel is needed.
function readPngAlpha(file) {
  const bytes = fs.readFileSync(file);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, `${file}: expected 8-bit channels`);
      assert.equal(data[9], 6, `${file}: expected a truecolour+alpha PNG`);
      assert.equal(data[12], 0, `${file}: expected a non-interlaced PNG`);
    }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);

  // Undo the per-scanline filters (PNG spec 9.2); each line may reference the
  // pixel to its left, the line above, or both.
  let read = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[read];
    read += 1;
    const line = raw.subarray(read, read + stride);
    read += stride;
    const current = pixels.subarray(row * stride, (row + 1) * stride);
    const previous = row > 0 ? pixels.subarray((row - 1) * stride, row * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? current[i - bpp] : 0;
      const up = previous[i];
      const upLeft = i >= bpp ? previous[i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const dLeft = Math.abs(estimate - left);
        const dUp = Math.abs(estimate - up);
        const dUpLeft = Math.abs(estimate - upLeft);
        value += dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      } else assert.equal(filter, 0, `${file}: unknown scanline filter ${filter}`);
      current[i] = value & 255;
    }
  }

  return { width, height, alphaAt: (x, y) => pixels[(y * width + x) * bpp + 3] };
}

for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
  test(`${name} uses the Confluence vector without another inset`, () => {
    const icon = fs.readFileSync(`android/app/src/main/res/mipmap-anydpi-v26/${name}`, "utf8");
    assert.match(icon, /<background android:drawable="@mipmap\/ic_launcher_background" \/>/);
    assert.match(icon, /<foreground android:drawable="@drawable\/ic_launcher_foreground" \/>/);
    assert.doesNotMatch(icon, /android:inset/);
  });
}

test("the launcher background stays aligned with the Rosé Pine Light icon field", () => {
  const values = fs.readFileSync("android/app/src/main/res/values/ic_launcher_background.xml", "utf8");
  assert.match(values, /<color name="ic_launcher_background">#FAF4ED<\/color>/i);
});

test("the adaptive foreground is the circular Confluence mark and contains no RT lettering", () => {
  const vector = fs.readFileSync("android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml", "utf8");
  assert.match(vector, /android:scaleX="0\.75"/);
  assert.match(vector, /android:scaleY="0\.75"/);
  assert.ok(SOURCE_RADIUS * FOREGROUND_SCALE <= SAFE_RADIUS);
  for (const rotation of ["0", "72", "144", "216", "288"]) {
    assert.match(vector, new RegExp(`android:rotation="${rotation}"`));
  }
  for (const color of STREAM_COLORS) {
    assert.match(vector, new RegExp(`android:fillColor="#${color}"`, "i"));
  }
  assert.doesNotMatch(vector, /<text\b|>\s*RT\s*</i);
});

test("every non-stream stroke in the launcher vector is the one shared ink", () => {
  const vector = fs.readFileSync("android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml", "utf8");
  const strokes = [...vector.matchAll(/android:strokeColor="(#[0-9A-Fa-f]{6,8})"/g)].map(match => match[1].toUpperCase());
  assert.ok(strokes.length > 0, "expected the vector to declare stroke colours");

  const ink = strokes.filter(color => !STREAM_COLORS.includes(color.replace("#", "")));
  assert.ok(ink.length > 0, "expected the calibration ring and die to be stroked in the ink colour");
  for (const color of ink) {
    assert.equal(color, ICON_INK.toUpperCase(), "the ring, ticks and die must all share --icon-ink");
  }

  const svg = fs.readFileSync("branding/resin-tools/rt-confluence-icon.svg", "utf8");
  assert.match(svg, new RegExp(`--icon-ink:${ICON_INK}`, "i"));
});

test("the generated Android foreground raster remains inside the safe circle", () => {
  const png = readPngAlpha("resources/icon-foreground.png");
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);

  let furthest = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.alphaAt(x, y) === 0) continue;
      furthest = Math.max(furthest, Math.hypot(x + 0.5 - 512, y + 0.5 - 512));
    }
  }
  const safeRadiusPx = png.width * SAFE_RADIUS / 108;
  assert.ok(furthest <= safeRadiusPx + 1, `${furthest.toFixed(2)}px exceeds ${safeRadiusPx.toFixed(2)}px safe radius`);
});
