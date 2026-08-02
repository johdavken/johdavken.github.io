# Polyn

Resin.Tools is a static, browser-based production utility. Browser `localStorage` is always the immediate working state; optional Supabase-backed RT Sync adds remote persistence and live updates without making the application dependent on a network connection.

## Optional RT Sync setup

1. Create a Supabase project and enable anonymous sign-ins under Authentication.
2. Run [`supabase/migrations/202607310001_line_sync.sql`](supabase/migrations/202607310001_line_sync.sql) in the Supabase SQL editor or through the Supabase CLI.
3. Set the public project URL and publishable key in [`supabase-config.js`](supabase-config.js). These values are intentionally public client configuration. Never place a service-role or secret key in this repository.
4. Deploy the static files normally. If Supabase, authentication, or the network is unavailable, Polyn continues in local-only mode.

The migration creates private workspace membership, revision-checked active jobs, revision-checked Saved Line Settings, temporary four-character linking codes stored only as keyed digests, RLS policies, and the public RPC interface used by the browser client.

## RT Sync behavior

- **Disconnect on this device** stops synchronization locally and preserves membership.
- **Leave RT Sync** removes the current anonymous browser identity from the line. An owner must transfer ownership first.
- **Remove linked device** lets an owner remove another member.
- **Delete line workspace** permanently deletes the shared line and is owner-only.

Each browser has an anonymous Supabase identity and a separate local device ID. One identity may join multiple line workspaces, and the selected line is stored locally. The current active job and Saved Line Settings use an on-device outbox when offline. Local edits are saved before upload, and reconnecting retries pending work. Conflict/replacement backups are retained locally in a bounded history.

No CAPTCHA is required in the initial version. Link-code generation, hashing, expiry, and attempt limiting are isolated in the database design so additional abuse protection can be introduced later without replacing the client data model.

## Resin catalog service

[`resin-catalog-service.js`](resin-catalog-service.js) provides the UI-independent `PolynResinCatalog` API: `getResins()`, `getResinByCode(code)`, `refreshResins()`, `getCachedResins()`, `clearResinCache()`, and `subscribe(listener)`. `getResins()` returns immediately, prioritizing a valid local cache and then the unchanged hard-coded catalog in [`resin-data.js`](resin-data.js), while refreshing Supabase in the background. `refreshResins()` returns `{ loaded, resins, reason? }` and never discards a valid cache when Supabase is unavailable or returns invalid data.

The browser cache key is `polyn.resinCatalog.v1`. Its versioned JSON envelope is `{ version: 1, cachedAt, resins }`; it contains only normalized public resin records, never Supabase configuration or credentials. Invalid JSON, an incompatible version, or invalid catalog rows are ignored safely.

The Recipe Panel and Resin Lookup call `getResins()` for an immediate catalog and use `subscribe()` to adopt a successful background refresh without polling. Future resin-facing UI should use this same service rather than reading fallback data directly.

## Resin UI data flow

```text
Supabase
  ↓
PolynResinCatalog
  ↓
Recipe Panel / Resin Lookup
```

Both resin-facing UI paths now consume the same normalized catalog records from `PolynResinCatalog`. The Recipe autocomplete updates its in-memory name list after a successful background refresh; Resin Lookup uses the same current records for exact matches and suggestions. Existing hard-coded data remains the service’s offline fallback.

## Workspace configuration payload helpers

[`workspace-configuration-payloads.js`](workspace-configuration-payloads.js) exposes `PolynWorkspaceConfigurationPayloads`, a UI-independent boundary for future Workspace Configurations work. Version-1 payloads always include `schema_version: 1`; unsupported versions and malformed payloads are rejected with structured validation results before application.

- A Receiver Weight Profile contains only line/layout identity, hopper naming mode, and six receiver weights per layer. Applying one is atomic, requires the current physical layout to match, and changes only `hopper.weight`.
- A Recipe contains only line type, naming mode, layer percentages, and each hopper's resin name/code and blend percentage. Applying one atomically updates only recipe fields, preserves receiver weights and runtime flags, and recalculates Hopper 1 from Hoppers 2–6 using the current app rule. The payload retains Hopper 1's resin and stored percentage, but its percentage must agree with that remainder and is recalculated on application. A blank resin is `null` in the payload; unrecognized or inactive codes remain strings.

