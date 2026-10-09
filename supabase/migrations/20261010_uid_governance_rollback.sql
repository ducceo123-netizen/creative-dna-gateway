-- Guarded rollback RPC; call only through authenticated administrative Edge route.
create or replace function public.uid_governance_rollback_snapshot(
 p_snapshot_id uuid, p_actor_user_id uuid, p_expected_current_md5 text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 s public.uid_governance_snapshots%rowtype;
 n public.knowledge_nodes%rowtype;
begin
 if not exists(select 1 from public.creative_dna_team_members where user_id=p_actor_user_id and role='admin' and is_active=true) then
   raise exception 'Active admin required';
 end if;
 select * into s from public.uid_governance_snapshots where id=p_snapshot_id and checkpoint='before';
 if not found then raise exception 'Eligible before snapshot not found'; end if;
 select * into n from public.knowledge_nodes where id=s.node_id for update;
 if not found then raise exception 'Node not found'; end if;
 if p_expected_current_md5 is null or md5(coalesce(n.content_md,'')||n.metadata::text||n.version)<>p_expected_current_md5 then
   raise exception 'Current node changed; rollback requires review of latest state';
 end if;
 insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 values(s.proposal_id,n.id,'rollback',n.content_md,n.metadata,n.version,p_actor_user_id);
 update public.knowledge_nodes
 set content_md=s.content_md, metadata=s.metadata, version=s.node_version, updated_at=now()
 where id=n.id;
 return jsonb_build_object('node_id',n.id,'snapshot_id',s.id,'rolled_back',true);
end $$;
revoke all on function public.uid_governance_rollback_snapshot(uuid,uuid,text) from public,anon,authenticated;
