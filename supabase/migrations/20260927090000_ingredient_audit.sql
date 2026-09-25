-- Ingredient change history. Until now only pack_price changes were logged (cost_price_log), so pack size, pack unit,
-- yield, rebate or GST changes could move a cost with no trace. Attach the generic cost_audit() trigger (see
-- 20260926200000_audit_log.sql) to the other cost-driving columns. pack_price stays with cost_price_log.
-- No data changes, no backfill.
drop trigger if exists cost_ingredients_audit on public.cost_ingredients;
create trigger cost_ingredients_audit after update on public.cost_ingredients
  for each row execute function public.cost_audit(
    'pack_size', 'pack_unit', 'yield_pct', 'rebate', 'price_inc_gst', 'gst_free', 'active', 'name', 'supplier_id', 'supplier_code'
  );

-- Same function as before, except last_price_update now uses the Brisbane date (it used the server's UTC date).
create or replace function public.cost_ingredients_price_log()
returns trigger language plpgsql security definer as $$
begin
  if new.pack_price is distinct from old.pack_price then
    insert into public.cost_price_log (ingredient_id, old_price, new_price, source, entered_by)
    values (new.id, old.pack_price, new.pack_price, new.source, auth.jwt() ->> 'email');
    new.previous_price := old.pack_price;
    new.last_price_update := (now() at time zone 'Australia/Brisbane')::date;
  end if;
  new.updated_at := now();
  return new;
end $$;
