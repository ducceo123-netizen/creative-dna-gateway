-- Owner-direct acceptance is a separate decision, never a QC evaluation.
-- Preparation only: owner configuration is deliberately EMPTY and deny-by-default.
-- A separately approved deployment must provision the verified owner; no RPC can
-- grant this authority and ordinary team-admin membership is insufficient.
create schema if not exists uid_rule_private;
revoke all on schema uid_rule_private from public,anon,authenticated,service_role;
create table uid_rule_private.owner_config (
 singleton boolean primary key default true check(singleton),
 owner_user_id uuid not null,
 verified_at timestamptz not null,
 verification_reference text not null check(length(btrim(verification_reference)) between 8 and 500),
 enabled boolean not null default false
);
create table uid_rule_private.decisions (
 id uuid primary key default gen_random_uuid(),
 proposal_id uuid not null unique references public.knowledge_proposals(id),
 owner_user_id uuid not null,
 candidate_hash text not null,
 rule_hash text not null,
 decision_kind text not null default 'owner_direct_rule' check(decision_kind='owner_direct_rule'),
 intent jsonb not null check(jsonb_typeof(intent)='object'),
 before_context jsonb not null check(jsonb_typeof(before_context)='object'),
 after_targets jsonb not null check(jsonb_typeof(after_targets)='array'),
 result jsonb not null check(jsonb_typeof(result)='object'),
 created_at timestamptz not null default now()
);
alter table uid_rule_private.owner_config enable row level security;
alter table uid_rule_private.decisions enable row level security;
revoke all on uid_rule_private.owner_config,uid_rule_private.decisions from public,anon,authenticated,service_role;
comment on table uid_rule_private.decisions is 'Immutable explicit owner rule decisions, not visual QC, candidate evaluation or proof of semantic consistency. Retain after rollback.';

create function public.uid_rule_preserve_decision() returns trigger language plpgsql
set search_path=public,pg_temp as $$
declare owner_name text;
begin
 if tg_op<>'INSERT' then raise exception 'Owner rule decision audit is immutable'; end if;
 select pg_get_userbyid(relowner) into owner_name from pg_class where oid=tg_relid;
 if current_user<>owner_name or current_setting('uid.rule_action',true) is distinct from 'accept'
 then raise exception 'Owner rule audit requires guarded acceptance'; end if;
 return new;
end $$;
create trigger uid_rule_preserve_decision before insert or update or delete on uid_rule_private.decisions
 for each row execute function public.uid_rule_preserve_decision();
revoke all on function public.uid_rule_preserve_decision() from public,anon,authenticated,service_role;

create function public.uid_rule_digest(p_value jsonb) returns text language sql immutable
set search_path=pg_catalog,pg_temp as $$ select encode(sha256(convert_to(p_value::text,'UTF8')),'hex') $$;
revoke all on function public.uid_rule_digest(jsonb) from public,anon,authenticated,service_role;

-- The persisted canonical six-section format, not the raw conversation, is
-- authoritative. Extra headings or unstructured trailing operations are rejected.
create function public.uid_rule_parse_canonical(p_text text) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare parts text[]; expected text[]:=array['Generalized Rule','Expected Behavior','Reject Conditions','Scope','Rule Class','Confidence'];
 result jsonb:='{}'; i integer; body text; lines text[]; line text; rejects jsonb:='[]';
begin
 if p_text is null or octet_length(p_text)>30000 then return null; end if;
 parts:=regexp_split_to_array(replace(btrim(p_text,E' \t\r\n'),E'\r\n',E'\n'),E'(?m)^## ');
 if cardinality(parts)<>7 or parts[1]<>'' then return null; end if;
 for i in 1..6 loop
  if split_part(parts[i+1],E'\n',1)<>expected[i] then return null; end if;
  body:=btrim(substr(parts[i+1],length(expected[i])+2),E' \t\r\n');
  if i=3 then
   if body<>'' then
    foreach line in array string_to_array(body,E'\n') loop
     if line !~ '^- [^[:space:]]' or length(line)>802 then return null; end if;
     rejects:=rejects||jsonb_build_array(substr(line,3));
    end loop;
   end if;
   if jsonb_array_length(rejects)>12 then return null; end if;
   result:=result||jsonb_build_object('reject_conditions',rejects);
  else
   if body='' or length(body)>(case when i=4 then 500 when i>=5 then 30 else 4000 end) or body~E'(?m)^#{1,6} ' then return null; end if;
   result:=result||jsonb_build_object(lower(replace(expected[i],' ','_')),body);
  end if;
 end loop;
 return result;
end $$;
revoke all on function public.uid_rule_parse_canonical(text) from public,anon,authenticated,service_role;

