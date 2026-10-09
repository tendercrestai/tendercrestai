begin;

insert into auth.users (id, email) values
  (
    '11111111-1111-4111-8111-111111111111',
    'rfp-test-one@example.invalid'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'rfp-test-two@example.invalid'
  );

insert into public.rfp_uploads (
  id, user_id, file_name, mime_type,
  sha256, size_bytes, storage_path
) values
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'one.txt',
    'text/plain',
    repeat('a',64),
    10,
    '11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/source.txt'
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '22222222-2222-4222-8222-222222222222',
    'two.txt',
    'text/plain',
    repeat('b',64),
    10,
    '22222222-2222-4222-8222-222222222222/44444444-4444-4444-8444-444444444444/source.txt'
  );

insert into storage.objects (bucket_id, name)
select 'rfp-documents', storage_path
from public.rfp_uploads;

insert into public.rfp_submissions (
  id, user_id, document_id, fingerprint, status
) values (
  '55555555-5555-4555-8555-555555555555',
  '22222222-2222-4222-8222-222222222222',
  '44444444-4444-4444-8444-444444444444',
  repeat('c',64),
  'processing'
);

set local role authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

do $$
begin
  if (select count(*) from public.rfp_uploads) <> 1 then
    raise exception 'Metadata isolation failed';
  end if;

  if (select count(*) from public.rfp_submissions) <> 0 then
    raise exception 'Submission isolation failed';
  end if;

  if (
    select count(*)
    from storage.objects
    where bucket_id = 'rfp-documents'
  ) <> 1 then
    raise exception
      'Storage isolation failed: inspect all storage.objects policies';
  end if;

  begin
    insert into public.rfp_uploads (
      id, user_id, file_name, mime_type,
      sha256, size_bytes, storage_path
    ) values (
      '66666666-6666-4666-8666-666666666666',
      '22222222-2222-4222-8222-222222222222',
      'forged.txt',
      'text/plain',
      repeat('d',64),
      10,
      '22222222-2222-4222-8222-222222222222/66666666-6666-4666-8666-666666666666/source.txt'
    );

    raise exception 'Foreign metadata insert was allowed';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.rfp_uploads
    set file_name = 'changed.txt';

    raise exception 'Metadata update was allowed';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.rfp_submissions
    set status = 'retryable';

    raise exception 'Submission state update was allowed';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
rollback;
