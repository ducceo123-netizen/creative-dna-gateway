-- Run after the foundation inside the same disposable transaction.
-- These are storage invariants, NOT end-to-end claim/completion race coverage.
do $$
declare before_epoch bigint; after_epoch bigint; qid uuid:='a3000000-0000-4000-8000-000000000001';
 pid uuid:='a3000000-0000-4000-8000-000000000002'; nid uuid:='a3000000-0000-4000-8000-000000000003';
 actor uuid:='a3000000-0000-4000-8000-000000000004'; ok boolean;
begin
 if exists(select 1 from uid_rule_v3_private.release)
 then raise exception 'Prototype unexpectedly seeds capability'; end if;
 if has_schema_privilege('service_role','uid_rule_v3_private','USAGE') or
    has_table_privilege('service_role','uid_rule_v3_private.requests','INSERT')
 then raise exception 'Prototype unexpectedly grants persistent access'; end if;
 select revision into before_epoch from uid_rule_v3_private.authorization_epoch where singleton;
 insert into uid_rule_v3_private.release values(true,false,1,'2026-10-15-agent-rule-general-v1','[]',repeat('a',64),'DISPOSABLE TEST ONLY');
 update uid_rule_v3_private.release set enabled=true;
 update uid_rule_v3_private.release set enabled=false;
 select revision into after_epoch from uid_rule_v3_private.authorization_epoch where singleton;
 if after_epoch<>before_epoch+3 then raise exception 'Release revoke/re-enable not epoch fenced'; end if;
 insert into public.knowledge_nodes(id,slug,title) values(nid,'test-rule-v3','Disposable rule target');
 insert into public.knowledge_proposals(id,knowledge_node_id) values(pid,nid);
 ok:=false;
 begin
  insert into uid_rule_v3_private.requests(id,proposal_id,owner_user_id,operation,idempotency_key,intent_hash,intent,
    authorization_revision,release_revision,created_at,expires_at)
  values(qid,pid,actor,'creative_rule_supplement.v1',qid,'test-only','{}',1,1,now(),now()+interval '24 hours');
 exception when others then ok:=true; end;
 if not ok then raise exception 'Unguarded request inserted'; end if;
 perform set_config('uid.rule_v3_action','handoff',true);
 insert into uid_rule_v3_private.requests(id,proposal_id,owner_user_id,operation,idempotency_key,intent_hash,intent,
    authorization_revision,release_revision,created_at,expires_at)
 values(qid,pid,actor,'creative_rule_supplement.v1',qid,'test-only','{}',1,1,now(),now()+interval '24 hours');
 ok:=false;
 begin update uid_rule_v3_private.requests set expires_at=expires_at+interval '1 hour' where id=qid;
 exception when others then ok:=true; end;
 if not ok then raise exception 'Expiry mutation accepted'; end if;
 perform set_config('uid.rule_v3_action','claim',true);
 ok:=false;
 begin update uid_rule_v3_private.requests set status='leased',claimant='dot',lease_token=gen_random_uuid(),
   lease_version=1,leased_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '901 seconds' where id=qid;
 exception when others then ok:=true; end;
 if not ok then raise exception 'Oversized lease accepted'; end if;
 update uid_rule_v3_private.requests set status='leased',claimant='dot',lease_token=gen_random_uuid(),
   lease_version=1,leased_at=now(),lease_expires_at=now()+interval '900 seconds' where id=qid;
 ok:=false;
 begin update uid_rule_v3_private.requests set lease_expires_at=now()+interval '899 seconds' where id=qid;
 exception when others then ok:=true; end;
 if not ok then raise exception 'Same-version lease update accepted'; end if;
 perform set_config('uid.rule_v3_action','cancel',true);
 update uid_rule_v3_private.requests set status='cancelled' where id=qid;
 perform set_config('uid.rule_v3_action','claim',true);
 ok:=false;
 begin update uid_rule_v3_private.requests set status='leased',lease_version=2,lease_token=gen_random_uuid() where id=qid;
 exception when others then ok:=true; end;
 if not ok then raise exception 'Cancelled request revived'; end if;
 ok:=false;
 begin delete from uid_rule_v3_private.events where request_id=qid;
 exception when others then ok:=true; end;
 if not ok then raise exception 'Audit events deleted'; end if;
 if (select count(*) from uid_rule_v3_private.events where request_id=qid)<>3 then raise exception 'Transition history incomplete'; end if;
end $$;
