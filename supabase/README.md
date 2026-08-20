# RT Sync database interface

## Applying migrations

The project database tracks applied migrations in
`supabase_migrations.schema_migrations`, so `supabase db push` is the way to
apply anything new: it reads that ledger, applies only the files missing from
it, and records what it ran.

The ledger was baselined on 2026-08-20 against the versions in
`migrations/`. Every file up to and including `202608160001` is recorded as
applied. The one deliberate exception is
[`migrations/202608150004_receiver_weight_profile_gallons.sql`](migrations/202608150004_receiver_weight_profile_gallons.sql),
which is optional server-side hardening and is left unrecorded on purpose -
see its own header. `db push` will apply it, which is fine whenever that is
wanted.

Before the baseline there was no ledger at all and migrations were applied by
hand in the SQL Editor, which is how `202608150003` went unapplied for five
days while the repository and its tests implied otherwise. The per-section
notes below still describe what each migration does and the order it belongs
in; they are no longer a manual checklist to work through.

The authoritative schema is [`migrations/202607310001_line_sync.sql`](migrations/202607310001_line_sync.sql).

If the initial migration was applied before the link-code qualification fix, also apply [`migrations/202607310002_fix_link_code_generation.sql`](migrations/202607310002_fix_link_code_generation.sql).

If `join_workspace` reports an ambiguous `workspace_id`, apply [`migrations/202607310003_fix_join_workspace.sql`](migrations/202607310003_fix_join_workspace.sql).

## RT Sync revision-conflict protection

Apply [`migrations/202608040001_active_job_noop_guard.sql`](migrations/202608040001_active_job_noop_guard.sql), [`migrations/202608050001_regrant_update_active_job.sql`](migrations/202608050001_regrant_update_active_job.sql), and [`migrations/202608150001_active_job_stale_noop_guard.sql`](migrations/202608150001_active_job_stale_noop_guard.sql) in that order after the initial line-sync migration. The last migration makes an upload that already equals the shared active job a read-only success even when its cached revision is stale; differing payloads retain normal optimistic-concurrency conflicts.

## Workspace Configurations (Phase 2 database contract)

After the line-sync migration and its two fixes above, run [`migrations/202608020003_workspace_configurations.sql`](migrations/202608020003_workspace_configurations.sql) once. This additive migration creates the long-term `public.workspace_configurations` store; it does not modify the legacy `saved_setups` table or its RPCs.

The single table holds two document types with separate name namespaces: `receiver_weight_profile` and `recipe`. Names are trimmed, internal whitespace is collapsed, and case-insensitively normalized on the server; `(workspace_id, configuration_type, normalized_name)` is unique, so duplicate names are rejected rather than overwritten. Documents use schema version `1` only, JSON-object payloads up to 128 KiB, and are validated against their respective narrow payload boundary.

Receiver Weight Profiles contain physical layout identity and receiver weights only. Recipes contain line/layer percentages and hopper resin assignments/percentages only. Recipe `favorite` is document metadata, never payload data; profiles are always non-favorites. Unknown or inactive resin codes remain valid recipe strings.

