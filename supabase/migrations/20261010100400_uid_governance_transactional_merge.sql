-- This function atomically snapshots and merges a PASSED candidate.
-- Evaluation rows are created by the trusted test runner, never by the browser.
create or replace function public.uid_governance_accept_merge(
 p_proposal_id uuid,p_actor_user_id uuid,p_evaluation_id uuid,p_review_note text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 p public.knowledge_proposals%rowtype;
 e public.uid_governance_evaluations%rowtype;
 n public.knowledge_nodes%rowtype;
 structural boolean;
 result jsonb;
begin
 if not exists(select 1 from public.creative_dna_team_members
   where user_id=p_actor_user_id and role='admin' and is_active=true)
 then raise exception 'Active admin required'; end if;
 select * into p from public.knowledge_proposals where id=p_proposal_id and status='pending' for update;
 if not found then raise exception 'Pending proposal not found'; end if;
 select * into e from public.uid_governance_evaluations
 where id=p_evaluation_id and proposal_id=p.id for update;
 if not found or e.evaluation_status<>'passed' or e.critical_failures<>0
  or e.completed_at is null or cardinality(e.baseline_ids)=0
  or jsonb_array_length(e.test_results)=0
 then raise exception 'Approved regression evaluation required'; end if;
 if e.candidate_hash <> md5(coalesce(nullif(p.proposed_content_md,''),p.raw_feedback,'')) then
   raise exception 'Proposal content changed after evaluation'; end if;
 select * into n from public.knowledge_nodes where id=p.knowledge_node_id;
 if not found then raise exception 'Source node not found'; end if;
 structural := n.slug='onepage-system'
   and coalesce(p.proposed_scope,'') !~* 'brand[ _-]?style|vibe|mood';
 insert into public.uid_governance_snapshots
  (proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 select p.id,id,'before',content_md,metadata,version,p_actor_user_id
 from public.knowledge_nodes
 where (structural and slug='onepage-system' and status='active')
    or (not structural and id=n.id);
 result:=public.admin_accept_merge_creative_dna_proposal(p.id,p_actor_user_id,p_review_note);
 insert into public.uid_governance_snapshots
  (proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 select p.id,id,'after',content_md,metadata,version,p_actor_user_id
 from public.knowledge_nodes
 where (structural and slug='onepage-system' and status='active')
    or (not structural and id=n.id);
 return result||jsonb_build_object('evaluation_id',e.id,'governance_passed',true);
end $$;
revoke all on function public.uid_governance_accept_merge(uuid,uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.uid_governance_accept_merge(uuid,uuid,uuid,text) to service_role;
-- Prevent bypass via the old auto-merge RPC from service_role or public API.
-- Its owner can still invoke it from uid_governance_accept_merge.
revoke all on function public.admin_accept_merge_creative_dna_proposal(uuid,uuid,text)
 from public,anon,authenticated,service_role;
