-- Narrow future pair-grant conversion without modifying previously applied migrations.
SELECT pg_advisory_xact_lock(901002);
CREATE OR REPLACE FUNCTION organization_master.bundle_materialize_pair(p_actor text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 t jsonb;target_subject uuid;target_campus uuid;subject_scope text;campus_scope text;
 new_subject boolean;new_campus boolean;g record;permission text;policy_permission text;
BEGIN
 t:=organization_master.bundle_context(p_actor);
 IF t IS NULL OR t->>'phase' IS DISTINCT FROM 'PAIR' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 target_subject:=(t->'command'->'subject'->>'id')::uuid;
 target_campus:=(t->'command'->'campus'->>'id')::uuid;
 new_subject:=(t->>'newSubject')::boolean;new_campus:=(t->>'newCampus')::boolean;
 IF new_subject AND NOT EXISTS(SELECT 1 FROM organization_master.version v JOIN organization_master.input i ON i.id=v.input_id WHERE v.subject_id=target_subject AND v.number=1 AND i.job_id=(t->>'jobId')::uuid AND i.job_revision=(t->>'revisionId')::uuid) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF new_campus AND NOT EXISTS(SELECT 1 FROM organization_master.campus_event v JOIN organization_master.input i ON i.id=v.input_id WHERE v.campus_id=target_campus AND v.number=1 AND i.job_id=(t->>'jobId')::uuid AND i.job_revision=(t->>'revisionId')::uuid) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF NOT (new_subject OR new_campus) THEN RETURN;END IF;
 SELECT campus INTO subject_scope FROM organization_master.subject WHERE id=target_subject;
 SELECT scope INTO campus_scope FROM organization_master.campus WHERE id=target_campus;
 IF subject_scope IS NULL OR campus_scope IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 FOR g IN SELECT DISTINCT ON (details->>'grantee',details->>'permission') details
  FROM organization_master.bundle_control_event
  WHERE revision_id=(t->>'revisionId')::uuid AND kind='GRANT' AND details->>'resource'=t->>'resource'
  ORDER BY details->>'grantee',details->>'permission',sequence DESC LOOP
  IF NOT (g.details->>'allowed')::boolean THEN CONTINUE;END IF;
  policy_permission:=CASE g.details->>'permission' WHEN 'CREATE' THEN 'WRITE' WHEN 'REVISE' THEN 'WRITE' WHEN 'REVIEW' THEN 'REVIEW' ELSE 'READ' END;
  permission:=CASE g.details->>'permission' WHEN 'CREATE' THEN 'ESTABLISH' WHEN 'REVISE' THEN 'REVISE' WHEN 'REVIEW' THEN 'REVIEW' ELSE 'READ' END;
  -- Preauthorization only narrows rights; it cannot grant missing creation policy.
  -- Existing endpoints require their exact READ, not a wildcard creation policy.
  BEGIN
   PERFORM vnext_control.authorize(g.details->>'grantee','SYNTHETIC',policy_permission);
   PERFORM organization_master.authorize(g.details->>'grantee',CASE WHEN new_subject THEN NULL ELSE target_subject END,subject_scope,'READ');
   PERFORM organization_master.authorize(g.details->>'grantee',CASE WHEN new_campus THEN NULL ELSE target_campus END,campus_scope,'READ');
   IF new_subject THEN PERFORM organization_master.authorize(g.details->>'grantee',NULL,subject_scope,policy_permission);END IF;
   IF new_campus THEN PERFORM organization_master.authorize(g.details->>'grantee',NULL,campus_scope,policy_permission);END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;
   CONTINUE;
  END;
  INSERT INTO organization_master.operating_access VALUES(g.details->>'grantee',target_subject,target_campus,permission) ON CONFLICT DO NOTHING;
  IF permission='REVIEW' THEN
   -- REVIEW does not itself confer sensitive reads omitted by creation policy.
   BEGIN
    IF new_subject THEN PERFORM organization_master.authorize(g.details->>'grantee',NULL,subject_scope,'READ_RESTRICTED');END IF;
    IF new_campus THEN PERFORM organization_master.authorize(g.details->>'grantee',NULL,campus_scope,'READ_RESTRICTED');END IF;
   EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;
    CONTINUE;
   END;
   INSERT INTO organization_master.operating_access VALUES(g.details->>'grantee',target_subject,target_campus,'READ_RESTRICTED') ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION organization_master.bundle_materialize_pair(text) FROM PUBLIC,hdi_prototype;