The helpers intentionally coexist with the legacy full snapshot/save system and are not yet wired to production UI, storage, cloud services, or synchronization. Later database/service/UI phases should create and validate a payload with these helpers, apply it after their own user-flow checks, then orchestrate rendering and persistence outside the module. Favorite status belongs to the future saved-document record, not a recipe payload.

## Workspace configuration service

[`workspace-configurations-service.js`](workspace-configurations-service.js) provides the UI-independent `PolynWorkspaceConfigurations` service for the Phase 2 `workspace_configurations` database contract. Its API is `getCached`, `listCached`, `listRecipes`, `listReceiverWeightProfiles`, `refresh`, `create`, `update`, `rename`, `duplicate`, `delete`, `setFavorite`, `clearWorkspaceCache`, and `subscribe`.

Documents are normalized to `{ id, workspaceId, type, name, normalizedName, schemaVersion, payload, favorite, createdBy, updatedBy, createdAt, updatedAt }`. The service uses the existing authenticated RT Sync client only through `lineSync.getWorkspaceConfigurationTransport()`; it never creates another session or exposes credentials. Each workspace has an isolated `polyn.workspaceConfigurations.v1::<workspace-id>` cache envelope containing version, workspace ID, timestamp, and separate profile/recipe arrays.

Cached reads are safe offline, but writes are never queued. Cloud refreshes and all mutations use the Phase 2 RPCs, preserve the previous valid cache on failure, and notify subscribers only after a successful cache replacement. Creates and updates validate a detached payload through the Phase 1 helpers before calling Supabase. This is last-write-wins, has no Realtime subscription or polling. Never use a service-role key in browser code.

## Shared workspace configuration viewer

The existing **Line Configurations** panel now shows read-only **Receiver Weight Profiles** and **Recipes** for the currently connected RT Sync workspace, above the unchanged local configuration controls. It renders that workspace's cached items immediately, performs one refresh after a workspace change or panel initialization, and offers a manual refresh. Cached items remain visible with a concise stale/offline message if refresh fails; no workspace means no cloud items are shown.

Every cloud load opens a confirmation dialog. Recipe loads use the Phase 1 recipe helper and may change line type, naming mode, layer percentages, and hopper assignments/percentages while preserving weights, tracking, pump-off state, offsets, runtime state, workspace identity, and preferences. Weight Profile loads use the corresponding Phase 1 helper and change only receiver weights; incompatible physical layouts are rejected without partial application. A successful load renders/calculates, persists ordinary local session state, and emits one normal RT Sync active-job mutation. This phase is read/load-only: it has no cloud editing controls, Realtime, polling, offline writes, or changes to legacy local configurations.

Shared Workspace Configurations can now also be managed from this same panel. **Save Current Weights** creates a narrow Receiver Weight Profile; **Save Current Recipe** creates a narrow Recipe. Existing shared items can be updated from the current app state, renamed, duplicated, or deleted; Recipes alone can be favorited, which keeps them first in their existing alphabetical groups. Duplicate names present an explicit Cancel, Update Existing, or Choose Another Name decision. All changes use the Phase 3 service and preserve the current workspace/application state. The local Save/Load configuration system remains separate and unchanged; this adds no Realtime, polling, or offline write queue.

## Resin administration

The Admin Login uses a dedicated, persisted email/password Supabase client whose auth storage key is separate from RT Sync’s anonymous session. Database authorization comes exclusively from `public.admin_users` and `resins` RLS policies; hiding the editor is not the authorization mechanism. Successful editor writes refresh `PolynResinCatalog` without reloading the page, so active recipe and lookup results update on subsequent interactions. See [the Supabase setup instructions](supabase/README.md#resin-administration); never add a service-role key to browser code.

## Tests

Run the browser-independent test suite with:

```sh
node --test *.test.js
```
