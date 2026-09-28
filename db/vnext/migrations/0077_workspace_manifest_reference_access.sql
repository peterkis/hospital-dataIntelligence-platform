-- Exact workbook row references are authorization boundaries, not display-only metadata.
-- Forward-only: preserve prior migrations, envelopes, function OIDs, owners and ACLs.
SELECT pg_advisory_xact_lock(901002);
DO $repair_authorize$
DECLARE
 body text;
 needle text := $needle$  IF p_permission='WRITE' THEN PERFORM organization_master.bundle_dimension_access(p_actor,m->'bindings',dimensions,'STORE');END IF;
 END IF;$needle$;
 replacement text := $replacement$  IF p_permission='WRITE' THEN PERFORM organization_master.bundle_dimension_access(p_actor,m->'bindings',dimensions,'STORE');END IF;
  -- V4 metadata authenticates the exact references extracted from the encrypted
  -- manifest. Older protected bundle metadata is ambiguous and must fail closed.
  IF NOT (m ? 'manifestReferences') THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  IF jsonb_typeof(m->'manifestReferences') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'manifestReferences')>1000 THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  DECLARE
   ref jsonb;target_ref jsonb;subject_ref jsonb;campus_ref jsonb;
   ref_id uuid;pair_subject uuid;pair_campus uuid;object_subject uuid;object_campus uuid;
   ref_scope text;actual_scope text;ref_owner text;actual_kind text;effective_permission text;
  BEGIN
   FOR ref IN SELECT value FROM jsonb_array_elements(m->'manifestReferences') LOOP
    IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR NOT (ref ?& ARRAY['row','dataset','scope','intent','target','subject','campus']) OR ref-ARRAY['row','dataset','scope','intent','target','subject','campus']<>'{}'::jsonb OR jsonb_typeof(ref->'dataset') IS DISTINCT FROM 'string' OR ref->>'dataset' NOT IN ('ORG01','ORG02','ORG03') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
    IF ref->'row'<>'null'::jsonb AND (jsonb_typeof(ref->'row') IS DISTINCT FROM 'number' OR (ref->>'row')::integer NOT BETWEEN 2 AND 1001) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
    IF ref->'scope'<>'null'::jsonb AND ref->>'scope' NOT IN ('NORTH','SOUTH') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
    IF ref->'intent'<>'null'::jsonb AND ref->>'intent' NOT IN ('CREATE','REVISE') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
    ref_scope:=ref->>'scope';target_ref:=ref->'target';subject_ref:=ref->'subject';campus_ref:=ref->'campus';
    object_subject:=NULL;object_campus:=NULL;actual_scope:=NULL;actual_kind:=NULL;
    IF target_ref<>'null'::jsonb THEN
     IF jsonb_typeof(target_ref) IS DISTINCT FROM 'object' OR NOT (target_ref ?& ARRAY['owner','id','version']) OR target_ref-ARRAY['owner','id','version']<>'{}'::jsonb OR jsonb_typeof(target_ref->'id') IS DISTINCT FROM 'string' OR (target_ref->'version'<>'null'::jsonb AND (jsonb_typeof(target_ref->'version') IS DISTINCT FROM 'string' OR target_ref->>'version'!~'^[1-9][0-9]*$')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
     ref_id:=(target_ref->>'id')::uuid;ref_owner:=target_ref->>'owner';
     IF ref->>'dataset'='ORG01' THEN
      IF ref_owner<>'organization-master' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
      SELECT s.campus INTO actual_scope FROM organization_master.subject s WHERE s.id=ref_id;
      IF actual_scope IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
      IF ref_scope IS NOT NULL AND ref_scope<>actual_scope THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
      PERFORM organization_master.authorize(p_actor,ref_id,actual_scope,p_permission);
     ELSIF ref->>'dataset'='ORG02' THEN
      IF ref_owner<>'organization-master/campus' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
      SELECT c.scope INTO actual_scope FROM organization_master.campus c WHERE c.id=ref_id;
      IF actual_scope IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
      IF ref_scope IS NOT NULL AND ref_scope<>actual_scope THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
      PERFORM organization_master.authorize(p_actor,ref_id,actual_scope,p_permission);
     ELSE
      IF ref_owner<>'organization-master/operating-relation' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
      SELECT o.subject_id,o.campus_id,o.scope,o.kind INTO object_subject,object_campus,actual_scope,actual_kind FROM organization_master.operating_object o WHERE o.id=ref_id;
      IF object_subject IS NULL OR actual_kind<>'RELATION' THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
      IF ref_scope IS NOT NULL AND ref_scope<>actual_scope THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
      PERFORM organization_master.operating_authorize(p_actor,object_subject,object_campus,CASE WHEN p_permission='WRITE' THEN 'REVISE' ELSE p_permission END);
     END IF;
    END IF;
    pair_subject:=NULL;pair_campus:=NULL;
    IF subject_ref<>'null'::jsonb THEN
     IF ref->>'dataset'<>'ORG03' OR jsonb_typeof(subject_ref) IS DISTINCT FROM 'object' OR NOT (subject_ref ?& ARRAY['id','version']) OR subject_ref-ARRAY['id','version']<>'{}'::jsonb OR jsonb_typeof(subject_ref->'id') IS DISTINCT FROM 'string' OR (subject_ref->'version'<>'null'::jsonb AND (jsonb_typeof(subject_ref->'version') IS DISTINCT FROM 'string' OR subject_ref->>'version'!~'^[1-9][0-9]*$')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
     pair_subject:=(subject_ref->>'id')::uuid;SELECT s.campus INTO actual_scope FROM organization_master.subject s WHERE s.id=pair_subject;
     IF actual_scope IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
     PERFORM organization_master.authorize(p_actor,pair_subject,actual_scope,'READ');
    END IF;
    IF campus_ref<>'null'::jsonb THEN
     IF ref->>'dataset'<>'ORG03' OR jsonb_typeof(campus_ref) IS DISTINCT FROM 'object' OR NOT (campus_ref ?& ARRAY['id','version']) OR campus_ref-ARRAY['id','version']<>'{}'::jsonb OR jsonb_typeof(campus_ref->'id') IS DISTINCT FROM 'string' OR (campus_ref->'version'<>'null'::jsonb AND (jsonb_typeof(campus_ref->'version') IS DISTINCT FROM 'string' OR campus_ref->>'version'!~'^[1-9][0-9]*$')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
     pair_campus:=(campus_ref->>'id')::uuid;SELECT c.scope INTO actual_scope FROM organization_master.campus c WHERE c.id=pair_campus;
     IF actual_scope IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
     PERFORM organization_master.authorize(p_actor,pair_campus,actual_scope,'READ');
    END IF;
    IF pair_subject IS NOT NULL AND pair_campus IS NOT NULL THEN
     IF object_subject IS NOT NULL AND (object_subject<>pair_subject OR object_campus<>pair_campus) THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
     effective_permission:=CASE WHEN p_permission<>'WRITE' THEN p_permission WHEN ref->>'intent'='CREATE' THEN 'ESTABLISH' WHEN ref->>'intent'='REVISE' THEN 'REVISE' ELSE 'READ' END;
     PERFORM organization_master.operating_authorize(p_actor,pair_subject,pair_campus,effective_permission);
    END IF;
   END LOOP;
  END;
 END IF;$replacement$;
BEGIN
 body:=replace(pg_get_functiondef('organization_master.workspace_authorize(text,jsonb,text)'::regprocedure),E'\r\n',E'\n');
 IF length(body)-length(replace(body,needle,''))<>length(needle) OR position('manifestReferences' IN body)>0 THEN RAISE EXCEPTION 'WORKSPACE_MANIFEST_REFERENCE_AUTH_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,replacement);
END $repair_authorize$;
