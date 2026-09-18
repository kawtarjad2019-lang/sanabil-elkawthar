alter table public.teachers
  add column if not exists is_active boolean not null default true,
  add column if not exists default_compensation_type text not null default 'percentage',
  add column if not exists default_compensation_percentage numeric(5, 2) not null default 50;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teachers_default_compensation_type_check') then
    alter table public.teachers add constraint teachers_default_compensation_type_check
      check (default_compensation_type in ('percentage', 'fixed_monthly_salary'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teachers_default_compensation_percentage_check') then
    alter table public.teachers add constraint teachers_default_compensation_percentage_check
      check (default_compensation_percentage >= 0 and default_compensation_percentage <= 100);
  end if;
end;
$$;

alter table public.students
  add column if not exists teacher_id uuid references public.teachers(id) on delete set null,
  add column if not exists teacher_compensation_type text,
  add column if not exists teacher_compensation_percentage numeric(5, 2),
  add column if not exists teacher_fixed_monthly_salary numeric(12, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'students_teacher_compensation_type_check') then
    alter table public.students add constraint students_teacher_compensation_type_check
      check (teacher_compensation_type is null or teacher_compensation_type in ('percentage', 'fixed_monthly_salary'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'students_teacher_compensation_percentage_check') then
    alter table public.students add constraint students_teacher_compensation_percentage_check
      check (teacher_compensation_percentage is null or (teacher_compensation_percentage >= 0 and teacher_compensation_percentage <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'students_teacher_fixed_salary_check') then
    alter table public.students add constraint students_teacher_fixed_salary_check
      check (teacher_fixed_monthly_salary is null or teacher_fixed_monthly_salary >= 0);
  end if;
end;
$$;

create index if not exists students_teacher_id_idx on public.students (teacher_id);

alter table public.payments
  add column if not exists teacher_id uuid references public.teachers(id) on delete set null,
  add column if not exists compensation_type_snapshot text,
  add column if not exists compensation_percentage_snapshot numeric(5, 2),
  add column if not exists teacher_share numeric(12, 2) not null default 0,
  add column if not exists center_share numeric(12, 2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_compensation_type_snapshot_check') then
    alter table public.payments add constraint payments_compensation_type_snapshot_check
      check (compensation_type_snapshot is null or compensation_type_snapshot in ('percentage', 'fixed_monthly_salary'));
  end if;
end;
$$;

create index if not exists payments_teacher_id_idx on public.payments (teacher_id);
create index if not exists payments_teacher_month_idx on public.payments (teacher_id, payment_month);

create table if not exists public.teacher_salary_payments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete restrict,
  salary_month date not null,
  expected_amount numeric(12, 2) not null default 0,
  paid_amount numeric(12, 2) not null default 0,
  payment_status text not null default 'unpaid',
  payment_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_salary_month_unique unique (teacher_id, salary_month),
  constraint teacher_salary_expected_non_negative check (expected_amount >= 0),
  constraint teacher_salary_paid_non_negative check (paid_amount >= 0),
  constraint teacher_salary_status_check check (payment_status in ('paid', 'partial', 'unpaid'))
);

create index if not exists teacher_salary_month_idx on public.teacher_salary_payments (salary_month);

alter table public.teacher_salary_payments enable row level security;

create policy "Authenticated users can view teacher salary payments"
  on public.teacher_salary_payments for select to authenticated using (true);

create policy "Authenticated users can add teacher salary payments"
  on public.teacher_salary_payments for insert to authenticated with check (true);

create policy "Authenticated users can edit teacher salary payments"
  on public.teacher_salary_payments for update to authenticated using (true) with check (true);

create or replace function public.set_teacher_salary_payment_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'teacher_salary_payments_set_updated_at') then
    create trigger teacher_salary_payments_set_updated_at
    before update on public.teacher_salary_payments
    for each row execute function public.set_teacher_salary_payment_updated_at();
  end if;
end;
$$;
