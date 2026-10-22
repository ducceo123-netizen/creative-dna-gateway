-- Correct false-positive replacement intent classification only.
-- Keep authentication, scope, compiler projection, hashes and all other checks unchanged.
create or replace function public.uid_rule_eligibility(p_context jsonb,p_actor_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 p jsonb:=p_context->'proposal'; spec jsonb; owner_config jsonb; actor_admin boolean; owner_ok boolean;
 blockers jsonb:='[]'; field text; candidate text; normative text; all_text text; rule_class text;
 target jsonb; prior_line text; clause text; normalized text; prior_normalized text; normalized_prior_lines text[];
 replacement_text text;
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
 -- Uncertainty about research/SKU evidence is not a canonical replacement.
 -- This bounded detector is not semantic proof. Remove only directly negated
 -- operation verbs, never a whole sentence or an arbitrary span of text.
 -- Keep punctuation and line boundaries so versioned or multiline targets remain detectable.
 replacement_text:=regexp_replace(lower(normative),'[[:space:]]+',' ','g');
  -- Double negation is not a promise to preserve existing canonical rules.
  if replacement_text !~ '(không (phải|thể) không|đừng không|không đừng|never (do |must |should )?not|not (to )?(not|never)|not (to )?(do|must|should) not)' then
   replacement_text:=regexp_replace(replacement_text,
    '\m(không( được| nên| cần)?|đừng|do not|must not|should not|never)[ ]+(ghi đè|override|supersede|replace|thay thế|bỏ)\M',
    ' [negated replacement] ','g');
  end if;
  if replacement_text ~ '(\m(supersed(e[sd]?|ing)|overrid(e[sd]?|den|ing))\M|\mreplac(e[sd]?|ing)\M.{0,40}\m(rules?|canonical)\M|\mbỏ\M.{0,20}\mrules?\M|\mghi đè\M|\mthay thế\M.{0,40}\m(rules?|quy tắc|canonical)\M)'
 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unclear_rule_conflict','message','Rule có yêu cầu thay thế canonical; luồng này chỉ hỗ trợ bổ sung rule.','next_action','Tách yêu cầu thay thế khỏi phần bổ sung; cần bản cập nhật chỉ rõ rule cũ, rule mới và phạm vi thay thế.')); end if;
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
  -- Canonical normalization is identical for every candidate clause. Cache it
  -- once per target, preserving original line order and duplicate clauses.
  select array_agg(regexp_replace(lower(btrim(regexp_replace(line,'^[#* -]+|[[:space:]]+$','','g'))),'[[:space:]]+',' ','g') order by ordinal)
   into normalized_prior_lines
   from regexp_split_to_table(coalesce(target->>'content_md',''),E'[\n.]') with ordinality as lines(line,ordinal);
  for clause in select regexp_split_to_table(coalesce(spec->>'generalized_rule','')||E'\n'||coalesce(spec->>'expected_behavior',''),E'[\n.]') loop
   normalized:=lower(btrim(regexp_replace(clause,'[[:space:]]+',' ','g')));
   if length(normalized)<12 then continue; end if;
   foreach prior_normalized in array coalesce(normalized_prior_lines,'{}'::text[]) loop
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
