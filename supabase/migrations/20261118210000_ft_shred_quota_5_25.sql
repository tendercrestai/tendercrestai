-- Raise the shared free-tool budget from 3 uses per IP per UTC day / 10
-- shared across all users to 5 per IP / 25 shared. The shredder path passes
-- the new limits from JS (netlify/functions/free-tools.js), but the bid
-- checker admits inside ft_bidcheck_start, which hardcoded 3,10 when it was
-- created (20261107090000). This replaces that function body-identically
-- except for the two numbers. Apply via the Supabase dashboard SQL Editor;
-- until it is applied, the bid checker stays at 3/10 while the shredder and
-- the quota display already show 5/25.
create or replace function public.ft_bidcheck_start(p_id uuid,p_ip text,p_title text,p_source text,p_documents jsonb,p_chunks jsonb,p_warnings jsonb,p_answers jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.ft_admit(p_ip,'shred',5,25);
 insert into public.ft_jobs(id,ip_hash,title,source,documents,chunks,warnings)values(p_id,p_ip,p_title,p_source,p_documents,p_chunks,p_warnings);
 insert into public.ft_bidchecks(id,answers)values(p_id,p_answers);
end $$;
