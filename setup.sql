-- Run this entire script in Supabase Dashboard > SQL Editor.
-- Creates a private bucket and policies that restrict each user to their own folder.

insert into storage.buckets (id, name, public, file_size_limit)
values ('user-files', 'user-files', false, 5368709120)
on conflict (id) do update set public = false, file_size_limit = 5368709120;

create policy "Users can list files in own folder"
on storage.objects for select
to authenticated
using (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can upload files to own folder"
on storage.objects for insert
to authenticated
with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete files in own folder"
on storage.objects for delete
to authenticated
using (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);
