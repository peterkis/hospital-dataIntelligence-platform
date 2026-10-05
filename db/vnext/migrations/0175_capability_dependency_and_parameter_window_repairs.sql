-- Published 0171-0174 bytes remain immutable. Recheck the exact approved bases,
-- rather than only proving that some current version still covers the window.
SELECT pg_advisory_xact_lock(901002);
DO $frozen_basis$
DECLARE body text;source_check text;unit_check text;
BEGIN
 body:=pg_get_functiondef('care_organization.capability_mutate(text,text)'::regprocedure);
 source_check:='PERFORM governance_catalog.capability_source_coverage(actor,u.source_system_id,from_at,CASE WHEN w->>''action'' IN (''ACTIVATE'',''RESUME'') THEN declaration.valid_to ELSE to_at END,record_at);';
 unit_check:='PERFORM care_organization.capability_admission(actor,u.applicability,w->''facts''->''rule'',from_at,CASE WHEN w->>''action'' IN (''ACTIVATE'',''RESUME'') THEN declaration.valid_to ELSE to_at END,record_at);';
 IF position(source_check IN body)=0 OR position(unit_check IN body)=0 THEN RAISE EXCEPTION 'CAPABILITY_SQL_ADMISSION_BASELINE_MISMATCH';END IF;
 body:=replace(body,source_check,'IF governance_catalog.capability_source_coverage(actor,u.source_system_id,from_at,CASE WHEN w->>''action'' IN (''ACTIVATE'',''RESUME'') THEN declaration.valid_to ELSE to_at END,record_at) IS DISTINCT FROM w->''facts''->''dependencies''->''source'' THEN RAISE EXCEPTION ''STALE_VALIDATION'';END IF;');
 body:=replace(body,unit_check,'IF care_organization.capability_admission(actor,u.applicability,w->''facts''->''rule'',from_at,CASE WHEN w->>''action'' IN (''ACTIVATE'',''RESUME'') THEN declaration.valid_to ELSE to_at END,record_at) IS DISTINCT FROM ((w->''facts''->''dependencies''->''unit'')-''current'') THEN RAISE EXCEPTION ''STALE_VALIDATION'';END IF;');
 EXECUTE body;
END $frozen_basis$;

-- Mutation authorization continues to follow the latest draft; READ of a
-- relationship uses an approved basis. Exact readers authorize their selected
-- version instead, so another version's source grants cannot poison old pins.
CREATE OR REPLACE FUNCTION governance_catalog.parameter_value_access(p_actor text,p_id uuid,p_permission text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v governance_catalog.parameter_value;d uuid;BEGIN
 SELECT * INTO v FROM governance_catalog.parameter_value WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT x.definition_version_id INTO d FROM governance_catalog.parameter_value_version x
  WHERE x.value_id=p_id ORDER BY CASE WHEN p_permission='READ' AND EXISTS(SELECT 1 FROM governance_catalog.parameter_value_approval a WHERE a.version_id=x.id) THEN 0 ELSE 1 END,x.number DESC LIMIT 1;
 PERFORM governance_catalog.parameter_value_scope_access(p_actor,d,v.scope_context,p_permission);
END $$;

DO $exact_read$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.parameter_value_read(text,jsonb,boolean)'::regprocedure);
 needle:='PERFORM governance_catalog.parameter_value_access(p_actor,(p_input->>''id'')::uuid,''READ'');';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'PARAMETER_VALUE_READ_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'PERFORM vnext_control.authorize(p_actor,''SYNTHETIC'',''READ'');');
 needle:='SELECT * INTO STRICT anchor FROM governance_catalog.parameter_value WHERE id=(p_input->>''id'')::uuid;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'PARAMETER_VALUE_READ_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'SELECT * INTO anchor FROM governance_catalog.parameter_value WHERE id=(p_input->>''id'')::uuid;IF NOT FOUND THEN RAISE EXCEPTION ''NOT_FOUND'';END IF;');
 needle:='PERFORM governance_catalog.parameter_require_access(p_actor,''SYNTHETIC'',v.definition_version_id,''READ'');';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'PARAMETER_VALUE_READ_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'PERFORM governance_catalog.parameter_value_scope_access(p_actor,v.definition_version_id,anchor.scope_context,''READ'');');
 needle:='IF p_input->>''versionId'' IS NOT NULL AND result=''[]''::jsonb THEN RAISE EXCEPTION ''NOT_FOUND'';END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'PARAMETER_VALUE_READ_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF result=''[]''::jsonb THEN PERFORM governance_catalog.parameter_value_access(p_actor,anchor.id,''READ'');IF p_input->>''versionId'' IS NOT NULL THEN RAISE EXCEPTION ''NOT_FOUND'';END IF;END IF;');
 EXECUTE body;
 body:=pg_get_functiondef('care_organization.capability_snapshot_at(text,uuid,timestamp)'::regprocedure);
 needle:='PERFORM governance_catalog.parameter_value_access(p_actor,(pin->>''valueId'')::uuid,''READ'');';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAPABILITY_PARAMETER_READ_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'PERFORM governance_catalog.parameter_value_read(p_actor,jsonb_build_object(''id'',pin->>''valueId'',''versionId'',pin->>''versionId''),false);');
