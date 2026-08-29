begin;

-- RT Cloud - encrypted disaster-recovery backup for RT Notes.
--
-- RT Notes are device-local (their own IndexedDB database, never in an app
-- snapshot, never in RT Sync, never on the shared desktop). RT Cloud is an
-- OPT-IN private backup so a notebook can be recovered after the app is
-- uninstalled or its data cleared. It is backup and recovery, NOT live
-- multi-device Notes sync:
--
--   * the device's IndexedDB stays authoritative;
--   * one Recovery Code  ->  one current encrypted snapshot;
--   * there is no Realtime publication, no per-note rows, no history.
--
-- This table is deliberately isolated from every RT Sync object. Its only
-- identifier is `backup_lookup_hash` = base64url(SHA-256("rtcloud/lookup/v1\n"
-- || recovery_code)), derived on the device. The raw Recovery Code is never
-- sent to Supabase and cannot be reconstructed from the hash. RT Sync Device
-- IDs / anonymous RT User IDs / workspace IDs are NOT used for ownership or
-- lookup - a brand-new install with brand-new RT Sync identities must still
-- be able to restore using only the Recovery Code.
--
-- Supabase never sees a readable note title, body, `bodyFormat`, folder name,
-- or folder relationship: `encrypted_payload` is AES-GCM ciphertext of the
-- existing PolynNotesStore export envelope and is opaque to the server. Note
-- fields are never columns.
--
-- Every access path is the `rt-cloud` Edge Function using the service-role
-- key. RLS is enabled with NO policies and all privileges are revoked from
-- anon / authenticated, so the normal browser client cannot touch this table.

create table if not exists public.rt_notes_cloud_backups (
  id uuid primary key default extensions.gen_random_uuid(),

  -- base64url( SHA-256( "rtcloud/lookup/v1\n" || recovery_code ) ). One-way.
  -- The ONLY thing that identifies a backup.
  backup_lookup_hash text not null,

  -- Non-secret PBKDF2 salt (base64, 16 bytes). Returned on restore so any
  -- install can re-derive the AES-GCM key from the Recovery Code alone.
  kdf_salt text not null,

  -- AES-GCM ciphertext (base64) of PolynNotesStore.serializeExport() output.
  -- Opaque blob. NOT decomposed into note/folder columns, ever.
  encrypted_payload text not null,

  -- AES-GCM IV/nonce (base64, 12 bytes). Fresh per successful backup.
  iv text not null,

  encryption_version smallint not null default 1,
  payload_version smallint not null default 2,

  -- Incremented on every successful backup. Status / reliability signal only,
  -- NOT a conflict-resolution mechanism - RT Cloud is last-write-wins and one
  -- Recovery Code maps to exactly one current snapshot.
  revision bigint not null default 1,

  -- Diagnostic only. Nullable, never authoritative, never used for lookup or
  -- access control. A reinstall writes fresh values here and still restores.
  source_device_id text,
  source_rt_user_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_backup_at timestamptz not null default now(),

  constraint rt_notes_cloud_backups_lookup_hash_key unique (backup_lookup_hash),
  constraint rt_notes_cloud_backups_lookup_hash_format
    check (backup_lookup_hash ~ '^[A-Za-z0-9_-]{40,64}$'),
  constraint rt_notes_cloud_backups_kdf_salt_len
    check (char_length(kdf_salt) between 16 and 128),
  constraint rt_notes_cloud_backups_iv_len
    check (char_length(iv) between 12 and 64),
  -- ~1.5 MiB ciphertext ceiling. Validated again in the Edge Function before
  -- the row is ever touched.
  constraint rt_notes_cloud_backups_payload_size
    check (octet_length(encrypted_payload) between 1 and 1572864),
  constraint rt_notes_cloud_backups_encryption_version_check
    check (encryption_version between 1 and 32),
  constraint rt_notes_cloud_backups_payload_version_check
    check (payload_version between 1 and 32)
);

alter table public.rt_notes_cloud_backups enable row level security;

-- No policies. Service-role Edge Function only.
revoke all on table public.rt_notes_cloud_backups from public, anon, authenticated;
grant all on table public.rt_notes_cloud_backups to service_role;

-- Per-IP throttle for restore/status lookups. Recovery lookup is effectively
-- authentication; the Recovery Code already carries 160 bits of entropy, so
-- this is defence-in-depth against automated guessing, not the primary
-- control. Also service-role only.
create table if not exists public.rt_notes_cloud_lookup_throttle (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0,
  blocked_until timestamptz
);

alter table public.rt_notes_cloud_lookup_throttle enable row level security;
revoke all on table public.rt_notes_cloud_lookup_throttle from public, anon, authenticated;
grant all on table public.rt_notes_cloud_lookup_throttle to service_role;

-- updated_at maintenance (mirrors the other update triggers in this project).
create or replace function private.rt_cloud_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rt_notes_cloud_backups_touch on public.rt_notes_cloud_backups;
create trigger rt_notes_cloud_backups_touch
  before update on public.rt_notes_cloud_backups
  for each row execute function private.rt_cloud_touch_updated_at();

-- Deliberately NOT added to the supabase_realtime publication: RT Cloud is a
-- recovery backup, not a synchronized store, and must never push note state
-- to another device.

commit;
