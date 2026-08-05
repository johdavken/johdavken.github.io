begin;

-- Re-asserts EXECUTE on public.update_active_job for authenticated, which
-- the original grant in 202607310001_line_sync.sql already establishes.
-- Live logs on 2026-08-05 showed a sustained run of Postgres's own
-- "permission denied for function update_active_job" (42501) - distinct
-- from this function's own workspace_access_denied raise - meaning
-- `authenticated` had lost EXECUTE on it, causing every device's active-job
-- save to fail and retry continuously; this was a leading contributor to a
-- renewed Supabase CPU spike. The live grant was already restored by hand
-- via the SQL Editor; this migration only codifies that fix so a fresh
-- deployment (or anyone re-running migrations from scratch) can't
-- reintroduce it. Purely additive and idempotent - no schema or logic
-- change, no change to any other function's permissions.
--
-- How EXECUTE was lost is still unconfirmed: PostgreSQL's documented
-- behavior is that CREATE OR REPLACE FUNCTION preserves existing grants
-- when the signature is unchanged, which is what
-- 202608040001_active_job_noop_guard.sql did to this same function - so
-- that migration is a plausible but unproven suspect, not a confirmed
-- cause. Flagging this as open rather than asserting a root cause this
-- migration doesn't actually establish.

grant execute on function public.update_active_job(uuid,jsonb,bigint,uuid) to authenticated;

commit;
