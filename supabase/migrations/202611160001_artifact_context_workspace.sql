begin;
create table if not exists public.artifact_workspaces (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade, revision integer not null default 0,
 messages jsonb not null default '[]', draft jsonb, request_id uuid, lease_until timestamptz,
 unique(document_id,user_id), check(jsonb_typeof(messages)='array')
);
create table if not exists public.artifact_context_sources (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.artifact_workspaces(id) on delete cascade,
 snapshot jsonb not null, updated_at timestamptz not null default now(), check(octet_length(snapshot::text)<=2500000)
);
create table if not exists public.github_connections (
 user_id uuid primary key references public.profiles(id) on delete cascade, login text not null,
 token_ciphertext text not null, expires_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.github_oauth_states (
 state_hash text primary key, user_id uuid not null references public.profiles(id) on delete cascade,
 verifier_ciphertext text not null, document_id uuid, expires_at timestamptz not null
);
alter table public.artifact_workspaces enable row level security;
alter table public.artifact_context_sources enable row level security;
alter table public.github_connections enable row level security;
alter table public.github_oauth_states enable row level security;
revoke all on public.artifact_workspaces,public.artifact_context_sources,public.github_connections,public.github_oauth_states from anon,authenticated;
grant all on public.artifact_workspaces,public.artifact_context_sources,public.github_connections,public.github_oauth_states to service_role;

-- Lock the personal workspace while replacing a snapshot; concurrent uploads
-- cannot exceed the source limit. Source IDs never grant access to other users.
create or replace function public.put_artifact_source(p_workspace uuid,p_user uuid,p_source uuid,p_snapshot jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
 perform 1 from artifact_workspaces where id=p_workspace and user_id=p_user for update;
 if not found then raise exception 'WORKSPACE_NOT_FOUND'; end if;
 if not exists(select 1 from artifact_context_sources where id=p_source and workspace_id=p_workspace)
 and (select count(*) from artifact_context_sources where workspace_id=p_workspace)>=6 then raise exception 'SOURCE_LIMIT'; end if;
 insert into artifact_context_sources(id,workspace_id,snapshot) values(p_source,p_workspace,p_snapshot)
 on conflict(id) do update set snapshot=excluded.snapshot,updated_at=now() where artifact_context_sources.workspace_id=p_workspace;
 if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
end; $$;

-- Apply the accepted draft and clear it in the same transaction as versioning.
-- Uploading the immutable object happens first, as in save_artifact_version.
create or replace function public.apply_artifact_workspace_draft(p_workspace uuid,p_user uuid,p_draft uuid,p_storage_key text,p_file_size integer)
returns public.document_versions language plpgsql security invoker set search_path=public as $$
declare w public.artifact_workspaces; saved public.document_versions;
begin
 select * into w from artifact_workspaces where id=p_workspace and user_id=p_user for update;
 if not found then raise exception 'WORKSPACE_NOT_FOUND'; end if;
 if w.request_id is not null and w.lease_until>now() then raise exception 'WORKSPACE_BUSY'; end if;
 if w.draft is null or (w.draft->>'id')::uuid is distinct from p_draft then raise exception 'DRAFT_CHANGED'; end if;
 select * into saved from save_artifact_version(w.document_id,p_storage_key,p_file_size,p_user,w.draft->>'prompt','Applied from artifact workspace',(w.draft->>'base_version_id')::uuid);
 update artifact_workspaces set draft=null,revision=revision+1,request_id=null,lease_until=null,
 messages=messages || jsonb_build_array(jsonb_build_object('role','assistant','content','Applied as version '||saved.version_number||'. The share link now opens this version.','created_at',now(),'references',w.draft->'references')) where id=w.id;
 return saved;
end; $$;
revoke all on function public.put_artifact_source(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.apply_artifact_workspace_draft(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.put_artifact_source(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.apply_artifact_workspace_draft(uuid,uuid,uuid,text,integer) to service_role;
commit;
