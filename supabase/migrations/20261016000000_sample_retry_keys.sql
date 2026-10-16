-- Existing rows keep NULL keys. New clients assign stable UUIDs before upload.
-- This lets a retry succeed without inserting duplicates if the first response was lost.
alter table public.camera_samples add column if not exists client_sample_id uuid;

create unique index if not exists idx_camera_samples_client_sample
  on public.camera_samples (run_id, client_sample_id);
