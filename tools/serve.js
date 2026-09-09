"use strict";

/* Read-only static preview server for the real app, straight from the repo
 * root. No dependencies, no build step, writes nothing.
 *
 *   npm run serve            # http://127.0.0.1:8080
 *   npm run serve -- --port 9000
 *
 * WHY THIS EXISTS RATHER THAN `python3 -m http.server`:
 *
 * Every response is sent no-store. A plain static server sends Last-Modified,
 * the browser caches index.html, and a reload then re-requests the stylesheet
 * URL the CACHED html names - so bumping ?v= in index.html changes nothing and
 * you are measuring the old CSS while looking at new source. That has produced
 * confidently wrong readings more than once: a rule appearing not to apply, and
 * a change appearing to do nothing. no-store removes the failure mode instead
 * of asking anyone to remember the workaround.
 *
 * Binds to 127.0.0.1 only, serves GET/HEAD only, and refuses any path that
 * escapes the repo root.
 */

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function port(argv) {
  const i = argv.indexOf("--port");
  if (i !== -1 && argv[i + 1]) return Number(argv[i + 1]);
  if (process.env.RT_SERVE_PORT) return Number(process.env.RT_SERVE_PORT);
  return 8080;
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end("read-only server");
  }

  const url = new URL(req.url, "http://127.0.0.1");
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";

  const file = path.resolve(REPO_ROOT, "." + rel);
  // Never serve outside the repo, and never hand out local secrets.
  if (!file.startsWith(REPO_ROOT + path.sep) || /(^|\/)\.(git|env)/.test(rel)) {
    res.writeHead(403);
    return res.end("forbidden");
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("not found");
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      // The whole point. Never let a measurement read a stale file.
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(req.method === "HEAD" ? undefined : buf);
  });
});

const p = port(process.argv);
server.listen(p, "127.0.0.1", () => {
  process.stdout.write(`Resin.tools preview: http://127.0.0.1:${p}/  (no-store; Ctrl-C to stop)\n`);
});
