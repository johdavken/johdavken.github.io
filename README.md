# Resin.tools — Slate

[Resin.tools](https://resin.tools) is a dependency-light web app for blown film operators: it plans resin hopper run-downs, manages recipe setup and receiver hopper weights, and keeps an active job in step across every device on a line.

**Slate** is its current interface. It is the default view on desktops and floor tablets, and it runs as a presentation layer over the same application runtime as the original floor UI — one app, one Supabase connection, one RT Sync session.

## Which view you get

All views are the same document ([`index.html`](index.html)); the query string picks the presentation.

| URL | View |
| --- | --- |
| `?view=slate` | **Slate** |
| `?view=legacy` | The original floor UI |
| `?view=station` | Station, the experimental desktop console |
| _(none)_ | The device's saved choice; otherwise Slate on a desktop window ≥ 1100 px or a tablet-sized touch screen, and the floor UI on phones |

[`slate-host.js`](slate-host.js) makes that decision and loads Slate's styles and scripts only when Slate is the view, so the floor UI never carries Slate's code. Phones can opt in from the floor UI's **Slate (Beta)** link and then Slate's Settings.

Slate draws for three tiers ([`slate/slate-tier.js`](slate/slate-tier.js)): mouse desktop, touch tablet (both orientations, gloved operators) and phone. The design notes and implementation logs are in [`slate/TABLET-PLAN.md`](slate/TABLET-PLAN.md) and [`slate/MOBILE-PLAN.md`](slate/MOBILE-PLAN.md).

## What Slate does

- **Recipe** — the line's layers and hoppers as a draft: resin search from the shared catalog, blend percentages with Hopper 1 derived from Hoppers 2–6, bulk edit, drag-and-drop rearrangement with Undo/Cancel/Done, and Rows or Columns layouts.
- **Weights** — receiver hopper weights by physical position, kept separate from the recipe.
- **Recipe Book** — shared Recipes and Receiver Weight Profiles for the workspace: load (with a preview of what will and will not change), save, update, rename, duplicate, favorite, delete.
- **Timeline** — the run-down to the next changeover, with tracking, pump-off, and correction of a hopper that ran out early.
- **Resin Balance** — resin totals, with production and scrap entry.
- **Tools** — Formulas (pounds per 1,000 ft, unit conversions, product density, working back from a weighed set), Winding Tension, Work Alarm, changeover and line-rate estimates.
- **RT Sync** — join a line by code or QR, see linked devices, resolve conflicts in Slate's own dialog.
- **Admin** (verified administrators only) — Workspaces, Line Configuration, Resin Database.
- **Settings** — theme families (Catppuccin, Everforest, Gruvbox, Retro '82, Ristretto, Rosé Pine, Solitude, Tokyo Night, Yaru), each with a light and dark half; backgrounds; layouts; view and input preferences.

## How it fits together

```text
app.js  (the application: state, calculations, RT Sync, storage)
   │  publishes to
   ▼
station-*-bridge.js  (state, command, connection, recipes, weight profiles, admin)
   │  read by
   ▼
slate/slate.js  →  slate/slate-*.js  (Slate's sections and tools)
```

- **The application is the only writer.** Slate subscribes to the bridges as an ordinary consumer and changes state only by dispatching commands through the command bridge; it never reaches into the floor UI's DOM.
- **Slate's modules** live in [`slate/`](slate/), one file per section or tool, booted by [`slate/slate.js`](slate/slate.js). Styles and theme files are in [`slate/styles/`](slate/styles/).
- **Standalone harness.** [`slate/slate.html`](slate/slate.html) loads Slate without `app.js` and falls back to a demo line ([`slate/slate-demo.js`](slate/slate-demo.js)) — useful for layout work, not for live data.
- **Shared services** are used unchanged from the rest of the app: `PolynResinCatalog` ([`resin-catalog-service.js`](resin-catalog-service.js)), `PolynWorkspaceConfigurations` ([`workspace-configurations-service.js`](workspace-configurations-service.js)) and `PolynWorkspaceConfigurationPayloads` ([`workspace-configuration-payloads.js`](workspace-configuration-payloads.js)). The `Polyn` prefix on these globals and storage keys is historical and kept for compatibility.

## Data model in brief

- **Recipes** hold line type, naming mode, layer percentages, and each hopper's resin and blend percentage. Loading one never touches receiver weights or runtime state.
- **Receiver Weight Profiles** hold only physical hopper weights for a layout. Loading one changes only weights.
- **Runtime state** — tracking, pump-off, timeline, sync outbox, device identity — belongs to neither.
- Hopper 1's percentage is always `100 − (H2 … H6)`.

[`CLAUDE.md`](CLAUDE.md) is the full project guide and the source of truth for these rules.

## Backend (optional)

Browser `localStorage` is always the immediate working state. Supabase adds RT Sync, shared configurations, the resin catalog and admin tooling; without it the app runs local-only.

1. Create a Supabase project and enable anonymous sign-ins.
2. Apply [`supabase/migrations`](supabase/migrations) in filename order (`supabase db push`).
3. Set the project URL and **publishable** key in [`supabase-config.js`](supabase-config.js). Never put a service-role key in this repository.
4. Edge Functions live in [`supabase/functions`](supabase/functions) (`recipe-scan`, `rt-cloud`, `database-health`).

See [`supabase/README.md`](supabase/README.md) for the migration ledger, RT Sync RPCs, resin administration and admin-assisted workspace recovery.

## Running locally

```sh
npm run serve          # http://127.0.0.1:8080  (no-store static server, no build step)
```

Then open `http://127.0.0.1:8080/?view=slate`, or `slate/slate.html` for the demo harness.

The Android app is a Capacitor shell around the same files (`npm run sync:android`, see [`capacitor.config.json`](capacitor.config.json)); the GitHub Pages deployment does not use it.

## Tests

```sh
node --test tests/*.test.js
git diff --check
```

Tests live in [`tests/`](tests/) and run from the repo root; Slate's are the `slate-*.test.js` files. SQL behavior is covered by source-level contract tests (`*-schema.test.js`).
