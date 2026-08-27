"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const manifestRaw = fs.readFileSync("manifest.webmanifest", "utf8");
const head = html.slice(0, html.indexOf("</head>"));

/* ============================================================
 *   Manifest
 * ============================================================ */

test("the manifest is valid JSON with the fields an install needs", () => {
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.name, "Resin.Tools");
  assert.equal(manifest.short_name, "Resin.Tools");
  assert.ok(manifest.description, "an installable app should describe itself");
  assert.equal(manifest.display, "standalone");
  // resin.tools serves the app from the domain root, so both are "/".
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
});

test("manifest colors come from the app's own palette, not invented ones", () => {
  const manifest = JSON.parse(manifestRaw);
  const theme = fs.readFileSync("theme.css", "utf8");
  const industrialSlate = theme.slice(theme.indexOf('[data-theme="industrial-slate"]'));
  const background = /--bg:\s*(#[0-9a-f]{6})/i.exec(industrialSlate)?.[1];
  assert.ok(background, "expected the default theme to define --bg");
  assert.equal(manifest.background_color.toLowerCase(), background.toLowerCase());
  assert.equal(manifest.theme_color.toLowerCase(), background.toLowerCase());
  // The <meta> must agree with the manifest or the two disagree at install time.
  assert.match(head, new RegExp(`<meta name="theme-color" content="${background}">`, "i"));
});

test("every manifest icon resolves to a real file at its declared size", () => {
  const manifest = JSON.parse(manifestRaw);
  assert.ok(manifest.icons.length >= 2, "need at least the 192 and 512 icons");
  const declared = new Set();
  for (const icon of manifest.icons){
    assert.match(icon.src, /^\/icons\//, `${icon.src} should be a root-absolute path`);
    const file = icon.src.replace(/^\//, "");
    assert.ok(fs.existsSync(file), `${icon.src} is declared but missing from the repo`);
    assert.equal(icon.type, "image/png");
    const [width, height] = icon.sizes.split("x").map(Number);
    assert.deepEqual(pngSize(file), { width, height }, `${file} is not actually ${icon.sizes}`);
    declared.add(icon.sizes);
  }
  assert.ok(declared.has("192x192") && declared.has("512x512"));
});

/** Dimensions from a PNG's IHDR chunk - avoids an image dependency. */
function pngSize(file){
  const head = Buffer.alloc(24);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, head, 0, 24, 0);
  fs.closeSync(fd);
  assert.equal(head.toString("ascii", 12, 16), "IHDR", `${file} is not a PNG`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

test("the Apple touch icon exists at 180x180 and is linked exactly once", () => {
  assert.deepEqual(pngSize("icons/apple-touch-icon.png"), { width: 180, height: 180 });
  assert.equal((head.match(/rel="apple-touch-icon"/g) || []).length, 1);
  assert.match(head, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
});

/* ============================================================
 *   <head>
 * ============================================================ */

test("the head declares the manifest and Apple standalone metadata once each", () => {
  for (const [label, pattern] of [
    ["manifest link", /rel="manifest"/g],
    ["theme-color", /name="theme-color"/g],
    ["apple-mobile-web-app-capable", /name="apple-mobile-web-app-capable"/g],
    // Chrome warns in the console without the standard spelling; older iOS
    // only understands the apple- prefixed one, so both must be present.
    ["mobile-web-app-capable", /name="mobile-web-app-capable"/g],
    ["apple-mobile-web-app-title", /name="apple-mobile-web-app-title"/g],
    ["status bar style", /name="apple-mobile-web-app-status-bar-style"/g]
  ]){
    assert.equal((head.match(pattern) || []).length, 1, `${label} should appear exactly once`);
  }
  assert.match(head, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(head, /content="yes"/);
  assert.match(head, /<meta name="apple-mobile-web-app-title" content="Resin\.Tools">/);
});

test("the status bar style stays 'default' regardless of the app's own top safe-area handling", () => {
  // black-translucent draws the page under the status bar and would need an
  // explicit top inset offset for iOS specifically. styles.css does read
  // env(safe-area-inset-top) now (for Android/Capacitor's edge-to-edge
  // WebView, which has no "default"-style opt-out), but "default" already
  // keeps iOS's own inset at 0, so that addition changes nothing there and
  // is not by itself a reason to switch iOS to black-translucent.
  assert.match(head, /name="apple-mobile-web-app-status-bar-style" content="default"/);
  assert.match(styles, /env\(safe-area-inset-top/, "expected main{} to compensate for Android's edge-to-edge status bar");
});

test("the existing viewport keeps viewport-fit=cover and its other settings", () => {
  assert.match(head, /<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" \/>/);
  assert.equal((head.match(/name="viewport"/g) || []).length, 1);
});

test("the existing SVG favicon is untouched", () => {
  assert.match(head, /<link rel="icon" type="image\/svg\+xml" sizes="any" href="branding\/resin-tools\/rt6-02-layer-stack-icon\.svg\?v=2">/);
});

/* ============================================================
 *   Install hint behavior
 * ============================================================ */

function loadHint(env){
  const root = {
    navigator: { userAgent: env.userAgent, platform: env.platform || "", maxTouchPoints: env.maxTouchPoints || 0, standalone: env.iosStandalone },
    matchMedia: query => ({ matches: !!(env.displayMode && query.includes(env.displayMode)) }),
    localStorage: env.storage,
    Capacitor: env.native ? { isNativePlatform: () => true } : undefined
  };
  // No document: init() is skipped, so each case tests the decision itself.
  const source = fs.readFileSync("install-hint.js", "utf8");
  new Function("root", `${source.replace(/\}\)\(typeof globalThis[^;]+;\s*$/, "})(root);")}`)(root);
  return root.PolynInstallHint;
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125";

function memoryStorage(seed){
  const map = new Map(Object.entries(seed || {}));
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
}

test("iOS in a browser tab is the one case that gets the hint", () => {
  const api = loadHint({ userAgent: IPHONE, storage: memoryStorage() });
  assert.equal(api.isIosDevice(), true);
  assert.equal(api.isStandaloneDisplay(), false);
  assert.equal(api.shouldShowIosHint(), true);
});

test("an installed iOS Home Screen app never sees the hint", () => {
  // Both signals independently suppress it: the older navigator.standalone
  // flag and the display-mode media query.
  const viaFlag = loadHint({ userAgent: IPHONE, iosStandalone: true, storage: memoryStorage() });
  assert.equal(viaFlag.isStandaloneDisplay(), true);
  assert.equal(viaFlag.shouldShowIosHint(), false);

  const viaDisplayMode = loadHint({ userAgent: IPHONE, displayMode: "standalone", storage: memoryStorage() });
  assert.equal(viaDisplayMode.isStandaloneDisplay(), true);
  assert.equal(viaDisplayMode.shouldShowIosHint(), false);
});

test("iPadOS reporting a Mac user agent is still recognized as iOS", () => {
  const ipad = loadHint({ userAgent: DESKTOP.replace("X11; Linux x86_64", "Macintosh; Intel Mac OS X 10_15_7"), platform: "MacIntel", maxTouchPoints: 5, storage: memoryStorage() });
  assert.equal(ipad.isIosDevice(), true);
  // A real Mac reports no touch points and must not be treated as iOS.
  const mac = loadHint({ userAgent: DESKTOP, platform: "MacIntel", maxTouchPoints: 0, storage: memoryStorage() });
  assert.equal(mac.isIosDevice(), false);
  assert.equal(mac.shouldShowIosHint(), false);
});

test("Android browsers and desktop never see an iOS hint", () => {
  for (const [label, userAgent] of [["Android browser", ANDROID], ["desktop", DESKTOP]]){
    const api = loadHint({ userAgent, storage: memoryStorage() });
    assert.equal(api.isIosDevice(), false, `${label} should not look like iOS`);
    assert.equal(api.shouldShowIosHint(), false, `${label} must not get the hint`);
  }
});

test("the native Android Capacitor app never shows install guidance", () => {
  // Belt and braces: even if the UA somehow looked like iOS, native wins.
  const android = loadHint({ userAgent: ANDROID, native: true, storage: memoryStorage() });
  assert.equal(android.shouldShowIosHint(), false);
  const spoofed = loadHint({ userAgent: IPHONE, native: true, storage: memoryStorage() });
  assert.equal(spoofed.shouldShowIosHint(), false, "isNativePlatform() must suppress the hint outright");
});

test("a dismissed hint stays dismissed", () => {
  const api = loadHint({ userAgent: IPHONE, storage: memoryStorage({ "polyn.installHint.v1": "1" }) });
  assert.equal(api.shouldShowIosHint(), false);
  // Follows the existing polyn.<feature>.v1 localStorage convention.
  assert.match(api.DISMISSED_KEY, /^polyn\.[a-zA-Z]+\.v1$/);
});

test("blocked storage degrades to showing the hint rather than throwing", () => {
  const throwing = { getItem(){ throw new Error("denied"); }, setItem(){ throw new Error("denied"); } };
  const api = loadHint({ userAgent: IPHONE, storage: throwing });
  assert.doesNotThrow(() => api.shouldShowIosHint());
  assert.equal(api.shouldShowIosHint(), true);
});

test("the hint is a dismissible bottom notice, not a blocking modal", () => {
  const source = fs.readFileSync("install-hint.js", "utf8");
  assert.doesNotMatch(source, /showModal|<dialog|role="dialog"|aria-modal/, "must not be a modal");
  // Text "Dismiss" button, matching .pumpOffAlarmBanner rather than an X.
  assert.match(source, /textContent = "Dismiss"/);
  assert.match(source, /Safari → Share → Add to Home Screen/);
  // Shares the existing bottom-notice placement, including the dock offset.
  assert.match(styles, /\.installHint\{[^}]*position:fixed[^}]*bottom:12px/);
  assert.match(styles, /\.pumpOffAlarmBanner,\.installHint\{bottom:calc\(var\(--app-dock-height\)/);
});

test("the hint module is loaded by index.html and exports standalone detection", () => {
  assert.match(html, /<script src="install-hint\.js\?v=[\d.]+" defer><\/script>/);
  assert.match(fs.readFileSync("install-hint.js", "utf8"), /root\.PolynInstallHint = \{[^}]*isStandaloneDisplay/);
});

/* ============================================================
 *   Service worker: still no caching
 * ============================================================ */

test("no caching was introduced - the service worker still only handles notifications", () => {
  const worker = fs.readFileSync("service-worker.js", "utf8");
  assert.doesNotMatch(worker, /addEventListener\(\s*"fetch"/, "a fetch handler would start caching/serving assets");
  assert.doesNotMatch(worker, /caches\.|CacheStorage|cache\.addAll/, "no Cache Storage use");
  assert.match(worker, /addEventListener\("notificationclick"/);
});

/* ============================================================
 *   Android packaging
 * ============================================================ */

test("build-www follows the manifest's icons, which no index.html attribute references", () => {
  const script = fs.readFileSync("scripts/build-www.js", "utf8");
  assert.match(script, /function manifestIconReferences\(/);
  assert.match(script, /\.endsWith\("\.webmanifest"\)/);
  const { buildWww, OUT } = require("./scripts/build-www.js");
  const { files } = buildWww();
  for (const expected of ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "install-hint.js"]){
    assert.ok(files.includes(expected), `${expected} should be packaged for Android`);
    assert.ok(fs.existsSync(path.join(OUT, expected)), `${expected} should exist in www/`);
  }
  // The manifest that ships must not point at icons that were left behind.
  const shipped = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.webmanifest"), "utf8"));
  for (const icon of shipped.icons){
    assert.ok(fs.existsSync(path.join(OUT, icon.src.replace(/^\//, ""))), `www/ is missing ${icon.src}`);
  }
});
