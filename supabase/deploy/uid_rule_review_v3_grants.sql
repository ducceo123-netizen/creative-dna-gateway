-- Separate security-sensitive change. Execute ONLY after specific action-time approval.
-- Existing service_role is verified server boundary; never send its key to clients.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_preview(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.uid_rule_review_v3_preview(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_handoff(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.uid_rule_review_v3_handoff(uuid,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_get(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.uid_rule_review_v3_get(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_cancel(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.uid_rule_review_v3_cancel(uuid,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_claim(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.uid_rule_review_v3_claim(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_revalidate(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.uid_rule_review_v3_revalidate(uuid,uuid,uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_complete(uuid,uuid,text,uuid,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.uid_rule_review_v3_complete(uuid,uuid,text,uuid,integer,text,jsonb) TO service_role;
COMMIT;
