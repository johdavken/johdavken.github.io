# Line Sync database interface

The authoritative schema is [`migrations/202607310001_line_sync.sql`](migrations/202607310001_line_sync.sql).

Public tables:

- `line_workspaces`: shared line identity, audit creator, workspace revision, and a globally unique creator-bound operation ID for idempotent creation retries.
- `line_workspace_members`: `(workspace_id, user_id)` membership with `owner` or `member` role. A user may belong to multiple workspaces.
- `active_jobs`: one full active-job snapshot per workspace with optimistic revision and operation ID.
- `saved_setups`: revisioned, soft-deleted Saved Line Settings using the existing ResinIQ payload format.

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
