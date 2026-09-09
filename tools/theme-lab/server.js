"use strict";

/* ---------------------------------------------------------------------------
 * Theme Lab — local developer server
 *
 * Launch with:  npm run theme-lab       (see package.json "scripts")
 *          or:  node tools/theme-lab/server.js [--port 4178]
 *
 * What it does
 *   - Serves the REAL resin.tools web app straight from the repo root as
 *     static files, so the Theme Lab preview renders the actual project
 *     (Recipe, Timeline, Resin Totals, Station Console, dialogs, every
 *     responsive layout) rather than a mock.
 *   - Serves the Theme Lab UI under /__theme-lab/.
 *   - Exposes a tiny JSON API under /__theme-lab/api/ for reading the theme
 *     token architecture out of theme.css and (only on explicit confirmation)
 *     writing a conservative, line-level edit back to a single palette block.
 *
 * What it does NOT do
 *   - It is never imported by the app, never added to index.html, never
 *     copied into www/ by scripts/build-www.js, and has zero runtime effect
 *     on production. Stop the process and nothing needs cleaning up.
 *   - It holds no state. Theme edits live in the browser until you choose to
 *     export or save.
 * ------------------------------------------------------------------------- */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const url = require("node:url");

const {
  parseThemeCss,
  renderUpdatedBlock,
  applyChangesToCss,
} = require("./theme-parser.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TOOL_ROOT = __dirname;
const BACKUP_DIR = path.join(TOOL_ROOT, "backups");
const TOOL_PREFIX = "/__theme-lab";
const THEME_CSS = path.join(REPO_ROOT, "theme.css");
const INDEX_HTML = path.join(REPO_ROOT, "index.html");

/* The base stylesheet is a set of consecutive styles-*.css parts, linked in
 * cascade order by index.html. Theme Lab only reads it, to show the :root token
 * defaults a palette inherits, so it wants the same single view the test suite
 * uses - and derives the part list the same way, from index.html itself, so a
 * new part needs no change here. */
function readStylesParts(indexHtml) {
  const parts = [];
  const re = /<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g;
  let m;
  while ((m = re.exec(indexHtml))) {
    const file = m[1].split("?")[0];
    if (/^styles(-[a-z0-9-]+)?\.css$/.test(path.basename(file))) parts.push(file);
  }
  return parts;
}

function parsePort(argv) {
  const flagIdx = argv.indexOf("--port");
  if (flagIdx !== -1 && argv[flagIdx + 1]) return Number(argv[flagIdx + 1]);
  if (process.env.THEME_LAB_PORT) return Number(process.env.THEME_LAB_PORT);
  if (process.env.PORT) return Number(process.env.PORT);
  return 4178;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj, null, 2), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

async function readBody(req, limitBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/* ----------------------------- static files ----------------------------- */

async function serveStatic(req, res, pathname) {
  // Resolve within the repo root; reject traversal.
  const rel = decodeURIComponent(pathname.replace(/^\/+/, ""));
  const abs = path.resolve(REPO_ROOT, rel === "" ? "index.html" : rel);
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + path.sep)) {
    return send(res, 403, "Forbidden");
  }
  // Never serve the tool's own source through the app origin path; it has its
  // own prefix. Also keep node_modules / .git out of reach.
  const blocked = ["node_modules", ".git", "tools"];
  if (blocked.some((b) => rel === b || rel.startsWith(b + "/"))) {
    return send(res, 404, "Not found");
  }

  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return send(res, 404, `Not found: ${rel}`);
  }
  const file = stat.isDirectory() ? path.join(abs, "index.html") : abs;
  let data;
  try {
    data = await fsp.readFile(file);
  } catch {
    return send(res, 404, `Not found: ${rel}`);
  }
  const ext = path.extname(file).toLowerCase();
  send(res, 200, data, {
    "Content-Type": MIME[ext] || "application/octet-stream",
  });
}