RLS permits authenticated workspace members (including the app's authenticated anonymous users) to read only their own workspace's configurations. Browser roles have no direct write privilege. The security-definer RPCs, granted only to `authenticated`, check authentication and existing workspace membership, derive names and audit IDs server-side, and implement simple last-write-wins operations:

- `create_workspace_configuration(uuid, uuid, text, text, integer, jsonb, boolean)`
- `update_workspace_configuration(uuid, uuid, integer, jsonb)`
- `rename_workspace_configuration(uuid, uuid, text)`
- `duplicate_workspace_configuration(uuid, uuid, text)`
- `delete_workspace_configuration(uuid, uuid)` — hard-deletes only the selected reusable document
- `set_workspace_configuration_favorite(uuid, uuid, boolean)`

Configurations are intentionally not added to the Realtime publication and have no offline mutation queue. Never use a Supabase service-role key in browser code. A later service/UI phase will call these RPCs; the current app and its legacy local/saved-setup workflow remain unchanged.

## Resin catalog

Run [`migrations/202608020001_create_resins.sql`](migrations/202608020001_create_resins.sql) first, then run [`seeds/202608020001_resins.sql`](seeds/202608020001_resins.sql). The migration creates `public.resins`; the seed adds the 135 resin records currently baked into the application. Run each file once in the Supabase SQL Editor, in that order.

`resins` has a UUID primary key; `resin_code`; nullable `density_g_cm3` and `bulk_density_lb_ft3`; `is_active`; and `created_at`/`updated_at` timestamps. Resin codes are uniquely indexed after case and edge-whitespace normalization, density must be positive when present, and active code lookups have a partial index. An update trigger maintains `updated_at`.

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

## Admin Workspace Recovery

Every RT Sync user is a Supabase **anonymous** Auth identity. If a line computer's browser storage is cleared, that identity is unreachable forever — the browser signs in as a brand-new anonymous user on next load. Nothing server-side is lost (the workspace, its `active_jobs` row, `saved_setups`, and `workspace_configurations` are untouched), but the old `line_workspace_members` row now points at an identity nobody can sign back into, so the reset device can no longer read or write that workspace unless another surviving member generates a join link code for it.

Run [`migrations/202608030001_admin_workspace_recovery.sql`](migrations/202608030001_admin_workspace_recovery.sql) after the resin admin migration above. It is additive: no existing table, policy, or RPC is altered.

Recovery flow: an administrator signs in through the existing **Admin Login** (email/password, `public.admin_users`), opens **Workspace Management**, selects the workspace (e.g. "Line 8"), and chooses **Add This Device**. This attaches the browser's *current* anonymous RT Sync identity and device ID to that workspace as an ordinary `member` row. The **old, orphaned identity is never restored and is not deleted** — recovery only ever adds a new membership row for the current identity. Ownership is never transferred by recovery; if the row already exists, the RPC returns a harmless already-member result. After recovery succeeds, the app reconnects through the existing RT Sync client APIs (`loadWorkspaces` → `selectWorkspace` → refresh Workspace Configurations) — no page reload, and the admin session is never swapped for the anonymous one.

Authorization reuses `public.is_resin_admin()` exactly as resin administration does; there is no separate admin concept for recovery. A new `private.assert_admin()` helper (mirrors `private.assert_authenticated()`) is the single entry check for every new RPC below. The target identity is verified as a real, currently-anonymous Supabase Auth user (`auth.users.is_anonymous`) before it can be attached to a workspace — a browser cannot pass an arbitrary or non-anonymous UUID and have it accepted.

New `public` RPCs, granted only to `authenticated`, `SECURITY DEFINER`, `set search_path = ''`:

- `admin_list_line_workspaces(uuid)` — summary rows only (name, created/last-activity timestamps, member/recipe/weight-profile counts, whether the passed-in identity is already a member). Never returns join-code digests, active-job payloads, recipe payloads, or workspace secrets.
- `admin_get_workspace_details(uuid)` — the member list for one workspace (device label, role, timestamps) backing the optional diagnostic disclosure and member removal.
- `admin_add_device_to_workspace(uuid, uuid, uuid, text)` — the recovery action itself. Idempotent (`on conflict … do update` on the existing `(workspace_id, user_id)` primary key, matching `join_workspace`'s pattern), always inserts role `'member'`, never rewrites `role` on conflict, never deletes any other row, and never touches `active_jobs`/`saved_setups`/`workspace_configurations`. `device_id` lives in the browser's own `PolynSyncStorage` localStorage key, separate from the RT Sync Auth session, so it routinely survives whatever reset invalidated the anonymous identity — the *normal* recovery case is therefore a `device_id` collision against this same workspace's own previous, orphaned membership row, not a different device. On that specific collision (same workspace, same `device_id`, different `user_id`) the stale row is kept — its `role`, label, and timestamps untouched — but its `device_id` is regenerated so the real one is freed for the recovered identity. `device_already_in_use` is only ever returned if a second, genuinely unresolvable collision remains after that.
- `admin_remove_workspace_member(uuid, uuid)` — optional stale-membership cleanup, gated the same way the existing owner-only `remove_workspace_member` already is (refuses to remove an `owner` row, so it can never strand a workspace).
- `admin_transfer_workspace_ownership(uuid, uuid)` — a **separate, deliberate** action from `admin_add_device_to_workspace`, for the specific case where the device that was lost was the workspace's *owner*. Each line's workstation is typically the device that created its workspace, so it holds the `owner` role, and an owner's lost identity leaves nobody able to call the existing owner-gated RPCs (`transfer_workspace_ownership`, `remove_workspace_member`, `delete_workspace`) at all. This RPC requires the new owner to already be an ordinary member (call `admin_add_device_to_workspace` first), demotes the previous `owner` row to `member` (it is not deleted — same "don't destroy the old membership" rule as recovery itself), and promotes the target. It is idempotent (a no-op, no audit row, if the target is already owner). The database cannot verify the previous owner's device is actually gone rather than temporarily offline, so this is never automatic — the app only offers it as an explicit, separately-confirmed button once the device is already a recovered member, and the confirmation text says so plainly.

A small `private.workspace_recovery_audit` table (workspace, admin, target identity, device, action, timestamp — no payload or secret data) records every `add_device`/`remove_member` call for later review; it has no client grants and is read only from the Supabase SQL editor. `admin_rename_workspace` was deliberately not added: once a device is recovered it has ordinary membership and can use the existing member-gated `rename_workspace` RPC directly.

**Manual steps to enable recovery for an admin:** none beyond the existing resin-admin provisioning above — any user already in `public.admin_users` can use Workspace Management immediately once the migration is applied.

**To test safely:** in a private/incognito browser profile, *create* a test workspace (so that profile is its owner), then clear that profile's site data (or just open a fresh private window) to simulate a reset device. Sign into **Admin Login** in a normal window, open **Workspace Management**, and confirm the reset profile's workspace regains access after **Add This Device** — without needing the original device or a new join code. To exercise ownership recovery too, confirm **Reassign Ownership to This Device** stays disabled until the device is a member, then use it and confirm the original (now orphaned) owner row is demoted to `member`, not deleted, and that `generate_link_code` still works immediately after — since ordinary membership, not ownership, is all that's required to hand out join codes to other devices on the line.

Never place a Supabase service-role key in browser code; Workspace Management uses the same publishable-key admin client as Resin Database.
