begin;

-- Bulk density (lb/ft³) is a directly-measured trait of the resin, distinct
-- from density_g_cm3 (polymer density, used today with a temporary fixed
-- packing factor to *estimate* bulk density - see TEMP_RESIN_PACKING_FACTOR
-- in app.js). Once real bulk density values have been measured for enough
-- resins, Smart Hoppers can use this directly instead of the estimate -
-- not wired up yet, this migration only adds the column so it can start
-- being populated.
alter table public.resins
  add column bulk_density_lb_ft3 numeric(8,3)
  check (bulk_density_lb_ft3 is null or bulk_density_lb_ft3 between 1 and 100);

commit;
