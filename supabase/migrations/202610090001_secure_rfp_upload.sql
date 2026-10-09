begin;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'rfp-documents',
  'rfp-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.rfp_uploads (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (
    mime_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    )
  ),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  check (
    storage_path = user_id::text || '/' || id::text || '/source.' ||
      case mime_type
        when 'application/pdf' then 'pdf'
        when 'text/plain' then 'txt'
        else 'docx'
      end
  )
);

alter table public.rfp_uploads enable row level security;
revoke all on public.rfp_uploads from anon, authenticated;
grant select, insert on public.rfp_uploads to authenticated;
grant all on public.rfp_uploads to service_role;

create policy rfp_uploads_owner_read
on public.rfp_uploads
for select to authenticated
using (user_id = (select auth.uid()));

create policy rfp_uploads_owner_insert
on public.rfp_uploads
for insert to authenticated
with check (user_id = (select auth.uid()));

-- Submission state is maintained only by the trusted function.
create table public.rfp_submissions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid unique,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (
    status in ('processing', 'queued', 'retryable', 'uncertain')
  ),
  record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (document_id, user_id)
    references public.rfp_uploads(id, user_id),
  check (
    (status = 'queued' and record_id is not null)
    or
    (status <> 'queued' and record_id is null)
  )
);

alter table public.rfp_submissions enable row level security;
revoke all on public.rfp_submissions from anon, authenticated;
grant select on public.rfp_submissions to authenticated;
grant all on public.rfp_submissions to service_role;

create policy rfp_submissions_owner_read
on public.rfp_submissions
for select to authenticated
using (user_id = (select auth.uid()));

create index rfp_uploads_user_id_idx
on public.rfp_uploads(user_id);

create index rfp_submissions_user_id_idx
on public.rfp_submissions(user_id);

-- No UPDATE policy: customers cannot overwrite reviewed sources.
create policy rfp_documents_owner_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'rfp-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy rfp_documents_owner_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'rfp-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.rfp_uploads u
    where u.user_id = (select auth.uid())
      and u.storage_path = name
  )
);

commit;
