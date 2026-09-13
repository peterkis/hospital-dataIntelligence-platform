SELECT pg_advisory_xact_lock(901002);
-- Once protected bytes exist, public job revisions may reuse their existing declarations
-- but must not introduce another unkeyed content digest. The store checks all earlier
-- declarations in the same transaction/lock, so neither ordering can expose its bytes' SHA.
CREATE FUNCTION governance_catalog.guard_protected_revision_digest() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF EXISTS(SELECT 1 FROM governance_catalog.protected_artifact a WHERE a.job_id=NEW.job_id)
    AND NOT EXISTS(SELECT 1 FROM governance_catalog.import_input_revision r WHERE r.job_id=NEW.job_id AND r.metadata->>'declaredSha256'=NEW.metadata->>'declaredSha256')
 THEN RAISE EXCEPTION 'PUBLIC_DIGEST_AFTER_PROTECTION_FORBIDDEN'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protected_revision_digest_guard BEFORE INSERT ON governance_catalog.import_input_revision
 FOR EACH ROW EXECUTE FUNCTION governance_catalog.guard_protected_revision_digest();
REVOKE ALL ON FUNCTION governance_catalog.guard_protected_revision_digest() FROM PUBLIC,hdi_prototype;
