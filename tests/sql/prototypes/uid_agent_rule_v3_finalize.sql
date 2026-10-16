-- INACTIVE PROTOTYPE. No grants; requires disposable parity and race tests.
create function uid_rule_v3_private.review_core(p_review jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,public,pg_temp as $$
 select p_review-'compiler_plan'-'compiler_receipt'
$$;
create function uid_rule_v3_private.validate_review(a uid_rule_v3_private.attempts,p_review jsonb) returns text
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c jsonb:=a.snapshot->'rule_context'; core jsonb:=uid_rule_v3_private.review_core(p_review);
 sources jsonb; src jsonb; receipt jsonb; f jsonb; t jsonb; criterion text; ids jsonb; n integer;
 read_time timestamptz; revalidated timestamptz; now_at timestamptz:=clock_timestamp();
begin
 if jsonb_typeof(p_review) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_review) k where k not in
  ('schema_version','decision','review_note','source_receipts','findings','visual_qc_performed','review_scope','compiler_plan','compiler_receipt'))
  or (select count(*) from jsonb_object_keys(core))<>7
  or core->>'schema_version' is distinct from 'uid.agent-rule-review.v1' or core->>'decision' is distinct from 'passed'
  or core->'visual_qc_performed' is distinct from 'false'
  or core->>'review_scope' is distinct from 'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC'
  or jsonb_typeof(core->'review_note') is distinct from 'string' or length(btrim(core->>'review_note')) not between 40 and 4000
  or jsonb_typeof(core->'source_receipts') is distinct from 'array' or jsonb_typeof(core->'findings') is distinct from 'array'
 then raise exception 'Exact genuine rule-only semantic review required'; end if;
 sources:=jsonb_build_array(jsonb_build_object('id','rule-context','record',c))||(c->'targets')||(c#>'{compiler_context,brand_dna_nodes}')||(c#>'{compiler_context,dependent_nodes}');
 if exists(select 1 from jsonb_array_elements(sources) s where jsonb_typeof(s->'id') is distinct from 'string')
  or exists(select 1 from jsonb_array_elements(sources) s group by s->>'id' having count(distinct s)>1)
 then raise exception 'Source identity collision'; end if;
 select jsonb_agg(s order by s->>'id') into sources from (select distinct value s from jsonb_array_elements(sources)) x;
 select jsonb_agg(s->'id' order by s->>'id') into ids from jsonb_array_elements(sources) s;
 if jsonb_array_length(sources)>128 or jsonb_array_length(core->'source_receipts')<>jsonb_array_length(sources) then raise exception 'Complete source coverage required'; end if;
 for src in select value from jsonb_array_elements(sources) loop
  select count(*) into n from jsonb_array_elements(core->'source_receipts') x where x->>'node_id'=src->>'id';
  select value into receipt from jsonb_array_elements(core->'source_receipts') x where x->>'node_id'=src->>'id' limit 1;
  if n<>1 or receipt is distinct from jsonb_build_object('node_id',src->'id','record_sha256',uid_rule_v3_private.hex(src),
     'read_at',receipt->'read_at','revalidated_at',receipt->'revalidated_at','note',receipt->'note')
   or jsonb_typeof(receipt->'note') is distinct from 'string' or length(btrim(receipt->>'note')) not between 40 and 4000
  then raise exception 'Exact source receipt hash/schema required'; end if;
  read_time:=(receipt->>'read_at')::timestamptz; revalidated:=(receipt->>'revalidated_at')::timestamptz;
  if read_time is null or revalidated is null or not isfinite(read_time) or not isfinite(revalidated)
   or read_time<a.leased_at or revalidated<read_time or revalidated>now_at or revalidated>=a.lease_expires_at
  then raise exception 'Source receipt is outside current fenced lease'; end if;
 end loop;
 if jsonb_array_length(core->'findings')<>jsonb_array_length(c->'targets')*3 then raise exception 'Complete target criterion coverage required'; end if;
 for t in select value from jsonb_array_elements(c->'targets') loop
  foreach criterion in array array['rule_semantics','scope_fidelity','canonical_conflicts'] loop
   select count(*) into n from jsonb_array_elements(core->'findings') x where x->>'node_id'=t->>'id' and x->>'criterion'=criterion;
   select value into f from jsonb_array_elements(core->'findings') x where x->>'node_id'=t->>'id' and x->>'criterion'=criterion limit 1;
   if n<>1 or f is distinct from jsonb_build_object('node_id',t->'id','criterion',criterion,'result','passed','note',f->'note','source_node_ids',ids)
    or jsonb_typeof(f->'note') is distinct from 'string' or length(btrim(f->>'note')) not between 40 and 4000
   then raise exception 'Genuine source-linked passed criterion required'; end if;
  end loop;
 end loop;
 return uid_rule_v3_private.hex(core);
end $$;
create function uid_rule_v3_private.catalog(a uid_rule_v3_private.attempts,p_review_hash text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c jsonb:=a.snapshot->'rule_context'; catalog jsonb; contracts jsonb; t jsonb; projected jsonb; dna jsonb; bundle jsonb;
 supplement jsonb; hashes jsonb; canonical text:=c#>>'{proposal,proposed_content_md}'; spec jsonb; attempt_id text:=a.request_id::text||':'||a.lease_version;
begin
 perform public.uid_rule_catalog_plan(uid_rule_v3_private.adapt_context(c));
 select target_row.value#>'{metadata,creative_quality_contract}' into catalog from jsonb_array_elements(c->'targets') as target_row(value) order by target_row.value->>'id' limit 1;
 if catalog is null then return null; end if;
 contracts:=catalog->'contracts'; spec:=public.uid_rule_parse_canonical(canonical);
 for t in select value from jsonb_array_elements(c->'targets') order by value->>'id' loop
  bundle:=contracts->(t->>'brand_slug');
  select value into projected from jsonb_array_elements(c#>'{compiler_context,projected_targets}') n where n->>'id'=t->>'id';
  select value into dna from jsonb_array_elements(c#>'{compiler_context,brand_dna_nodes}') n where n->>'brand_id'=t->>'brand_id';
  hashes:=jsonb_build_object('branch',public.uid_rule_source_hash(projected),'brand_dna',public.uid_rule_source_hash(dna));
  supplement:=jsonb_build_object('schema_version','uid.agent-rule-reviewed-supplemental-rule.v1','id','agent-rule:'||attempt_id,
   'proposal_id',c#>'{proposal,id}','request_id',a.request_id,'attempt_id',attempt_id,
   'decision_kind','agent_rule_review','evaluator_version','dot-agent-v3-rule-semantics',
   'snapshot_hash',a.snapshot_hash,'review_hash',p_review_hash,'review_scope','RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC','visual_qc_performed',false,
   'canonical_text',canonical,'declared_scope',spec->'scope','scope',jsonb_build_object('brands',(select jsonb_agg(n->>'brand_slug' order by n->>'brand_slug') from jsonb_array_elements(c->'targets') n),'branches',jsonb_build_array(c#>>'{scope,branch_slug}')),
   'rule_class',spec->'rule_class','confidence',spec->'confidence',
   'source',jsonb_build_object('node','branch','locator','agent-rule:'||(c#>>'{proposal,id}')||':'||attempt_id,'canonical_text_hash',encode(sha256(convert_to(canonical,'UTF8')),'hex')),
   'accepted_source_hashes',hashes,'precedence','SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH');
  bundle:=bundle||jsonb_build_object('schema_version','uid-creative-quality/4','revision','agent-rule:'||attempt_id,'source_hashes',hashes,
   'agent_rule_reviewed_supplemental_rules',coalesce(bundle->'agent_rule_reviewed_supplemental_rules','[]')||jsonb_build_array(supplement));
  if length(public.uid_rule_stable_json(bundle))>100000 then raise exception 'Quality catalog capacity exceeded'; end if;
  contracts:=jsonb_set(contracts,array[t->>'brand_slug'],bundle);
 end loop;
 return catalog||jsonb_build_object('contracts',contracts);
end $$;
create function uid_rule_v3_private.validate_plan(a uid_rule_v3_private.attempts,p_review jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c jsonb:=a.snapshot->'rule_context'; cap jsonb:=a.snapshot->'compiler_capability';
 review_hash text; catalog jsonb; targets jsonb; expected jsonb; proof jsonb:=p_review->'compiler_receipt';
 t jsonb; entry jsonb; n integer; identity jsonb; attempt_id text:=a.request_id::text||':'||a.lease_version;
begin
 review_hash:=uid_rule_v3_private.validate_review(a,p_review); catalog:=uid_rule_v3_private.catalog(a,review_hash);
 select jsonb_agg(jsonb_build_object('node_id',t->'id','content_md',t->'content_md',
  'metadata',case when catalog is null then t->'metadata' else jsonb_set(t->'metadata','{creative_quality_contract}',catalog) end,
  'version',t->'version','input_schema',t->'input_schema','status',t->'status','confidence',t->'confidence') order by t->>'id') into targets
 from jsonb_array_elements(c#>'{compiler_context,projected_targets}') t;
 identity:=jsonb_build_object('request_id',a.request_id,'attempt_id',attempt_id,'proposal_id',c#>'{proposal,id}',
  'candidate_hash',a.candidate_hash,'snapshot_hash',a.snapshot_hash,'review_hash',review_hash);
 expected:=identity||jsonb_build_object('schema_version','uid.agent-rule-review-plan.v1','targets',targets);
 if p_review->'compiler_plan' is distinct from expected then raise exception 'Compiler plan differs from exact SQL reconstructed delta'; end if;
 if jsonb_typeof(proof->'compiled') is distinct from 'array' or jsonb_array_length(proof->'compiled')<>jsonb_array_length(c->'targets')
 then raise exception 'Complete pinned compiler receipt required'; end if;
 for t in select value from jsonb_array_elements(c->'targets') loop
  select count(*) into n from jsonb_array_elements(proof->'compiled') x where x->>'node_id'=t->>'id';
  select value into entry from jsonb_array_elements(proof->'compiled') x where x->>'node_id'=t->>'id' limit 1;
  if n<>1 then raise exception 'Compiler target identity mismatch'; end if;
  if catalog is null then
   if entry is distinct from jsonb_build_object('mode','canonical_append','node_id',t->'id','brand_slug',t->'brand_slug',
    'projection_hash',(select uid_rule_v3_private.hex(x) from jsonb_array_elements(targets) x where x->>'node_id'=t->>'id'))
   then raise exception 'Compiler append projection mismatch'; end if;
  elsif coalesce(entry->>'contract_hash','')!~'^[0-9a-f]{64}$' or entry is distinct from jsonb_build_object(
   'mode','quality_catalog','node_id',t->'id','brand_slug',t->'brand_slug','source_hashes',catalog#>array['contracts',t->>'brand_slug','source_hashes'],
   'contract_hash',entry->'contract_hash','added_supplement_ids',jsonb_build_array('agent-rule:'||attempt_id))
  then raise exception 'Compiler target identity/hash mismatch'; end if;
 end loop;
 if proof is distinct from identity||jsonb_build_object('schema_version','uid.agent-rule-review-compiler-receipt.v1','status','COMPILED',
  'proof_scope','DETERMINISTIC_COMPILATION_ONLY','compiler_version',cap->'compiler_version','compiler_bundle_hash',cap->'compiler_bundle_hash',
  'plan_hash',uid_rule_v3_private.hex(expected),'compiled',proof->'compiled') then raise exception 'Compiler receipt identity mismatch'; end if;
 return catalog;
end $$;
revoke all on all functions in schema uid_rule_v3_private from public,anon,authenticated,service_role;
create function uid_rule_v3_private.complete(p_request uuid,p_owner uuid,p_claimant text,p_token uuid,p_version integer,p_candidate text,p_review jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare epoch bigint; q uid_rule_v3_private.requests%rowtype; a uid_rule_v3_private.attempts%rowtype;
 c jsonb; s jsonb; current_intent jsonb; catalog jsonb; before_nodes jsonb; after_nodes jsonb; outside_nodes jsonb;
 v_blockers jsonb:='[]'; next_status text:='blocked'; merge_result jsonb; core jsonb;
 previous text:=current_setting('uid.rule_v3_action',true);
begin
 epoch:=uid_rule_v3_private.lock_authority(p_owner);
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.brands in share mode;
 select * into q from uid_rule_v3_private.requests where id=p_request and owner_user_id=p_owner for update;
 if not found then raise exception 'Delegated rule request not found'; end if;
 select * into a from uid_rule_v3_private.attempts where request_id=q.id and lease_version=p_version;
 if not found or a.lease_token is distinct from p_token or a.claimant is distinct from p_claimant or a.candidate_hash is distinct from p_candidate
 then raise exception 'Exact fenced attempt identity required'; end if;
 if exists(select 1 from uid_rule_v3_private.audit where request_id=q.id and lease_version=p_version) then return uid_rule_v3_private.public_request(q); end if;
 if q.status<>'leased' or q.lease_token is distinct from p_token or q.lease_version is distinct from p_version or q.claimant is distinct from p_claimant
 then raise exception 'Matching live fenced lease required'; end if;
 if q.lease_expires_at<=clock_timestamp() then raise exception 'Lease expired; claim and review fresh snapshot'; end if;
 perform 1 from public.knowledge_proposals where id=q.proposal_id for update;
 select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') into before_nodes from public.knowledge_nodes n
 where exists(select 1 from jsonb_array_elements(a.snapshot#>'{rule_context,targets}') t where t->>'id'=n.id::text);
 if q.expires_at<=clock_timestamp() then
  next_status:='expired'; v_blockers:='[{"code":"intent_expired"}]';
 elsif q.authorization_revision<>epoch then
  next_status:='superseded'; v_blockers:='[{"code":"authority_changed"}]';
 else
  c:=uid_rule_v3_private.context(q.proposal_id,p_owner);
  current_intent:=uid_rule_v3_private.intent(c,p_owner,q.operation);
  if c#>>'{proposal,status}' is distinct from 'pending' or c#>>'{proposal,merged_at}' is not null
   or 'sha256:'||uid_rule_v3_private.hex(current_intent) is distinct from q.intent_hash then
   next_status:='superseded'; v_blockers:='[{"code":"intent_changed_or_resolved"}]';
  else
   begin
    s:=uid_rule_v3_private.snapshot(c,p_owner);
    if (s#>>'{compiler_capability,release_revision}')::bigint<>q.release_revision
    then raise exception 'Pinned release changed'; end if;
    if 'sha256:'||uid_rule_v3_private.hex(s) is distinct from a.snapshot_hash or s->>'candidate_hash' is distinct from a.candidate_hash then
     next_status:='queued'; v_blockers:='[{"code":"snapshot_changed","next_action":"Inspect a fresh claim; old receipts cannot be reused."}]';
    elsif p_review->>'decision'='blocked' then
     core:=uid_rule_v3_private.review_core(p_review);
     if jsonb_typeof(core) is distinct from 'object' or core->>'schema_version' is distinct from 'uid.agent-rule-review.v1'
      or core->'visual_qc_performed' is distinct from 'false' or core->>'review_scope' is distinct from 'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC'
      or jsonb_typeof(core->'source_receipts') is distinct from 'array' or jsonb_typeof(core->'findings') is distinct from 'array'
      or jsonb_typeof(core->'review_note') is distinct from 'string' or length(btrim(core->>'review_note')) not between 40 and 4000
      or p_review ? 'compiler_plan' or p_review ? 'compiler_receipt' then raise exception 'Scoped blocked review and specific explanation required'; end if;
     v_blockers:=jsonb_build_array(jsonb_build_object('code','semantic_review_blocked','message',core->>'review_note'));
    else
     catalog:=uid_rule_v3_private.validate_plan(a,p_review); next_status:='merged';
    end if;
   exception when others then
    next_status:='blocked'; v_blockers:=jsonb_build_array(jsonb_build_object('code','rule_review_validation_blocked','message',sqlerrm));
   end;
  end if;
 end if;
 perform set_config('uid.rule_v3_action','complete',true);
 if next_status='merged' then
  if q.lease_expires_at<=clock_timestamp() or q.expires_at<=clock_timestamp() then raise exception 'Lease or intent expired before canonical write'; end if;
  if exists(select 1 from public.knowledge_nodes child where child.status='active'
   and exists(select 1 from jsonb_array_elements(c->'targets') t where t->>'id'=child.parent_id::text)
   and not exists(select 1 from jsonb_array_elements(c->'targets') t where t->>'id'=child.id::text))
  then raise exception 'Unsupported active dependency outside scope'; end if;
  select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') into outside_nodes from public.knowledge_nodes n
   where not exists(select 1 from jsonb_array_elements(c->'targets') t where t->>'id'=n.id::text);
  merge_result:=public.admin_accept_merge_creative_dna_proposal(q.proposal_id,p_owner,
   'Agent rule review under explicit owner delegation. Rule semantics and compilation only; no output/media QC or owner-direct review is asserted. '||left(p_review->>'review_note',3000));
  perform uid_rule_private.apply_projected_catalog(c,catalog);
  if outside_nodes is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') from public.knowledge_nodes n
   where not exists(select 1 from jsonb_array_elements(c->'targets') t where t->>'id'=n.id::text))
  then raise exception 'Outside-scope canonical mutation; transaction rolled back'; end if;
  if not exists(select 1 from public.knowledge_proposals where id=q.proposal_id and status='merged' and reviewed_by=p_owner and merged_at is not null)
  then raise exception 'Expected scoped merge outcome missing'; end if;
  select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') into after_nodes from public.knowledge_nodes n
   where exists(select 1 from jsonb_array_elements(c->'targets') t where t->>'id'=n.id::text);
 end if;
 insert into uid_rule_v3_private.audit(request_id,lease_version,proposal_id,owner_user_id,result,review,compiler_plan,compiler_receipt,before_snapshot,after_snapshot,blockers)
 values(q.id,a.lease_version,q.proposal_id,p_owner,case when next_status='queued' then 'blocked' else next_status end,
  coalesce(p_review,'null'::jsonb),case when next_status='merged' then p_review->'compiler_plan' end,
  case when next_status='merged' then p_review->'compiler_receipt' end,before_nodes,after_nodes,v_blockers);
 update uid_rule_v3_private.requests set status=next_status,updated_at=clock_timestamp(),blockers=v_blockers,
  next_attempt_at=case when next_status='blocked' then clock_timestamp()+interval '1 hour' end,
  outcome=jsonb_build_object('canonical_changed',next_status='merged','visual_qc_performed',false,
   'review_scope','RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC',
   'merged_nodes',case when next_status='merged' then merge_result->'merged_nodes' else '0'::jsonb end)
 where id=q.id returning * into q;
 perform set_config('uid.rule_v3_action',coalesce(previous,''),true);
 return uid_rule_v3_private.public_request(q);
end $$;
revoke all on all functions in schema uid_rule_v3_private from public,anon,authenticated,service_role;
create function public.uid_rule_review_v3_complete(p_request_id uuid,p_owner_user_id uuid,p_claimant text,p_lease_token uuid,p_lease_version integer,p_candidate_hash text,p_review jsonb) returns jsonb
language sql security definer set search_path=pg_catalog,public,pg_temp as $$
 select uid_rule_v3_private.complete(p_request_id,p_owner_user_id,p_claimant,p_lease_token,p_lease_version,p_candidate_hash,p_review)
$$;
revoke all on function public.uid_rule_review_v3_complete(uuid,uuid,text,uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
