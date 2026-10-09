-- Atomic rollback of all nodes touched by a governed proposal merge.
-- Abort if any node changed since that merge; never silently erase later improvements.
create or replace function public.uid_governance_rollback_proposal(
 p_proposal_id uuid,p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 snap record;
 current_node public.knowledge_nodes%rowtype;
 after_node public.uid_governance_snapshots%rowtype;
 cnt integer:=0;
begin
 if not exists(select 1 from public.creative_dna_team_members where user_id=p_actor_user_id and role='admin' and is_active=true)
 then raise exception 'Active admin required'; end if;
 if not exists(select 1 from public.uid_governance_snapshots where proposal_id=p_proposal_id and checkpoint='before')
 then raise exception 'No before snapshots for proposal'; end if;
 for snap in
   select distinct on (node_id) * from public.uid_governance_snapshots
   where proposal_id=p_proposal_id and checkpoint='before'
   order by node_id,created_at desc
 loop
   select * into current_node from public.knowledge_nodes where id=snap.node_id for update;
   if not found then raise exception 'Missing affected canonical node'; end if;
   select * into after_node from public.uid_governance_snapshots
   where proposal_id=p_proposal_id and node_id=snap.node_id and checkpoint='after'
   order by created_at desc limit 1;
   if not found then raise exception 'Post-merge snapshot missing'; end if;
   if md5(coalesce(current_node.content_md,'')||current_node.metadata::text||current_node.version)
    <>md5(coalesce(after_node.content_md,'')||after_node.metadata::text||after_node.node_version)
   then raise exception 'Node changed after merge; rollback blocked'; end if;
   insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
   values(p_proposal_id,current_node.id,'rollback',current_node.content_md,current_node.metadata,current_node.version,p_actor_user_id);
   update public.knowledge_nodes
     set content_md=snap.content_md,metadata=snap.metadata,version=snap.node_version,updated_at=now()
   where id=current_node.id;
   cnt:=cnt+1;
 end loop;
 return jsonb_build_object('rolled_back',true,'proposal_id',p_proposal_id,'node_count',cnt);
end $$;
revoke all on function public.uid_governance_rollback_proposal(uuid,uuid) from public,anon,authenticated;
grant execute on function public.uid_governance_rollback_proposal(uuid,uuid) to service_role;
