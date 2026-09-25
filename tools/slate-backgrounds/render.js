"use strict";

/* Renders Slate's backgrounds from the SVG sources beside this file to
 * the JPEGs Slate loads (slate/images/backgrounds/). The SVGs are the
 * sources of truth - smoke drawn by feTurbulence - and are pre-rendered
 * so no device computes the filter at runtime. Playwright is not a
 * project dependency: point PLAYWRIGHT_MODULE at an install whose
 * Chromium is cached.
 *
 *   PLAYWRIGHT_MODULE=/path/to/playwright-core node tools/slate-backgrounds/render.js
 */

const fs = require("node:fs");
const path = require("node:path");

const NAMES = ["smoke", "ember", "tide", "aurora", "dunes", "hearth", "horizon"];
const OUT = path.join(__dirname, "..", "..", "slate", "images", "backgrounds");

(async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  for (const name of NAMES) {
    const svg = fs.readFileSync(path.join(__dirname, `${name}.svg`), "utf8");
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    const file = path.join(OUT, `${name}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 82 });
    console.log(`${path.relative(process.cwd(), file)}  ${fs.statSync(file).size} bytes`);
  }
  await browser.close();
})();
