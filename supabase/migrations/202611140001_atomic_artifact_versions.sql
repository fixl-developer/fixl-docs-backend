-- Requires the existing ReportHub documents and document_versions tables.
-- Apply before deploying the artifact-workspace backend.
begin;
create or replace function public.save_artifact_version(
 p_document_id uuid,
 p_storage_key text,
 p_file_size integer,
 p_created_by uuid,
 p_prompt_used text default null,
 p_change_note text default null,
 p_expected_version_id uuid default null
) returns public.document_versions
language plpgsql
security invoker
set search_path = public
as $$
declare
 current_id uuid;
 next_number integer;
 saved public.document_versions;
begin
 select current_version_id into current_id
 from public.documents where id = p_document_id for update;
 if not found then
  raise exception 'DOCUMENT_NOT_FOUND';
 end if;
 if current_id is distinct from p_expected_version_id then
  raise exception 'VERSION_CONFLICT';
 end if;
 select coalesce(max(version_number),0)+1 into next_number
 from public.document_versions where document_id=p_document_id;
 insert into public.document_versions
 (document_id,version_number,storage_key,file_size,created_by,prompt_used,change_note)
 values(p_document_id,next_number,p_storage_key,p_file_size,p_created_by,p_prompt_used,p_change_note)
 returning * into saved;
 update public.documents set current_version_id=saved.id,updated_at=now() where id=p_document_id;
 return saved;
end;
$$;
revoke all on function public.save_artifact_version(uuid,text,integer,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_artifact_version(uuid,text,integer,uuid,text,text,uuid) to service_role;
commit;
