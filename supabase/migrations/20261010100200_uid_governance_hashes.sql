-- Read-only hashes used for optimistic concurrency and evaluation identity.
create or replace function public.uid_governance_candidate_hash(p_proposal_id uuid)
returns text language sql security definer set search_path=public as $$
 select md5(coalesce(nullif(proposed_content_md,''),raw_feedback,''))
 from public.knowledge_proposals where id=p_proposal_id
$$;
create or replace function public.uid_governance_node_hash(p_node_id uuid)
returns text language sql security definer set search_path=public as $$
 select md5(coalesce(content_md,'')||metadata::text||version)
 from public.knowledge_nodes where id=p_node_id
$$;
revoke all on function public.uid_governance_candidate_hash(uuid) from public,anon,authenticated;
revoke all on function public.uid_governance_node_hash(uuid) from public,anon,authenticated;
grant execute on function public.uid_governance_candidate_hash(uuid) to service_role;
grant execute on function public.uid_governance_node_hash(uuid) to service_role;
