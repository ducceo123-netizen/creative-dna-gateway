-- Read-only verification after disabled install/grant, never claims or enqueues.
SELECT p.oid::regprocedure::text AS signature,p.prosecdef,p.proconfig,p.proacl,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS server_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'uid_rule_review_v3_%';
SELECT has_schema_privilege('service_role','uid_rule_v3_private','USAGE') AS server_private_schema_usage;
SELECT c.relname,c.relrowsecurity,c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='uid_rule_v3_private' AND c.relkind='r';
SELECT enabled,revision,compiler_version,compiler_bundle_hash,approved_release_reference FROM uid_rule_v3_private.release;
