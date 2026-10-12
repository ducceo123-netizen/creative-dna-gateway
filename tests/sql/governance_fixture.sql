-- Disposable LOCAL database fixture only. Never run on a deployed project.
-- The repository's historical migrations depend on these pre-existing tables.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.brands(id uuid primary key default gen_random_uuid(),slug text not null,name text not null,
 description text,current_version text not null default '0.1',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.creative_dna_team_members(id uuid primary key default gen_random_uuid(),user_id uuid not null,
 display_name text,role text not null default 'contributor',is_active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.knowledge_nodes(id uuid primary key default gen_random_uuid(),brand_id uuid references public.brands(id),
 node_type text not null default 'branch',slug text not null,title text not null,parent_id uuid,
 version text not null default '0.1',status text not null default 'active',confidence text not null default 'common',
 content_md text not null default '',metadata jsonb not null default '{}',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),input_schema jsonb not null default '{}');
create table public.knowledge_proposals(id uuid primary key default gen_random_uuid(),
 knowledge_node_id uuid not null references public.knowledge_nodes(id) on delete cascade,
 proposed_version text,proposed_content_md text,change_summary text,evidence_summary jsonb not null default '{}',
 status text not null default 'pending' constraint knowledge_proposals_status_check check(status in ('pending','accepted','rejected','merged')),
 created_at timestamptz not null default now(),reviewed_at timestamptz,brand_id uuid references public.brands(id),
 submitted_by uuid,submitted_by_name text,raw_feedback text,proposed_scope text,reviewed_by uuid,review_note text,
 merged_at timestamptz,updated_at timestamptz not null default now(),context_images jsonb not null default '[]');
create table public.training_events(id uuid primary key default gen_random_uuid(),brand_id uuid,
 knowledge_node_id uuid,mode text,input_text text,parsed_payload jsonb,status text,actor_user_id uuid,actor_role text,source_action text);
-- Runtime-equivalent legacy merge fixture (pre-existing live function, read-only
-- inspected 2026-10-12). This deliberately retains its structural target behavior.
create function public.admin_accept_merge_creative_dna_proposal(p_proposal_id uuid,p_actor_user_id uuid,p_review_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.knowledge_proposals%rowtype; source_node public.knowledge_nodes%rowtype;
 target_node public.knowledge_nodes%rowtype; feedback_text text; structural_onepage boolean; merged_count integer:=0;
begin
 select * into p from public.knowledge_proposals where id=p_proposal_id and status='pending' for update;
 if not found then raise exception 'Pending proposal not found'; end if;
 select * into source_node from public.knowledge_nodes where id=p.knowledge_node_id;
 if not found then raise exception 'Knowledge node not found'; end if;
 feedback_text:=btrim(coalesce(p.proposed_content_md,p.raw_feedback,''));
 if feedback_text='' then raise exception 'Proposal has no mergeable feedback'; end if;
 structural_onepage:=source_node.slug='onepage-system' and coalesce(p.proposed_scope,'')!~*'brand[ _-]?style|vibe|mood';
 for target_node in select * from public.knowledge_nodes where
   (structural_onepage and slug='onepage-system' and status='active') or (not structural_onepage and id=source_node.id) for update
 loop
   if position(feedback_text in target_node.content_md)=0 then
     update public.knowledge_nodes set content_md=content_md||E'\n\n## ACCEPTED ADMIN FEEDBACK\n'||feedback_text,updated_at=now() where id=target_node.id;
   end if;
   insert into public.training_events(brand_id,knowledge_node_id,mode,input_text,parsed_payload,status,actor_user_id,actor_role,source_action)
   values(coalesce(target_node.brand_id,p.brand_id),target_node.id,'train',feedback_text,
     jsonb_build_object('proposal_id',p.id,'proposed_scope',p.proposed_scope,'cross_brand_sync',structural_onepage,'context_images',p.context_images),
     'accepted',p_actor_user_id,'admin','admin_accept_auto_merge');
   merged_count:=merged_count+1;
 end loop;
 update public.knowledge_proposals set status='merged',reviewed_at=now(),reviewed_by=p_actor_user_id,
   review_note=p_review_note,merged_at=now(),updated_at=now() where id=p.id;
 return jsonb_build_object('proposal_id',p.id,'status','merged','merged_at',now(),'merged_nodes',merged_count,'cross_brand_sync',structural_onepage);
end $$;
