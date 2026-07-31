# ResinIQ

ResinIQ is a static, browser-based production utility. Browser `localStorage` is always the immediate working state; optional Supabase Line Sync adds remote persistence and live updates without making the application dependent on a network connection.

## Optional Line Sync setup

1. Create a Supabase project and enable anonymous sign-ins under Authentication.
2. Run [`supabase/migrations/202607310001_line_sync.sql`](supabase/migrations/202607310001_line_sync.sql) in the Supabase SQL editor or through the Supabase CLI.
3. Set the public project URL and publishable key in [`supabase-config.js`](supabase-config.js). These values are intentionally public client configuration. Never place a service-role or secret key in this repository.
4. Deploy the static files normally. If Supabase, authentication, or the network is unavailable, ResinIQ continues in local-only mode.

The migration creates private workspace membership, revision-checked active jobs, revision-checked Saved Line Settings, temporary four-character linking codes stored only as keyed digests, RLS policies, and the public RPC interface used by the browser client.

## Line Sync behavior

- **Disconnect on this device** stops synchronization locally and preserves membership.
- **Leave Line Sync** removes the current anonymous browser identity from the line. An owner must transfer ownership first.
- **Remove linked device** lets an owner remove another member.
- **Delete line workspace** permanently deletes the shared line and is owner-only.

Each browser has an anonymous Supabase identity and a separate local device ID. One identity may join multiple line workspaces, and the selected line is stored locally. The current active job and Saved Line Settings use an on-device outbox when offline. Local edits are saved before upload, and reconnecting retries pending work. Conflict/replacement backups are retained locally in a bounded history.

No CAPTCHA is required in the initial version. Link-code generation, hashing, expiry, and attempt limiting are isolated in the database design so additional abuse protection can be introduced later without replacing the client data model.

## Tests

Run the browser-independent test suite with:

```sh
node --test *.test.js
```