async function serveToolFile(req, res, pathname) {
  const rel = decodeURIComponent(
    pathname.slice(TOOL_PREFIX.length).replace(/^\/+/, "")
  );
  const name = rel === "" ? "index.html" : rel;
  const abs = path.resolve(TOOL_ROOT, name);
  if (!abs.startsWith(TOOL_ROOT + path.sep)) return send(res, 403, "Forbidden");
  if (abs.startsWith(BACKUP_DIR)) return send(res, 404, "Not found");
  let data;
  try {
    data = await fsp.readFile(abs);
  } catch {
    return send(res, 404, `Not found: ${name}`);
  }
  const ext = path.extname(abs).toLowerCase();
  send(res, 200, data, { "Content-Type": MIME[ext] || "text/plain" });
}

/* -------------------------------- API ---------------------------------- */

// Theme names + human labels are taken from the app's own <select id="themeSel">
// so Theme Lab tracks the real theme list instead of a parallel one.
function readThemeSelectOptions(html) {
  const selMatch = html.match(/<select id="themeSel">([\s\S]*?)<\/select>/);
  if (!selMatch) return [];
  const out = [];
  const re = /<option value="([^"]+)"([^>]*)>([^<]+)<\/option>/g;
  let m;
  while ((m = re.exec(selMatch[1]))) {
    out.push({
      value: m[1],
      label: m[3].trim(),
      touchOnly: /data-touch-only-theme/.test(m[2]),
    });
  }
  return out;
}

// styles.css :root{} holds the base token defaults every theme inherits from.
// Parsed read-only so the editor can show an inherited value for a token a
// given palette does not itself declare.
function parseRootDefaults(css) {
  const start = css.indexOf(":root{");
  if (start === -1) return {};
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return {};
  const body = css.slice(open + 1, end);
  const out = {};
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[2].trim();
  return out;
}

async function apiThemes(req, res) {
  const [themeCss, indexHtml] = await Promise.all([
    fsp.readFile(THEME_CSS, "utf8"),
    fsp.readFile(INDEX_HTML, "utf8"),
  ]);
  const stylesCss = (
    await Promise.all(
      readStylesParts(indexHtml).map((part) =>
        fsp.readFile(path.join(REPO_ROOT, part), "utf8")
      )
    )
  ).join("");
  const parsed = parseThemeCss(themeCss);
  const themeCssLines = themeCss.split("\n");
  const rawOf = (block) =>
    themeCssLines.slice(block.openLine - 1, block.closeLine).join("\n");
  const byName = new Map();
  for (const t of parsed) {
    byName.set(t.name, t);
    for (const a of t.aliases) byName.set(a, t);
  }
  const options = readThemeSelectOptions(indexHtml);
  const rootDefaults = parseRootDefaults(stylesCss);

  // Selector list first (in app order), then any palette block in theme.css
  // that the selector does not expose (e.g. the base "dark"/"light" blocks).
  const seen = new Set();
  const themes = [];
  for (const opt of options) {
    if (opt.value === "system") continue; // resolves at runtime, no own block
    const block = byName.get(opt.value);
    if (!block) continue;
    seen.add(block.name);
    themes.push({
      name: block.name,
      label: opt.label,
      touchOnly: opt.touchOnly,
      inSelector: true,
      colorScheme: block.colorScheme,
      openLine: block.openLine,
      closeLine: block.closeLine,
      tokens: block.tokens,
      raw: rawOf(block),
    });
  }
  for (const block of parsed) {
    if (seen.has(block.name)) continue;
    themes.push({
      name: block.name,
      label: `${block.name} (not in selector)`,
      touchOnly: false,
      inSelector: false,
      colorScheme: block.colorScheme,
      openLine: block.openLine,
      closeLine: block.closeLine,
      tokens: block.tokens,
      raw: rawOf(block),
    });
  }

  sendJson(res, 200, {
    themeCssPath: "theme.css",
    generatedAt: new Date().toISOString(),
    rootDefaults,
    themes,
  });
}

