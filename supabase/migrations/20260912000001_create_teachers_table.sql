create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  specialty text,
  monthly_salary numeric(12, 2),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teachers_name_not_blank check (length(btrim(full_name)) > 0),
  constraint teachers_salary_non_negative check (monthly_salary is null or monthly_salary >= 0)
);

create unique index if not exists teachers_email_unique
  on public.teachers (lower(email))
  where email is not null and length(btrim(email)) > 0;

create index if not exists teachers_active_name_idx
  on public.teachers (is_active, full_name);

alter table public.teachers enable row level security;

create policy "Authenticated users can view teachers"
  on public.teachers for select
  to authenticated
  using (true);

create policy "Authenticated users can add teachers"
  on public.teachers for insert
  to authenticated
  with check (true);

create policy "Authenticated users can edit teachers"
  on public.teachers for update
  to authenticated
  using (true)
  with check (true);

create or replace function public.set_teacher_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists teachers_set_updated_at on public.teachers;

create trigger teachers_set_updated_at
before update on public.teachers
for each row execute function public.set_teacher_updated_at();
