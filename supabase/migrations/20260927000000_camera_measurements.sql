create table if not exists public.camera_runs (
  id uuid primary key,
  created_at timestamptz not null default now(),
  object_label text not null check (char_length(object_label) between 1 and 80),
  status text not null default 'active'
    check (status in ('active', 'stopped', 'completed', 'verified')),
  reference_elapsed_ms integer check (reference_elapsed_ms between 0 and 3600000),
  calibration_ratio double precision
    check (calibration_ratio is null or calibration_ratio between 0.35 and 2.5)
);

create index if not exists idx_camera_runs_created_at
  on public.camera_runs (created_at desc);

create table if not exists public.camera_samples (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.camera_runs (id) on delete cascade,
  elapsed_ms integer not null check (elapsed_ms between 0 and 3600000),
  scale double precision not null check (scale > 0 and scale <= 1),
  raw_ttc double precision check (raw_ttc is null or raw_ttc between 0 and 30),
  quality double precision not null check (quality between 0 and 1)
);

create index if not exists idx_camera_samples_run_elapsed
  on public.camera_samples (run_id, elapsed_ms desc);

-- Browser requests go through the Vercel API route. Only its server-side
-- Supabase secret key can access these tables; no public table policies exist.
alter table public.camera_runs enable row level security;
alter table public.camera_samples enable row level security;
revoke all on table public.camera_runs, public.camera_samples from anon, authenticated;
grant all on table public.camera_runs, public.camera_samples to service_role;
