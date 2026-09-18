create table if not exists public.class_enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  enrolled_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_enrollments_unique unique (class_id, student_id)
);

create index if not exists class_enrollments_student_idx on public.class_enrollments (student_id, is_active);
create index if not exists class_enrollments_class_idx on public.class_enrollments (class_id, is_active);

create table if not exists public.class_schedules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  teacher_id uuid not null references public.teachers(id) on delete restrict,
  room text not null,
  day_of_week smallint not null,
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_schedules_room_check check (room in ('قاعة 1', 'قاعة 2', 'قاعة 3', 'قاعة 4')),
  constraint class_schedules_day_check check (day_of_week between 0 and 6),
  constraint class_schedules_time_check check (end_time > start_time)
);

create index if not exists class_schedules_day_idx on public.class_schedules (day_of_week, is_active);
create index if not exists class_schedules_class_idx on public.class_schedules (class_id, is_active);

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  schedule_id uuid references public.class_schedules(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  teacher_id uuid not null references public.teachers(id) on delete restrict,
  room text not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint attendance_sessions_room_check check (room in ('قاعة 1', 'قاعة 2', 'قاعة 3', 'قاعة 4')),
  constraint attendance_sessions_time_check check (end_time > start_time),
  constraint attendance_sessions_schedule_date_unique unique (schedule_id, session_date)
);

create index if not exists attendance_sessions_date_idx on public.attendance_sessions (session_date);
create index if not exists attendance_sessions_class_idx on public.attendance_sessions (class_id, session_date);

create table if not exists public.attendance_session_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  status text not null default 'present',
  absence_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_session_records_unique unique (session_id, student_id),
  constraint attendance_session_status_check check (status in ('present', 'absent', 'late', 'excused'))
);

create index if not exists attendance_session_records_student_idx on public.attendance_session_records (student_id);
create index if not exists attendance_session_records_session_idx on public.attendance_session_records (session_id);

alter table public.class_enrollments enable row level security;
alter table public.class_schedules enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_session_records enable row level security;

create policy "Authenticated users can view class enrollments" on public.class_enrollments for select to authenticated using (true);
create policy "Authenticated users can manage class enrollments" on public.class_enrollments for all to authenticated using (true) with check (true);
create policy "Authenticated users can view class schedules" on public.class_schedules for select to authenticated using (true);
create policy "Authenticated users can manage class schedules" on public.class_schedules for all to authenticated using (true) with check (true);
create policy "Authenticated users can view attendance sessions" on public.attendance_sessions for select to authenticated using (true);
create policy "Authenticated users can manage attendance sessions" on public.attendance_sessions for all to authenticated using (true) with check (true);
create policy "Authenticated users can view session attendance" on public.attendance_session_records for select to authenticated using (true);
create policy "Authenticated users can manage session attendance" on public.attendance_session_records for all to authenticated using (true) with check (true);
