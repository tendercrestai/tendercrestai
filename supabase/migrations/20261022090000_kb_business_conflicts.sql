-- Business conflicts must not use serialization_failure (40001): REST/database
-- infrastructure can retry that SQLSTATE instead of promptly returning conflict.
-- Preserve the applied base migration and update only these KB functions.
begin;
do $$
declare signature regprocedure; definition text;
begin
 foreach signature in array array[
  'public.kb_register(uuid,uuid,text,text,text,integer,text)'::regprocedure,
  'public.kb_save_answer(uuid,uuid,uuid,integer,text,text,uuid[])'::regprocedure,
  'public.kb_approve_answer(uuid,uuid,uuid,integer)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(signature);
  if position('errcode=''40001''' in definition)>0 then
   definition:=replace(definition,'errcode=''40001''','errcode=''PT409''');
   execute definition;
  end if;
 end loop;
end $$;
commit;
