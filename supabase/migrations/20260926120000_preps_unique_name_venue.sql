-- A prep name is unique per venue (the same prep can exist at two venues).
alter table public.cost_preps drop constraint if exists cost_preps_name_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cost_preps_name_venue_key') then
    alter table public.cost_preps add constraint cost_preps_name_venue_key unique (name, venue_id);
  end if;
end $$;
