-- Agent review compilation is a distinct provenance layer, never owner-direct
-- acceptance. Source/media inspection stays a trusted executor attestation;
-- SQL independently validates authority, leases, evidence identity/coverage,
-- exact permitted catalog delta and projected source hashes. Runtime contract
-- hashes attest execution of the pinned host compiler, not TypeScript in SQL.
alter table public.uid_agent_review_evaluations
 add column review_hash text,
 add column compiler_plan jsonb,
 add column compiler_plan_hash text,
 add column compiler_receipt jsonb;
comment on column public.uid_agent_review_evaluations.compiler_receipt is
 'Immutable pinned host compiler execution attestation; deterministic compilation alone never satisfies genuine source/media review.';

-- Exact frozen compiler source identity. Release automation separately pins the
-- verified published checkout. No mutable config or proposal-chosen executable.
create function uid_rule_private.review_compiler_capability() returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select '{"schema_version":"uid.agent-compiler-capability.v1","manifest_id":"uid.agent-compiler-source.v1","compiler_version":"2026-10-13-agent-supplement-v1","source_manifest":[{"path":"bun.lock","sha256":"c3589879622959a29743bf1518f14c6bec6d4db97fe9c0ab23367213be234d04"},{"path":"package.json","sha256":"650a70bfe5a22f9995e2959210d1d3027b1f5d7dd812a033e0064e97122df9be"},{"path":"scripts/agent-review-compiler.bundle.mjs","sha256":"2b44b574a472e5ff9f34868a51839ebd3403d55adc8b08d0cf6516c3615f8492"},{"path":"scripts/compile-agent-review-plan.mjs","sha256":"1cb94b5e19cb537cc56578a1d68829c3d2bbc8154351e6941e0f2535f5f550c7"},{"path":"supabase/functions/_shared/agent-review-plan.ts","sha256":"83eae14ef55a599156d3abfc2de2bb2ad154ee8d19e8f8250341d3dfce3e98c3"},{"path":"supabase/functions/_shared/creative-quality.ts","sha256":"fa00f4830721ba62f246875a78b5378af3429890d3ad052cd90e48c570f1b2ef"},{"path":"supabase/functions/_shared/owner-rule-plan.ts","sha256":"4e00926adca7ca231fa4149bb82d1648525321661f1e15986f76e2e9131aa0a9"}],"compiler_bundle_hash":"317ccf1296b56de084b55b1079daa55300e9e081a7c653811b3895c5476a7a4b","required_node_major":24,"release_ready":true}'::jsonb
$$;
revoke all on function uid_rule_private.review_compiler_capability() from public,anon,authenticated,service_role;

create function uid_rule_private.review_core(p_review jsonb) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_object('schema_version',p_review->'schema_version','decision',p_review->'decision',
  'review_note',p_review->'review_note','media_receipts',p_review->'media_receipts','findings',p_review->'findings')
$$;
revoke all on function uid_rule_private.review_core(jsonb) from public,anon,authenticated,service_role;