-- Match the existing TypeScript compiler's stable object ordering and source
-- identity independently. Unexpected numeric/Unicode representation fails closed
-- when the Edge compiler plan does not match this exact canonical identity.
create function public.uid_rule_stable_json(p_value jsonb) returns text
language plpgsql immutable set search_path=public,pg_temp as $$
declare result text;
begin
 case jsonb_typeof(p_value)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.uid_rule_stable_json(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(p_value);
 when 'array' then select '['||coalesce(string_agg(public.uid_rule_stable_json(value),',' order by ordinal),'')||']' into result from jsonb_array_elements(p_value) with ordinality a(value,ordinal);
 else result:=p_value::text;
 end case;
 return result;
end $$;
create function public.uid_rule_source_hash(p_node jsonb) returns text
language sql immutable set search_path=public,pg_temp as $$
 select encode(sha256(convert_to(public.uid_rule_stable_json(jsonb_build_object('slug',p_node->'slug','version',p_node->'version','content_md',coalesce(p_node->>'content_md',''),'metadata',coalesce(p_node->'metadata','{}')-'creative_quality_contract')),'UTF8')),'hex')
$$;
revoke all on function public.uid_rule_stable_json(jsonb),public.uid_rule_source_hash(jsonb) from public,anon,authenticated,service_role;

-- Include the real Onepage master/mirror trigger closure, even inactive mirrors.
-- Inactive/divergent state is exposed but blocks acceptance rather than silently
-- reactivating a row or overwriting its input schema/confidence/version.
create function public.uid_rule_context(p_proposal_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb; targets jsonb; projected jsonb:='[]'; master jsonb; master_count integer;
 target jsonb; projection jsonb; block_text text; ids uuid[]; branch text; cross_brand boolean;
begin
 c:=public.uid_governance_review_context(p_proposal_id);
 if c is null then return null; end if;
 branch:=c#>>'{scope,branch_slug}'; cross_brand:=c#>'{scope,cross_brand}'='true';
 select jsonb_agg(to_jsonb(n)||jsonb_build_object('brand_name',b.name,'brand_slug',b.slug,'node_hash','node-v2:'||md5(to_jsonb(n)::text)) order by n.id),array_agg(n.id order by n.id)
 into targets,ids from public.knowledge_nodes n left join public.brands b on b.id=n.brand_id
 where n.id in(select id from public.uid_governance_target_nodes(p_proposal_id))
  or (branch='onepage-system' and cross_brand and n.slug='onepage-system' and lower(b.name) in ('giftsoul','soulprise')
      and exists(select 1 from public.uid_governance_target_nodes(p_proposal_id)));
 targets:=coalesce(targets,'[]');
 select count(*) into master_count from public.knowledge_nodes n join public.brands b on b.id=n.brand_id where n.slug='onepage-system' and lower(b.name)='pawfecthouse';
 if master_count=1 then select to_jsonb(n) into master from public.knowledge_nodes n join public.brands b on b.id=n.brand_id where n.slug='onepage-system' and lower(b.name)='pawfecthouse'; end if;
 block_text:=E'\n\n## ACCEPTED ADMIN FEEDBACK — '||to_char(now() at time zone 'UTC','YYYY-MM-DD')||E'\n'||btrim(coalesce(c#>>'{proposal,proposed_content_md}',''))||E'\n';
 for target in select value from jsonb_array_elements(targets) loop
  projection:=target-'brand_name'-'brand_slug'-'node_hash';
  if branch='onepage-system' and cross_brand and master is not null and lower(target->>'brand_name') in ('giftsoul','soulprise') then
   projection:=projection||jsonb_build_object('content_md',master->>'content_md','input_schema',master->'input_schema','version',master->'version','status',master->'status','confidence',master->'confidence',
    'metadata',(master->'metadata')||jsonb_build_object('active_brand',target->>'brand_name','onepage_master_brand','PawfectHouse','onepage_sync_mode','PAWFECTHOUSE_MASTER_100_PERCENT','cross_brand_onepage_structure','IDENTICAL_HARD','brand_difference_scope','BRAND_DNA_EXPRESSION_ONLY'));
  end if;
  if position(btrim(coalesce(c#>>'{proposal,proposed_content_md}','')) in coalesce(projection->>'content_md',''))=0 then
   projection:=jsonb_set(projection,'{content_md}',to_jsonb(coalesce(projection->>'content_md','')||block_text));
  end if;
  projected:=projected||jsonb_build_array(projection);
 end loop;
 return c||jsonb_build_object('targets',targets,'scope',(c->'scope')||jsonb_build_object('target_node_ids',to_jsonb(coalesce(ids,'{}'::uuid[])),'actual_trigger_closure',true),
  'compiler_context',jsonb_build_object('policy_version','uid.owner-rule-plan.v1','master_node_id',case when branch='onepage-system' and cross_brand then master->'id' else null end,'master_count',master_count,
   'merge_block_text',block_text,'projected_targets',projected,
   'brands',coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from public.brands b where b.id in(select n.brand_id from public.knowledge_nodes n where n.id=any(ids))),'[]'),
   'brand_dna_nodes',coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from public.knowledge_nodes n where n.slug='brand-dna' and n.status='active' and n.brand_id in(select x.brand_id from public.knowledge_nodes x where x.id=any(ids))),'[]'),
   'dependent_nodes',coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from public.knowledge_nodes n where n.status='active' and n.parent_id=any(ids) and not n.id=any(ids)),'[]'),
   'merge_definition',pg_get_functiondef('public.admin_accept_merge_creative_dna_proposal(uuid,uuid,text)'::regprocedure),
   'trigger_definitions',coalesce((select jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid)) order by t.tgname) from pg_trigger t where t.tgrelid='public.knowledge_nodes'::regclass and not t.tgisinternal and t.tgenabled<>'D'),'[]')));
end $$;
revoke all on function public.uid_rule_context(uuid) from public,anon,authenticated,service_role;

