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
| Element picker | `preview-agent.js` is injected into the iframe after load. While active, a transparent catcher layer intercepts all pointer input so clicks never reach the app. If the clicked element has no authored colour rule of its own (e.g. a bare text `<span>`), the trace walks up to the nearest ancestor that does and traces that — flagged in the panel ("Clicked … has no authored colour rules of its own. Showing … N levels up."), never silently. |
| Cascade / token tracing | `css-trace.js` (also injected into the iframe) fetches and line-parses every stylesheet the preview loads, resolves the winning rule for text colour / background / border / SVG fill+stroke on the picked element, and follows any `var()` chain to its terminal value and source location. It classifies each property as **token-driven**, **theme-specific override**, or **hardcoded**. The computed value is still shown alongside — what it looks like vs. why. |
| Impact / token → used-by | The **Impact** tab (or clicking a token name in the **Tokens** tab) takes a token and, from the same parsed index, lists everywhere it is consumed in the current theme's rendering: **direct consumers** (a rule with `… : var(--token)`) and **via component token** (a component token that itself resolves to it, e.g. `--btnstyle-accent → --recipe-pill-accent → --focus-border`). Each entry shows the declaration, `file:line`, media, and how many matching elements are visible on screen right now; a "Highlight on screen" button boxes them in the preview. Read-only — it never enters edit mode. Component-token branches that reference the target but do **not** currently resolve through it (blocked by a palette override, or the token is set per-element) are listed separately with the reason. |

The picker result panel shows, per property: computed value, the winning selector, its `file:line`, the full declaration, and — for `var()` — every hop of the token chain (`var(--x) → value @ file:line`), including any base definition a palette block overrides. If nothing authored matches a property it says so (inherited / UA default) rather than guessing.

### Token classification

- **token-driven** — the winning declaration is `var(--token)` and `--token` resolves through the active theme's palette block.
- **theme-specific override** — either a hardcoded literal in a `[data-theme="…"]`-scoped rule, or a component token (`--btnstyle-*`, …) whose base `var()` definition is redefined to a literal inside the palette block. The trace names both the base and the override.
- **hardcoded** — a literal value in a rule with no theme scoping; no token involved.

## Files

- `server.js` — static server + `/__theme-lab/api/{themes,save}`
- `index.html`, `theme-lab.css`, `theme-lab.js` — the editor UI
- `theme-parser.js` — `theme.css` block parser + conservative rewriter (unit-tested by `../../theme-lab.test.js`)
- `preview-agent.js` — injected into the preview iframe: element picker + trace dispatch
- `css-trace.js` — injected into the preview iframe: stylesheet line-parser, specificity, cascade resolution, `var()` chain resolution (`trace`), and the reverse token → consumer map (`buildRefMap` / `impact`). Pure helpers unit-tested by `../../theme-lab-trace.test.js`
- `backups/` — auto-created, git-ignored `theme.css` backups from Save