// A precise, line-anchored diff built from the known edits (changed
// declaration lines + appended tokens) rather than a text LCS. The rewrite
// only ever touches these exact lines, so this shows exactly what Save does.
function targetedDiff(pathLabel, originalCss, preview) {
  const src = originalCss.split("\n");
  const out = [`--- a/${pathLabel}`, `+++ b/${pathLabel}`];
  for (const ch of preview.changedLines) {
    out.push(`@@ line ${ch.line} @@`);
    if (src[ch.line - 2] !== undefined) out.push(`  ${src[ch.line - 2]}`);
    out.push(`- ${ch.before}`);
    out.push(`+ ${ch.after}`);
    if (src[ch.line] !== undefined) out.push(`  ${src[ch.line]}`);
  }
  if (preview.newTokens.length) {
    out.push(`@@ appended before the block's closing brace @@`);
    for (const tok of preview.newTokens) {
      out.push(`+   ${tok}: ${String(preview.changes[tok]).trim()};`);
    }
  }
  if (!preview.changedLines.length && !preview.newTokens.length) {
    out.push("(no textual change — values already match)");
  }
  return out.join("\n");
}

async function apiSave(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: `Bad JSON: ${err.message}` });
  }
  const { theme, changes, confirm, dryRun } = payload || {};
  if (!theme || typeof theme !== "string") {
    return sendJson(res, 400, { ok: false, error: "Missing 'theme'." });
  }
  if (!changes || typeof changes !== "object" || !Object.keys(changes).length) {
    return sendJson(res, 400, { ok: false, error: "No 'changes' provided." });
  }
  for (const [k, v] of Object.entries(changes)) {
    if (!/^--[A-Za-z0-9_-]+$/.test(k)) {
      return sendJson(res, 400, { ok: false, error: `Invalid token name: ${k}` });
    }
    if (typeof v !== "string" || v.length > 400 || /[{};]/.test(v)) {
      return sendJson(res, 400, {
        ok: false,
        error: `Invalid value for ${k}: ${JSON.stringify(v)}`,
      });
    }
  }

  const original = await fsp.readFile(THEME_CSS, "utf8");
  let result;
  try {
    result = applyChangesToCss(original, theme, changes);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const preview = renderUpdatedBlock(original, theme, changes);
  preview.changes = changes;
  const diff = targetedDiff("theme.css", original, preview);

  if (!confirm || dryRun) {
    return sendJson(res, 200, {
      ok: true,
      applied: false,
      dryRun: true,
      theme,
      changedLines: preview.changedLines,
      newTokens: preview.newTokens,
      diff,
    });
  }

  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `theme.css.${stamp}.bak`);
  await fsp.writeFile(backupPath, original, "utf8");
  await fsp.writeFile(THEME_CSS, result.css, "utf8");

  sendJson(res, 200, {
    ok: true,
    applied: true,
    theme,
    backup: path.relative(REPO_ROOT, backupPath),
    changedLines: preview.changedLines,
    newTokens: preview.newTokens,
    diff,
  });
}

/* ------------------------------- router -------------------------------- */

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = url.parse(req.url);

    if (pathname === TOOL_PREFIX) {
      res.writeHead(302, { Location: TOOL_PREFIX + "/" });
      return res.end();
    }

    if (pathname === TOOL_PREFIX + "/api/themes" && req.method === "GET") {
      return await apiThemes(req, res);
    }
    if (pathname === TOOL_PREFIX + "/api/save" && req.method === "POST") {
      return await apiSave(req, res);
    }
    if (pathname.startsWith(TOOL_PREFIX + "/")) {
      return await serveToolFile(req, res, pathname);
    }

    return await serveStatic(req, res, pathname);
  } catch (err) {
    send(res, 500, `Theme Lab server error: ${err.stack || err}`);
  }
});

const port = parsePort(process.argv.slice(2));
server.listen(port, () => {
  const base = `http://localhost:${port}`;
  /* eslint-disable no-console */
  console.log("");
  console.log("  Theme Lab  (developer-only, not part of production)");
  console.log("  ────────────────────────────────────────────────────");
  console.log(`  Editor      ${base}${TOOL_PREFIX}/`);
  console.log(`  Live app    ${base}/`);
  console.log("");
  console.log("  Ctrl+C to stop. Nothing to clean up afterwards.");
  console.log("");
  /* eslint-enable no-console */
});
