-- Apply explicitly ONLY to a newly authorized isolated V2 database. Never production.
-- The migration administrator owns the schema/functions. Runtime uses only the
-- dedicated login role below (provision its LOGIN/password separately).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f'))
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='uid_task_private') THEN
    RAISE EXCEPTION 'V2 requires a separate new database with no existing public application tables';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS uid_brands_v2;
REVOKE ALL ON SCHEMA uid_brands_v2 FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uid_brands_v2_app') THEN
    CREATE ROLE uid_brands_v2_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uid_brands_v2_app' AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
    RAISE EXCEPTION 'Existing V2 app role is privileged';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='uid_brands_v2_app') THEN
    RAISE EXCEPTION 'V2 app role must not inherit other database roles';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS uid_brands_v2.store_usage(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), bytes bigint NOT NULL CHECK(bytes >= 0));
INSERT INTO uid_brands_v2.store_usage VALUES(true,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS uid_brands_v2.jobs(id text PRIMARY KEY, owner text NOT NULL, idem text NOT NULL, input_hash text NOT NULL, revision integer NOT NULL CHECK(revision>=0), expires bigint NOT NULL, document text NOT NULL, UNIQUE(owner,idem));
CREATE INDEX IF NOT EXISTS jobs_expiry ON uid_brands_v2.jobs(expires);
CREATE TABLE IF NOT EXISTS uid_brands_v2.history(job text NOT NULL REFERENCES uid_brands_v2.jobs(id) ON DELETE CASCADE, revision integer NOT NULL, document text NOT NULL, PRIMARY KEY(job,revision));
CREATE TABLE IF NOT EXISTS uid_brands_v2.receipts(job text NOT NULL REFERENCES uid_brands_v2.jobs(id) ON DELETE CASCADE, operation text NOT NULL, request_hash text NOT NULL, document text NOT NULL, PRIMARY KEY(job,operation));
CREATE TABLE IF NOT EXISTS uid_brands_v2.artifacts(job text NOT NULL REFERENCES uid_brands_v2.jobs(id) ON DELETE CASCADE, hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'), mime text NOT NULL, bytes bytea NOT NULL, PRIMARY KEY(job,hash));
CREATE TABLE IF NOT EXISTS uid_brands_v2.leases(job text PRIMARY KEY REFERENCES uid_brands_v2.jobs(id) ON DELETE CASCADE, holder text NOT NULL, expires bigint NOT NULL, fence integer NOT NULL CHECK(fence>0));
CREATE TABLE IF NOT EXISTS uid_brands_v2.telemetry(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job text NOT NULL REFERENCES uid_brands_v2.jobs(id) ON DELETE CASCADE, event text NOT NULL, created bigint NOT NULL);
ALTER TABLE uid_brands_v2.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE uid_brands_v2.jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_owner ON uid_brands_v2.jobs;
CREATE POLICY job_owner ON uid_brands_v2.jobs TO uid_brands_v2_app USING(owner=current_setting('uid_brands_v2.owner',true) AND expires>floor(extract(epoch FROM clock_timestamp())*1000)) WITH CHECK(owner=current_setting('uid_brands_v2.owner',true) AND expires>floor(extract(epoch FROM clock_timestamp())*1000));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['history','receipts','artifacts','leases','telemetry'] LOOP
    EXECUTE format('ALTER TABLE uid_brands_v2.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE uid_brands_v2.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS job_owner ON uid_brands_v2.%I',t);
    EXECUTE format('CREATE POLICY job_owner ON uid_brands_v2.%I TO uid_brands_v2_app USING (EXISTS (SELECT 1 FROM uid_brands_v2.jobs j WHERE j.id=job)) WITH CHECK (EXISTS (SELECT 1 FROM uid_brands_v2.jobs j WHERE j.id=job))',t);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA uid_brands_v2 FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA uid_brands_v2 FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA uid_brands_v2 FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA uid_brands_v2 FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA uid_brands_v2 FROM %I',r);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA uid_brands_v2 TO uid_brands_v2_app;
REVOKE ALL ON ALL TABLES IN SCHEMA uid_brands_v2 FROM uid_brands_v2_app;
GRANT SELECT,INSERT,UPDATE ON uid_brands_v2.jobs,uid_brands_v2.leases TO uid_brands_v2_app;
GRANT SELECT,INSERT ON uid_brands_v2.history,uid_brands_v2.receipts,uid_brands_v2.artifacts,uid_brands_v2.telemetry TO uid_brands_v2_app;
GRANT SELECT,UPDATE ON uid_brands_v2.store_usage TO uid_brands_v2_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA uid_brands_v2 TO uid_brands_v2_app;
-- The only cross-owner operation has no caller-controlled cutoff or SQL.
-- row_security=off fails closed if the migration owner cannot perform cleanup.
CREATE OR REPLACE FUNCTION uid_brands_v2.prune_expired() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,uid_brands_v2 SET row_security=off AS $$
DECLARE cutoff bigint := floor(extract(epoch FROM clock_timestamp())*1000); removed integer; freed bigint;
BEGIN
  PERFORM 1 FROM uid_brands_v2.store_usage WHERE singleton FOR UPDATE;
  SELECT coalesce(sum(octet_length(j.document)),0)
    +coalesce((SELECT sum(octet_length(h.document)) FROM uid_brands_v2.history h JOIN uid_brands_v2.jobs j ON j.id=h.job WHERE j.expires<=cutoff),0)
    +coalesce((SELECT sum(octet_length(r.document)) FROM uid_brands_v2.receipts r JOIN uid_brands_v2.jobs j ON j.id=r.job WHERE j.expires<=cutoff),0)
    +coalesce((SELECT sum(octet_length(a.bytes)) FROM uid_brands_v2.artifacts a JOIN uid_brands_v2.jobs j ON j.id=a.job WHERE j.expires<=cutoff),0)
    +coalesce((SELECT sum(octet_length(t.event)) FROM uid_brands_v2.telemetry t JOIN uid_brands_v2.jobs j ON j.id=t.job WHERE j.expires<=cutoff),0)
    INTO freed FROM uid_brands_v2.jobs j WHERE j.expires<=cutoff;
  DELETE FROM uid_brands_v2.jobs WHERE expires<=cutoff;
  GET DIAGNOSTICS removed = ROW_COUNT;
  UPDATE uid_brands_v2.store_usage SET bytes=bytes-freed WHERE singleton;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION uid_brands_v2.prune_expired() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION uid_brands_v2.prune_expired() FROM %I',r);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION uid_brands_v2.prune_expired() TO uid_brands_v2_app;
