-- INACTIVE PROTOTYPE. Disposable tests only; no grants or canonical writes.
create function uid_rule_v3_private.hex(p_value jsonb) returns text language sql immutable
set search_path=pg_catalog,public,pg_temp as $$ select encode(sha256(convert_to(public.uid_rule_stable_json(p_value),'UTF8')),'hex') $$;
create function uid_rule_v3_private.operation_for(p_text text,p_scope text) returns text
language sql immutable set search_path=pg_catalog,public,pg_temp as $$
 select case when public.uid_rule_parse_canonical(p_text) is not null and nullif(btrim(p_scope),'') is not null then 'creative_rule_supplement.v1' end
$$;
create function uid_rule_v3_private.context(p_proposal uuid,p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare raw jsonb; c jsonb;
begin
 raw:=public.uid_rule_context(p_proposal);
 if raw is null then return null; end if;
 c:=jsonb_build_object('proposal',raw->'proposal','scope',raw->'scope','targets',raw->'targets',
  'compiler_context',(raw->'compiler_context')||jsonb_build_object('owner_user_id',p_owner));
 -- Never reuse the outcome-QC candidate hash: baselines/evaluations do not grant
 -- authority or alter the rule-only freshness identity.
 return c||jsonb_build_object('candidate_hash','sha256:'||uid_rule_v3_private.hex(c));
end $$;
create function uid_rule_v3_private.intent(p_context jsonb,p_owner uuid,p_operation text) returns jsonb
language sql immutable set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('schema_version','uid.review-intent.v3','review_mode','agent_rule_review',
  'owner_user_id',p_owner,'operation',p_operation,'proposal_id',p_context#>'{proposal,id}',
  'source_node_id',p_context#>'{proposal,knowledge_node_id}',
  'proposed_content_md',p_context#>'{proposal,proposed_content_md}','proposed_scope',p_context#>'{proposal,proposed_scope}',
  'targets',(select jsonb_agg(jsonb_build_object('id',t->'id','brand_id',t->'brand_id','slug',t->'slug') order by t->>'id')
   from jsonb_array_elements(p_context->'targets') t))
$$;
create function uid_rule_v3_private.adapt_context(p_context jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c jsonb:=p_context; catalog jsonb; t jsonb; bundle jsonb; item jsonb; old jsonb; contracts jsonb; adapted jsonb;
 slug text; field text; all_rules jsonb; arr jsonb; targets jsonb; proof_keys text[]:=array[
 'schema_version','id','proposal_id','request_id','attempt_id','decision_kind','evaluator_version','snapshot_hash','review_hash',
 'review_scope','canonical_text','declared_scope','scope','rule_class','confidence','source','accepted_source_hashes','precedence','visual_qc_performed'];
begin
 select t#>'{metadata,creative_quality_contract}' into catalog from jsonb_array_elements(c->'targets') t order by t->>'id' limit 1;
 if catalog is null and not exists(select 1 from jsonb_array_elements(c->'targets') n where n#>'{metadata,creative_quality_contract}' is not null) then return c; end if;
 if catalog->>'schema_version' is distinct from 'uid-creative-quality-catalog/1' or jsonb_typeof(catalog->'contracts') is distinct from 'object'
 then raise exception 'Complete existing catalog required'; end if;
 if exists(select 1 from jsonb_array_elements(c->'targets') t where t#>'{metadata,creative_quality_contract}' is distinct from catalog)
 or exists(select 1 from jsonb_array_elements(c#>'{compiler_context,projected_targets}') t where t#>'{metadata,creative_quality_contract}' is distinct from catalog)
 then raise exception 'Prior catalog or mirror provenance drift'; end if;
 contracts:=catalog->'contracts';
 for t in select value from jsonb_array_elements(c->'targets') loop
  slug:=t->>'brand_slug'; bundle:=contracts->slug;
  foreach field in array array['owner_supplemental_rules','agent_reviewed_supplemental_rules','agent_rule_reviewed_supplemental_rules'] loop
   if bundle ? field and jsonb_typeof(bundle->field) is distinct from 'array' then raise exception 'Malformed prior supplemental array'; end if;
  end loop;
  arr:=coalesce(bundle->'agent_rule_reviewed_supplemental_rules','[]');
  if (bundle->>'schema_version'='uid-creative-quality/4' and jsonb_array_length(arr)=0)
   or (bundle ? 'agent_rule_reviewed_supplemental_rules' and bundle->>'schema_version' is distinct from 'uid-creative-quality/4')
  then raise exception 'Prior rule schema downgrade or empty history'; end if;
  all_rules:=coalesce(bundle->'owner_supplemental_rules','[]')||coalesce(bundle->'agent_reviewed_supplemental_rules','[]')||arr;
  if jsonb_array_length(all_rules)>=16 or exists(select 1 from jsonb_array_elements(all_rules) r group by r->>'id' having count(*)>1)
   or exists(select 1 from jsonb_array_elements(all_rules) r group by r->>'proposal_id' having count(*)>1)
   or exists(select 1 from jsonb_array_elements(all_rules) r where r->>'proposal_id'=c#>>'{proposal,id}' or r->>'canonical_text'=c#>>'{proposal,proposed_content_md}')
  then raise exception 'Prior capacity or supplemental collision'; end if;
  for item in select value from jsonb_array_elements(arr) loop
   if jsonb_typeof(item) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from (select array_agg(k order by k) from unnest(proof_keys) k)
    or item->>'schema_version' is distinct from 'uid.agent-rule-reviewed-supplemental-rule.v1'
    or item->>'decision_kind' is distinct from 'agent_rule_review' or item->'visual_qc_performed' is distinct from 'false'
    or item->>'review_scope' is distinct from 'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC'
    or item->>'evaluator_version' is distinct from 'dot-agent-v3-rule-semantics'
    or coalesce(item->>'request_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(item->>'proposal_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or item->>'attempt_id' is distinct from (item->>'request_id')||':'||split_part(item->>'attempt_id',':',2)
    or split_part(item->>'attempt_id',':',2) !~ '^[1-9][0-9]{0,8}$'
    or item->>'id' is distinct from 'agent-rule:'||(item->>'attempt_id')
    or coalesce(item->>'snapshot_hash','') !~ '^sha256:[0-9a-f]{64}$' or coalesce(item->>'review_hash','') !~ '^[0-9a-f]{64}$'
    or uid_rule_v3_private.operation_for(item->>'canonical_text',item->>'declared_scope') is null
    or jsonb_typeof(item->'scope') is distinct from 'object'
    or jsonb_typeof(item#>'{scope,brands}') is distinct from 'array'
    or (item#>'{scope,brands}' @> jsonb_build_array(t->>'brand_slug')) is distinct from true
    or item#>'{scope,branches}' is distinct from jsonb_build_array(t->>'slug')
    or coalesce(item->>'rule_class','') not in ('STRUCTURAL','BRAND_STYLE','WORKFLOW')
    or coalesce(item->>'confidence','') not in ('HIGH','MEDIUM')
    or item->>'precedence' is distinct from 'SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH'
    or item->'source' is distinct from jsonb_build_object('node','branch','locator','agent-rule:'||(item->>'proposal_id')||':'||(item->>'attempt_id'),
       'canonical_text_hash',encode(sha256(convert_to(item->>'canonical_text','UTF8')),'hex'))
    or jsonb_typeof(item->'accepted_source_hashes') is distinct from 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(item->'accepted_source_hashes') k) is distinct from array['branch','brand_dna']
    or coalesce(item#>>'{accepted_source_hashes,branch}','') !~ '^[0-9a-f]{64}$'
    or coalesce(item#>>'{accepted_source_hashes,brand_dna}','') !~ '^[0-9a-f]{64}$'
    or position(item->>'canonical_text' in coalesce(t->>'content_md',''))=0
   then raise exception 'Malformed or unbound prior agent-rule provenance'; end if;
  end loop;
  if bundle->>'schema_version'='uid-creative-quality/4' then
   bundle:=(bundle-'agent_rule_reviewed_supplemental_rules')||jsonb_build_object('schema_version',
    case when jsonb_array_length(coalesce(bundle->'agent_reviewed_supplemental_rules','[]'))>0 then 'uid-creative-quality/3'
     when jsonb_array_length(coalesce(bundle->'owner_supplemental_rules','[]'))>0 then 'uid-creative-quality/2' else 'uid-creative-quality/1' end);
   contracts:=jsonb_set(contracts,array[slug],bundle);
  end if;
 end loop;
 adapted:=catalog||jsonb_build_object('contracts',contracts);
 select jsonb_agg(jsonb_set(t,'{metadata,creative_quality_contract}',adapted) order by t->>'id') into targets from jsonb_array_elements(c->'targets') t;
 c:=jsonb_set(c,'{targets}',targets);
 select jsonb_agg(jsonb_set(t,'{metadata,creative_quality_contract}',adapted) order by t->>'id') into targets from jsonb_array_elements(c#>'{compiler_context,projected_targets}') t;
 return jsonb_set(c,'{compiler_context,projected_targets}',targets);
end $$;
revoke all on all functions in schema uid_rule_v3_private from public,anon,authenticated,service_role;