-- A shared internal writer. Its callers independently reconstruct and validate
-- their distinct owner-direct or agent-reviewed catalog before reaching it.
-- It writes the master once and verifies the actual full trigger closure.
create function uid_rule_private.apply_projected_catalog(p_context jsonb,p_catalog jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare target jsonb; metadata jsonb; expected jsonb; actual jsonb; entry jsonb; expected_targets jsonb:='[]';
begin
 for target in select value from jsonb_array_elements(p_context#>'{compiler_context,projected_targets}') loop
  metadata:=target->'metadata';
  if p_catalog is not null then metadata:=jsonb_set(metadata,'{creative_quality_contract}',p_catalog); end if;
  expected_targets:=expected_targets||jsonb_build_array(jsonb_build_object('node_id',target->'id','content_md',target->'content_md','metadata',metadata));
 end loop;
 for entry in select value from jsonb_array_elements(expected_targets)
  where p_context#>>'{scope,branch_slug}'<>'onepage-system' or value->>'node_id'=p_context#>>'{compiler_context,master_node_id}' order by value->>'node_id' loop
  update public.knowledge_nodes set content_md=entry->>'content_md',metadata=entry->'metadata',updated_at=now() where id=(entry->>'node_id')::uuid;
 end loop;
 for target in select value from jsonb_array_elements(p_context#>'{compiler_context,projected_targets}') loop
  select value into entry from jsonb_array_elements(expected_targets) where value->>'node_id'=target->>'id';
  select to_jsonb(n) into actual from public.knowledge_nodes n where id=(target->>'id')::uuid;
  expected:=target||jsonb_build_object('metadata',entry->'metadata');
  if actual-'updated_at' is distinct from expected-'updated_at' then raise exception 'Canonical node did not match exact approved projection after triggers'; end if;
 end loop;
end $$;
revoke all on function uid_rule_private.apply_projected_catalog(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.uid_rule_catalog_plan(p_context jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 spec jsonb:=public.uid_rule_parse_canonical(p_context#>>'{proposal,proposed_content_md}');
 catalog jsonb; base_catalog jsonb; contracts jsonb; bundle jsonb; new_bundle jsonb; target jsonb; projected jsonb; dna jsonb;
 brands jsonb; brand_slug text; branch text:=p_context#>>'{scope,branch_slug}';
 proposal_id text:=p_context#>>'{proposal,id}'; owner_user_id text:=p_context#>>'{compiler_context,owner_user_id}';
 canonical_text text:=btrim(p_context#>>'{proposal,proposed_content_md}');
 supplement jsonb; source_hashes jsonb; found_compiled boolean:=false;
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
 for target in select value from jsonb_array_elements(p_context->'targets') loop
  brand_slug:=target->>'brand_slug'; bundle:=contracts->brand_slug;
  if (bundle->>'schema_version' is null or bundle->>'schema_version' not in ('uid-creative-quality/1','uid-creative-quality/2','uid-creative-quality/3')) or jsonb_typeof(bundle->'rules') is distinct from 'array' or jsonb_typeof(bundle->'references') is distinct from 'array'
   or jsonb_array_length(bundle->'rules') not between 1 and 80 or jsonb_array_length(bundle->'references')>48
   or (bundle ? 'owner_supplemental_rules' and jsonb_typeof(bundle->'owner_supplemental_rules') is distinct from 'array')
   or (bundle ? 'agent_reviewed_supplemental_rules' and jsonb_typeof(bundle->'agent_reviewed_supplemental_rules') is distinct from 'array')
  then raise exception 'Supported bounded quality bundle required'; end if;
  if (bundle->>'schema_version'='uid-creative-quality/1' and (bundle ? 'owner_supplemental_rules' or bundle ? 'agent_reviewed_supplemental_rules'))
   or (bundle->>'schema_version'='uid-creative-quality/2' and (not bundle ? 'owner_supplemental_rules' or jsonb_array_length(bundle->'owner_supplemental_rules')=0 or bundle ? 'agent_reviewed_supplemental_rules'))
   or (bundle->>'schema_version'='uid-creative-quality/3' and (not bundle ? 'agent_reviewed_supplemental_rules' or jsonb_array_length(bundle->'agent_reviewed_supplemental_rules')=0)) then raise exception 'Quality bundle schema does not match its supplemental capability'; end if;
  if jsonb_array_length(coalesce(bundle->'owner_supplemental_rules','[]'))+jsonb_array_length(coalesce(bundle->'agent_reviewed_supplemental_rules','[]'))>=16 then raise exception 'Owner supplemental rule capacity reached'; end if;
  if (select count(*) from jsonb_array_elements(p_context#>'{compiler_context,brand_dna_nodes}') n where n->>'brand_id'=target->>'brand_id')<>1 then raise exception 'Exactly one current active brand DNA node required per target'; end if;
  select value into dna from jsonb_array_elements(p_context#>'{compiler_context,brand_dna_nodes}') n where n->>'brand_id'=target->>'brand_id';
  if bundle#>>'{source_hashes,branch}' is distinct from public.uid_rule_source_hash(target) or bundle#>>'{source_hashes,brand_dna}' is distinct from public.uid_rule_source_hash(dna) then raise exception 'Existing quality catalog is stale; refresh through its canonical review flow first'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(bundle->'owner_supplemental_rules','[]')||coalesce(bundle->'agent_reviewed_supplemental_rules','[]')) old where old->>'proposal_id'=proposal_id or old->>'id'='owner:'||proposal_id or old->>'canonical_text'=canonical_text) then raise exception 'An existing supplemental rule already contains this owner rule identity or text'; end if;
  select value into projected from jsonb_array_elements(p_context#>'{compiler_context,projected_targets}') n where n->>'id'=target->>'id';
  source_hashes:=jsonb_build_object('branch',public.uid_rule_source_hash(projected),'brand_dna',public.uid_rule_source_hash(dna));
  supplement:=jsonb_build_object('schema_version','uid.owner-supplemental-rule.v1','id','owner:'||proposal_id,'proposal_id',proposal_id,'decision_kind','owner_direct_rule',
   'canonical_text',canonical_text,'declared_scope',spec->'scope','scope',jsonb_build_object('brands',brands,'branches',jsonb_build_array(branch)),'rule_class',spec->'rule_class','confidence',spec->'confidence',
   'source',jsonb_build_object('node','branch','locator','owner-rule:'||proposal_id,'canonical_text_hash',encode(sha256(convert_to(canonical_text,'UTF8')),'hex')),
   'accepted_source_hashes',source_hashes,'precedence','SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH','semantic_consistency','NOT_PROVEN_BY_DETERMINISTIC_CHECKS','visual_qc_performed',false);
  new_bundle:=bundle||jsonb_build_object('schema_version',case when jsonb_array_length(coalesce(bundle->'agent_reviewed_supplemental_rules','[]'))>0 then 'uid-creative-quality/3' else 'uid-creative-quality/2' end,'revision','owner-rule:'||proposal_id,'source_hashes',source_hashes,'owner_supplemental_rules',coalesce(bundle->'owner_supplemental_rules','[]')||jsonb_build_array(supplement));
  if length(public.uid_rule_stable_json(new_bundle))>100000 then raise exception 'Quality bundle exceeds bounded compiler capacity'; end if;
  contracts:=jsonb_set(contracts,array[brand_slug],new_bundle);
 end loop;
 return base_catalog||jsonb_build_object('contracts',contracts);
end $$;
revoke all on function public.uid_rule_catalog_plan(jsonb) from public,anon,authenticated,service_role;

create or replace function public.uid_rule_apply_plan(p_context jsonb,p_plan jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare catalog jsonb; expected_targets jsonb:='[]'; target jsonb; metadata jsonb; expected jsonb; actual jsonb; entry jsonb;
begin
 catalog:=public.uid_rule_catalog_plan(p_context);
 for target in select value from jsonb_array_elements(p_context#>'{compiler_context,projected_targets}') loop
  metadata:=target->'metadata';
  if catalog is not null then metadata:=jsonb_set(metadata,'{creative_quality_contract}',catalog); end if;
  expected_targets:=expected_targets||jsonb_build_array(jsonb_build_object('node_id',target->'id','content_md',target->'content_md','metadata',metadata,'version',target->'version','input_schema',target->'input_schema','status',target->'status','confidence',target->'confidence'));
 end loop;
 if catalog is not null or p_plan is not null then
  if jsonb_typeof(p_plan) is distinct from 'object' or p_plan->>'schema_version' is distinct from 'uid.owner-rule-plan.v1'
   or p_plan->'candidate_hash' is distinct from p_context->'candidate_hash' or jsonb_typeof(p_plan->'targets') is distinct from 'array'
   or p_plan->'rule_hash' is distinct from p_context#>'{direct_rule,rule_hash}'
   or exists(select 1 from jsonb_object_keys(p_plan) k where k not in ('schema_version','candidate_hash','rule_hash','targets'))
  then raise exception 'Exact server-computed compiler plan required'; end if;
  select jsonb_agg(value order by value->>'node_id') into actual from jsonb_array_elements(p_plan->'targets');
  select jsonb_agg(value order by value->>'node_id') into expected from jsonb_array_elements(expected_targets);
  if actual is distinct from expected then raise exception 'Compiler plan differs from the exact permitted rule/catalog/source delta'; end if;
 end if;
 perform uid_rule_private.apply_projected_catalog(p_context,catalog);
end $$;
revoke all on function public.uid_rule_apply_plan(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.uid_review_snapshot(p_proposal_id uuid) returns jsonb
 language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb; s jsonb; runs jsonb; manifest jsonb;
begin
 c:=public.uid_rule_context(p_proposal_id);
 if c is not null then c:=jsonb_set(c,'{compiler_context,owner_user_id}',(select to_jsonb(owner_user_id) from uid_rule_private.owner_config where singleton and enabled)); end if;
 if c is null then return null; end if;
 select to_jsonb(n) into s from public.knowledge_nodes n where n.id=(c#>>'{proposal,knowledge_node_id}')::uuid;
 select coalesce(jsonb_agg(jsonb_build_object(
  'baseline_id',b->>'id','case_key',b->>'case_key','source_run_id',r->>'source_run_id',
  'artifact_url',r->>'artifact_url','output',r->'candidate_output',
  'evaluation_id',e.id,'evaluation_record_version',public.uid_review_digest(to_jsonb(e)),
  'evaluation_record',to_jsonb(e),'test_result_count',(select count(*) from jsonb_array_elements(e.test_results) x where x->>'baseline_id'=b->>'id')
 ) order by b->>'id'),'[]') into runs
 from jsonb_array_elements(c->'baselines') b
 join lateral (
  select ev.* from public.uid_governance_evaluations ev
  where ev.proposal_id=p_proposal_id and ev.candidate_hash=c->>'candidate_hash'
   and ev.evaluator_version='mechanical-v2-scope-freshness' and jsonb_typeof(ev.test_results)='array'
   and exists(select 1 from jsonb_array_elements(ev.test_results) x where x->>'baseline_id'=b->>'id')
  order by ev.created_at desc,ev.id desc limit 1
 )e on true
 join lateral (select value r from jsonb_array_elements(e.test_results) where value->>'baseline_id'=b->>'id' limit 1)r on true
 where b->>'approved_at' is not null and b->'is_reference_only'='false'::jsonb;
 with baselines as (
  select b from jsonb_array_elements(c->'baselines') b where b->>'approved_at' is not null and b->'is_reference_only'='false'::jsonb
 ), docs as (
  select b->>'id' baseline_id,b->>'brand_id' brand_id,'source' kind,'source_brief' origin,b->'source_brief' doc,public.uid_review_digest(b-'is_reference_only') record_version from baselines
  union all select b->>'id',b->>'brand_id','source','context_images',c#>'{proposal,context_images}',public.uid_review_digest(c->'proposal') from baselines
  union all select b->>'id',b->>'brand_id','baseline','approved_output',b->'approved_output',public.uid_review_digest(b-'is_reference_only') from baselines
  union all select b->>'id',b->>'brand_id','candidate','candidate_artifact',to_jsonb(r->>'artifact_url'),r->>'evaluation_record_version' from baselines join jsonb_array_elements(runs) r on r->>'baseline_id'=b->>'id'
  union all select b->>'id',b->>'brand_id','candidate','candidate_output',r->'output',r->>'evaluation_record_version' from baselines join jsonb_array_elements(runs) r on r->>'baseline_id'=b->>'id'
 ), evidence as (
  select jsonb_build_object('kind',d.kind,'origin',d.origin,'baseline_id',d.baseline_id,'brand_id',d.brand_id,
    'path',u.path,'locator',u.locator,'record_version',d.record_version,
    'expected_content_sha256',u.expected_content_sha256,'object_version',u.object_version) item
  from docs d cross join lateral public.uid_review_urls(d.doc)u
 ) select coalesce(jsonb_agg(item||jsonb_build_object('evidence_id',public.uid_review_digest(item)) order by item::text),'[]') into manifest from evidence;
 return jsonb_build_object('schema_version','uid.review-snapshot.v2','proposal',c->'proposal','source',s,
  'scope',c->'scope','candidate_hash',c->'candidate_hash','targets',c->'targets','baselines',c->'baselines',
  'eligible_baseline_ids',c->'eligible_baseline_ids','candidate_runs',runs,'media_manifest',manifest,
  'dependent_nodes',c#>'{compiler_context,dependent_nodes}',
  'rule_context',c,'compiler_capability',uid_rule_private.review_compiler_capability());
end $$;


revoke all on function public.uid_review_snapshot(uuid) from public,anon,authenticated,service_role;

create or replace function public.uid_review_checks(p_snapshot jsonb) returns jsonb
 language plpgsql immutable set search_path=public,pg_temp as $$
declare blockers jsonb:='[]'; results jsonb:='[]'; issues jsonb; b jsonb; r jsonb; t jsonb; a jsonb; key text; val jsonb; token text; output_text text; n integer; bad boolean; critical integer:=0;
begin
 -- Active dependent children are outside the reviewed mutation set. No current
 -- compiler plan expands/applies them, even for an otherwise uncompiled parent.
 -- Their complete rows are pinned in every v2 attempt snapshot; missing shape
 -- also fails closed instead of treating unknown dependencies as an empty set.
 if jsonb_typeof(p_snapshot->'dependent_nodes') is distinct from 'array'
   or p_snapshot->'dependent_nodes'<>'[]'::jsonb then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unsupported_dependency_scope',
   'message','Active dependent child nodes fall outside the reviewed canonical mutation scope.',
   'next_action','Keep this proposal pending. A supported dependency-aware update must include and review the complete affected scope before it can merge.'));
 end if;
 if p_snapshot is null or coalesce(jsonb_array_length(p_snapshot->'targets'),0)=0 or p_snapshot#>>'{proposal,status}' is distinct from 'pending' then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unavailable_scope','message','Pending feedback and active canonical targets required.','next_action','Refresh the feedback and verify its scope.'));
 end if;
 for t in select value from jsonb_array_elements(coalesce(p_snapshot->'targets','[]')) loop
  if not exists(select 1 from jsonb_array_elements(p_snapshot->'baselines') x where x->>'brand_id' is not distinct from t->>'brand_id' and x->>'approved_at' is not null and x->'is_reference_only'='false'::jsonb) then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_baseline','message','An approved non-reference quality baseline is missing for '||coalesce(t->>'brand_name','this brand')||'.','next_action','An administrator must supply and approve a genuine quality baseline for every affected brand.'));
  end if;
 end loop;
 if coalesce(jsonb_array_length(p_snapshot->'eligible_baseline_ids'),0)=0 then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_baseline','message','No approved non-reference quality baseline.','next_action','Supply approved quality baselines; saved reference corpora cannot approve a change.'));
 end if;
 for b in select value from jsonb_array_elements(coalesce(p_snapshot->'baselines','[]')) where value->>'approved_at' is not null and value->'is_reference_only'='false'::jsonb loop
  issues:='[]';
  select count(*) into n from jsonb_array_elements(p_snapshot->'candidate_runs') x where x->>'baseline_id'=b->>'id';
  select value into r from jsonb_array_elements(p_snapshot->'candidate_runs') x where x->>'baseline_id'=b->>'id' limit 1;
  if n<>1 or r->'test_result_count' is distinct from '1'::jsonb or r->>'case_key' is distinct from b->>'case_key'
   or coalesce(length(btrim(r->>'source_run_id')),0)=0 or coalesce(r->>'artifact_url','')!~'^https://[^[:space:]]+$'
   or jsonb_typeof(r->'output') is distinct from 'object' or r->'output'='{}'::jsonb then
   issues:=issues||jsonb_build_array('Exactly one stored candidate output, run ID and HTTPS artifact is required.');
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_candidate','message','Missing or invalid candidate for baseline '||(b->>'case_key')||'.','next_action','Record a real candidate run for the current proposal hash. The unchanged unexpired approval can receive a fresh claim and review when evidence arrives.'));
  else
   a:=b->'expected_assertions'; bad:=jsonb_typeof(a) is distinct from 'object'; n:=0;
   foreach key in array array['required_text','forbidden_text','required_keys','immutable_fields'] loop
    if a ? key then
     if jsonb_typeof(a->key) is distinct from 'array' then bad:=true;
     else
      n:=n+jsonb_array_length(a->key);
      for val in select value from jsonb_array_elements(a->key) loop
       if jsonb_typeof(val) is distinct from 'string' or length(btrim(val#>>'{}'))=0 then bad:=true; end if;
      end loop;
     end if;
    end if;
   end loop;
   if bad or n=0 then issues:=issues||jsonb_build_array('Approved assertions are absent or malformed.');
   else
    output_text:=lower((r->'output')::text);
    for token in select value from jsonb_array_elements_text(coalesce(a->'required_text','[]')) loop
     if position(lower(token) in output_text)=0 then issues:=issues||jsonb_build_array('Required statement missing: '||token); end if;
    end loop;
    for token in select value from jsonb_array_elements_text(coalesce(a->'forbidden_text','[]')) loop
     if position(lower(token) in output_text)>0 then issues:=issues||jsonb_build_array('Forbidden statement found: '||token); end if;
    end loop;
    for token in select value from jsonb_array_elements_text(coalesce(a->'required_keys','[]')) loop
     if not (r->'output' ? token) then issues:=issues||jsonb_build_array('Required output field missing: '||token); end if;
    end loop;
    for token in select value from jsonb_array_elements_text(coalesce(a->'immutable_fields','[]')) loop
     if not (r->'output' ? token) or not (b->'approved_output' ? token) or r->'output'->token is distinct from b->'approved_output'->token then
      issues:=issues||jsonb_build_array('Approved immutable field missing or changed: '||token);
     end if;
    end loop;
   end if;
  end if;
  foreach key in array array['source_brief','approved_output','candidate_artifact'] loop
   if not exists(select 1 from jsonb_array_elements(p_snapshot->'media_manifest') m where m->>'baseline_id'=b->>'id' and m->>'origin'=key) then
    blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_media','message','Missing '||key||' HTTPS evidence for baseline '||(b->>'case_key')||'.','next_action','Attach real product-source, approved baseline visual, and candidate media; a fresh claim can review new evidence under the unchanged unexpired approval.'));
   end if;
  end loop;
  if jsonb_array_length(issues)>0 then critical:=critical+jsonb_array_length(issues); end if;
  results:=results||jsonb_build_array(jsonb_build_object('baseline_id',b->>'id','case_key',b->>'case_key','status',case when issues='[]'::jsonb then 'passed' else 'failed' end,'issues',issues));
 end loop;
 if critical>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','mechanical_failed','message','Candidate failed deterministic approved assertions.','next_action','Correct the candidate or approved assertions; run and record the candidate again.')); end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_snapshot->'media_manifest','[]')) m where m->>'locator'!~'^https://[^[:space:]]+$') then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','insecure_media','message','A stored media locator does not use HTTPS.','next_action','Provide secure source and artifact links before review.'));
 end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_snapshot->'media_manifest','[]')) m where m->>'expected_content_sha256' is not null and m->>'expected_content_sha256'!~'^[0-9a-f]{64}$') then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','invalid_digest','message','Stored media digest is malformed.','next_action','Correct the source digest metadata, then claim and review fresh evidence under the unchanged unexpired approval.'));
 end if;
 return jsonb_build_object('blockers',blockers,'mechanical_results',results,'critical_failures',critical);
end $$;

revoke all on function public.uid_review_checks(jsonb) from public,anon,authenticated,service_role;

create or replace function public.uid_review_claim(p_owner_user_id uuid,p_claimant text default 'dot') returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.uid_review_requests%rowtype; s jsonb; h text; checks jsonb; seen uuid[]:='{}'; p public.knowledge_proposals%rowtype; previous text:=current_setting('uid.review_action',true);
begin
 perform public.uid_review_assert_admin(p_owner_user_id);
 if p_claimant is null or length(btrim(p_claimant))=0 or length(p_claimant)>100 then raise exception 'Valid claimant required'; end if;
 lock table public.knowledge_nodes in share mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 lock table public.uid_governance_evaluations in share mode;
 perform set_config('uid.review_action','claim',true);
 loop
  -- Fetch one row at a time: a PL/pgSQL FOR cursor may prefetch/lock multiple
  -- requests and defeat concurrent SKIP LOCKED claimers.
  select * into q from public.uid_review_requests where owner_user_id=p_owner_user_id and not(id=any(seen))
   and (status in ('queued','blocked') or (status='leased' and lease_expires_at<=clock_timestamp()))
   order by created_at,id limit 1 for update skip locked;
  exit when not found;
  seen:=array_append(seen,q.id);
  if q.expires_at<=clock_timestamp() then
   update public.uid_review_requests set status='expired',updated_at=clock_timestamp(),blockers='[{"code":"intent_expired","message":"Approval expired.","next_action":"Review the current feedback and approve again."}]' where id=q.id;
   continue;
  end if;
  select * into p from public.knowledge_proposals where id=q.proposal_id for share;
  if p.status is distinct from 'pending' or p.merged_at is not null or public.uid_review_digest(public.uid_review_intent(q.proposal_id,q.owner_user_id)) is distinct from q.intent_hash then
   update public.uid_review_requests set status='superseded',updated_at=clock_timestamp(),blockers='[{"code":"intent_changed","message":"Feedback patch, target scope, or proposal state changed.","next_action":"Refresh and approve the new feedback if still needed."}]' where id=q.id;
   continue;
  end if;
  s:=public.uid_review_snapshot(q.proposal_id); h:=public.uid_review_digest(s);
  if q.status='blocked' and q.last_snapshot_hash=h and (q.next_attempt_at is null or q.next_attempt_at>clock_timestamp()) then continue; end if;
  checks:=public.uid_review_checks(s);
  if checks->'blockers'<>'[]'::jsonb then
   update public.uid_review_requests set status='blocked',updated_at=clock_timestamp(),last_snapshot_hash=h,blockers=checks->'blockers' where id=q.id;
   continue;
  end if;
  update public.uid_review_requests set status='leased',claimant=btrim(p_claimant),lease_token=gen_random_uuid(),lease_version=lease_version+1,
   leased_at=clock_timestamp(),lease_expires_at=least(clock_timestamp()+interval '900 seconds',expires_at),
   updated_at=clock_timestamp(),last_snapshot_hash=h,blockers='[]',outcome=null,next_attempt_at=null where id=q.id returning * into q;
  insert into public.uid_review_attempts(request_id,lease_version,lease_token,claimant,candidate_hash,snapshot_hash,snapshot,leased_at,lease_expires_at)
   values(q.id,q.lease_version,q.lease_token,q.claimant,s->>'candidate_hash',h,s,q.leased_at,q.lease_expires_at);
  perform set_config('uid.review_action',coalesce(previous,''),true);
  return jsonb_build_object('request_id',q.id,'owner_user_id',q.owner_user_id,'proposal_id',q.proposal_id,'intent_hash',q.intent_hash,
   'attempt_id',q.id::text||':'||q.lease_version::text,'evaluator_version','dot-agent-v1-source-media',
   'candidate_hash',s->>'candidate_hash','snapshot_hash',h,'lease_token',q.lease_token,'lease_version',q.lease_version,
   'leased_at',q.leased_at,'lease_expires_at',q.lease_expires_at,'expires_at',q.expires_at,'snapshot',s,
   'current_context',s->'rule_context');
 end loop;
 perform set_config('uid.review_action',coalesce(previous,''),true);
 return null;
end $$;


revoke all on function public.uid_review_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.uid_review_claim(uuid,text) to service_role;

create function uid_rule_private.agent_review_catalog(p_attempt public.uid_review_attempts,p_review_hash text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb:=p_attempt.snapshot->'rule_context'; eligibility jsonb; catalog jsonb; contracts jsonb; bundle jsonb;
 target jsonb; projected jsonb; dna jsonb; source_hashes jsonb; supplement jsonb; brands jsonb;
 spec jsonb; canonical_text text; brand_slug text; proposal_id text; attempt_id text; dummy jsonb;
begin
 if jsonb_typeof(c) is distinct from 'object' or p_review_hash !~'^[0-9a-f]{64}$' then raise exception 'Exact pinned rule context and review hash required'; end if;
 eligibility:=public.uid_rule_eligibility(c,(c#>>'{compiler_context,owner_user_id}')::uuid);
 if eligibility->'eligible' is distinct from 'true' then raise exception 'Structured rule, protected-scope, or exact projection checks failed: %',eligibility->'blockers'; end if;
 -- Reuse all bounded existing-catalog/source and no-downgrade validation. This
 -- hypothetical OWNER delta is discarded; the actual delta below is AGENT-only.
 dummy:=public.uid_rule_catalog_plan(c);
 if dummy is null then raise exception 'Agent compiler plan requires an existing supported quality catalog'; end if;
 select t#>'{metadata,creative_quality_contract}' into catalog from jsonb_array_elements(c->'targets') t order by t->>'id' limit 1;
 contracts:=catalog->'contracts';
 proposal_id:=c#>>'{proposal,id}'; canonical_text:=btrim(c#>>'{proposal,proposed_content_md}');
 spec:=public.uid_rule_parse_canonical(canonical_text);
 attempt_id:=p_attempt.request_id::text||':'||p_attempt.lease_version::text;
 select jsonb_agg(slug order by slug collate "C") into brands from (select distinct t->>'brand_slug' slug from jsonb_array_elements(c->'targets') t)b;
 for target in select value from jsonb_array_elements(c->'targets') order by value->>'id' loop
  brand_slug:=target->>'brand_slug'; bundle:=contracts->brand_slug;
  select value into projected from jsonb_array_elements(c#>'{compiler_context,projected_targets}') n where n->>'id'=target->>'id';
  select value into dna from jsonb_array_elements(c#>'{compiler_context,brand_dna_nodes}') n where n->>'brand_id'=target->>'brand_id';
  source_hashes:=jsonb_build_object('branch',public.uid_rule_source_hash(projected),'brand_dna',public.uid_rule_source_hash(dna));
  supplement:=jsonb_build_object('schema_version','uid.agent-reviewed-supplemental-rule.v1','id','agent-review:'||attempt_id,
   'proposal_id',proposal_id,'request_id',p_attempt.request_id,'attempt_id',attempt_id,
   'evaluator_version','dot-agent-v1-source-media','decision_kind','owner_approved_agent_review',
   'snapshot_hash',p_attempt.snapshot_hash,'review_hash',p_review_hash,'review_scope','PINNED_EVIDENCE_ONLY_NOT_FUTURE_OUTPUT_GUARANTEE',
   'canonical_text',canonical_text,'declared_scope',spec->'scope','scope',jsonb_build_object('brands',brands,'branches',jsonb_build_array(c#>>'{scope,branch_slug}')),
   'rule_class',spec->'rule_class','confidence',spec->'confidence',
   'source',jsonb_build_object('node','branch','locator','agent-review:'||proposal_id||':'||attempt_id,'canonical_text_hash',encode(sha256(convert_to(canonical_text,'UTF8')),'hex')),
   'accepted_source_hashes',source_hashes,'precedence','SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH');
  bundle:=bundle||jsonb_build_object('schema_version','uid-creative-quality/3','revision','agent-review:'||attempt_id,
   'source_hashes',source_hashes,'agent_reviewed_supplemental_rules',coalesce(bundle->'agent_reviewed_supplemental_rules','[]')||jsonb_build_array(supplement));
  if length(public.uid_rule_stable_json(bundle))>100000 then raise exception 'Quality bundle exceeds bounded compiler capacity'; end if;
  contracts:=jsonb_set(contracts,array[brand_slug],bundle);
 end loop;
 return catalog||jsonb_build_object('contracts',contracts);
end $$;
revoke all on function uid_rule_private.agent_review_catalog(public.uid_review_attempts,text) from public,anon,authenticated,service_role;

create function uid_rule_private.validate_agent_compiler(p_attempt public.uid_review_attempts,p_review jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb:=p_attempt.snapshot->'rule_context'; capability jsonb:=p_attempt.snapshot->'compiler_capability';
 core jsonb; review_hash text; catalog jsonb; projected jsonb; metadata jsonb; expected_targets jsonb:='[]';
 plan jsonb:=p_review->'compiler_plan'; receipt jsonb:=p_review->'compiler_receipt'; expected_plan jsonb;
 expected_receipt jsonb; compiled jsonb; entry jsonb; target jsonb; expected_source_hashes jsonb; plan_hash text;
 attempt_id text:=p_attempt.request_id::text||':'||p_attempt.lease_version::text; n integer;
begin
 if capability->'release_ready' is distinct from 'true'::jsonb
  or capability->>'schema_version' is distinct from 'uid.agent-compiler-capability.v1'
  or capability->>'manifest_id' is distinct from 'uid.agent-compiler-source.v1'
  or coalesce(capability->>'compiler_bundle_hash','') !~'^[0-9a-f]{64}$'
  or jsonb_typeof(capability->'source_manifest') is distinct from 'array' or jsonb_array_length(capability->'source_manifest')<>7
  or capability->>'compiler_bundle_hash' is distinct from encode(sha256(convert_to(public.uid_rule_stable_json(capability->'source_manifest'),'UTF8')),'hex')
 then raise exception 'Pinned compiler capability is not released'; end if;
 if jsonb_typeof(p_review) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_review) k where k not in ('schema_version','decision','review_note','media_receipts','findings','compiler_plan','compiler_receipt'))
  or jsonb_typeof(plan) is distinct from 'object' or jsonb_typeof(receipt) is distinct from 'object'
 then raise exception 'Exact genuine review core, compiler plan and compiler receipt required'; end if;
 core:=uid_rule_private.review_core(p_review);
 review_hash:=encode(sha256(convert_to(public.uid_rule_stable_json(core),'UTF8')),'hex');
 catalog:=uid_rule_private.agent_review_catalog(p_attempt,review_hash);
 for projected in select value from jsonb_array_elements(c#>'{compiler_context,projected_targets}') order by value->>'id' loop
  metadata:=jsonb_set(projected->'metadata','{creative_quality_contract}',catalog);
  expected_targets:=expected_targets||jsonb_build_array(jsonb_build_object('node_id',projected->'id','content_md',projected->'content_md','metadata',metadata,
   'version',projected->'version','input_schema',projected->'input_schema','status',projected->'status','confidence',projected->'confidence'));
 end loop;
 expected_plan:=jsonb_build_object('schema_version','uid.agent-rule-plan.v1','request_id',p_attempt.request_id,'attempt_id',attempt_id,
  'proposal_id',c#>'{proposal,id}','candidate_hash',p_attempt.candidate_hash,'snapshot_hash',p_attempt.snapshot_hash,'review_hash',review_hash,'targets',expected_targets);
 if plan is distinct from expected_plan then raise exception 'Compiler plan differs from exact permitted agent-reviewed catalog delta'; end if;
 plan_hash:=encode(sha256(convert_to(public.uid_rule_stable_json(expected_plan),'UTF8')),'hex');
 if jsonb_typeof(receipt->'compiled') is distinct from 'array' then raise exception 'Complete target compiler receipts required'; end if;
 compiled:=receipt->'compiled';
 if jsonb_array_length(compiled)<>jsonb_array_length(c->'targets') then raise exception 'Compiler receipt target coverage mismatch'; end if;
 for target in select value from jsonb_array_elements(c->'targets') order by value->>'id' loop
  select count(*) into n from jsonb_array_elements(compiled) x where x->>'node_id'=target->>'id';
  select value into entry from jsonb_array_elements(compiled) x where x->>'node_id'=target->>'id' limit 1;
  expected_source_hashes:=catalog#>array['contracts',target->>'brand_slug','source_hashes'];
  if n<>1 or coalesce(entry->>'contract_hash','')!~'^[0-9a-f]{64}$' or entry is distinct from jsonb_build_object(
    'node_id',target->'id','brand_slug',target->'brand_slug','source_hashes',expected_source_hashes,
    'contract_hash',entry->'contract_hash','added_supplement_ids',jsonb_build_array('agent-review:'||attempt_id))
  then raise exception 'Compiler receipt does not match exact target/source/addition identity'; end if;
 end loop;
 expected_receipt:=jsonb_build_object('schema_version','uid.agent-compiler-receipt.v1','status','COMPILED','proof_scope','DETERMINISTIC_COMPILATION_ONLY',
  'compiler_version',capability->'compiler_version','compiler_bundle_hash',capability->'compiler_bundle_hash',
  'request_id',p_attempt.request_id,'attempt_id',attempt_id,'proposal_id',c#>'{proposal,id}',
  'candidate_hash',p_attempt.candidate_hash,'snapshot_hash',p_attempt.snapshot_hash,'review_hash',review_hash,'plan_hash',plan_hash,'compiled',compiled);
 if receipt is distinct from expected_receipt then raise exception 'Compiler receipt differs from pinned capability, lease, review or plan identity'; end if;
 return jsonb_build_object('catalog',catalog,'plan',expected_plan,'plan_hash',plan_hash,'review_hash',review_hash);
end $$;
revoke all on function uid_rule_private.validate_agent_compiler(public.uid_review_attempts,jsonb) from public,anon,authenticated,service_role;

create or replace function public.uid_review_complete(p_request_id uuid,p_owner_user_id uuid,p_claimant text,p_lease_token uuid,
 p_lease_version integer,p_candidate_hash text,p_review jsonb) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.uid_review_requests%rowtype; a public.uid_review_attempts%rowtype; p public.knowledge_proposals%rowtype;
 s jsonb; checks jsonb; assessment jsonb; v_blockers jsonb:='[]'; new_status text:='blocked'; result jsonb;
 before_nodes jsonb; after_nodes jsonb; outside_nodes jsonb; compiler_result jsonb; compiler_needed boolean; evaluation_id uuid:=gen_random_uuid(); critical integer:=0;
 previous text:=current_setting('uid.review_action',true);
begin
 perform public.uid_review_assert_admin(p_owner_user_id);
 -- Same lock ordering as the existing guarded merger. Table locks prevent
 -- target/baseline/evaluation phantoms during the final atomic check and merge.
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 lock table public.uid_governance_evaluations in share mode;
 select * into q from public.uid_review_requests where id=p_request_id and owner_user_id=p_owner_user_id for update;
 if not found then raise exception 'Owner review request not found'; end if;
 select * into a from public.uid_review_attempts where request_id=q.id and lease_version=p_lease_version;
 if not found or a.lease_token is distinct from p_lease_token or a.claimant is distinct from p_claimant or a.candidate_hash is distinct from p_candidate_hash
 then raise exception 'Matching fenced review lease and candidate hash required'; end if;
 -- A replay is a read of the already committed result; it never re-merges.
 if exists(select 1 from public.uid_agent_review_evaluations e where e.request_id=q.id and e.lease_version=a.lease_version) then
  return public.uid_review_public(q);
 end if;
 if q.status<>'leased' or q.lease_token is distinct from p_lease_token or q.lease_version is distinct from p_lease_version or q.claimant is distinct from p_claimant then
  raise exception 'Matching active review lease required'; end if;
 if q.lease_expires_at<=clock_timestamp() then raise exception 'Review lease expired; reclaim and inspect a fresh snapshot'; end if;
 select * into p from public.knowledge_proposals where id=q.proposal_id for update;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into before_nodes from public.knowledge_nodes t
  where exists(select 1 from jsonb_array_elements(a.snapshot->'targets') n where n->>'id'=t.id::text);
 if q.expires_at<=clock_timestamp() then
  new_status:='expired'; v_blockers:='[{"code":"intent_expired","message":"Approval expired during review.","next_action":"Review the current feedback and approve again."}]';
 elsif p.status is distinct from 'pending' or p.merged_at is not null or public.uid_review_digest(public.uid_review_intent(q.proposal_id,q.owner_user_id)) is distinct from q.intent_hash then
  new_status:='superseded'; v_blockers:='[{"code":"intent_changed","message":"Feedback patch, scope or proposal state changed during review.","next_action":"Refresh and approve the new feedback if still needed."}]';
 else
  s:=public.uid_review_snapshot(q.proposal_id);
  if public.uid_review_digest(s) is distinct from a.snapshot_hash or s->>'candidate_hash' is distinct from a.candidate_hash then
   new_status:='queued'; v_blockers:='[{"code":"snapshot_changed","message":"Canonical rules or review evidence changed during inspection.","next_action":"Claim again and inspect the fresh snapshot; old receipts cannot be reused."}]';
  else
   checks:=public.uid_review_checks(a.snapshot);
   assessment:=public.uid_review_assess_receipts(a.snapshot,p_review,q.leased_at,clock_timestamp());
   v_blockers:=(checks->'blockers')||(assessment->'blockers');
   critical:=(checks->>'critical_failures')::integer+(assessment->>'critical_failures')::integer;
   compiler_needed:=a.snapshot#>>'{source,slug}'='onepage-system' or exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t
    where t->>'slug'='brand-dna' or t->'metadata' ? 'creative_quality_contract');
   if compiler_needed and v_blockers='[]'::jsonb and critical=0 then
    begin
     compiler_result:=uid_rule_private.validate_agent_compiler(a,p_review);
    exception when others then
     v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','compiler_integration_required',
      'message','Pinned compiler validation blocked: '||sqlerrm,'next_action','Use the reviewed compiler release on the exact claim after genuine media review; missing capability, scope or compiler errors cannot be bypassed.'));
    end;
   end if;
   if v_blockers='[]'::jsonb and critical=0 then new_status:='merged'; end if;
  end if;
 end if;
 perform set_config('uid.review_action','complete',true);
 if new_status='merged' then
  -- Recheck wall-clock deadlines after all potentially blocking locks/checks.
  if q.expires_at<=clock_timestamp() or q.lease_expires_at<=clock_timestamp() then raise exception 'Review lease or approval expired before merge; claim fresh review'; end if;
  -- Independent live final-write guard under the nodes table lock. This also
  -- prevents a stale/malformed future snapshot implementation from bypassing
  -- the unsupported-dependency boundary. SHARE ROW EXCLUSIVE fences inserts,
  -- reparenting and activation until this transaction finishes.
  if exists(select 1 from public.knowledge_nodes child where child.status='active'
   and exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where t->>'id'=child.parent_id::text)
   and not exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where t->>'id'=child.id::text))
  then raise exception 'Unsupported active child dependency scope; all changes rolled back'; end if;
  select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') into outside_nodes from public.knowledge_nodes n
   where not exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where t->>'id'=n.id::text);
  insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
  select q.proposal_id,id,'before',content_md,metadata,version,q.owner_user_id from public.knowledge_nodes n
   where exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where t->>'id'=n.id::text);
  result:=public.admin_accept_merge_creative_dna_proposal(q.proposal_id,q.owner_user_id,
   'Agent review by '||q.claimant||' under owner-approved request '||q.id::text||' (lease '||q.lease_version||'). Source/media QC is recorded in the separate agent audit; the owner approved the proposed change. '||left(p_review->>'review_note',3400));
  if outside_nodes is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') from public.knowledge_nodes n
    where not exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where t->>'id'=n.id::text))
  then raise exception 'Merge trigger changed canonical rows outside approved scope; all changes rolled back'; end if;
  if exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where not exists(select 1 from public.knowledge_nodes n where n.id::text=t->>'id'))
  then raise exception 'Merge removed an approved canonical target; all changes rolled back'; end if;
  if compiler_result is not null then
   perform uid_rule_private.apply_projected_catalog(a.snapshot->'rule_context',compiler_result->'catalog');
   if outside_nodes is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') from public.knowledge_nodes n
    where not exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where t->>'id'=n.id::text))
   then raise exception 'Compiler trigger changed canonical rows outside approved scope; all changes rolled back'; end if;
  end if;
  if not exists(select 1 from public.knowledge_proposals where id=q.proposal_id and status='merged' and reviewed_by=q.owner_user_id and merged_at is not null)
  then raise exception 'Legacy merge did not record expected agent-reviewed owner approval'; end if;
  insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
  select q.proposal_id,id,'after',content_md,metadata,version,q.owner_user_id from public.knowledge_nodes n
   where exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where t->>'id'=n.id::text);
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into after_nodes from public.knowledge_nodes t
   where exists(select 1 from jsonb_array_elements(a.snapshot->'targets') n where n->>'id'=t.id::text);
 end if;
 insert into public.uid_agent_review_evaluations(id,request_id,proposal_id,owner_user_id,evaluator_version,candidate_hash,snapshot_hash,
  lease_version,claimant,evaluation_status,critical_failures,submitted_review,mechanical_results,blockers,before_snapshot,after_snapshot,review_hash,compiler_plan,compiler_plan_hash,compiler_receipt)
 values(evaluation_id,q.id,q.proposal_id,q.owner_user_id,'dot-agent-v1-source-media',a.candidate_hash,a.snapshot_hash,a.lease_version,a.claimant,
  case when new_status='merged' then 'passed' else 'blocked' end,critical,coalesce(p_review,'null'::jsonb),coalesce(checks->'mechanical_results','[]'),v_blockers,before_nodes,after_nodes,encode(sha256(convert_to(public.uid_rule_stable_json(uid_rule_private.review_core(p_review)),'UTF8')),'hex'),
  p_review->'compiler_plan',compiler_result->>'plan_hash',p_review->'compiler_receipt');
 update public.uid_review_requests set status=new_status,updated_at=clock_timestamp(),blockers=v_blockers,
  next_attempt_at=case when new_status='blocked' then clock_timestamp()+interval '1 hour' else null end,
  outcome=jsonb_build_object('evaluation_id',evaluation_id,'canonical_changed',new_status='merged','merged_nodes',case when new_status='merged' then result->'merged_nodes' else '0'::jsonb end,
   'merged_at',case when new_status='merged' then result->'merged_at' else null end)
 where id=q.id returning * into q;
 perform set_config('uid.review_action',coalesce(previous,''),true);
 return public.uid_review_public(q);
end $$;


revoke all on function public.uid_review_complete(uuid,uuid,text,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.uid_review_complete(uuid,uuid,text,uuid,integer,text,jsonb) to service_role;
