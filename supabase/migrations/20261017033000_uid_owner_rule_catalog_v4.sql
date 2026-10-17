-- Owner-direct writes may append to an existing delegated-rule /4 catalog.
-- Preserve every prior provenance layer. The pinned v1-v3 compilers, review
-- functions, grants and authority boundaries are deliberately unchanged.
-- CREATE OR REPLACE retains the existing function owner and execute ACL.
create or replace function public.uid_rule_catalog_plan(p_context jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 spec jsonb:=public.uid_rule_parse_canonical(p_context#>>'{proposal,proposed_content_md}');
 catalog jsonb; base_catalog jsonb; contracts jsonb; bundle jsonb; new_bundle jsonb; target jsonb; projected jsonb; dna jsonb;
 brands jsonb; brand_slug text; branch text:=p_context#>>'{scope,branch_slug}';
 proposal_id text:=p_context#>>'{proposal,id}'; owner_user_id text:=p_context#>>'{compiler_context,owner_user_id}';
 canonical_text text:=btrim(p_context#>>'{proposal,proposed_content_md}');
 supplement jsonb; source_hashes jsonb; found_compiled boolean:=false;
 all_rules jsonb; item jsonb; prior_spec jsonb; field text; key text; proof_keys text[]; body_text text;
 common_keys text[]:=array['schema_version','id','proposal_id','decision_kind','canonical_text','declared_scope','scope','rule_class','confidence','source','accepted_source_hashes','precedence'];
 review_keys text[]:=array['request_id','attempt_id','evaluator_version','snapshot_hash','review_hash','review_scope'];
begin
 if spec is null or owner_user_id is null then raise exception 'Strict canonical rule schema and verified owner required'; end if;
 select jsonb_agg(slug order by slug collate "C") into brands from (select distinct t->>'brand_slug' slug from jsonb_array_elements(p_context->'targets') t) b;
 if brands is null or exists(select 1 from jsonb_array_elements(brands) x where x='null' or x='""') then raise exception 'Exact brand slugs required for runtime scope'; end if;
 for target in select value from jsonb_array_elements(p_context->'targets') loop
  catalog:=target#>'{metadata,creative_quality_contract}';
  if catalog is null then continue; end if;
  if catalog->>'schema_version' is distinct from 'uid-creative-quality-catalog/1' or jsonb_typeof(catalog->'contracts') is distinct from 'object' then raise exception 'Supported shared quality catalog required'; end if;
  if base_catalog is null then base_catalog:=catalog; elsif base_catalog is distinct from catalog then raise exception 'All target catalogs must match the displayed master catalog'; end if;
  found_compiled:=true;
 end loop;
 if not found_compiled then return null; end if;
 if exists(select 1 from jsonb_array_elements(p_context->'targets') t where t#>'{metadata,creative_quality_contract}' is null) then raise exception 'Mixed compiled and uncompiled target scope is unsupported'; end if;
 contracts:=base_catalog->'contracts';
 -- A /4 projection must retain the complete original shared catalog; never
 -- normalize a divergent mirror by throwing away its provenance first.
 if exists(select 1 from jsonb_each(contracts) b where b.value->>'schema_version'='uid-creative-quality/4' or b.value ? 'agent_rule_reviewed_supplemental_rules') then
  if (select count(*) from jsonb_object_keys(contracts))>16
   or exists(select 1 from jsonb_array_elements(p_context#>'{compiler_context,projected_targets}') t where t#>'{metadata,creative_quality_contract}' is distinct from base_catalog)
  then raise exception 'Prior catalog or mirror provenance drift'; end if;
 end if;
 for target in select value from jsonb_array_elements(p_context->'targets') loop
  brand_slug:=target->>'brand_slug'; bundle:=contracts->brand_slug;
  if (bundle->>'schema_version' is null or bundle->>'schema_version' not in ('uid-creative-quality/1','uid-creative-quality/2','uid-creative-quality/3','uid-creative-quality/4')) or jsonb_typeof(bundle->'rules') is distinct from 'array' or jsonb_typeof(bundle->'references') is distinct from 'array'
   or jsonb_array_length(bundle->'rules') not between 1 and 80 or jsonb_array_length(bundle->'references')>48
   or (bundle ? 'owner_supplemental_rules' and jsonb_typeof(bundle->'owner_supplemental_rules') is distinct from 'array')
   or (bundle ? 'agent_reviewed_supplemental_rules' and jsonb_typeof(bundle->'agent_reviewed_supplemental_rules') is distinct from 'array')
   or (bundle ? 'agent_rule_reviewed_supplemental_rules' and jsonb_typeof(bundle->'agent_rule_reviewed_supplemental_rules') is distinct from 'array')
  then raise exception 'Supported bounded quality bundle required'; end if;
  if (bundle->>'schema_version'='uid-creative-quality/1' and (bundle ? 'owner_supplemental_rules' or bundle ? 'agent_reviewed_supplemental_rules'))
   or (bundle->>'schema_version'='uid-creative-quality/2' and (not bundle ? 'owner_supplemental_rules' or jsonb_array_length(bundle->'owner_supplemental_rules')=0 or bundle ? 'agent_reviewed_supplemental_rules'))
   or (bundle->>'schema_version'='uid-creative-quality/3' and (not bundle ? 'agent_reviewed_supplemental_rules' or jsonb_array_length(bundle->'agent_reviewed_supplemental_rules')=0)) or (bundle->>'schema_version'='uid-creative-quality/4' and (not bundle ? 'agent_rule_reviewed_supplemental_rules' or jsonb_array_length(bundle->'agent_rule_reviewed_supplemental_rules')=0))
   or (bundle ? 'agent_rule_reviewed_supplemental_rules' and bundle->>'schema_version'<>'uid-creative-quality/4')
  then raise exception 'Quality bundle schema does not match its supplemental capability'; end if;
  all_rules:=coalesce(bundle->'owner_supplemental_rules','[]')||coalesce(bundle->'agent_reviewed_supplemental_rules','[]')||coalesce(bundle->'agent_rule_reviewed_supplemental_rules','[]');
  if jsonb_array_length(all_rules)>=16 then raise exception 'Owner supplemental rule capacity reached'; end if;
  -- Legacy /1-/3 behavior is unchanged. /4 additionally validates every
  -- retained supplemental envelope before allowing a new owner decision.
  if bundle->>'schema_version'='uid-creative-quality/4' then
   -- The v4 reader validates its preserved legacy representation too. Empty
   -- legacy arrays cannot claim /1 or /2 capabilities after that projection.
   if jsonb_array_length(coalesce(bundle->'agent_reviewed_supplemental_rules','[]'))=0
    and (bundle ? 'agent_reviewed_supplemental_rules' or (bundle ? 'owner_supplemental_rules' and jsonb_array_length(bundle->'owner_supplemental_rules')=0))
   then raise exception 'Prior supplemental arrays do not match the legacy capability'; end if;
   if exists(select 1 from jsonb_array_elements(all_rules) r group by r->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(all_rules) r group by r->>'proposal_id' having count(*)>1)
   then raise exception 'Prior supplemental identity collision'; end if;
   foreach field in array array['owner_supplemental_rules','agent_reviewed_supplemental_rules','agent_rule_reviewed_supplemental_rules'] loop
    proof_keys:=common_keys||case field when 'owner_supplemental_rules' then array['semantic_consistency','visual_qc_performed']
     when 'agent_reviewed_supplemental_rules' then review_keys else review_keys||array['visual_qc_performed'] end;
    for item in select value from jsonb_array_elements(coalesce(bundle->field,'[]')) loop
     if jsonb_typeof(item) is distinct from 'object' then raise exception 'Malformed prior supplemental provenance'; end if;
     if (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from (select array_agg(k order by k) from unnest(proof_keys) k)
     then raise exception 'Malformed prior supplemental provenance keys'; end if;
     for key in select jsonb_object_keys(item) loop
      if key not in ('scope','source','accepted_source_hashes','visual_qc_performed') and jsonb_typeof(item->key) is distinct from 'string'
      then raise exception 'Malformed prior supplemental provenance scalar'; end if;
     end loop;
     prior_spec:=public.uid_rule_parse_canonical(item->>'canonical_text');
     body_text:=regexp_replace(item->>'canonical_text',E'(?m)^## (Generalized Rule|Expected Behavior|Reject Conditions|Scope|Rule Class|Confidence)\n','','g');
     if prior_spec is null or length(item->>'canonical_text')>16000
      or item->>'canonical_text' is distinct from btrim(item->>'canonical_text',E' \t\r\n')
      or item->>'canonical_text' ~ U&'[\0001-\0008\000B-\001F]'
      or body_text ~ E'(?m)^#{1,6}[[:space:]]' or body_text ~ '```|~~~'
      or jsonb_array_length(prior_spec->'reject_conditions')=0
      or (select sum(length(value)+2)+count(*)-1 from jsonb_array_elements_text(prior_spec->'reject_conditions'))>4000
      or prior_spec->'scope' is distinct from item->'declared_scope'
      or prior_spec->'rule_class' is distinct from item->'rule_class' or prior_spec->'confidence' is distinct from item->'confidence'
      or item->>'rule_class' not in ('STRUCTURAL','BRAND_STYLE','WORKFLOW') or item->>'confidence' not in ('HIGH','MEDIUM')
      or item->>'proposal_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or item->>'precedence' is distinct from 'SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH'
      or jsonb_typeof(item->'scope') is distinct from 'object'
      or jsonb_typeof(item->'accepted_source_hashes') is distinct from 'object'
      or position(item->>'canonical_text' in coalesce(target->>'content_md',''))=0
     then raise exception 'Malformed or unbound prior supplemental body'; end if;
     if (select array_agg(k order by k) from jsonb_object_keys(item->'scope') k) is distinct from array['branches','brands']
      or jsonb_typeof(item#>'{scope,brands}') is distinct from 'array' or jsonb_typeof(item#>'{scope,branches}') is distinct from 'array'
     then raise exception 'Malformed prior supplemental scope'; end if;
     if jsonb_array_length(item#>'{scope,brands}') not between 1 and 80 or jsonb_array_length(item#>'{scope,branches}') not between 1 and 80
      or (item#>'{scope,brands}' @> jsonb_build_array(brand_slug)) is distinct from true
      or (item#>'{scope,branches}' @> jsonb_build_array(branch)) is distinct from true
      or exists(select 1 from jsonb_array_elements((item#>'{scope,brands}')||(item#>'{scope,branches}')) v
       where jsonb_typeof(v) is distinct from 'string' or length(btrim(v#>>'{}',E' \t\r\n'))=0 or length(v#>>'{}')>500 or v='"*"'::jsonb)
      or (select array_agg(k order by k) from jsonb_object_keys(item->'accepted_source_hashes') k) is distinct from array['branch','brand_dna']
      or jsonb_typeof(item#>'{accepted_source_hashes,branch}') is distinct from 'string'
      or jsonb_typeof(item#>'{accepted_source_hashes,brand_dna}') is distinct from 'string'
      or item#>>'{accepted_source_hashes,branch}' !~ '^[0-9a-f]{64}$' or item#>>'{accepted_source_hashes,brand_dna}' !~ '^[0-9a-f]{64}$'
     then raise exception 'Malformed prior supplemental scope or source hashes'; end if;
     if field='owner_supplemental_rules' then
      if item->>'schema_version' is distinct from 'uid.owner-supplemental-rule.v1'
       or item->>'decision_kind' is distinct from 'owner_direct_rule' or item->>'id' is distinct from 'owner:'||(item->>'proposal_id')
       or item->>'semantic_consistency' is distinct from 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS' or item->'visual_qc_performed' is distinct from 'false'::jsonb
       or item->'source' is distinct from jsonb_build_object('node','branch','locator','owner-rule:'||(item->>'proposal_id'),
        'canonical_text_hash',encode(sha256(convert_to(item->>'canonical_text','UTF8')),'hex'))
      then raise exception 'Malformed or unbound prior owner provenance'; end if;
     else
      if item->>'request_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or item->>'attempt_id' !~ ('^'||(item->>'request_id')||':[1-9][0-9]{0,8}$')
       or item->>'snapshot_hash' !~ '^sha256:[0-9a-f]{64}$' or item->>'review_hash' !~ '^[0-9a-f]{64}$'
      then raise exception 'Malformed prior agent review identity'; end if;
      if field='agent_reviewed_supplemental_rules' then
       if item->>'schema_version' is distinct from 'uid.agent-reviewed-supplemental-rule.v1'
        or item->>'decision_kind' is distinct from 'owner_approved_agent_review' or item->>'evaluator_version' is distinct from 'dot-agent-v1-source-media'
        or item->>'review_scope' is distinct from 'PINNED_EVIDENCE_ONLY_NOT_FUTURE_OUTPUT_GUARANTEE'
        or item->>'id' is distinct from 'agent-review:'||(item->>'attempt_id')
        or item->'source' is distinct from jsonb_build_object('node','branch','locator','agent-review:'||(item->>'proposal_id')||':'||(item->>'attempt_id'),
         'canonical_text_hash',encode(sha256(convert_to(item->>'canonical_text','UTF8')),'hex'))
       then raise exception 'Malformed or unbound prior media-review provenance'; end if;
      else
       if item->>'schema_version' is distinct from 'uid.agent-rule-reviewed-supplemental-rule.v1'
        or item->>'decision_kind' is distinct from 'agent_rule_review' or item->>'evaluator_version' is distinct from 'dot-agent-v3-rule-semantics'
        or item->>'review_scope' is distinct from 'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC' or item->'visual_qc_performed' is distinct from 'false'::jsonb
        or item->>'id' is distinct from 'agent-rule:'||(item->>'attempt_id')
        or item->'source' is distinct from jsonb_build_object('node','branch','locator','agent-rule:'||(item->>'proposal_id')||':'||(item->>'attempt_id'),
         'canonical_text_hash',encode(sha256(convert_to(item->>'canonical_text','UTF8')),'hex'))
       then raise exception 'Malformed or unbound prior agent-rule provenance'; end if;
      end if;
     end if;
    end loop;
   end loop;
  end if;
  if (select count(*) from jsonb_array_elements(p_context#>'{compiler_context,brand_dna_nodes}') n where n->>'brand_id'=target->>'brand_id')<>1 then raise exception 'Exactly one current active brand DNA node required per target'; end if;
  select value into dna from jsonb_array_elements(p_context#>'{compiler_context,brand_dna_nodes}') n where n->>'brand_id'=target->>'brand_id';
  if bundle#>>'{source_hashes,branch}' is distinct from public.uid_rule_source_hash(target) or bundle#>>'{source_hashes,brand_dna}' is distinct from public.uid_rule_source_hash(dna) then raise exception 'Existing quality catalog is stale; refresh through its canonical review flow first'; end if;
  if exists(select 1 from jsonb_array_elements(all_rules) old where old->>'proposal_id'=proposal_id or old->>'id'='owner:'||proposal_id or old->>'canonical_text'=canonical_text) then raise exception 'An existing supplemental rule already contains this owner rule identity or text'; end if;
  select value into projected from jsonb_array_elements(p_context#>'{compiler_context,projected_targets}') n where n->>'id'=target->>'id';
  source_hashes:=jsonb_build_object('branch',public.uid_rule_source_hash(projected),'brand_dna',public.uid_rule_source_hash(dna));
  supplement:=jsonb_build_object('schema_version','uid.owner-supplemental-rule.v1','id','owner:'||proposal_id,'proposal_id',proposal_id,'decision_kind','owner_direct_rule',
   'canonical_text',canonical_text,'declared_scope',spec->'scope','scope',jsonb_build_object('brands',brands,'branches',jsonb_build_array(branch)),'rule_class',spec->'rule_class','confidence',spec->'confidence',
   'source',jsonb_build_object('node','branch','locator','owner-rule:'||proposal_id,'canonical_text_hash',encode(sha256(convert_to(canonical_text,'UTF8')),'hex')),
   'accepted_source_hashes',source_hashes,'precedence','SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH','semantic_consistency','NOT_PROVEN_BY_DETERMINISTIC_CHECKS','visual_qc_performed',false);
  new_bundle:=bundle||jsonb_build_object('schema_version',case when bundle->>'schema_version'='uid-creative-quality/4' then 'uid-creative-quality/4' when jsonb_array_length(coalesce(bundle->'agent_reviewed_supplemental_rules','[]'))>0 then 'uid-creative-quality/3' else 'uid-creative-quality/2' end,'revision','owner-rule:'||proposal_id,'source_hashes',source_hashes,'owner_supplemental_rules',coalesce(bundle->'owner_supplemental_rules','[]')||jsonb_build_array(supplement));
  if length(public.uid_rule_stable_json(new_bundle))>100000 then raise exception 'Quality bundle exceeds bounded compiler capacity'; end if;
  contracts:=jsonb_set(contracts,array[brand_slug],new_bundle);
 end loop;
 return base_catalog||jsonb_build_object('contracts',contracts);
end $$;
