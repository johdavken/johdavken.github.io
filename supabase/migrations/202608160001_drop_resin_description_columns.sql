begin;

-- The application no longer stores or displays a resin's display description
-- or material information text - only resin_code, density_g_cm3, and
-- bulk_density_lb_ft3 remain. All application code (RESIN_FIELDS/
-- REMOTE_FIELDS select lists, the admin edit form, Resin Reference, Resin
-- Database, and Bulk Density Measurement) was updated to stop reading,
-- writing, or searching by these columns before this migration exists, so
-- dropping them here is safe: no remaining query names them explicitly.
-- No policy, trigger, or other constraint on public.resins references
-- either column, so this is a clean drop with no other schema changes.
alter table public.resins drop column display_description;
alter table public.resins drop column information_description;

commit;
