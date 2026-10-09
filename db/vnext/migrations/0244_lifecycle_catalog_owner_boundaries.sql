SELECT pg_advisory_xact_lock(901002);
CREATE OR REPLACE FUNCTION care_organization.lifecycle_member_matches(p_actor text,p_owner text,p_candidate uuid,p_input uuid,p_revision uuid,p_identity text,p_digest text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;m care_organization.lifecycle_member;c jsonb;BEGIN
 t:=care_organization.lifecycle_context(p_actor);IF t IS NULL THEN RETURN false;END IF;
 IF t->>'owner' IS DISTINCT FROM p_owner OR t->>'inputId' IS DISTINCT FROM p_input::text OR t->>'candidateId' IS DISTINCT FROM p_candidate::text OR t->>'digest' IS DISTINCT FROM p_digest OR t->>'phase' NOT IN ('FREEZE','APPLY') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT * INTO m FROM care_organization.lifecycle_member WHERE candidate_id=p_candidate AND owner=p_owner AND member_id=p_input;
 c:=governance_catalog.apply_record(p_actor,'READ_CANDIDATE',jsonb_build_object('candidateId',p_candidate));
 IF m.member_id IS NULL OR m.revision IS DISTINCT FROM p_revision OR m.identity_code IS DISTINCT FROM p_identity OR c->>'digest' IS DISTINCT FROM p_digest OR c->'input'->>'jobId' IS DISTINCT FROM m.input_id::text THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF t->>'phase'='APPLY' THEN IF c->>'approvedBy' IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;PERFORM governance_catalog.apply_record(c->>'approvedBy','CHECK_APPROVAL',jsonb_build_object('candidateId',p_candidate));END IF;
 RETURN true;
END $$;
-- Care protects its commit frame; Catalog retains its own outcome/approval writer.
CREATE FUNCTION care_organization.lifecycle_commit_guard(p_actor text,p_input uuid,p_candidate uuid,p_facts jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;BEGIN
 IF NOT EXISTS(SELECT 1 FROM care_organization.lifecycle_input WHERE id=p_input) THEN RETURN;END IF;
 t:=care_organization.lifecycle_context(p_actor);
 IF t->>'operation' IS DISTINCT FROM 'COMMIT_CHECK' OR t->>'candidateId' IS DISTINCT FROM p_candidate::text OR t->'facts' IS DISTINCT FROM p_facts THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
END $$;
REVOKE ALL ON FUNCTION care_organization.lifecycle_commit_guard(text,uuid,uuid,jsonb) FROM PUBLIC,hdi_prototype;
DO $$DECLARE body text;needle text;BEGIN
 body:=replace(pg_get_functiondef('governance_catalog.apply_record(text,text,jsonb)'::regprocedure),E'\r','');
 needle:=$old$IF EXISTS(SELECT 1 FROM care_organization.lifecycle_input li WHERE li.id=(c.input->>'jobId')::uuid) THEN
  IF care_organization.lifecycle_context(p_actor)->>'operation' IS DISTINCT FROM 'COMMIT_CHECK' OR care_organization.lifecycle_context(p_actor)->>'candidateId' IS DISTINCT FROM c.id::text OR care_organization.lifecycle_context(p_actor)->'facts' IS DISTINCT FROM p_input->'facts' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 END IF;$old$;
 needle:=replace(needle,E'\r','');
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_CATALOG_COMMIT_PORT_BASELINE';END IF;
 EXECUTE replace(body,needle,$new$PERFORM care_organization.lifecycle_commit_guard(p_actor,(c.input->>'jobId')::uuid,c.id,p_input->'facts');$new$);
END $$;
