# Resolving an RT Sync revision-conflict storm

Use this runbook when Supabase Postgres logs show `revision_conflict` repeating rapidly (for example, thousands of `update_active_job` conflicts per minute). A few isolated conflicts are normal when two devices make different edits; a sustained, machine-speed stream is not.

## 1. Confirm and contain

In the Supabase Logs Explorer, query the last 15 minutes:

```sql
select toStartOfMinute(timestamp) as minute, count() as conflicts
from logs
where source = 'postgres_logs'
  and event_message = 'revision_conflict'
group by minute
order by minute;
```

If the rate is high and continuous, do not keep pressing Retry on the affected device.

## 2. Ensure the normal server guard is installed

Run [`../supabase/migrations/202608150001_active_job_stale_noop_guard.sql`](../supabase/migrations/202608150001_active_job_stale_noop_guard.sql) if it has not already been applied. It makes an upload that already matches the shared active-job payload succeed without rewriting the row, even when its cached revision is stale.

This migration does **not** suppress real conflicts where the pending payload differs from the shared payload.

## 3. Identify the offending device

Run [`../supabase/migrations/202608150002_log_active_job_conflict_actor.sql`](../supabase/migrations/202608150002_log_active_job_conflict_actor.sql). It temporarily adds a Postgres `LOG` line immediately before each real active-job conflict.

Query the diagnostic entries:

```sql
select timestamp, event_message
from logs
where source = 'postgres_logs'
  and event_message ilike 'active_job_revision_conflict%'
order by timestamp desc
limit 50;
```

The log line contains `user_id` and `workspace_id`. Map that user to a device:

```sql
select w.name, m.user_id, m.device_id, m.device_label, m.role,
       m.joined_at, m.last_seen_at
from public.line_workspace_members m
join public.line_workspaces w on w.id = m.workspace_id
where m.user_id = 'USER_ID_FROM_LOG'
  and m.workspace_id = 'WORKSPACE_ID_FROM_LOG';
```

## 4. Stop the storm

Remove only the identified member from only the identified workspace:

```sql
delete from public.line_workspace_members
where workspace_id = 'WORKSPACE_ID_FROM_LOG'
  and user_id = 'USER_ID_FROM_LOG';
```

This does not delete the shared active job or any other device. The removed device keeps its local data, but its next sync call is denied and should stop retrying.

Verify containment:

```sql
select event_message, max(timestamp) as last_seen, count() as events
from logs
where source = 'postgres_logs'
  and event_message in ('revision_conflict', 'workspace_access_denied')
group by event_message
order by last_seen desc;
```

Expect the conflict stream to stop, usually followed by one `workspace_access_denied` from the removed client.

## 5. Recover the device safely

Before rejoining the device:

1. Update/reinstall the Android app, or clear the site/app cache and reload the web app.
2. Deploy the current site so its `cloud-sync.js` cache key is current.
3. Rejoin the device to the workspace with a new link code.
4. Monitor Postgres logs for at least 5–10 minutes before treating the incident as closed.

Do not reconnect the same stale session before it has loaded the current client code.

## 6. Remove temporary diagnostic logging

After the incident is resolved, run [`../supabase/migrations/202608150003_remove_active_job_conflict_actor_logging.sql`](../supabase/migrations/202608150003_remove_active_job_conflict_actor_logging.sql).

This restores the normal function while preserving the stale-identical-payload guard from `202608150001`. Leaving the diagnostic migration installed is safe for correctness, but it adds one Postgres log entry per conflict and can substantially increase log volume during another storm.

## Migration summary

| Migration | When to run | Purpose |
| --- | --- | --- |
| `202608150001_active_job_stale_noop_guard.sql` | Once, before or during any incident | Settles stale uploads whose payload already matches the shared active job. |
| `202608150002_log_active_job_conflict_actor.sql` | Temporarily during an active storm | Logs the authenticated user and workspace for each real conflict. |
| `202608150003_remove_active_job_conflict_actor_logging.sql` | After identification/containment | Removes the temporary per-conflict actor log. |
