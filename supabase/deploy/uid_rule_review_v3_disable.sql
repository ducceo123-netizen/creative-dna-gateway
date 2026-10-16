-- Operational rollback: no data removal, no catalog downgrade, no history deletion.
-- First set Edge UID_RULE_REVIEW_V3_ENABLED=false and stop v3 claiming only.
-- Keep compatible v4 readers and the v2 host intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
UPDATE uid_rule_v3_private.release SET enabled=false WHERE singleton AND enabled;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_preview(uuid,uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_handoff(uuid,uuid,text,uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_claim(uuid,text) FROM service_role;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_revalidate(uuid,uuid,uuid,integer) FROM service_role;
REVOKE ALL ON FUNCTION public.uid_rule_review_v3_complete(uuid,uuid,text,uuid,integer,text,jsonb) FROM service_role;
COMMIT;
-- Preserve get/cancel for truthful state and explicit owner cancellation.
-- A full incident lockdown may also revoke those two after separate approval.
-- In-flight completion serializes with release update; inspect committed audit after rollback.
-- Do not report rollback retroactively undid a merge that committed first.
