SELECT pg_advisory_xact_lock(901002);

-- A selected assertion authorizes only the complete version it returns.
-- Full-history authorization remains the responsibility of identifier_snapshot callers.
CREATE FUNCTION department_master.identifier_selected(p_actor text,p_id uuid,p_campus text,p_record timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m department_master.organization_identifier;v department_master.organization_identifier_version;BEGIN
 SELECT * INTO m FROM department_master.organization_identifier WHERE id=p_id;IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM department_master.identifier_authorize(p_actor,m.scheme,p_campus,'READ');
 PERFORM department_master.mapping_target_authorize(p_actor,m.target_type,m.target_id,p_campus);
 SELECT * INTO v FROM department_master.organization_identifier_version WHERE identifier_id=m.id AND (p_record IS NULL OR recorded_at<=p_record) ORDER BY number DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM department_master.mapping_source(p_actor,(v.facts->>'sourceSystemId')::uuid,v.valid_from,v.valid_to,false);
 RETURN to_jsonb(m)||jsonb_build_object('versions',jsonb_build_array((to_jsonb(v)-ARRAY['input_id','legacy_version_id'])||jsonb_build_object('number',v.number::text)));
END $$;

CREATE FUNCTION department_master.department_code_at_authorized(p_actor text,p_id uuid,p_business timestamp,p_record timestamp,p_campus text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d department_master.department;legacy department_master.version;baseline timestamp;selected jsonb;v jsonb;selected_id uuid;BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 SELECT * INTO d FROM department_master.department WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT min(v2.recorded_at) INTO baseline FROM department_master.organization_identifier m2 JOIN department_master.organization_identifier_version v2 ON v2.identifier_id=m2.id WHERE m2.target_type='ORG' AND m2.target_id=p_id AND m2.kind='HOSPITAL_CODE';
 IF p_record IS NOT NULL AND p_record<baseline THEN
  SELECT * INTO legacy FROM department_master.version WHERE department_id=p_id AND recorded_at<=p_record ORDER BY number LIMIT 1;
  RETURN jsonb_build_object('initialCode',d.code,'effectiveCode',CASE WHEN legacy.id IS NOT NULL AND tsrange(legacy.valid_from,legacy.valid_to,'[)')@>p_business THEN d.code ELSE NULL END,'codeVersion',NULL,'codeEvidence','ORG04_HISTORICAL');
 END IF;
 -- HOSPITAL/READ does not imply access to ORG23 derived facts, even when none
 -- is currently effective. Missing context or withdrawn authority is denial.
 PERFORM department_master.identifier_authorize(p_actor,'SYNTHETIC_DEPARTMENT_CODE',p_campus,'READ');
 PERFORM department_master.mapping_target_authorize(p_actor,'ORG',p_id,p_campus);
 SELECT x.id INTO selected_id FROM department_master.organization_identifier x CROSS JOIN LATERAL (SELECT * FROM department_master.organization_identifier_version WHERE identifier_id=x.id AND (p_record IS NULL OR recorded_at<=p_record) ORDER BY number DESC LIMIT 1) current WHERE x.target_type='ORG' AND x.target_id=p_id AND x.kind='HOSPITAL_CODE' AND current.action<>'RETRACT' AND tsrange(current.valid_from,current.valid_to,'[)')@>p_business;
 IF selected_id IS NOT NULL THEN selected:=department_master.identifier_selected(p_actor,selected_id,p_campus,p_record);v:=selected->'versions'->0;END IF;
 RETURN jsonb_build_object('initialCode',d.code,'effectiveCode',v->>'value','codeVersion',CASE WHEN v IS NULL THEN NULL ELSE jsonb_build_object('id',selected_id,'version',v->>'number','versionId',v->>'id') END,'codeEvidence','ORG23_ASSERTION');
END $$;

-- Close the old context-free entry point for roles that retained its grant.
CREATE OR REPLACE FUNCTION department_master.department_code_at(p_actor text,p_id uuid,p_business timestamp,p_record timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'ACCESS_DENIED';
END $$;
REVOKE ALL ON FUNCTION department_master.identifier_selected(text,uuid,text,timestamp),department_master.department_code_at_authorized(text,uuid,timestamp,timestamp,text) FROM PUBLIC,hdi_prototype;

-- Apply the same Catalog-owned interfaces used by Department since 0087.
-- Preserve all signed tickets, frozen identities, approval checks and facts.
DO $repair$
DECLARE body text;needle text;replacement text;BEGIN
 body:=pg_get_functiondef('department_master.identifier_mutate(text,text)'::regprocedure);
 FOR needle,replacement IN SELECT * FROM (VALUES
  ('j governance_catalog.import_job;','j jsonb;'),
  ('c governance_catalog.apply_candidate;a governance_catalog.apply_approval;','c jsonb;approved_by text;approved_identity text;'),
  ($before$PERFORM governance_catalog.import_job_read(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));SELECT * INTO j FROM governance_catalog.import_job WHERE id=(t->>'jobId')::uuid;
  IF j.submitter_identity IS DISTINCT FROM identity OR j.current_revision_id IS DISTINCT FROM (t->>'revisionId')::uuid OR j.contract_snapshot->>'dataset'<>'ORG23' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  INSERT INTO department_master.identifier_input(job_id,job_revision,maker,identity_code,request_id,digest,campus,schemes,envelope) VALUES(j.id,j.current_revision_id,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'campus',t->'schemes',t->'envelope') RETURNING * INTO r;$before$,
   $after$j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',t->>'jobId'));
  IF j->>'submitterIdentity' IS DISTINCT FROM identity OR j->>'currentRevisionId' IS DISTINCT FROM t->>'revisionId' OR j->'contract'->>'dataset'<>'ORG23' THEN RAISE EXCEPTION 'STALE_REVISION';END IF;
  INSERT INTO department_master.identifier_input(job_id,job_revision,maker,identity_code,request_id,digest,campus,schemes,envelope) VALUES((j->>'id')::uuid,(j->>'currentRevisionId')::uuid,actor,identity,(t->>'requestId')::uuid,t->>'digest',t->>'campus',t->'schemes',t->'envelope') RETURNING * INTO r;$after$),
  ($before$IF r.job_revision IS DISTINCT FROM (SELECT current_revision_id FROM governance_catalog.import_job WHERE id=r.job_id) THEN RAISE EXCEPTION 'STALE_REVISION';END IF;$before$,
   $after$j:=governance_catalog.import_job_context(actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 IF r.job_revision IS DISTINCT FROM (j->>'currentRevisionId')::uuid THEN RAISE EXCEPTION 'STALE_REVISION';END IF;$after$),
  ($before$SELECT * INTO c FROM governance_catalog.apply_candidate WHERE id=(t->>'candidateId')::uuid;SELECT * INTO a FROM governance_catalog.apply_approval WHERE candidate_id=c.id;
 IF c.digest IS DISTINCT FROM t->>'digest' OR c.input->>'jobId' IS DISTINCT FROM r.id::text OR c.input->>'revisionId' IS DISTINCT FROM r.revision::text OR a.candidate_id IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF c.maker_identity IS DISTINCT FROM r.identity_code OR a.identity_code=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 PERFORM governance_catalog.apply_record(a.actor_code,'CHECK_APPROVAL',jsonb_build_object('candidateId',c.id));PERFORM department_master.identifier_input_read(a.actor_code,r.id,'REVIEW');
 PERFORM department_master.mapping_target_authorize(actor,row->>'target_type',(row->>'target_id')::uuid,r.campus);PERFORM department_master.mapping_target_authorize(a.actor_code,row->>'target_type',(row->>'target_id')::uuid,r.campus);
 PERFORM vnext_control.require_source_access(actor,'SYNTHETIC',(row->>'source_system_id')::uuid);PERFORM vnext_control.require_source_access(a.actor_code,'SYNTHETIC',(row->>'source_system_id')::uuid);$before$,
   $after$c:=governance_catalog.apply_record(actor,'READ_CANDIDATE',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 IF c->>'digest' IS DISTINCT FROM t->>'digest' OR c->'input'->>'jobId' IS DISTINCT FROM r.id::text OR c->'input'->>'revisionId' IS DISTINCT FROM r.revision::text OR coalesce(c->>'approvedBy','')='' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 IF c->>'makerIdentity' IS DISTINCT FROM r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 approved_by:=c->>'approvedBy';PERFORM governance_catalog.apply_record(approved_by,'CHECK_APPROVAL',jsonb_build_object('candidateId',(t->>'candidateId')::uuid));
 approved_identity:=vnext_control.authorize(approved_by,'SYNTHETIC','REVIEW');IF approved_identity=r.identity_code THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;
 PERFORM department_master.identifier_input_read(approved_by,r.id,'REVIEW');
 PERFORM department_master.mapping_target_authorize(actor,row->>'target_type',(row->>'target_id')::uuid,r.campus);PERFORM department_master.mapping_target_authorize(approved_by,row->>'target_type',(row->>'target_id')::uuid,r.campus);
 PERFORM vnext_control.require_source_access(actor,'SYNTHETIC',(row->>'source_system_id')::uuid);PERFORM vnext_control.require_source_access(approved_by,'SYNTHETIC',(row->>'source_system_id')::uuid);$after$)
 ) changes(needle,replacement) LOOP
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'IDENTIFIER_CATALOG_INTERFACE_BASELINE_MISMATCH';END IF;
  body:=replace(body,needle,replacement);
 END LOOP;
 IF body~'governance_catalog\.(import_job|apply_candidate|apply_approval)([^a-z_]|$)' THEN RAISE EXCEPTION 'IDENTIFIER_CATALOG_INTERFACE_BASELINE_MISMATCH';END IF;
 EXECUTE body;
END $repair$;


