-- Bar display photos uploaded from the recipe editor ("Upload Photo"). Public bucket: the cocktail station iPads have no
-- login, so they read photos by plain URL (through the app's /bar/photo/ rewrite, so the iPad's offline copy can hold them).
-- Only signed-in allowed users (cost_allowed_users, same gate as every cost_* table) can add, replace or remove files.
-- Files are small by design: the editor shrinks every photo to a JPEG, 1200px on the long side, before uploading; the
-- 2 MB cap here is the backstop.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bar-photos', 'bar-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists bar_photos_select on storage.objects;
drop policy if exists bar_photos_insert on storage.objects;
drop policy if exists bar_photos_update on storage.objects;
drop policy if exists bar_photos_delete on storage.objects;

create policy bar_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'bar-photos' and public.cost_is_allowed());
create policy bar_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'bar-photos' and public.cost_is_allowed());
create policy bar_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'bar-photos' and public.cost_is_allowed()) with check (bucket_id = 'bar-photos' and public.cost_is_allowed());
create policy bar_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'bar-photos' and public.cost_is_allowed());
