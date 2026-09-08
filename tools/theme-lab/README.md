# Theme Lab (developer-only)

A local, web-based theme editor for resin.tools. It previews the **real** app
and lets you edit the **real** theme tokens from `theme.css` live, without a
reload and without touching source files until you explicitly export or save.

Not a production feature. Nothing here is referenced by `index.html`, bundled
into `www/` by `scripts/build-www.js`, or shipped in the Android/PWA build.

## Run

```
npm run theme-lab
```

Prints two URLs (default port `4178`, override with `--port` or `THEME_LAB_PORT`):

- **Editor** — `http://localhost:4178/__theme-lab/`
- **Live app** — `http://localhost:4178/` (the unmodified app, for comparison)

`Ctrl+C` to stop. No build step, no cleanup, no state left behind.

## How it works

| Concern | Approach |
| --- | --- |
| Serve the app | `server.js` is a zero-dependency static server for the repo root. The preview is the real `index.html` in an `<iframe>` at `/?themelab=1`, same origin as the editor. |
| Discover themes | `GET /__theme-lab/api/themes` parses `theme.css` for `:where(html, body)[data-theme="…"]{ … }` palette blocks (see `theme-parser.js`) and reads the human labels from the app's own `<select id="themeSel">`. Base `:root` defaults from `styles.css` are shown read-only as inherited values. |
| Switch preview theme | The editor sets `data-theme` directly on the iframe's `<html>` + `<body>`. It never calls the app's `applyTheme()` / theme `<select>`, so the user's stored preference and `localStorage` are untouched. A "lock" re-asserts the previewed theme if the app changes it while you navigate. |
| Live token edits | Held in an in-memory working set. Applied to the preview as inline custom properties on the iframe's `<html>` **and** `<body>` (the palette blocks target both, so an override on only `<html>` loses to `<body>`'s own declaration). Source files are never written. |
| Original vs current | Each token tracks its source value; changed tokens are highlighted, with per-token reset and reset-all. The **Changes** tab lists `old → new` and previews the rebuilt CSS block. |
| Export | **Copy CSS block** / **Download .css** produce the palette block with your values substituted. |
| Save to source | `POST /__theme-lab/api/save`. Two steps: a dry run returns a line-anchored diff for review, then an explicit confirm writes it. Only the changed `--token:` lines inside the one selected block are rewritten (indentation, trailing `;`, and trailing comments preserved); tokens not already in the block are appended just before its `}`. A timestamped backup of `theme.css` is written to `tools/theme-lab/backups/` (git-ignored) first. Never automatic. |
| Element picker | `preview-agent.js` is injected into the iframe after load. While active, a transparent catcher layer intercepts all pointer input so clicks never reach the app; it reports the hovered/clicked element's **computed** colours (v1). Full matched-rule / token-source tracing is Phase 2. |

## Files

- `server.js` — static server + `/__theme-lab/api/{themes,save}`
- `index.html`, `theme-lab.css`, `theme-lab.js` — the editor UI
- `theme-parser.js` — `theme.css` block parser + conservative rewriter (also unit-tested by `../../theme-lab.test.js`)
- `preview-agent.js` — injected into the preview iframe for element inspection
- `backups/` — auto-created, git-ignored `theme.css` backups from Save
