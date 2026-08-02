# RT Sync database interface

The authoritative schema is [`migrations/202607310001_line_sync.sql`](migrations/202607310001_line_sync.sql).

If the initial migration was applied before the link-code qualification fix, also apply [`migrations/202607310002_fix_link_code_generation.sql`](migrations/202607310002_fix_link_code_generation.sql).

If `join_workspace` reports an ambiguous `workspace_id`, apply [`migrations/202607310003_fix_join_workspace.sql`](migrations/202607310003_fix_join_workspace.sql).

## Resin catalog

Run [`migrations/202608020001_create_resins.sql`](migrations/202608020001_create_resins.sql) first, then run [`seeds/202608020001_resins.sql`](seeds/202608020001_resins.sql). The migration creates `public.resins`; the seed adds the 135 resin records currently baked into the application. Run each file once in the Supabase SQL Editor, in that order.

`resins` has a UUID primary key; `resin_code`; nullable `display_description`, `density_g_cm3`, and `information_description`; `is_active`; and `created_at`/`updated_at` timestamps. Resin codes are uniquely indexed after case and edge-whitespace normalization, density must be positive when present, and active code lookups have a partial index. An update trigger maintains `updated_at`.

RLS is enabled. Both `anon` and `authenticated` roles can select only records where `is_active` is true. No client insert, update, or delete policy exists, so anonymous and authenticated clients cannot mutate the catalog.

## Resin administration

After the catalog migration, run [`migrations/202608020002_resin_admin.sql`](migrations/202608020002_resin_admin.sql). It creates `public.admin_users(user_id, created_at)`, where `user_id` references `auth.users`, and adds a security-definer `public.is_resin_admin()` check used by `resins` RLS policies.

To provision an administrator: create an email/password user in **Authentication → Users** in Supabase (do not expose public registration in the app), copy its UUID, then run `insert into public.admin_users (user_id) values ('USER-UUID-HERE');` in the SQL Editor. Sign into the app through **Admin Login**; a verified user sees **Resin Database**. An authenticated user absent from `admin_users` is signed out of the separate admin session and cannot read inactive rows or mutate records.

`anon` and normal authenticated users retain active-only reads. Verified admins can read all resins and insert/update them; no client delete policy or delete privilege is granted. The browser uses only the publishable key and a separately persisted admin auth session. Never put a Supabase service-role key in client code.

Public tables:

- `line_workspaces`: shared line identity, audit creator, workspace revision, and a globally unique creator-bound operation ID for idempotent creation retries.
- `line_workspace_members`: `(workspace_id, user_id)` membership with `owner` or `member` role. A user may belong to multiple workspaces.
- `active_jobs`: one full active-job snapshot per workspace with optimistic revision and operation ID.
- `saved_setups`: revisioned, soft-deleted Saved Line Settings using the existing Polyn payload format.
- `resins`: shared, read-only-to-clients resin catalog; inactive records are hidden from app users.

Link-code secrets, code digests, and attempt limits are in the inaccessible `private` schema. Plain linking codes are returned once and are never stored remotely.

Public RPCs granted only to `authenticated` (including authenticated anonymous users):

- `create_workspace(text, uuid, text, jsonb, uuid)`
- `rename_workspace(uuid, text, bigint)`
- `generate_link_code(uuid)`
- `join_workspace(text, uuid, text)`
- `update_active_job(uuid, jsonb, bigint, uuid)`
- `create_saved_setup(uuid, uuid, text, jsonb, uuid)`
- `update_saved_setup(uuid, uuid, jsonb, bigint, uuid)`
- `rename_saved_setup(uuid, uuid, text, bigint, uuid)`
- `delete_saved_setup(uuid, uuid, bigint, uuid)`
- `transfer_workspace_ownership(uuid, uuid)`
- `update_device_label(uuid, text)`
- `leave_workspace(uuid)`
- `remove_workspace_member(uuid, uuid)`
- `delete_workspace(uuid, bigint)`

RLS grants members read access only inside their workspaces. A regular member sees only its own membership row; an owner sees the workspace's linked devices. All writes go through the security-definer RPCs, which check authentication, membership/ownership, payload constraints, revisions, and idempotent operation IDs.

Active-job payloads must carry the currently supported version string (`0.17`). Saved Line Settings remain compatible with unversioned snapshots and the existing `0.14`–`0.17` snapshot versions.
