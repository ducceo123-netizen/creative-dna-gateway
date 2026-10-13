-- Local-only direct acceptance integration suite. Uses exact read-only-inspected
-- live legacy merger/master/mirror trigger definitions, all inside ROLLBACK.
begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION: %',message; end if; end $$;
create function pg_temp.expect_error(command text,expected text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when others then
  if position(lower(expected) in lower(sqlerrm))>0 then return; end if;
  raise exception 'Expected error %, got %',expected,sqlerrm;
 end;
 raise exception 'Expected error %, command succeeded',expected;
end $$;
CREATE OR REPLACE FUNCTION public.admin_accept_merge_creative_dna_proposal(p_proposal_id uuid, p_actor_user_id uuid, p_review_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p knowledge_proposals%rowtype;
  source_node knowledge_nodes%rowtype;
  target_node knowledge_nodes%rowtype;
  feedback_text text;
  now_ts timestamptz := now();
  block_text text;
  structural_onepage boolean;
  merged_count integer := 0;
begin
  select * into p
  from knowledge_proposals
  where id = p_proposal_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Pending proposal not found';
  end if;

  select * into source_node
  from knowledge_nodes
  where id = p.knowledge_node_id;

  if not found then
    raise exception 'Knowledge node not found';
  end if;

  feedback_text := btrim(coalesce(p.proposed_content_md, p.raw_feedback, ''));
  if feedback_text = '' then
    raise exception 'Proposal has no mergeable feedback';
  end if;

  structural_onepage :=
    source_node.slug = 'onepage-system'
    and coalesce(p.proposed_scope, '') !~* 'brand[ _-]?style|vibe|mood';

  block_text :=
    E'\n\n## ACCEPTED ADMIN FEEDBACK — ' ||
    to_char(now_ts at time zone 'UTC', 'YYYY-MM-DD') ||
    E'\n' || feedback_text || E'\n';

  if structural_onepage then
    for target_node in
      select *
      from knowledge_nodes
      where slug = 'onepage-system' and status = 'active'
      for update
    loop
      if position(feedback_text in coalesce(target_node.content_md, '')) = 0 then
        update knowledge_nodes
        set content_md = coalesce(content_md, '') || block_text,
            updated_at = now_ts
        where id = target_node.id;
      end if;

      insert into training_events(
        brand_id, knowledge_node_id, mode, input_text, parsed_payload, status,
        actor_user_id, actor_role, source_action
      ) values (
        coalesce(target_node.brand_id, p.brand_id),
        target_node.id,
        'train',
        feedback_text,
        jsonb_build_object(
          'proposal_id', p.id,
          'proposed_scope', p.proposed_scope,
          'cross_brand_sync', true,
          'context_images', coalesce(p.context_images, '[]'::jsonb)
        ),
        'accepted',
        p_actor_user_id,
        'admin',
        'admin_accept_auto_merge_cross_brand_sync'
      );

      merged_count := merged_count + 1;
    end loop;
  else
    if position(feedback_text in coalesce(source_node.content_md, '')) = 0 then
      update knowledge_nodes
      set content_md = coalesce(content_md, '') || block_text,
          updated_at = now_ts
      where id = source_node.id;
    end if;

    insert into training_events(
      brand_id, knowledge_node_id, mode, input_text, parsed_payload, status,
      actor_user_id, actor_role, source_action
    ) values (
      coalesce(source_node.brand_id, p.brand_id),
      source_node.id,
      'train',
      feedback_text,
      jsonb_build_object(
        'proposal_id', p.id,
        'proposed_scope', p.proposed_scope,
        'cross_brand_sync', false,
        'context_images', coalesce(p.context_images, '[]'::jsonb)
      ),
      'accepted',
      p_actor_user_id,
      'admin',
      'admin_accept_auto_merge'
    );

    merged_count := 1;
  end if;

  update knowledge_proposals
  set status = 'merged',
      reviewed_at = now_ts,
      reviewed_by = p_actor_user_id,
      review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
      merged_at = now_ts,
      updated_at = now_ts
  where id = p.id;

  return jsonb_build_object(
    'proposal_id', p.id,
    'status', 'merged',
    'merged_at', now_ts,
    'merged_nodes', merged_count,
    'cross_brand_sync', structural_onepage
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION public.onepage_mirror_metadata(p_source jsonb, p_brand_name text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(p_source, '{}'::jsonb)
    || jsonb_build_object(
      'active_brand', p_brand_name,
      'onepage_master_brand', 'PawfectHouse',
      'onepage_sync_mode', 'PAWFECTHOUSE_MASTER_100_PERCENT',
      'cross_brand_onepage_structure', 'IDENTICAL_HARD',
      'brand_difference_scope', 'BRAND_DNA_EXPRESSION_ONLY'
    );
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_onepage_pawfecthouse_master()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_brand text;
  master public.knowledge_nodes%rowtype;
begin
  select name into target_brand from public.brands where id = new.brand_id;

  if new.slug='onepage-system'
     and lower(coalesce(target_brand,'')) in ('giftsoul','soulprise') then

    select kn.* into master
    from public.knowledge_nodes kn
    join public.brands b on b.id=kn.brand_id
    where lower(b.name)='pawfecthouse'
      and kn.slug='onepage-system'
    limit 1;

    if found then
      new.content_md := master.content_md;
      new.input_schema := master.input_schema;
      new.metadata := public.onepage_mirror_metadata(master.metadata, target_brand);
      new.version := master.version;
      new.status := master.status;
      new.confidence := master.confidence;
    end if;
  end if;

  return new;
end;
$function$
;
CREATE TRIGGER trg_enforce_onepage_pawfecthouse_master BEFORE UPDATE OF content_md, input_schema, metadata, version, status, confidence ON public.knowledge_nodes FOR EACH ROW EXECUTE FUNCTION enforce_onepage_pawfecthouse_master();
CREATE OR REPLACE FUNCTION public.sync_onepage_from_pawfecthouse()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  source_brand text;
begin
  select name into source_brand from public.brands where id = new.brand_id;

  if lower(coalesce(source_brand,'')) = 'pawfecthouse' and new.slug = 'onepage-system' then
    update public.knowledge_nodes target
    set content_md = new.content_md,
        input_schema = new.input_schema,
        metadata = public.onepage_mirror_metadata(new.metadata, b.name),
        version = new.version,
        status = new.status,
        confidence = new.confidence,
        updated_at = new.updated_at
    from public.brands b
    where target.brand_id = b.id
      and target.slug = 'onepage-system'
      and lower(b.name) in ('giftsoul','soulprise');
  end if;

  return new;
end;
$function$
;
CREATE TRIGGER trg_sync_onepage_from_pawfecthouse AFTER UPDATE OF content_md, input_schema, metadata, version, status, confidence ON public.knowledge_nodes FOR EACH ROW EXECUTE FUNCTION sync_onepage_from_pawfecthouse();

-- No installation grants an owner; only local test setup provisions this row.
select pg_temp.assert_true((select count(*)=0 from uid_rule_private.owner_config),'owner config is initially empty');
insert into public.brands(id,slug,name) values
 ('10000000-0000-0000-0000-000000000001','pawfecthouse','PawfectHouse'),
 ('10000000-0000-0000-0000-000000000002','giftsoul','GiftSoul'),
 ('10000000-0000-0000-0000-000000000003','soulprise','SoulPrise');
insert into public.creative_dna_team_members(user_id,role,is_active) values
 ('10000000-0000-0000-0000-000000000010','admin',true),
 ('10000000-0000-0000-0000-000000000011','admin',true),
 ('10000000-0000-0000-0000-000000000012','admin',false),
 ('10000000-0000-0000-0000-000000000013','contributor',true);
insert into public.knowledge_nodes(id,brand_id,slug,title,node_type,content_md,metadata)
 select ('10000000-0000-0000-0000-00000000010'||i)::uuid,('10000000-0000-0000-0000-00000000000'||i)::uuid,'onepage-system','Onepage '||i,'page',
 E'Canonical content guardrails.\nDo not invent product facts.',case when i=1 then '{}'::jsonb else public.onepage_mirror_metadata('{}',case i when 2 then 'GiftSoul' else 'SoulPrise' end) end
 from generate_series(1,3)i;
insert into public.knowledge_nodes(id,brand_id,slug,title,node_type,content_md)
 select ('10000000-0000-0000-0000-00000000011'||i)::uuid,('10000000-0000-0000-0000-00000000000'||i)::uuid,'brand-dna','Brand DNA '||i,'brand','Keep each brand expression distinct.' from generate_series(1,3)i;
insert into public.knowledge_nodes(id,brand_id,slug,title,content_md) values('10000000-0000-0000-0000-000000000199','10000000-0000-0000-0000-000000000001','home-hero','Outside target','Outside unchanged');
create function pg_temp.canonical(generalized text default 'Use clear product-led headline content.',expected text default 'Keep headline content specific to the supplied product.',reject text default 'Generic headings without product context.',scope text default 'Shared Onepage structure',class text default 'STRUCTURAL') returns text language sql immutable as $$
 select '## Generalized Rule'||E'\n'||generalized||E'\n\n## Expected Behavior\n'||expected||E'\n\n## Reject Conditions\n- '||reject||E'\n\n## Scope\n'||scope||E'\n\n## Rule Class\n'||class||E'\n\n## Confidence\nHIGH'
$$;
insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,raw_feedback,proposed_scope,evidence_summary) values
 ('10000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000101','10000000-0000-0000-0000-000000000001',pg_temp.canonical(),'Original member intent','Shared Onepage structure','{"admin_overview":{"rule_class":"STRUCTURAL"}}');
create temp table test_state as select '10000000-0000-0000-0000-000000000201'::uuid proposal,'10000000-0000-0000-0000-000000000010'::uuid actor,
 public.uid_rule_preflight('10000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000010') context,
 (select jsonb_agg(to_jsonb(n) order by id) from public.knowledge_nodes n) nodes_before;
select pg_temp.assert_true(context#>'{direct_rule,eligible}'='false','unconfigured owner denied') from test_state;
insert into uid_rule_private.owner_config(owner_user_id,verified_at,verification_reference,enabled) values('10000000-0000-0000-0000-000000000010',now(),'LOCAL TEST FIXTURE ONLY',true);
update test_state set context=public.uid_rule_preflight(proposal,actor);
select pg_temp.assert_true(context#>'{direct_rule,eligible}'='true','strict structured rule eligible without baseline or image'),
 pg_temp.assert_true(context#>'{direct_rule,visual_qc_performed}'='false','no invented visual QC'),
 pg_temp.assert_true(jsonb_array_length(context->'targets')=3,'actual master/mirror targets shown'),
 pg_temp.assert_true(jsonb_array_length(context#>'{compiler_context,projected_targets}')=3,'all projections visible'),
 pg_temp.assert_true(context#>>'{direct_rule,proposed_rule,training_spec,generalized_rule}'='Use clear product-led headline content.','canonical sections authoritative'),
 pg_temp.assert_true(jsonb_array_length(context->'baselines')=0,'no baseline required') from test_state;

create function pg_temp.plan_for(c jsonb) returns jsonb language plpgsql as $$
declare catalog jsonb; targets jsonb;
begin
 begin catalog:=public.uid_rule_catalog_plan(c); exception when others then catalog:=null; end;
 select jsonb_agg(jsonb_build_object('node_id',t->'id','content_md',t->'content_md','metadata',case when catalog is null then t->'metadata' else jsonb_set(t->'metadata','{creative_quality_contract}',catalog) end,'version',t->'version','input_schema',t->'input_schema','status',t->'status','confidence',t->'confidence') order by t->>'id') into targets from jsonb_array_elements(c#>'{compiler_context,projected_targets}') t;
 return jsonb_build_object('schema_version','uid.owner-rule-plan.v1','candidate_hash',c->'candidate_hash','rule_hash',c#>'{direct_rule,rule_hash}','targets',targets);
end $$;
create function pg_temp.accept_rule(p uuid,actor uuid,candidate text,rule text) returns jsonb language plpgsql as $$
declare c jsonb; plan jsonb; plan_hash text; receipt jsonb;
begin
 c:=public.uid_rule_context(p);
 c:=jsonb_set(c,'{compiler_context,owner_user_id}',to_jsonb(actor));
 c:=c||jsonb_build_object('direct_rule',public.uid_rule_eligibility(c,actor));
 select result into receipt from uid_rule_private.decisions where proposal_id=p;
 if receipt is not null then plan:=null;plan_hash:=receipt->>'plan_hash';
 else plan:=pg_temp.plan_for(c);plan_hash:=encode(sha256(convert_to(public.uid_rule_stable_json(plan),'UTF8')),'hex');end if;
 return public.uid_rule_accept(p,actor,candidate,rule,plan,plan_hash);
end $$;

-- Boundaries: anonymous/authenticated cannot call RPCs; even service cannot read
-- or mutate configuration/audits or bypass the legacy merge's owner-only grant.
select pg_temp.assert_true(not has_function_privilege(r,s,'EXECUTE'),'deny '||r||' '||s)
 from (values('anon'),('authenticated')) roles(r) cross join (values('public.uid_rule_preflight(uuid,uuid)'),('public.uid_rule_accept(uuid,uuid,text,text,jsonb,text)')) signatures(s);
select pg_temp.assert_true(not has_schema_privilege(r,'uid_rule_private','USAGE'),'private schema '||r),
 pg_temp.assert_true(not has_table_privilege(r,'uid_rule_private.decisions','INSERT'),'private audit '||r),
 pg_temp.assert_true(not has_table_privilege(r,'uid_rule_private.owner_config','UPDATE'),'private config '||r)
 from (values('anon'),('authenticated'),('service_role')) roles(r);
select pg_temp.assert_true(not has_function_privilege('service_role','public.admin_accept_merge_creative_dna_proposal(uuid,uuid,text)','EXECUTE'),'legacy merge stays inaccessible'),
 pg_temp.assert_true(has_function_privilege('service_role','public.uid_rule_accept(uuid,uuid,text,text,jsonb,text)','EXECUTE'),'service guarded accept available');

do $$ declare s record; actor uuid; begin
 select * into s from test_state;
 foreach actor in array array['10000000-0000-0000-0000-000000000011'::uuid,'10000000-0000-0000-0000-000000000012'::uuid,'10000000-0000-0000-0000-000000000013'::uuid,null::uuid] loop
  perform pg_temp.expect_error(format('select pg_temp.accept_rule(%L,%L,%L,%L)',s.proposal,actor,s.context->>'candidate_hash',s.context#>>'{direct_rule,rule_hash}'),'verified owner');
 end loop;
 perform pg_temp.expect_error(format('select pg_temp.accept_rule(%L,%L,NULL,%L)',s.proposal,s.actor,s.context#>>'{direct_rule,rule_hash}'),'Exact displayed');
 perform pg_temp.expect_error(format('select pg_temp.accept_rule(%L,%L,%L,NULL)',s.proposal,s.actor,s.context->>'candidate_hash'),'Exact displayed');
end $$;

-- Freshness includes proposal/canonical fields, trigger scope, brand DNA and
-- owner config. Test every change in a rolled-back subtransaction.
do $$ declare s record; command text; refreshed jsonb; begin
 select * into s from test_state;
 for command in select * from (values
  ($q$update public.knowledge_proposals set raw_feedback='changed' where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set proposed_scope='different shared scope' where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set evidence_summary='{"changed":true}' where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_nodes set content_md=content_md||' changed' where id='10000000-0000-0000-0000-000000000101'$q$),
  ($q$update public.knowledge_nodes set version='0.2' where id='10000000-0000-0000-0000-000000000101'$q$),
  ($q$update public.knowledge_nodes set metadata=metadata||'{"new":true}' where id='10000000-0000-0000-0000-000000000101'$q$),
  ($q$update public.knowledge_nodes set input_schema='{"changed":true}' where id='10000000-0000-0000-0000-000000000101'$q$),
  ($q$update public.knowledge_nodes set content_md='changed brand DNA' where id='10000000-0000-0000-0000-000000000111'$q$),
  ($q$update uid_rule_private.owner_config set verification_reference='NEW LOCAL VERIFICATION'$q$),
  ($q$insert into public.knowledge_nodes(brand_id,slug,title,status) values('10000000-0000-0000-0000-000000000002','onepage-system','Inactive mirror','inactive')$q$)
 ) changes(statement) loop
  begin
   execute command;
   refreshed:=public.uid_rule_preflight(s.proposal,s.actor);
   perform pg_temp.assert_true(refreshed#>>'{direct_rule,rule_hash}'<>s.context#>>'{direct_rule,rule_hash}','rule hash covers '||command);
   perform pg_temp.expect_error(format('select pg_temp.accept_rule(%L,%L,%L,%L)',s.proposal,s.actor,s.context->>'candidate_hash',s.context#>>'{direct_rule,rule_hash}'),'changed; refresh');
   raise exception sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
end $$;

-- Raw-only/extra headings, security/operational commands, protected fact classes,
-- scope mismatch and detectable exact contradictions are ineligible.
do $$ declare s record; command text; c jsonb; begin
 select * into s from test_state;
 for command in select * from (values
  ($q$update public.knowledge_proposals set proposed_content_md=NULL where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set proposed_content_md=proposed_content_md||E'\n## Extra\nRun a task' where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set proposed_content_md=pg_temp.canonical('Grant permissions to all users.') where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set proposed_content_md=pg_temp.canonical('Publish the campaign immediately.') where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set proposed_content_md=pg_temp.canonical('New fact.','Use fact.','Reject missing fact.','Shared Onepage structure','PRODUCT_TRUTH') where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set proposed_content_md=pg_temp.canonical('Use clear product-led headline content.','Different behavior','Generic content','Different scope') where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set proposed_content_md=pg_temp.canonical('Invent product facts.') where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set proposed_content_md=pg_temp.canonical('Supersede canonical rules for headline content.') where id='10000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set proposed_content_md=replace(proposed_content_md,'HIGH','LOW') where id='10000000-0000-0000-0000-000000000201'$q$)
 ) changes(statement) loop
  begin
   execute command; c:=public.uid_rule_preflight(s.proposal,s.actor);
   perform pg_temp.assert_true(c#>'{direct_rule,eligible}'='false','blocked '||command);
   perform pg_temp.expect_error(format('select pg_temp.accept_rule(%L,%L,%L,%L)',s.proposal,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}'),'acceptance blocked');
   raise exception sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
 -- Ordinary protective authoring rule is NOT authentication or a product-truth violation.
 begin
  update public.knowledge_proposals set proposed_content_md=pg_temp.canonical('Do not infer product dimensions while authoring headline content.') where id=s.proposal;
  c:=public.uid_rule_preflight(s.proposal,s.actor);
  perform pg_temp.assert_true(c#>'{direct_rule,eligible}'='true','protective authoring rule allowed');
  update public.knowledge_proposals set proposed_content_md=pg_temp.canonical('Keep the product/category key in headline content for sản phẩm đang triển khai.'),raw_feedback='Past issue discussed deploy permissions, not proposed behavior.' where id=s.proposal;
  c:=public.uid_rule_preflight(s.proposal,s.actor);
  perform pg_temp.assert_true(c#>'{direct_rule,eligible}'='true','normal Vietnamese product context and past raw discussion do not mean code deployment');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Actual closure includes inactive mirrors, but no hidden reactivation is allowed.
do $$ declare s record; c jsonb; begin
 select * into s from test_state;
 begin
  insert into public.knowledge_nodes(id,brand_id,slug,title,status) values('10000000-0000-0000-0000-000000000150','10000000-0000-0000-0000-000000000002','onepage-system','Hidden inactive mirror','inactive');
  c:=public.uid_rule_preflight(s.proposal,s.actor);
  perform pg_temp.assert_true(jsonb_array_length(c->'targets')=4,'inactive mirror in real closure');
  perform pg_temp.assert_true(c#>'{direct_rule,eligible}'='false','inactive mirror does not reactivate through rule');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  alter table public.knowledge_nodes disable trigger trg_enforce_onepage_pawfecthouse_master;
  update public.knowledge_nodes set content_md='Divergent mirror text must not be overwritten.' where id='10000000-0000-0000-0000-000000000102';
  alter table public.knowledge_nodes enable trigger trg_enforce_onepage_pawfecthouse_master;
  c:=public.uid_rule_preflight(s.proposal,s.actor);
  perform pg_temp.assert_true(c#>'{direct_rule,eligible}'='false','divergent mirror content is not overwritten by rule approval');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  insert into public.knowledge_nodes(brand_id,slug,title,status) values('10000000-0000-0000-0000-000000000001','onepage-system','Inactive duplicate master','inactive');
  c:=public.uid_rule_preflight(s.proposal,s.actor);
  perform pg_temp.assert_true(c#>'{direct_rule,eligible}'='false','all-status duplicate master rejected');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update public.knowledge_proposals set proposed_scope='brand style only',proposed_content_md=pg_temp.canonical('Keep brand headline expression.','Use brand phrasing.','Generic voice.','brand style only','BRAND_STYLE'),evidence_summary='{"admin_overview":{"rule_class":"BRAND_STYLE"}}' where id=s.proposal;
  c:=public.uid_rule_preflight(s.proposal,s.actor);
  perform pg_temp.assert_true(c#>'{direct_rule,eligible}'='false','local Onepage branch cannot leak via master/mirror');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Unknown triggers cannot silently expand the approved effect set.
create function pg_temp.leak_scope() returns trigger language plpgsql as $$ begin
 if new.id='10000000-0000-0000-0000-000000000101' then update public.knowledge_nodes set content_md='unauthorized side effect' where id='10000000-0000-0000-0000-000000000199'; end if; return new; end $$;
do $$ declare s record; c jsonb; begin
 select * into s from test_state;
 begin
  create trigger fixture_leak after update on public.knowledge_nodes for each row execute function pg_temp.leak_scope();
  c:=public.uid_rule_preflight(s.proposal,s.actor);
  perform pg_temp.expect_error(format('select pg_temp.accept_rule(%L,%L,%L,%L)',s.proposal,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}'),'outside the approved scope');
  perform pg_temp.assert_true((select status='pending' from public.knowledge_proposals where id=s.proposal),'trigger failure rolls back proposal');
  perform pg_temp.assert_true((select count(*)=0 from uid_rule_private.decisions),'trigger failure creates no audit');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Compiled Onepage rules are exact verbatim subordinate supplements. The SQL
-- reconstruction preserves all hard rules/references and rejects a forged plan.
do $$ declare s record; c jsonb; catalog jsonb:='{"schema_version":"uid-creative-quality-catalog/1","contracts":{}}'; target jsonb; dna jsonb;
 bundle jsonb; rules jsonb; plan jsonb; corrupt jsonb; result jsonb; original_rules jsonb; slug text; category text; command text;
begin
 select * into s from test_state;
 begin
  for target in select value from jsonb_array_elements(s.context->'targets') loop
   slug:=target->>'brand_slug';
   select value into dna from jsonb_array_elements(s.context#>'{compiler_context,brand_dna_nodes}') n where n->>'brand_id'=target->>'brand_id';
   rules:='[]';
   foreach category in array array['content','typography','banner','proof','delivery','workflow','brand_style'] loop
    rules:=rules||jsonb_build_array(jsonb_build_object('id','baseline.'||category,'key',case when category='brand_style' then 'brand.active_expression' else category||'.baseline' end,
      'value','KEEP_VERIFIED_CANONICAL','instruction','Preserve verified canonical content and Product Truth.','category',category,
      'scope',jsonb_build_object('brands',case when category='brand_style' then jsonb_build_array(slug) else '["*"]'::jsonb end,'branches','["onepage-system"]'::jsonb),
      'sources',jsonb_build_array(jsonb_build_object('node',case when category='brand_style' then 'brand_dna' else 'branch' end,'locator','canonical:fixture'))));
   end loop;
   bundle:=jsonb_build_object('schema_version','uid-creative-quality/1','revision','synthetic-fixture-v1','source_hashes',jsonb_build_object('branch',public.uid_rule_source_hash(target),'brand_dna',public.uid_rule_source_hash(dna)),
    'rules',rules,'references',jsonb_build_array(jsonb_build_object('id','optional-fixture','role','style','scope',jsonb_build_object('brands','["*"]'::jsonb,'branches','["onepage-system"]'::jsonb),'required_for','[]'::jsonb,'usage','supplementary_inspiration','source',jsonb_build_object('node','branch','locator','canonical:fixture'))));
   catalog:=jsonb_set(catalog,array['contracts',slug],bundle);
  end loop;
  update public.knowledge_nodes set metadata=jsonb_set(metadata,'{creative_quality_contract}',catalog) where id='10000000-0000-0000-0000-000000000101';
  c:=public.uid_rule_preflight(s.proposal,s.actor);
  perform pg_temp.assert_true(c#>'{direct_rule,eligible}'='true','fresh compiled structural scope eligible');
  plan:=pg_temp.plan_for(c);
  perform pg_temp.assert_true(plan#>>'{targets,0,metadata,creative_quality_contract,contracts,pawfecthouse,schema_version}'='uid-creative-quality/2','stored supplemental schema blocks old compiler downgrade');
  perform pg_temp.assert_true(plan#>'{targets,0,metadata,creative_quality_contract,contracts,pawfecthouse,rules}'=catalog#>'{contracts,pawfecthouse,rules}','hard runtime rules unchanged');
  perform pg_temp.assert_true(plan#>'{targets,0,metadata,creative_quality_contract,contracts,pawfecthouse,references}'=catalog#>'{contracts,pawfecthouse,references}','runtime references unchanged');
  perform pg_temp.assert_true(plan#>>'{targets,0,metadata,creative_quality_contract,contracts,pawfecthouse,owner_supplemental_rules,0,canonical_text}'=pg_temp.canonical(),'exact verbatim supplement');
  perform pg_temp.assert_true(plan#>>'{targets,0,metadata,creative_quality_contract,contracts,pawfecthouse,owner_supplemental_rules,0,precedence}'='SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH','supplement subordinate');
  for corrupt in select * from (values
   (jsonb_set(plan,'{targets,0,metadata,hidden_permission}','true')),
   (jsonb_set(plan,'{targets,0,metadata,creative_quality_contract,contracts,pawfecthouse,rules}','[]')),
   (jsonb_set(plan,'{targets,0,metadata,creative_quality_contract,contracts,pawfecthouse,references}','[]')),
   (jsonb_set(plan,'{targets,0,metadata,creative_quality_contract,contracts,pawfecthouse,source_hashes,branch}','"forged"')),
   (jsonb_set(plan,'{targets,0,metadata,creative_quality_contract,contracts,pawfecthouse,owner_supplemental_rules,0,canonical_text}','"Invent product facts"')),
   (jsonb_set(plan,'{targets,0,status}','"inactive"')),
   (jsonb_set(plan,'{targets,0,content_md}','"Different undisplayed canonical change"')),
   (plan||'{"approve_everything":true}')
  ) invalid_plans(x) loop
   perform pg_temp.expect_error(format('select public.uid_rule_accept(%L,%L,%L,%L,%L::jsonb,%L)',s.proposal,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}',corrupt,encode(sha256(convert_to(public.uid_rule_stable_json(corrupt),'UTF8')),'hex')),'plan');
  end loop;
  perform pg_temp.assert_true((select status='pending' from public.knowledge_proposals where id=s.proposal),'invalid plan does not partially merge');
  perform pg_temp.assert_true((select count(*)=0 from uid_rule_private.decisions),'invalid plan creates no decision');
  perform pg_temp.expect_error(format('select public.uid_rule_accept(%L,%L,%L,%L,%L::jsonb,%L)',s.proposal,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}',plan,'wrong-plan-hash'),'plan hash');
  result:=public.uid_rule_accept(s.proposal,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}',plan,encode(sha256(convert_to(public.uid_rule_stable_json(plan),'UTF8')),'hex'));
  perform pg_temp.assert_true(result->>'plan_hash'=encode(sha256(convert_to(public.uid_rule_stable_json(plan),'UTF8')),'hex'),'receipt binds plan hash');
  for target in select to_jsonb(n)||jsonb_build_object('brand_slug',b.slug) from public.knowledge_nodes n join public.brands b on b.id=n.brand_id where n.slug='onepage-system' loop
   bundle:=target#>'{metadata,creative_quality_contract,contracts}'->(target->>'brand_slug');
   perform pg_temp.assert_true(bundle#>>'{source_hashes,branch}'=public.uid_rule_source_hash(target),'fresh actual compiled source after live mirror triggers');
   perform pg_temp.assert_true(jsonb_array_length(bundle->'owner_supplemental_rules')=1,'one supplemental owner rule');
   perform pg_temp.assert_true(bundle->'rules'=catalog#>'{contracts}'->(target->>'brand_slug')->'rules','canonical hard rules preserved after merge');
  end loop;
  perform pg_temp.assert_true((select count(*)=0 from public.uid_governance_evaluations),'compiled owner acceptance creates no QC evaluation');
  perform public.uid_governance_rollback_proposal(s.proposal,s.actor);
  perform pg_temp.assert_true((select metadata->'creative_quality_contract'=catalog from public.knowledge_nodes where id='10000000-0000-0000-0000-000000000101'),'rollback restores prior catalog');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- The historical evaluation path remains usable on a genuinely uncompiled leaf,
-- while an otherwise passed evaluation cannot bypass compiled/dependency guards.
do $$ declare s record; call text; command text; begin
 select * into s from test_state;
 begin
  insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,proposed_scope)
   values('10000000-0000-0000-0000-000000000220','10000000-0000-0000-0000-000000000199','10000000-0000-0000-0000-000000000001','Synthetic evaluated leaf rule','brand-local home hero');
  insert into public.uid_governance_baselines(id,brand_id,branch_slug,case_key,source_brief,approved_output,expected_assertions,approved_at)
   values('10000000-0000-0000-0000-000000000320','10000000-0000-0000-0000-000000000001','home-hero','synthetic-leaf','{"source":"synthetic"}','{"title":"verified"}','{"required_keys":["title"]}',now());
  insert into public.uid_governance_evaluations(id,proposal_id,candidate_hash,baseline_ids,test_results,conflict_results,evaluation_status,critical_failures,evaluator_version,completed_at)
   values('10000000-0000-0000-0000-000000000420','10000000-0000-0000-0000-000000000220',public.uid_governance_candidate_hash('10000000-0000-0000-0000-000000000220'),
   array['10000000-0000-0000-0000-000000000320'::uuid],
   '[{"baseline_id":"10000000-0000-0000-0000-000000000320","case_key":"synthetic-leaf","status":"passed","source_run_id":"synthetic-test-only","artifact_url":"https://example.test/synthetic-only","candidate_output":{"title":"verified"},"issues":[]}]',
   '[{"actor_user_id":"10000000-0000-0000-0000-000000000010","product_truth_verified":true,"visual_reviewed":true,"manually_reviewed":true,"issues":[],"note":"Synthetic fixture of an already validated historical review."}]',
   'passed',0,'mechanical-v2-scope-freshness',now());
  call:=$q$select public.uid_governance_accept_merge('10000000-0000-0000-0000-000000000220','10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000420','Synthetic historical review regression')$q$;
  for command in select * from (values
   ($q$update public.knowledge_nodes set metadata='{"creative_quality_contract":{}}' where id='10000000-0000-0000-0000-000000000199'$q$),
   ($q$insert into public.knowledge_nodes(brand_id,slug,title,parent_id) values('10000000-0000-0000-0000-000000000001','child-dependent','Dependent leaf','10000000-0000-0000-0000-000000000199')$q$)
  )changes(statement) loop
   begin
    execute command;
    update public.uid_governance_evaluations set candidate_hash=public.uid_governance_candidate_hash(proposal_id) where id='10000000-0000-0000-0000-000000000420';
    perform pg_temp.expect_error(call,'Compiler integration required');
    perform pg_temp.assert_true((select status='pending' from public.knowledge_proposals where id='10000000-0000-0000-0000-000000000220'),'legacy guard stays atomic');
    raise exception sqlstate 'ZX002';
   exception when sqlstate 'ZX002' then null; end;
  end loop;
  execute call;
  perform pg_temp.assert_true((select status='merged' from public.knowledge_proposals where id='10000000-0000-0000-0000-000000000220'),'uncompiled leaf old evaluation path still works');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Genuinely uncompiled leaves use the same exact projection/owner transaction.
-- No migration, fabricated catalog, compiler refresh or visual pass is needed.
do $$ declare s record; c jsonb; plan jsonb; h text; result jsonb; replay jsonb;
 target_before jsonb; target_after jsonb; outside_before jsonb; bad jsonb; change text; variant jsonb;
 p uuid:='10000000-0000-0000-0000-000000000209'; leaf uuid:='10000000-0000-0000-0000-000000000198';
begin
 select * into s from test_state;
 begin
  insert into public.knowledge_nodes(id,brand_id,slug,title,node_type,content_md,version,status,confidence,metadata,input_schema)
  values(leaf,'10000000-0000-0000-0000-000000000001','ldp-system','Synthetic uncompiled LDP leaf','page','Existing LDP canonical content.','2.7','active','HIGH',
   '{"preserve":{"nested":[1,true,"kept"]},"source_policy":"verified only"}','{"required":["product"],"preserve":true}');
  insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,raw_feedback,proposed_scope,evidence_summary)
  values(p,leaf,'10000000-0000-0000-0000-000000000001',pg_temp.canonical('Use concise verified product-led LDP headings.','Keep LDP headings specific to the supplied product.','Generic headings without product context.','LDP local','STRUCTURAL'),
   'Synthetic direct leaf fixture','LDP local','{"admin_overview":{"rule_class":"STRUCTURAL"}}');
  c:=public.uid_rule_preflight(p,s.actor);
  perform pg_temp.assert_true(c#>'{direct_rule,eligible}'='true','genuine absent-catalog leaf eligible');
  perform pg_temp.assert_true(c#>'{compiler_context,dependent_nodes}'='[]','leaf has no active dependent child');
  perform pg_temp.assert_true(public.uid_rule_catalog_plan(c) is null,'absent catalog stays absent');
  plan:=pg_temp.plan_for(c);
  perform pg_temp.assert_true(plan is not null and plan->>'schema_version'='uid.owner-rule-plan.v1','leaf still requires exact nonnull plan');
  perform pg_temp.assert_true(not(plan#>'{targets,0,metadata}' ? 'creative_quality_contract'),'no catalog is fabricated for leaf');
  select to_jsonb(n) into target_before from public.knowledge_nodes n where id=leaf;
  select jsonb_agg(to_jsonb(n) order by id) into outside_before from public.knowledge_nodes n where id<>leaf;
  h:=encode(sha256(convert_to(public.uid_rule_stable_json(plan),'UTF8')),'hex');
  -- JSON null means a present malformed catalog, not an absent catalog.
  for variant in select * from (values ('null'::jsonb),('{}'::jsonb),('[]'::jsonb),('"invalid"'::jsonb),('{"schema_version":"uid-creative-quality-catalog/unsupported","contracts":{}}'::jsonb))x(v) loop
   begin
    update public.knowledge_nodes set metadata=metadata||jsonb_build_object('creative_quality_contract',variant) where id=leaf;
    bad:=public.uid_rule_preflight(p,s.actor);
    perform pg_temp.assert_true(bad#>'{direct_rule,eligible}'='false','present null/malformed catalog cannot use leaf fallback');
    perform pg_temp.expect_error(format('select public.uid_rule_catalog_plan(%L)',bad),'Supported shared quality catalog required');
    raise exception sqlstate 'ZX001';
   exception when sqlstate 'ZX001' then null; end;
  end loop;
  for bad in select * from (values
   (jsonb_set(plan,'{targets,0,metadata}','{}')),
   (jsonb_set(plan,'{targets,0,version}','"new"')),
   (jsonb_set(plan,'{targets,0,input_schema}','{}')),
   (jsonb_set(plan,'{targets,0,status}','"inactive"')),
   (jsonb_set(plan,'{targets,0,confidence}','"LOW"')),
   (jsonb_set(plan,'{targets,0,content_md}','"Different unseen text"')),
   (jsonb_set(plan,'{targets,0,node_id}',to_jsonb('10000000-0000-0000-0000-000000000199'::text))),
   (jsonb_set(plan,'{targets}','[]')),
   (plan||'{"approve_all":true}')
  )x(v) loop
   perform pg_temp.expect_error(format('select public.uid_rule_accept(%L,%L,%L,%L,%L,%L)',p,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}',bad,encode(sha256(convert_to(public.uid_rule_stable_json(bad),'UTF8')),'hex')),'plan');
  end loop;
  perform pg_temp.expect_error(format('select public.uid_rule_accept(%L,%L,%L,%L,null,%L)',p,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}',h),'plan hash');
  perform pg_temp.expect_error(format('select public.uid_rule_accept(%L,%L,%L,%L,%L,%L)',p,'10000000-0000-0000-0000-000000000011',c->>'candidate_hash',c#>>'{direct_rule,rule_hash}',plan,h),'verified owner Admin');
  for change in select * from (values
   (format('update public.knowledge_nodes set version=''2.8'' where id=%L',leaf)),
   (format('update public.knowledge_nodes set metadata=metadata||''{"concurrent":true}'' where id=%L',leaf)),
   (format('update public.knowledge_proposals set proposed_scope=''Changed scope'' where id=%L',p)),
   (format('update public.knowledge_proposals set proposed_content_md=proposed_content_md||E''\nDifferent patch'' where id=%L',p))
  )x(statement) loop
   begin
    execute change;
    perform pg_temp.expect_error(format('select public.uid_rule_accept(%L,%L,%L,%L,%L,%L)',p,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}',plan,h),'changed; refresh');
    raise exception sqlstate 'ZX001';
   exception when sqlstate 'ZX001' then null; end;
  end loop;
  begin
   insert into public.knowledge_nodes(brand_id,parent_id,slug,title,metadata) values('10000000-0000-0000-0000-000000000001',leaf,'compiled-child','Active dependent child','{"creative_quality_contract":{"revision":"fixture"}}');
   bad:=public.uid_rule_preflight(p,s.actor);
   perform pg_temp.assert_true(bad#>'{direct_rule,eligible}'='false' and bad#>'{direct_rule,blockers}' @> '[{"code":"unsupported_dependency_scope"}]','active child blocks absent-catalog parent');
   perform pg_temp.expect_error(format('select public.uid_rule_accept(%L,%L,%L,%L,%L,%L)',p,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}',plan,h),'changed; refresh');
   raise exception sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; end;
  begin
   update public.knowledge_proposals set proposed_content_md=pg_temp.canonical('State product material as a fact.','Describe material.','Unknown material.','LDP local','PRODUCT_TRUTH'),evidence_summary='{"admin_overview":{"rule_class":"PRODUCT_TRUTH"}}' where id=p;
   bad:=public.uid_rule_preflight(p,s.actor);
   perform pg_temp.assert_true(bad#>'{direct_rule,eligible}'='false','leaf fallback never opens protected Product Truth class');
   raise exception sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; end;
  perform pg_temp.assert_true((select count(*)=0 from public.uid_governance_snapshots where proposal_id=p),'rejected leaf plans never partially snapshot');
  perform pg_temp.assert_true((select to_jsonb(n) from public.knowledge_nodes n where id=leaf)=target_before,'rejected leaf operations leave source exact');
  result:=public.uid_rule_accept(p,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}',plan,h);
  select to_jsonb(n) into target_after from public.knowledge_nodes n where id=leaf;
  perform pg_temp.assert_true(target_after->>'content_md'=plan#>>'{targets,0,content_md}','exact displayed canonical append');
  perform pg_temp.assert_true(target_after-'content_md'-'updated_at'=target_before-'content_md'-'updated_at','all metadata and non-content fields unchanged');
  perform pg_temp.assert_true((select jsonb_agg(to_jsonb(n) order by id) from public.knowledge_nodes n where id<>leaf)=outside_before,'all outside rows unchanged');
  perform pg_temp.assert_true(result->>'decision_kind'='owner_direct_rule' and result->'visual_qc_performed'='false','honest direct decision attribution');
  replay:=public.uid_rule_accept(p,s.actor,c->>'candidate_hash',c#>>'{direct_rule,rule_hash}',null,h);
  perform pg_temp.assert_true(replay=result,'leaf replay reads immutable receipt exactly');
  perform pg_temp.assert_true((select count(*)=2 from public.uid_governance_snapshots where proposal_id=p),'one exact snapshot pair for leaf including retry');
  perform pg_temp.assert_true((select count(*)=1 from uid_rule_private.decisions where proposal_id=p),'one immutable owner decision');
  perform pg_temp.assert_true((select count(*)=0 from public.uid_governance_evaluations where proposal_id=p),'direct leaf creates no visual evaluation');
  perform public.uid_governance_rollback_proposal(p,s.actor);
  select to_jsonb(n) into target_after from public.knowledge_nodes n where id=leaf;
  perform pg_temp.assert_true(target_after-'updated_at'=target_before-'updated_at','leaf rollback restores original source and metadata');
  perform pg_temp.assert_true((select count(*)=1 from uid_rule_private.decisions where proposal_id=p),'rollback preserves immutable decision history');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Atomic successful structural merge and exact idempotent retry. No evaluation,
-- manual-review checkbox or image evidence is created by this path.
create temp table accepted as select pg_temp.accept_rule(proposal,actor,context->>'candidate_hash',context#>>'{direct_rule,rule_hash}') result from test_state;
select pg_temp.assert_true(result->>'decision_kind'='owner_direct_rule','distinct owner decision'),pg_temp.assert_true(result->'visual_qc_performed'='false','no QC claim') from accepted;
select pg_temp.assert_true((select count(*)=0 from public.uid_governance_evaluations),'no fabricated passed evaluations'),
 pg_temp.assert_true((select count(*)=1 from uid_rule_private.decisions),'one immutable decision'),
 pg_temp.assert_true((select count(*)=3 from public.uid_governance_snapshots where checkpoint='before'),'all before snapshots'),
 pg_temp.assert_true((select count(*)=3 from public.uid_governance_snapshots where checkpoint='after'),'all after snapshots');
select pg_temp.assert_true(pg_temp.accept_rule(proposal,actor,context->>'candidate_hash',context#>>'{direct_rule,rule_hash}')=(select result from accepted),'byte-identical retry'),
 pg_temp.assert_true(public.uid_rule_preflight(proposal,actor)->'direct_rule_receipt'=(select result from accepted),'owner preflight receipt available') from test_state;
select pg_temp.assert_true((select count(*)=6 from public.uid_governance_snapshots),'retry creates no additional snapshot');

do $$ declare s record; begin
 select * into s from test_state;
 perform pg_temp.expect_error(format('select pg_temp.accept_rule(%L,%L,%L,%L)',s.proposal,s.actor,'scope-v2:different',s.context#>>'{direct_rule,rule_hash}'),'Conflicting retry');
 perform pg_temp.expect_error($q$update uid_rule_private.decisions set candidate_hash='different'$q$,'immutable');
 perform pg_temp.expect_error('delete from uid_rule_private.decisions','immutable');
 begin
  update public.creative_dna_team_members set is_active=false where user_id=s.actor;
  perform pg_temp.expect_error(format('select pg_temp.accept_rule(%L,%L,%L,%L)',s.proposal,s.actor,s.context->>'candidate_hash',s.context#>>'{direct_rule,rule_hash}'),'verified owner');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;
-- Existing rollback restores all affected content/metadata and keeps the owner receipt.
select public.uid_governance_rollback_proposal(proposal,actor) from test_state;
select pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(nodes_before) old join public.knowledge_nodes n on n.id::text=old->>'id' where to_jsonb(n)-'updated_at' is distinct from old-'updated_at'),'rollback restores exact canonical fields') from test_state;
select pg_temp.assert_true((select count(*)=1 from uid_rule_private.decisions),'rollback keeps audit');
rollback;
