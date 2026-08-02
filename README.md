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

## Resin administration

The Admin Login uses a dedicated, persisted email/password Supabase client whose auth storage key is separate from RT Sync’s anonymous session. Database authorization comes exclusively from `public.admin_users` and `resins` RLS policies; hiding the editor is not the authorization mechanism. Successful editor writes refresh `PolynResinCatalog` without reloading the page, so active recipe and lookup results update on subsequent interactions. See [the Supabase setup instructions](supabase/README.md#resin-administration); never add a service-role key to browser code.

## Tests

Run the browser-independent test suite with:

```sh
node --test *.test.js
```
