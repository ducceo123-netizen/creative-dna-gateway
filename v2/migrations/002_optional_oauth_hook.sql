-- OPTIONAL, never part of server startup or the store migration.
-- The guarded installer sets this transaction-local target only after checking
-- the exact new-project connection, existing real users and registered clients.
DO $$ BEGIN
  IF current_setting('uid_brands_v2.oauth_project_ref',true) IS DISTINCT FROM 'muyyitsvkkjzjojetynr'
     OR current_user <> 'postgres'
     OR to_regclass('uid_brands_v2.jobs') IS NULL
     OR to_regclass('auth.users') IS NULL OR to_regclass('auth.oauth_clients') IS NULL
     OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='uid_task_private')
     OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f'))
     OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN
    RAISE EXCEPTION 'Optional OAuth setup requires the authorized isolated V2 project';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS uid_brands_v2_oauth;
REVOKE ALL ON SCHEMA uid_brands_v2_oauth FROM PUBLIC;
CREATE TABLE IF NOT EXISTS uid_brands_v2_oauth.policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  project_ref text NOT NULL CHECK(project_ref='muyyitsvkkjzjojetynr'),
  resource_url text NOT NULL CHECK(resource_url='https://uid-brands-architecture-v2-test.onrender.com/api/mcp'),
  required_scopes text[] NOT NULL CHECK(cardinality(required_scopes)>0 AND required_scopes @> ARRAY['openid']::text[] AND required_scopes <@ ARRAY['openid','email','profile','phone','offline_access']::text[]),
  input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE IF NOT EXISTS uid_brands_v2_oauth.approved_clients (
  client_id uuid PRIMARY KEY,
  redirect_uris text[] NOT NULL CHECK(cardinality(redirect_uris)>0)
);
CREATE TABLE IF NOT EXISTS uid_brands_v2_oauth.approved_subjects (subject uuid PRIMARY KEY);

CREATE OR REPLACE FUNCTION uid_brands_v2_oauth.custom_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,uid_brands_v2_oauth AS $$
DECLARE claims jsonb; client text; target text; required text[]; granted text[]; token_subject text;
BEGIN
  IF jsonb_typeof(event) IS DISTINCT FROM 'object' OR jsonb_typeof(event->'claims') IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('error',jsonb_build_object('http_code',400,'message','Invalid V2 token event'));
  END IF;
  claims := event->'claims';
  client := claims->>'client_id';
  -- Ordinary login is deliberately unchanged; the consent UI verifies its
  -- authenticated audience separately. OAuth refresh retains client_id.
  IF client IS NULL OR client='' THEN
    IF coalesce(event->>'authentication_method','') LIKE 'oauth_provider/%' THEN
      RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,'message','V2 OAuth client is required'));
    END IF;
    RETURN event;
  END IF;
  SELECT resource_url,required_scopes INTO target,required FROM uid_brands_v2_oauth.policy WHERE singleton;
  token_subject := claims->>'sub';
  IF target IS NULL OR client !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR token_subject IS NULL OR token_subject !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR event->>'user_id' IS DISTINCT FROM token_subject
     OR claims->>'iss' IS DISTINCT FROM 'https://muyyitsvkkjzjojetynr.supabase.co/auth/v1'
     OR (claims->'aud' IS DISTINCT FROM '"authenticated"'::jsonb AND claims->'aud' IS DISTINCT FROM '["authenticated"]'::jsonb)
     OR jsonb_typeof(claims->'scope') IS DISTINCT FROM 'string' THEN
    RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,'message','V2 OAuth policy denied'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM uid_brands_v2_oauth.approved_clients WHERE client_id=client::uuid)
     OR NOT EXISTS(SELECT 1 FROM uid_brands_v2_oauth.approved_subjects WHERE subject=token_subject::uuid) THEN
    RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,'message','V2 OAuth policy denied'));
  END IF;
  granted := regexp_split_to_array(trim(claims->>'scope'),'\s+');
  IF NOT granted @> required THEN
    RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,'message','V2 OAuth scope is required'));
  END IF;
  -- The supported hook input has no raw resource field. This pins one approved
  -- OAuth client to one resource; upstream checks authorize/token matching.
  RETURN jsonb_set(event,'{claims}',jsonb_set(claims,'{aud}',to_jsonb(target)));
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA uid_brands_v2_oauth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA uid_brands_v2_oauth FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','uid_brands_v2_app'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA uid_brands_v2_oauth FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA uid_brands_v2_oauth FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA uid_brands_v2_oauth FROM %I',r);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA uid_brands_v2_oauth TO supabase_auth_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA uid_brands_v2_oauth TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION uid_brands_v2_oauth.custom_access_token_hook(jsonb) TO supabase_auth_admin;
