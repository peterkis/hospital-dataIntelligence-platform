SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION care_organization.ward_nursing_scope_version_read(p_actor text,p_id uuid,p_version bigint,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d care_organization.ward_nursing_scope_set;v care_organization.ward_nursing_scope_version;result jsonb;ending timestamp;BEGIN
 SELECT * INTO d FROM care_organization.ward_nursing_scope_set WHERE id=p_id AND recorded_at<=p_r;IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;
 PERFORM care_organization.ward_nursing_authorize(p_actor,d.campus_id,'READ');PERFORM care_organization.ward_snapshot(p_actor,d.ward_id);
 IF p_version=1 THEN result:=jsonb_build_object('id',d.id,'version','1','scope',d.scope,'applicability',jsonb_build_object('ward',jsonb_build_object('owner','care-organization/ward','id',d.ward_id),'campus',jsonb_build_object('owner','organization-master/campus','id',d.campus_id),'purpose','NURSING_COVERAGE'),'partitions',d.partitions,'validFrom',to_char(d.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(d.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(d.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'sourceAlias',d.source_alias,'verificationBasis',d.verification_basis,'changeId',d.change_id);
 ELSE SELECT * INTO v FROM care_organization.ward_nursing_scope_version WHERE scope_set_id=p_id AND number=p_version AND recorded_at<=p_r;IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;
  result:=jsonb_build_object('id',d.id,'version',v.number::text,'scope',d.scope,'applicability',v.definition->'definition'->'applicability','partitions',v.partitions,'validFrom',to_char(v.valid_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(v.valid_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'sourceAlias',v.definition->'definition'->>'sourceAlias','verificationBasis',v.verification_basis,'changeId',v.change_id,'inputId',v.input_id,'inputDigest',v.definition->'proposal'->>'inputDigest');
 END IF;
 SELECT min(valid_from) INTO ending FROM care_organization.ward_nursing_scope_version WHERE scope_set_id=p_id AND number>p_version AND recorded_at<=p_r;
 IF ending IS NOT NULL AND ((result->>'validTo') IS NULL OR ending<(result->>'validTo')::timestamp) THEN result:=result||jsonb_build_object('validTo',to_char(ending,'YYYY-MM-DD"T"HH24:MI:SS.US'));END IF;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION care_organization.ward_nursing_scope_set_read(p_actor text,p_id uuid,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE head bigint;BEGIN SELECT coalesce(max(number),1) INTO head FROM care_organization.ward_nursing_scope_version WHERE scope_set_id=p_id AND recorded_at<=p_r;RETURN care_organization.ward_nursing_scope_version_read(p_actor,p_id,head,p_r);END $$;
CREATE OR REPLACE FUNCTION care_organization.ward_nursing_scope_validate(p_actor text,p_a jsonb,p_scope jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d jsonb;part text;BEGIN
 IF p_scope->>'kind'='WHOLE_WARD' THEN PERFORM care_organization.ward_nursing_closed(p_scope,ARRAY['kind']);RETURN p_scope;END IF;
 PERFORM care_organization.ward_nursing_closed(p_scope,ARRAY['kind','scopeSetId','version','partitionIds']);IF p_scope->>'kind' IS DISTINCT FROM 'PARTITIONS' OR coalesce(p_scope->>'version','')!~'^[1-9][0-9]{0,18}$' OR jsonb_typeof(p_scope->'partitionIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_scope->'partitionIds') NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_scope->'partitionIds'))<>jsonb_array_length(p_scope->'partitionIds') THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;
 d:=care_organization.ward_nursing_scope_version_read(p_actor,(p_scope->>'scopeSetId')::uuid,(p_scope->>'version')::bigint,p_r);
 IF d->'applicability'->'ward' IS DISTINCT FROM p_a->'ward' OR d->'applicability'->'campus' IS DISTINCT FROM p_a->'campus' OR NOT tsrange((d->>'validFrom')::timestamp,(d->>'validTo')::timestamp,'[)') @> tsrange(p_from,p_to,'[)') THEN RAISE EXCEPTION 'SCOPE_BASIS_MISMATCH';END IF;
 FOR part IN SELECT value FROM jsonb_array_elements_text(p_scope->'partitionIds') LOOP IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'partitions') q WHERE q->>'id'=part) THEN RAISE EXCEPTION 'UNKNOWN_COVERAGE_SCOPE';END IF;END LOOP;
 IF p_scope->>'version'='1' THEN RETURN d;END IF;
 RETURN jsonb_build_object('scopeSetId',d->>'id','version',d->>'version','inputId',d->>'inputId','inputDigest',d->>'inputDigest','partitions',d->'partitions','validFrom',d->>'validFrom','validTo',d->>'validTo');
END $$;
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_nursing_mutate_0199(text,text)'::regprocedure);
 body:=replace(body,'DECLARE fresh jsonb;','DECLARE scope_old jsonb;scope_proposal care_organization.ward_nursing_scope_proposal;scope_head bigint;fresh jsonb;');
 needle:='IF w->>''action''=''REGISTER_SCOPE'' THEN';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_WRITER_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF w->>''action'' IN (''REGISTER_SCOPE'',''REVISE_SCOPE'') THEN');
 needle:='IF EXISTS(SELECT 1 FROM care_organization.ward_nursing_scope_set WHERE ward_id=(w->''applicability''->''ward''->>''id'')::uuid) THEN RAISE EXCEPTION ''SCOPE_REVISION_NOT_SUPPORTED'';END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_CHECK_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$IF w->>'action'='REVISE_SCOPE' THEN
    IF NOT care_organization.lifecycle_member_matches(actor,'WARD_NURSING',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') THEN RAISE EXCEPTION 'SCOPE_REPARTITION_REQUIRES_LIFECYCLE';END IF;
    SELECT * INTO scope_proposal FROM care_organization.ward_nursing_scope_proposal WHERE input_id=r.id;
    scope_old:=care_organization.ward_nursing_scope_set_read(actor,(w->>'targetId')::uuid,record_at);
    scope_head:=(scope_old->>'version')::bigint;
    IF scope_proposal.input_id IS NULL OR scope_proposal.scope_set_id::text IS DISTINCT FROM w->>'targetId' OR scope_head::text IS DISTINCT FROM w->>'expectedHead' OR scope_proposal.expected_head<>scope_head OR from_at<=(scope_old->>'validFrom')::timestamp OR scope_old->'applicability' IS DISTINCT FROM w->'applicability' OR scope_old->>'sourceAlias' IS DISTINCT FROM w->'facts'->'definition'->>'sourceAlias' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
    IF w->'facts'->'proposal'->>'inputId' IS DISTINCT FROM r.id::text OR w->'facts'->'proposal'->>'inputDigest' IS DISTINCT FROM r.digest OR w->'facts'->'proposal'->>'scopeSetId' IS DISTINCT FROM scope_proposal.scope_set_id::text OR w->'facts'->'proposal'->>'version' IS DISTINCT FROM (scope_head+1)::text OR (w->'facts'->'proposal'->>'validFrom')::timestamp IS DISTINCT FROM from_at OR (w->'facts'->'proposal'->>'validTo')::timestamp IS DISTINCT FROM to_at THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
    IF jsonb_array_length(w->'facts'->'mapping')<>jsonb_array_length(scope_old->'partitions') OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_old->'partitions') old WHERE (SELECT count(*) FROM jsonb_array_elements(w->'facts'->'mapping') m WHERE m->>'partitionId'=old->>'id' AND m->>'version'=scope_head::text)<>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(w->'facts'->'mapping') m WHERE jsonb_array_length(m->'toAliases')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(m->'toAliases') a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scope_proposal.partitions) p WHERE p->>'sourceAlias'=a.value))) OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_proposal.partitions) p WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w->'facts'->'mapping') m WHERE m->'toAliases' ? (p->>'sourceAlias'))) THEN RAISE EXCEPTION 'SCOPE_MAPPING_INCOMPLETE';END IF;
   ELSIF EXISTS(SELECT 1 FROM care_organization.ward_nursing_scope_set WHERE ward_id=(w->'applicability'->'ward'->>'id')::uuid) THEN RAISE EXCEPTION 'SCOPE_REVISION_NOT_SUPPORTED';END IF;$new$);
 needle:='partitions:=partitions||jsonb_build_array(partition||jsonb_build_object(''id'',uuidv7()));';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_IDS_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$partitions:=partitions||jsonb_build_array(partition||jsonb_build_object('id',CASE WHEN w->>'action'='REVISE_SCOPE' THEN (SELECT (p->>'id')::uuid FROM jsonb_array_elements(scope_proposal.partitions) p WHERE p->>'sourceAlias'=partition->>'sourceAlias') ELSE uuidv7() END));$new$);
 needle:='INSERT INTO care_organization.ward_nursing_scope_set(ward_id,campus_id,scope,source_alias,partitions,valid_from,valid_to,recorded_at,verification_basis,change_id)';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_SCOPE_INSERT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$IF w->>'action'='REVISE_SCOPE' THEN
    IF partitions IS DISTINCT FROM w->'facts'->'proposal'->'partitions' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
    scope_id:=scope_proposal.scope_set_id;
    INSERT INTO care_organization.ward_nursing_scope_version VALUES(scope_id,scope_head+1,r.id,partitions,w->'facts',from_at,to_at,record_at,w->'facts'->'verificationBasis',root_id);
   ELSE INSERT INTO care_organization.ward_nursing_scope_set(ward_id,campus_id,scope,source_alias,partitions,valid_from,valid_to,recorded_at,verification_basis,change_id)$new$);
 body:=replace(body,'RETURNING id INTO scope_id;','RETURNING id INTO scope_id;END IF;');
 body:=replace(body,'''version'',''1'',''source'',jsonb_build_object(''dataset'',''ORG11''','''version'',CASE WHEN w->>''action''=''REVISE_SCOPE'' THEN (scope_head+1)::text ELSE ''1'' END,''source'',jsonb_build_object(''dataset'',''ORG11''');EXECUTE body;
END $$;
REVOKE ALL ON FUNCTION care_organization.ward_nursing_scope_version_read(text,uuid,bigint,timestamp) FROM PUBLIC,hdi_prototype;