-- Bounded structured TrainingSpec accepted by the existing feedback ingestion.
-- Text is data, never authority. No parsing of arbitrary prose as a rule schema.
create function public.uid_rule_eligibility(p_context jsonb,p_actor_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 p jsonb:=p_context->'proposal'; spec jsonb; owner_config jsonb; actor_admin boolean; owner_ok boolean;
 blockers jsonb:='[]'; field text; candidate text; normative text; all_text text; rule_class text;
 target jsonb; prior_line text; clause text; normalized text; prior_normalized text;
 branch text:=p_context#>>'{scope,branch_slug}'; rule_hash text;
 allowed_fields text[]:=array['observed_issue','generalized_rule','expected_behavior','reject_conditions','scope','rule_class','evidence_summary','confidence','admin_summary_vi','admin_reason_vi','admin_change_vi'];
begin
 select to_jsonb(c) into owner_config from uid_rule_private.owner_config c where singleton;
 select exists(select 1 from public.creative_dna_team_members where user_id=p_actor_user_id and role='admin' and is_active) into actor_admin;
 owner_ok:=coalesce(actor_admin and owner_config->>'owner_user_id'=p_actor_user_id::text and owner_config->'enabled'='true',false);
 if not owner_ok then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','verified_owner_required','message','Chỉ owner Admin đã được xác minh mới được duyệt rule trực tiếp.','next_action','Đăng nhập bằng owner đã cấu hình; quyền Admin thông thường không đủ.')); end if;
 if p is null or p->>'status' is distinct from 'pending' or p->>'merged_at' is not null
 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','pending_proposal_required','message','Feedback không còn ở trạng thái chờ duyệt.','next_action','Tải lại feedback hiện tại.')); end if;
 if coalesce(jsonb_array_length(p_context->'targets'),0)=0
 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','targets_unavailable','message','Không có nhánh canonical đang hoạt động trong phạm vi này.','next_action','Kiểm tra nhánh và phạm vi áp dụng.')); end if;
 if coalesce(jsonb_array_length(p_context#>'{compiler_context,dependent_nodes}'),0)>0 then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unsupported_dependency_scope','message','Nhánh này có các nhánh con phụ thuộc ngoài phạm vi đã xem.','next_action','Cần một bản cập nhật bao gồm toàn bộ phụ thuộc; không dùng duyệt rule trực tiếp ở đây.'));
 end if;
 if branch is null or branch not in ('onepage-system','ldp-system','home-hero','ldp-hero','ugc-image','recipient-image','seasonal-banner','shop-by-product-image','shop-by-categories','niche-product-combo')
 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unsupported_branch','message','Nhánh này chưa hỗ trợ duyệt rule trực tiếp.','next_action','Dùng luồng quản trị phù hợp cho nhánh này.')); end if;
 spec:=public.uid_rule_parse_canonical(p->>'proposed_content_md');
 if jsonb_typeof(spec) is distinct from 'object' or octet_length(spec::text)>30000 then
  spec:=null;
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','structured_rule_required','message','Feedback chưa có training_spec có cấu trúc để kiểm tra rule.','next_action','Chuẩn hóa rule thành training_spec; raw feedback hoặc tóm tắt tự do chưa đủ.'));
 else
  if exists(select 1 from jsonb_object_keys(spec) k where not k=any(allowed_fields))
  then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unsupported_rule_fields','message','Rule có trường nằm ngoài schema Creative DNA đã hỗ trợ.','next_action','Loại bỏ dữ liệu điều khiển không thuộc training_spec hoặc dùng luồng quản trị riêng.')); end if;
  foreach field in array array['generalized_rule','expected_behavior','scope'] loop
   if jsonb_typeof(spec->field) is distinct from 'string' or length(btrim(coalesce(spec->>field,''))) not between 1 and (case when field='scope' then 500 else 4000 end)
   then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','invalid_rule_shape','message','Training spec thiếu hoặc sai trường '||field||'.','next_action','Bổ sung đầy đủ nội dung rule có cấu trúc trước khi duyệt.')); end if;
  end loop;
  if jsonb_typeof(spec->'reject_conditions') is distinct from 'array' then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','invalid_reject_conditions','message','Reject conditions phải là danh sách câu mô tả ngắn.','next_action','Chuẩn hóa reject_conditions trong training spec.'));
  elsif jsonb_array_length(spec->'reject_conditions')>12 or exists(select 1 from jsonb_array_elements(spec->'reject_conditions') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 800) then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','invalid_reject_conditions','message','Reject conditions không đúng giới hạn schema.','next_action','Giữ tối đa 12 điều kiện ngắn, không rỗng.'));
  end if;
  if spec->>'confidence' is null or spec->>'confidence' not in ('HIGH','MEDIUM','LOW') then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','invalid_confidence','message','Rule thiếu confidence hợp lệ.','next_action','Chuẩn hóa confidence trong training spec.'));
  end if;
  rule_class:=spec->>'rule_class';
  if rule_class is null or rule_class not in ('STRUCTURAL','BRAND_STYLE','WORKFLOW') then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','protected_rule_class','message','Product Truth, OTHER hoặc loại rule không xác định không được duyệt bằng lối tắt này.','next_action','Xác minh dữ kiện sản phẩm hoặc chuẩn hóa đúng loại rule trước khi duyệt.'));
  end if;
  if spec->>'scope' is distinct from p->>'proposed_scope' or (p#>>'{evidence_summary,admin_overview,rule_class}' is not null and p#>>'{evidence_summary,admin_overview,rule_class}' is distinct from rule_class) then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','scope_mismatch','message','Scope trong training spec khác phạm vi proposal.','next_action','Làm rõ một phạm vi thống nhất rồi tải lại.'));
  end if;
  if rule_class='BRAND_STYLE' and p_context#>'{scope,cross_brand}'='true' then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','brand_style_cross_brand','message','Brand style không được áp dụng như rule cấu trúc chung nhiều brand.','next_action','Tách rule về đúng phạm vi brand.'));
  end if;
 end if;
 candidate:=btrim(coalesce(p->>'proposed_content_md',''));
 if length(candidate) not between 1 and 16000 or spec is not null and (position(spec->>'generalized_rule' in candidate)=0 or position(spec->>'expected_behavior' in candidate)=0) then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','canonical_rule_unbound','message','Nội dung sẽ merge chưa chứa đầy đủ generalized rule và expected behavior có cấu trúc.','next_action','Chuẩn hóa proposed_content_md và xem lại chính xác thay đổi trước khi duyệt.'));
 end if;
 normative:=coalesce(candidate,'')||E'\n'||coalesce(spec->>'generalized_rule','')||E'\n'||coalesce(spec->>'expected_behavior','');
 all_text:=normative; -- Raw feedback/observations describe evidence, never operational intent.
 -- This is a conservative deny-list of detectable non-creative operations, not
 -- a claim to classify all natural-language instructions or semantic conflicts.
 if all_text ~* '(\mauth(entication|orization)?\M|\msecurity\M|\mpermissions?\M|credentials?|password|service[_ -]?role|api[_ -]?key|access[_ -]?token|oauth|row.level.security|bypass|disable.{0,30}(gate|check|review)|grant[[:space:]]|revoke[[:space:]]|quyền truy cập|phân quyền|bảo mật|mật khẩu|xác thực|bỏ qua.{0,30}(kiểm tra|duyệt))'
   or all_text ~* '(publish|deploy|execute.{0,20}(code|script|sql|campaign)|run.{0,20}(script|sql|campaign)|launch.{0,20}campaign|xuất bản|triển khai[[:space:]]+(mã|ứng dụng|hệ thống|chức năng|campaign|chiến dịch)|chạy.{0,20}(mã|script|chiến dịch)|<script|javascript:|```|(^|[[:space:]])(curl|sudo|eval)[[:space:]]|alter[[:space:]]+table|drop[[:space:]]+table)'
 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','non_creative_operation','message','Nội dung có yêu cầu liên quan quyền truy cập, bảo mật hoặc thực thi/xuất bản.','next_action','Tách yêu cầu vận hành khỏi rule Creative DNA; không thể bỏ qua bằng xác nhận.')); end if;
 if normative ~* '(supersede|override|replace.{0,40}(rule|canonical)|bỏ.{0,20}rule|ghi đè|thay thế.{0,40}(rule|quy tắc)|mâu thuẫn|contradict|unresolved|chưa rõ)'
 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unclear_rule_conflict','message','Rule yêu cầu thay thế hoặc có xung đột chưa rõ với canonical hiện tại.','next_action','Làm rõ rule cũ, rule mới và phạm vi thay thế; lối duyệt trực tiếp hiện chỉ thêm rule.')); end if;
 if spec->>'confidence'='LOW' then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','uncertain_rule','message','Training spec còn có confidence LOW.','next_action','Làm rõ điều chưa chắc chắn trước khi duyệt rule.'));
 end if;
 -- Existing master/mirror triggers do not permit honest one-brand Onepage edits.
 if branch='onepage-system' and p_context#>'{scope,cross_brand}' is distinct from 'true' then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','onepage_mirror_scope','message','Onepage đang dùng cơ chế master/mirror; sửa riêng một brand có thể khác phạm vi đã xem.','next_action','Đưa brand style về nhánh brand riêng hoặc dùng bản cập nhật kiểm soát toàn bộ mirror.'));
 end if;
 if branch='onepage-system' and p_context#>'{scope,cross_brand}'='true' then
  if p_context#>>'{compiler_context,master_count}' is distinct from '1' or not exists(select 1 from jsonb_array_elements(p_context->'targets') t where t->>'id'=p_context#>>'{compiler_context,master_node_id}' and t->>'status'='active') then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','ambiguous_onepage_master','message','Không xác định được duy nhất một Onepage master đang hoạt động.','next_action','Sửa cấu hình master trước khi merge rule.'));
  end if;
  if exists(select 1 from jsonb_array_elements(p_context->'targets') t where lower(t->>'brand_name') in ('giftsoul','soulprise') and t->>'content_md' is distinct from (select m->>'content_md' from jsonb_array_elements(p_context->'targets') m where m->>'id'=p_context#>>'{compiler_context,master_node_id}'))
   or exists(select 1 from jsonb_array_elements(p_context->'targets') t join jsonb_array_elements(p_context#>'{compiler_context,projected_targets}') n on n->>'id'=t->>'id'
     where t->>'status'<>'active' or t-'content_md'-'updated_at'-'brand_name'-'brand_slug'-'node_hash' is distinct from n-'content_md'-'updated_at') then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','onepage_mirror_divergence','message','Một mirror không hoạt động hoặc khác cấu hình master; merge sẽ đổi dữ liệu ngoài rule đã duyệt.','next_action','Đồng bộ và kiểm tra trạng thái mirror bằng luồng quản trị riêng trước.'));
  end if;
 end if;
 if exists(select 1 from jsonb_array_elements(p_context->'targets') t group by t->>'brand_id' having count(*)>1) then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','ambiguous_brand_targets','message','Có nhiều canonical target cho cùng một brand.','next_action','Làm rõ các phiên bản target trước khi duyệt.'));
 end if;
 for target in select value from jsonb_array_elements(coalesce(p_context->'targets','[]')) loop
  -- Exact normalized opposite clauses are detectable; paraphrases still require
  -- the owner's substantive judgment and are never claimed semantically proven.
  for clause in select regexp_split_to_table(coalesce(spec->>'generalized_rule','')||E'\n'||coalesce(spec->>'expected_behavior',''),E'[\n.]') loop
   normalized:=lower(btrim(regexp_replace(clause,'[[:space:]]+',' ','g')));
   if length(normalized)<12 then continue; end if;
   for prior_line in select regexp_split_to_table(coalesce(target->>'content_md',''),E'[\n.]') loop
    prior_normalized:=lower(btrim(regexp_replace(prior_line,'^[#* -]+|[[:space:]]+$','','g')));
    prior_normalized:=regexp_replace(prior_normalized,'[[:space:]]+',' ','g');
    if prior_normalized in ('never '||normalized,'do not '||normalized,'must not '||normalized,'không '||normalized)
       or normalized in ('never '||prior_normalized,'do not '||prior_normalized,'must not '||prior_normalized,'không '||prior_normalized)
    then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','canonical_conflict','message','Rule có mệnh đề phủ định trực tiếp một câu trong canonical hiện tại.','next_action','Làm rõ xung đột và tạo thay đổi có phạm vi thay thế rõ ràng.')); exit; end if;
   end loop;
  end loop;
 end loop;
 if spec is not null and jsonb_typeof(spec->'reject_conditions')='array' and exists(select 1 from jsonb_array_elements_text(spec->'reject_conditions') x
   where lower(btrim(x)) in (lower(btrim(spec->>'generalized_rule')),lower(btrim(spec->>'expected_behavior'))))
 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','self_conflicting_rule','message','Rule yêu cầu và đồng thời reject cùng một hành vi.','next_action','Làm rõ expected behavior và reject conditions.')); end if;
 begin
  perform public.uid_rule_catalog_plan(p_context);
 exception when others then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','compiler_plan_unavailable','message','Không thể biên dịch an toàn rule cùng canonical hiện tại: '||sqlerrm,'next_action','Làm rõ schema, phạm vi và phiên bản quality contract; không bỏ qua lỗi bằng xác nhận.'));
 end;
 rule_hash:='owner-rule-v1:'||public.uid_rule_digest(jsonb_build_object('validator','uid.owner-rule-eligibility.v1','candidate_hash',p_context->'candidate_hash','actor_user_id',p_actor_user_id,'owner_config',owner_config,'training_spec',spec,'canonical_text',candidate,'scope',p_context->'scope','targets',p_context->'targets','compiler_context',p_context->'compiler_context'));
 return jsonb_build_object('schema_version','uid.owner-rule-eligibility.v1','eligible',jsonb_array_length(blockers)=0,
  'owner_authorized',owner_ok,'rule_class',rule_class,'rule_hash',rule_hash,'blockers',blockers,
  'proposed_rule',jsonb_build_object('canonical_text',candidate,'training_spec',spec),
  'check_scope','STRUCTURE_SCOPE_AND_DETECTABLE_CONFLICTS_ONLY','visual_qc_performed',false,
  'semantic_consistency','NOT_PROVEN_BY_DETERMINISTIC_CHECKS');
end $$;
revoke all on function public.uid_rule_eligibility(jsonb,uuid) from public,anon,authenticated,service_role;

-- One stable statement snapshot binds what the owner sees to the rule token.
create function public.uid_rule_preflight(p_proposal_id uuid,p_actor_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare context jsonb;
begin
 if not exists(select 1 from public.creative_dna_team_members where user_id=p_actor_user_id and role='admin' and is_active)
 then raise exception 'Active admin required'; end if;
 context:=public.uid_rule_context(p_proposal_id);
 if context is not null then context:=jsonb_set(context,'{compiler_context,owner_user_id}',to_jsonb(p_actor_user_id)); end if;
 if context is null then return null; end if;
 return context||jsonb_build_object('direct_rule',public.uid_rule_eligibility(context,p_actor_user_id),'direct_rule_receipt',(select d.result from uid_rule_private.decisions d join uid_rule_private.owner_config cfg on cfg.singleton and cfg.enabled and cfg.owner_user_id=p_actor_user_id where d.proposal_id=p_proposal_id and d.owner_user_id=p_actor_user_id));
end $$;
revoke all on function public.uid_rule_preflight(uuid,uuid) from public,anon,authenticated;
grant execute on function public.uid_rule_preflight(uuid,uuid) to service_role;

-- The SQL boundary reconstructs the only permitted runtime delta. A service
-- caller cannot smuggle a different catalog, remove a protected rule/reference,
-- alter source metadata or relabel an unrelated source edit by refreshing hashes.
create function public.uid_rule_catalog_plan(p_context jsonb) returns jsonb
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
  if (bundle->>'schema_version' is null or bundle->>'schema_version' not in ('uid-creative-quality/1','uid-creative-quality/2')) or jsonb_typeof(bundle->'rules') is distinct from 'array' or jsonb_typeof(bundle->'references') is distinct from 'array'
   or jsonb_array_length(bundle->'rules') not between 1 and 80 or jsonb_array_length(bundle->'references')>48
   or (bundle ? 'owner_supplemental_rules' and jsonb_typeof(bundle->'owner_supplemental_rules') is distinct from 'array')
  then raise exception 'Supported bounded quality bundle required'; end if;
  if (bundle->>'schema_version'='uid-creative-quality/1' and bundle ? 'owner_supplemental_rules') or (bundle->>'schema_version'='uid-creative-quality/2' and (not bundle ? 'owner_supplemental_rules' or jsonb_array_length(bundle->'owner_supplemental_rules')=0)) then raise exception 'Quality bundle schema does not match its supplemental capability'; end if;
  if jsonb_array_length(coalesce(bundle->'owner_supplemental_rules','[]'))>=16 then raise exception 'Owner supplemental rule capacity reached'; end if;
  if (select count(*) from jsonb_array_elements(p_context#>'{compiler_context,brand_dna_nodes}') n where n->>'brand_id'=target->>'brand_id')<>1 then raise exception 'Exactly one current active brand DNA node required per target'; end if;
  select value into dna from jsonb_array_elements(p_context#>'{compiler_context,brand_dna_nodes}') n where n->>'brand_id'=target->>'brand_id';
  if bundle#>>'{source_hashes,branch}' is distinct from public.uid_rule_source_hash(target) or bundle#>>'{source_hashes,brand_dna}' is distinct from public.uid_rule_source_hash(dna) then raise exception 'Existing quality catalog is stale; refresh through its canonical review flow first'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(bundle->'owner_supplemental_rules','[]')) old where old->>'proposal_id'=proposal_id or old->>'id'='owner:'||proposal_id or old->>'canonical_text'=canonical_text) then raise exception 'An existing supplemental rule already contains this owner rule identity or text'; end if;
  select value into projected from jsonb_array_elements(p_context#>'{compiler_context,projected_targets}') n where n->>'id'=target->>'id';
  source_hashes:=jsonb_build_object('branch',public.uid_rule_source_hash(projected),'brand_dna',public.uid_rule_source_hash(dna));
  supplement:=jsonb_build_object('schema_version','uid.owner-supplemental-rule.v1','id','owner:'||proposal_id,'proposal_id',proposal_id,'decision_kind','owner_direct_rule',
   'canonical_text',canonical_text,'declared_scope',spec->'scope','scope',jsonb_build_object('brands',brands,'branches',jsonb_build_array(branch)),'rule_class',spec->'rule_class','confidence',spec->'confidence',
   'source',jsonb_build_object('node','branch','locator','owner-rule:'||proposal_id,'canonical_text_hash',encode(sha256(convert_to(canonical_text,'UTF8')),'hex')),
   'accepted_source_hashes',source_hashes,'precedence','SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH','semantic_consistency','NOT_PROVEN_BY_DETERMINISTIC_CHECKS','visual_qc_performed',false);
  new_bundle:=bundle||jsonb_build_object('schema_version','uid-creative-quality/2','revision','owner-rule:'||proposal_id,'source_hashes',source_hashes,'owner_supplemental_rules',coalesce(bundle->'owner_supplemental_rules','[]')||jsonb_build_array(supplement));
  if length(public.uid_rule_stable_json(new_bundle))>100000 then raise exception 'Quality bundle exceeds bounded compiler capacity'; end if;
  contracts:=jsonb_set(contracts,array[brand_slug],new_bundle);
 end loop;
 return base_catalog||jsonb_build_object('contracts',contracts);
end $$;
revoke all on function public.uid_rule_catalog_plan(jsonb) from public,anon,authenticated,service_role;

create function public.uid_rule_apply_plan(p_context jsonb,p_plan jsonb) returns void
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
 -- Onepage writes the verified master only; existing sync triggers fan out.
 -- Read back every approved target below, including all mirrored fields.
 for entry in select value from jsonb_array_elements(expected_targets)
  where p_context#>>'{scope,branch_slug}'<>'onepage-system' or value->>'node_id'=p_context#>>'{compiler_context,master_node_id}'
  order by value->>'node_id' loop
  update public.knowledge_nodes set content_md=entry->>'content_md',metadata=entry->'metadata',updated_at=now() where id=(entry->>'node_id')::uuid;
 end loop;
 for target in select value from jsonb_array_elements(p_context#>'{compiler_context,projected_targets}') loop
  select value into entry from jsonb_array_elements(expected_targets) where value->>'node_id'=target->>'id';
  select to_jsonb(n) into actual from public.knowledge_nodes n where id=(target->>'id')::uuid;
  expected:=target||jsonb_build_object('metadata',entry->'metadata');
  if actual-'updated_at' is distinct from expected-'updated_at' then raise exception 'Canonical node did not match exact approved projection after triggers'; end if;
 end loop;
end $$;
revoke all on function public.uid_rule_apply_plan(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.uid_rule_accept(p_proposal_id uuid,p_actor_user_id uuid,p_expected_candidate_hash text,p_expected_rule_hash text,p_plan jsonb default null,p_expected_plan_hash text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p public.knowledge_proposals%rowtype; prior uid_rule_private.decisions%rowtype; context jsonb; eligibility jsonb;
 before_world jsonb; after_world jsonb; after_targets jsonb; target_ids uuid[];
 result jsonb; decision_id uuid:=gen_random_uuid(); candidate text; old_action text:=current_setting('uid.rule_action',true);
begin
 -- Same lock ordering as governed merge/resolve. Configuration and active
 -- membership remain locked even for an exact idempotent retry.
 perform 1 from public.creative_dna_team_members where user_id=p_actor_user_id and role='admin' and is_active for share;
 if not found then raise exception 'Active verified owner Admin required'; end if;
 perform 1 from uid_rule_private.owner_config where singleton and enabled and owner_user_id=p_actor_user_id for share;
 if not found then raise exception 'Active verified owner Admin required'; end if;
 if p_expected_candidate_hash is null or p_expected_rule_hash is null or p_expected_plan_hash is null then raise exception 'Exact displayed candidate, rule and plan hashes are required'; end if;
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 select * into p from public.knowledge_proposals where id=p_proposal_id for update;
 if not found then raise exception 'Proposal not found'; end if;
 select * into prior from uid_rule_private.decisions where proposal_id=p.id;
 if found then
  if prior.owner_user_id is distinct from p_actor_user_id or prior.candidate_hash is distinct from p_expected_candidate_hash or prior.rule_hash is distinct from p_expected_rule_hash or prior.result->>'plan_hash' is distinct from p_expected_plan_hash
  then raise exception 'Conflicting retry of an immutable owner rule decision'; end if;
  return prior.result;
 end if;
 if p.status is distinct from 'pending' or p.merged_at is not null then raise exception 'Pending unmerged proposal required'; end if;
 if p_plan is null or p_expected_plan_hash is distinct from encode(sha256(convert_to(public.uid_rule_stable_json(p_plan),'UTF8')),'hex') then raise exception 'Exact server-computed compiler plan hash required'; end if;
 perform 1 from public.knowledge_nodes where id in(select id from public.uid_governance_target_nodes(p.id)) order by id for update;
 context:=public.uid_rule_context(p.id);
 if context is not null then context:=jsonb_set(context,'{compiler_context,owner_user_id}',to_jsonb(p_actor_user_id)); end if;
 if context is null or p_expected_candidate_hash is distinct from context->>'candidate_hash'
 then raise exception 'Proposal, scope, canonical nodes or baselines changed; refresh review'; end if;
 eligibility:=public.uid_rule_eligibility(context,p_actor_user_id);
 context:=context||jsonb_build_object('direct_rule',eligibility);
 if p_expected_rule_hash is distinct from eligibility->>'rule_hash' then raise exception 'Rule or owner configuration changed; refresh review'; end if;
 if eligibility->'eligible' is distinct from 'true' then raise exception 'Direct rule acceptance blocked: %',eligibility->'blockers'; end if;
 select array_agg((t->>'id')::uuid order by (t->>'id')::uuid) into target_ids from jsonb_array_elements(context->'targets') t;
 if coalesce(cardinality(target_ids),0)=0 then raise exception 'Affected canonical nodes unavailable'; end if;
 candidate:=btrim(p.proposed_content_md);
 -- Capture non-target rows to detect trigger side effects. Lock above prevents
 -- concurrent membership/row changes. Unexpected writes roll back atomically.
 select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') into before_world from public.knowledge_nodes n where not id=any(target_ids);
 insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 select p.id,id,'before',content_md,metadata,version,p_actor_user_id from public.knowledge_nodes where id=any(target_ids);
 result:=public.admin_accept_merge_creative_dna_proposal(p.id,p_actor_user_id,'Owner directly approved this exact creative rule and scope. Structural and detectable-conflict checks only; no visual QC performed.');
 select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') into after_world from public.knowledge_nodes n where not id=any(target_ids);
 if before_world is distinct from after_world then raise exception 'Merge trigger changed canonical nodes outside the approved scope'; end if;
 -- The legacy cursor can revisit a mirror after the master sync. Reconcile to
 -- the exact displayed, single-append projection through a master-only Onepage
 -- compiler write. The existing legacy merger remains the proposal/training-event
 -- boundary; all actual mirror rows are verified after its trigger fanout.
 -- No inferred field changes: the eligibility guard requires all non-content
 -- projection fields to equal the original records.
 perform public.uid_rule_apply_plan(context,p_plan);
 select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') into after_world from public.knowledge_nodes n where not id=any(target_ids);
 if before_world is distinct from after_world then raise exception 'Compiler trigger changed canonical nodes outside the approved scope'; end if;
 if not exists(select 1 from public.knowledge_proposals where id=p.id and status='merged' and reviewed_by=p_actor_user_id and merged_at is not null)
 then raise exception 'Legacy merge did not record the expected owner decision'; end if;
 insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 select p.id,id,'after',content_md,metadata,version,p_actor_user_id from public.knowledge_nodes where id=any(target_ids);
 select jsonb_agg(to_jsonb(n) order by id) into after_targets from public.knowledge_nodes n where id=any(target_ids);
 result:=result||jsonb_build_object('decision_kind','owner_direct_rule','rule_decision_id',decision_id,'candidate_hash',p_expected_candidate_hash,'rule_hash',p_expected_rule_hash,'plan_hash',p_expected_plan_hash,'visual_qc_performed',false,'check_scope','STRUCTURE_SCOPE_AND_DETECTABLE_CONFLICTS_ONLY');
 perform set_config('uid.rule_action','accept',true);
 insert into uid_rule_private.decisions(id,proposal_id,owner_user_id,candidate_hash,rule_hash,intent,before_context,after_targets,result)
 values(decision_id,p.id,p_actor_user_id,p_expected_candidate_hash,p_expected_rule_hash,
  jsonb_build_object('schema_version','uid.owner-rule-intent.v1','decision_kind','owner_direct_rule','owner_user_id',p_actor_user_id,'candidate_hash',p_expected_candidate_hash,'rule_hash',p_expected_rule_hash,'canonical_text',candidate,'scope',context->'scope','target_node_ids',to_jsonb(target_ids),'visual_qc_performed',false),
  context,after_targets,result);
 perform set_config('uid.rule_action',coalesce(old_action,''),true);
 return result;
end $$;
revoke all on function public.uid_rule_accept(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.uid_rule_accept(uuid,uuid,text,text,jsonb,text) to service_role;
-- Preserve the legacy merge RPC's owner-only boundary and all rollback behavior.
revoke all on function public.admin_accept_merge_creative_dna_proposal(uuid,uuid,text) from public,anon,authenticated,service_role;

-- Preserve all existing evidence validation, then block unsupported compiler
-- writes before snapshots/canonical mutation. Direct owner decisions use the
-- private legacy primitive only with the exact independently reconstructed plan.
create or replace function public.uid_governance_accept_merge(
 p_proposal_id uuid,p_actor_user_id uuid,p_evaluation_id uuid,p_review_note text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p public.knowledge_proposals%rowtype;
 e public.uid_governance_evaluations%rowtype;
 context jsonb;
 expected_ids uuid[];
 evaluated_ids uuid[];
 result jsonb;
begin
 perform 1 from public.creative_dna_team_members
 where user_id=p_actor_user_id and role='admin' and is_active=true for share;
 if not found then raise exception 'Active admin required'; end if;
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 select * into p from public.knowledge_proposals where id=p_proposal_id and status='pending' for update;
 if not found then raise exception 'Pending proposal not found'; end if;
 perform 1 from public.knowledge_nodes where id in
   (select id from public.uid_governance_target_nodes(p.id)) order by id for update;
 select * into e from public.uid_governance_evaluations where id=p_evaluation_id and proposal_id=p.id for update;
 if not found or e.evaluation_status<>'passed' or e.critical_failures<>0 or e.completed_at is null
   or e.evaluator_version<>'mechanical-v2-scope-freshness' or jsonb_typeof(e.test_results)<>'array'
   or jsonb_typeof(e.conflict_results)<>'array'
 then raise exception 'Fresh approved regression evaluation required'; end if;
 context:=public.uid_governance_review_context(p.id);
 if context is null or jsonb_array_length(context->'targets')=0 then raise exception 'Affected canonical nodes unavailable'; end if;
 if e.candidate_hash is distinct from context->>'candidate_hash'
 then raise exception 'Proposal, scope, canonical nodes or baselines changed after evaluation'; end if;
 select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into expected_ids
 from jsonb_array_elements_text(context->'eligible_baseline_ids');
 select coalesce(array_agg(x order by x),'{}'::uuid[]) into evaluated_ids from unnest(e.baseline_ids) x;
 if cardinality(expected_ids)=0 or expected_ids<>evaluated_ids
 then raise exception 'Evaluation baseline IDs must exactly match all applicable approved regression cases'; end if;
 if exists(select 1 from jsonb_array_elements(context->'targets') t where not exists(
   select 1 from public.uid_governance_applicable_baselines(p.id) b
   where b.approved_at is not null and not public.uid_governance_is_reference_only(b)
     and b.brand_id::text is not distinct from t->>'brand_id'))
 then raise exception 'A non-reference approved regression baseline is required for every affected brand'; end if;
 if jsonb_array_length(e.test_results)<>cardinality(expected_ids)
   or exists(select 1 from jsonb_array_elements(e.test_results) r
     where jsonb_typeof(r)<>'object' or r->>'status' is distinct from 'passed'
       or coalesce(length(btrim(r->>'source_run_id')),0)=0 or coalesce(r->>'artifact_url','')!~'^https://[^[:space:]]+$'
       or r->'issues' is distinct from '[]'::jsonb
       or jsonb_typeof(r->'candidate_output') is distinct from 'object' or r->'candidate_output'='{}'::jsonb
       or not exists(select 1 from public.uid_governance_applicable_baselines(p.id) b
         where b.id::text=r->>'baseline_id' and b.id=any(expected_ids) and b.case_key=r->>'case_key'))
   or exists(select 1 from unnest(expected_ids) id where
     (select count(*) from jsonb_array_elements(e.test_results) r where r->>'baseline_id'=id::text)<>1)
 then raise exception 'Exactly one complete passed result per approved baseline is required'; end if;
 if not exists(select 1 from jsonb_array_elements(e.conflict_results) a
   where a->'product_truth_verified'='true'::jsonb and a->'visual_reviewed'='true'::jsonb
     and a->'manually_reviewed'='true'::jsonb and a->'issues'='[]'::jsonb
     and length(btrim(coalesce(a->>'note','')))>=20
     and exists(select 1 from public.creative_dna_team_members m
       where m.user_id::text=a->>'actor_user_id' and m.role='admin'))
 then raise exception 'Stored administrator product-truth, visual and conflict review evidence required'; end if;
 -- Existing evaluation-backed clients must not bypass the compiler-aware plan.
 -- Onepage triggers, brand DNA and child dependencies exceed this legacy route.
 if exists(select 1 from public.knowledge_nodes n where n.id=p.knowledge_node_id and n.slug in ('onepage-system','brand-dna'))
   or exists(select 1 from public.uid_governance_target_nodes(p.id) n where n.metadata ? 'creative_quality_contract')
   or exists(select 1 from public.knowledge_nodes child where child.status='active' and child.parent_id in(select id from public.uid_governance_target_nodes(p.id)))
 then raise exception 'Compiler integration required: this evaluated merge route cannot safely update compiled, Onepage, brand-DNA or dependent canonical rules'; end if;
 insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 select p.id,id,'before',content_md,metadata,version,p_actor_user_id from public.uid_governance_target_nodes(p.id);
 result:=public.admin_accept_merge_creative_dna_proposal(p.id,p_actor_user_id,p_review_note);
 insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 select p.id,id,'after',content_md,metadata,version,p_actor_user_id from public.uid_governance_target_nodes(p.id);
 return result||jsonb_build_object('evaluation_id',e.id,'governance_passed',true);
end $$;
revoke all on function public.uid_governance_accept_merge(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.uid_governance_accept_merge(uuid,uuid,uuid,text) to service_role;