END $exact_read$;

CREATE OR REPLACE FUNCTION governance_catalog.parameter_value_evaluate(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE from_b timestamp;to_b timestamp;cutoff timestamp;v governance_catalog.parameter_value_version;d governance_catalog.parameter_version;current_definition uuid;item jsonb;reason text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR NOT p_input ?& ARRAY['id','validFrom','validTo']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('id','versionId','recordAsOf','validFrom','validTo')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 from_b:=governance_catalog.contract_time(p_input->>'validFrom');to_b:=CASE WHEN p_input->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(p_input->>'validTo') END;
 IF to_b IS NOT NULL AND to_b<=from_b THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 cutoff:=CASE WHEN p_input->>'recordAsOf' IS NULL THEN timezone('Asia/Shanghai',clock_timestamp()) ELSE governance_catalog.contract_time(p_input->>'recordAsOf') END;
 -- Ignore versions that have not started at the requested business boundary.
 -- Do not filter valid_to: an expired latest revision must never revive an older one.
 SELECT x.* INTO v FROM governance_catalog.parameter_value_version x JOIN governance_catalog.parameter_value_approval a ON a.version_id=x.id AND a.recorded_at<=cutoff
  WHERE x.value_id=(p_input->>'id')::uuid AND x.recorded_at<=cutoff AND x.valid_from<=from_b ORDER BY x.number DESC LIMIT 1;
 IF v.id IS NULL THEN
  PERFORM governance_catalog.parameter_value_access(p_actor,(p_input->>'id')::uuid,'READ');
  reason:=CASE WHEN EXISTS(SELECT 1 FROM governance_catalog.parameter_value_version x JOIN governance_catalog.parameter_value_approval a ON a.version_id=x.id AND a.recorded_at<=cutoff WHERE x.value_id=(p_input->>'id')::uuid AND x.recorded_at<=cutoff) THEN 'PARAMETER_PERIOD_NOT_COVERED' ELSE 'PARAMETER_NOT_APPROVED' END;
  RETURN jsonb_build_object('item',NULL,'covered',false,'currentDefinitionVersionId',NULL,'reason',reason);
 END IF;
 SELECT * INTO STRICT d FROM governance_catalog.parameter_version WHERE id=v.definition_version_id;
 SELECT pv.id INTO current_definition FROM governance_catalog.parameter_version pv JOIN governance_catalog.parameter_approval a ON a.version_id=pv.id AND a.recorded_at<=cutoff
  WHERE pv.parameter_id=d.parameter_id AND pv.recorded_at<=cutoff AND pv.valid_from<=from_b ORDER BY pv.number DESC LIMIT 1;
 item:=governance_catalog.parameter_value_read(p_actor,jsonb_build_object('id',p_input->>'id','versionId',v.id,'recordAsOf',to_char(cutoff,'YYYY-MM-DD"T"HH24:MI:SS.US')),false)->0;
 reason:=CASE WHEN (p_input->>'versionId' IS NOT NULL AND p_input->>'versionId'<>v.id::text) OR current_definition IS DISTINCT FROM d.id
  OR EXISTS(SELECT 1 FROM governance_catalog.parameter_value_version x JOIN governance_catalog.parameter_value_approval a ON a.version_id=x.id AND a.recorded_at<=cutoff WHERE x.value_id=v.value_id AND x.recorded_at<=cutoff AND x.number>v.number AND x.valid_from>from_b AND (to_b IS NULL OR x.valid_from<to_b))
  OR EXISTS(SELECT 1 FROM governance_catalog.parameter_version x JOIN governance_catalog.parameter_approval a ON a.version_id=x.id AND a.recorded_at<=cutoff WHERE x.parameter_id=d.parameter_id AND x.recorded_at<=cutoff AND x.number>(SELECT number FROM governance_catalog.parameter_version WHERE id=current_definition) AND x.valid_from>from_b AND (to_b IS NULL OR x.valid_from<to_b)) THEN 'PARAMETER_ADOPTION_CHANGED'
  WHEN NOT tsrange(v.valid_from,v.valid_to,'[)') @> tsrange(from_b,to_b,'[)') OR NOT tsrange(d.valid_from,d.valid_to,'[)') @> tsrange(from_b,to_b,'[)') OR NOT governance_catalog.source_valid_spans(d.system_version_id,cutoff) @> tsrange(from_b,to_b,'[)') THEN 'PARAMETER_PERIOD_NOT_COVERED' ELSE 'SATISFIED' END;
 RETURN jsonb_build_object('item',item,'covered',reason='SATISFIED','currentDefinitionVersionId',current_definition,'reason',reason);
END $$;
