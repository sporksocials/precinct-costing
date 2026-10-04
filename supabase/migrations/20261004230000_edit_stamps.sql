-- Edit stamps: who last changed a dish or a prep, and when. The recipe editor uses them to tell the person who else has
-- been in the same record ("Brendan saved changes to this at 1:38pm"). The check itself compares content, not timestamps,
-- so these columns only add the name and a cheap optimistic guard; the app works without them.
--
--  * cost_menu_items and cost_preps already have updated_at (default now()) kept by the cost_item_touch / cost_prep_touch
--    triggers (cost_touch()). This adds updated_by text (nullable) and replaces those two triggers with cost_stamp_edit(),
--    which sets BOTH columns: updated_at = now(), updated_by = the signed-in email, or null when there is no JWT
--    (SQL editor, migrations, the service role). It never fails: any problem reading the JWT leaves updated_by null.
--    cost_touch() itself is left alone for any other table that uses it.
--  * A change to a recipe line also moves its parent's stamp, so a lines-only edit (including a removed line, which cannot
--    be attributed any other way) shows up on the dish or prep. Statement level triggers with transition tables: a save
--    of 10 lines is one parent update per statement (the app writes lines as one delete and one upsert), not 10.
--    The parent update is a plain stamp. The existing triggers on cost_menu_items only act on their own columns
--    (cost_menu_items_sell_price_log needs a changed sell or happy hour price; cost_menu_items_audit watches target_override
--    and active), so a stamp-only update writes no sell price log row and no audit row. Nothing here writes to
--    cost_recipe_lines, so there is no recursion.
-- Idempotent. No data is changed by this file.
alter table public.cost_menu_items add column if not exists updated_at timestamptz default now();
alter table public.cost_preps add column if not exists updated_at timestamptz default now();
alter table public.cost_menu_items add column if not exists updated_by text;
alter table public.cost_preps add column if not exists updated_by text;

comment on column public.cost_menu_items.updated_by is 'Email of the signed-in person who last changed this dish or its recipe lines; null for direct database work.';
comment on column public.cost_preps.updated_by is 'Email of the signed-in person who last changed this prep or its recipe lines; null for direct database work.';

create or replace function public.cost_stamp_edit()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  begin
    new.updated_by := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    new.updated_by := null;
  end;
  return new;
end $$;
revoke execute on function public.cost_stamp_edit() from public, anon, authenticated;

drop trigger if exists cost_item_touch on public.cost_menu_items;
create trigger cost_item_touch before update on public.cost_menu_items
  for each row execute function public.cost_stamp_edit();
drop trigger if exists cost_prep_touch on public.cost_preps;
create trigger cost_prep_touch before update on public.cost_preps
  for each row execute function public.cost_stamp_edit();

-- Recipe line changes stamp the parent (the BEFORE UPDATE trigger above fills in who). Security definer so the stamp does
-- not depend on the caller's row level security; the caller could already change the lines.
create or replace function public.cost_recipe_lines_stamp_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.cost_menu_items set updated_at = now() where id in (select parent_id from new_rows where parent_type = 'item');
  update public.cost_preps set updated_at = now() where id in (select parent_id from new_rows where parent_type = 'prep');
  return null;
end $$;

create or replace function public.cost_recipe_lines_stamp_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.cost_menu_items set updated_at = now()
    where id in (select parent_id from new_rows where parent_type = 'item' union select parent_id from old_rows where parent_type = 'item');
  update public.cost_preps set updated_at = now()
    where id in (select parent_id from new_rows where parent_type = 'prep' union select parent_id from old_rows where parent_type = 'prep');
  return null;
end $$;

create or replace function public.cost_recipe_lines_stamp_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.cost_menu_items set updated_at = now() where id in (select parent_id from old_rows where parent_type = 'item');
  update public.cost_preps set updated_at = now() where id in (select parent_id from old_rows where parent_type = 'prep');
  return null;
end $$;

revoke execute on function public.cost_recipe_lines_stamp_insert() from public, anon, authenticated;
revoke execute on function public.cost_recipe_lines_stamp_update() from public, anon, authenticated;
revoke execute on function public.cost_recipe_lines_stamp_delete() from public, anon, authenticated;

drop trigger if exists cost_recipe_lines_stamp_insert on public.cost_recipe_lines;
create trigger cost_recipe_lines_stamp_insert after insert on public.cost_recipe_lines
  referencing new table as new_rows for each statement execute function public.cost_recipe_lines_stamp_insert();
drop trigger if exists cost_recipe_lines_stamp_update on public.cost_recipe_lines;
create trigger cost_recipe_lines_stamp_update after update on public.cost_recipe_lines
  referencing old table as old_rows new table as new_rows for each statement execute function public.cost_recipe_lines_stamp_update();
drop trigger if exists cost_recipe_lines_stamp_delete on public.cost_recipe_lines;
create trigger cost_recipe_lines_stamp_delete after delete on public.cost_recipe_lines
  referencing old table as old_rows for each statement execute function public.cost_recipe_lines_stamp_delete();
