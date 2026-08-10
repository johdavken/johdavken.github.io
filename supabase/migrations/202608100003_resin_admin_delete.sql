begin;

-- Hard deletion is reserved for the same verified resin admins who can edit
-- the catalog. Operators should normally use Inactive to retain a record.
create policy "Resin admins can delete resins"
  on public.resins
  for delete
  to authenticated
  using ((select public.is_resin_admin()));

grant delete on public.resins to authenticated;

commit;
