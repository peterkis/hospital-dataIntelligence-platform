DO $patch$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('governance_catalog.validation_rules_valid(jsonb,uuid)'::regprocedure);
 needle:=' FOR rule IN SELECT value FROM jsonb_array_elements(definition->''rules'') LOOP';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAPABILITY_RULE_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||E'\n IF code=''ORG16'' AND definition->>''templateVersion''=''ORG16_CORE_V1'' AND rule->>''status''=''MACHINE'' AND ((rule->>''id''=''CAPABILITY_EMPTY_END_V1'' AND rule->>''field''=''valid_to'' AND rule->>''version''=''P3_08_EMPTY_END_V1'' AND rule->>''text''=''CSV/XLSX blank valid_to is an explicit open end; JSON requires native null.'') OR (rule->>''id''=''CAPABILITY_APPROVAL_V1'' AND rule->>''field''=''approval_ref'' AND rule->>''version''=''P3_08_V1'' AND rule->>''text''=''Source approval never replaces platform approval.'') OR (rule->>''id''=''CAPABILITY_RULE_CONFIRMATION_V1'' AND rule->>''field''=''rule_ref'' AND rule->>''version''=''P3_08_V1'' AND rule->>''text''=''Empty rule requires independent no-additional-rule confirmation.'') OR (rule->>''id''=''CAPABILITY_SOURCE_PLUS08_V1'' AND rule->>''field''=''valid_from'' AND rule->>''version''=''P3_08_TIME_V1'' AND rule->>''text''=''Explicit source +08:00 to Asia/Shanghai local; retain original timestamps.'')) THEN CONTINUE;END IF;');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.contract_definition(jsonb,uuid,text)'::regprocedure);
 needle:='''WARD_CORE''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAPABILITY_CONTRACT_BASELINE_MISMATCH';END IF;
 body:=replace(body,'''NURSING_CORE'',''WARD_CORE'',''LOCATION_CORE''','''NURSING_CORE'',''WARD_CORE'',''CAPABILITY_CORE'',''LOCATION_CORE''');
 needle:='FOR entry IN SELECT value FROM jsonb_array_elements(p_definition->''references'') LOOP';
 body:=replace(body,needle,needle||E'\n IF entry->>''status''=''CAPABILITY_CORE'' AND (p_profile<>''CORE'' OR p_definition->>''templateVersion''<>''ORG16_CORE_V1'' OR NOT EXISTS(SELECT 1 FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=p_dataset_version AND o.code=''ORG16'' AND o.scope=''SYNTHETIC'')) THEN RAISE EXCEPTION ''REFERENCE_INVALID'';END IF;');
 needle:=' IF p_profile=''FULL''';body:=replace(body,needle,'IF p_definition->>''templateVersion''=''ORG16_CORE_V1'' AND (p_profile<>''CORE'' OR jsonb_array_length(p_definition->''fields'')<>15 OR jsonb_array_length(dataset->''fields'')<>15) THEN RAISE EXCEPTION ''FULL_FIELD_OMISSION'';END IF;'||needle);EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);EXECUTE replace(body,'''STRICT_LOCATION_V1''','''STRICT_LOCATION_V1'',''STRICT_CAPABILITY_V1''');
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)'::regprocedure);
 body:=replace(body,'''STRICT_LOCATION_V1'')','''STRICT_LOCATION_V1'',''STRICT_CAPABILITY_V1'')');
 needle:='OR (p.policy=''STRICT_LOCATION_V1'' AND EXISTS(SELECT 1 FROM location_master.input WHERE job_revision=p.revision_id))';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAPABILITY_VALIDATION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,needle||' OR (p.policy=''STRICT_CAPABILITY_V1'' AND EXISTS(SELECT 1 FROM care_organization.capability_input WHERE job_revision=p.revision_id))');EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.read_validation(text,uuid)'::regprocedure);EXECUTE replace(body,'''STRICT_LOCATION_V1'')','''STRICT_LOCATION_V1'',''STRICT_CAPABILITY_V1'')');
END $patch$;
DO $constraints$ DECLARE tab text;constraint_name text;definition text;BEGIN
 FOREACH tab IN ARRAY ARRAY['import_input_revision','parse_provenance'] LOOP
  constraint_name:=CASE tab WHEN 'import_input_revision' THEN 'import_input_revision_metadata_shape_check' ELSE 'parse_provenance_policy_check' END;
  SELECT pg_get_constraintdef(c.oid) INTO definition FROM pg_constraint c WHERE c.conrelid=('governance_catalog.'||tab)::regclass AND c.conname=constraint_name;
  IF position('''STRICT_LOCATION_V1''::text' IN definition)=0 THEN RAISE EXCEPTION 'CAPABILITY_PARSER_BASELINE_MISMATCH';END IF;
  definition:=replace(definition,'''STRICT_LOCATION_V1''::text','''STRICT_LOCATION_V1''::text,''STRICT_CAPABILITY_V1''::text');EXECUTE format('ALTER TABLE governance_catalog.%I DROP CONSTRAINT %I',tab,constraint_name);EXECUTE format('ALTER TABLE governance_catalog.%I ADD CONSTRAINT %I %s',tab,constraint_name,definition);
 END LOOP;
END $constraints$;

-- Organization owns this final SQL check; Care never reads its private tables.
-- The approved frozen evidence identifies the references, and this Owner checks
-- their current effective spans under the same writer lock and publication R.
CREATE FUNCTION organization_master.capability_operating_guard(p_actor text,p_scope jsonb,p_dependency jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE part jsonb;operating jsonb;service jsonb;segment jsonb;relation jsonb;scope_fact jsonb;rv jsonb;sv jsonb;registration jsonb;license jsonb;verification jsonb;profile jsonb;campus jsonb;
 code text;requested tsrange;piece tsrange;spans tsmultirange;effective tsmultirange;qualified tsmultirange;profiles tsmultirange;running tsmultirange;declared tsmultirange:='{}';cuts tsmultirange;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 registration:=organization_master.qualification_snapshot(p_actor,(p_scope->'subject'->>'id')::uuid);
 campus:=organization_master.campus_snapshot(p_actor,(p_scope->'campus'->>'id')::uuid);
 IF jsonb_typeof(p_dependency->'unit'->'current') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
 SELECT coalesce(range_agg(tsrange((e.item->>'valid_from')::timestamp,(e.item->>'valid_to')::timestamp,'[)')),'{}'::tsmultirange) INTO profiles
  FROM jsonb_array_elements(registration->'versions') e(item) WHERE (e.item->>'recorded_at')::timestamp<=p_r;
 FOR part IN SELECT e.item FROM jsonb_array_elements(p_dependency->'unit'->'current') e(item) LOOP
  requested:=tsrange((part->>'from')::timestamp,(part->>'to')::timestamp,'[)');declared:=declared+tsmultirange(requested);operating:=part->'dependencies'->'operating';
  IF operating->>'status' IS DISTINCT FROM 'SATISFIED' OR operating->'subject' IS DISTINCT FROM p_scope->'subject' OR operating->'campus' IS DISTINCT FROM p_scope->'campus' THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
  running:='{}';
  FOR profile IN SELECT e.item FROM jsonb_array_elements(campus->'events') e(item) WHERE e.item->>'state' IN ('RUNNING','TRIAL_RUNNING') AND (e.item->>'recorded_at')::timestamp<=p_r LOOP
   SELECT coalesce(range_agg(tsrange((e.item->>'valid_from')::timestamp,(e.item->>'valid_to')::timestamp,'[)')),'{}'::tsmultirange) INTO cuts FROM jsonb_array_elements(campus->'events') e(item) WHERE e.item->>'state' IS NOT NULL AND (e.item->>'number')::bigint>(profile->>'number')::bigint AND (e.item->>'recorded_at')::timestamp<=p_r;
   running:=running+(tsmultirange(tsrange((profile->>'valid_from')::timestamp,(profile->>'valid_to')::timestamp,'[)'))-cuts);
  END LOOP;
  IF NOT running @> requested OR NOT profiles @> requested OR NOT coalesce((organization_master.location_coverage(p_actor,(p_scope->'campus'->>'id')::uuid,lower(requested),upper(requested))->>'covered')::boolean,false) THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
  FOR code IN SELECT e.item FROM jsonb_array_elements_text(p_scope->'services') e(item) LOOP
   SELECT e.item INTO service FROM jsonb_array_elements(operating->'services') e(item) WHERE e.item->>'code'=code;
   IF service IS NULL OR service->>'status' IS DISTINCT FROM 'SATISFIED' THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;spans:='{}';
   FOR segment IN SELECT e.item FROM jsonb_array_elements(service->'segments') e(item) LOOP
    piece:=tsrange((segment->>'from')::timestamp,(segment->>'to')::timestamp,'[)');IF isempty(piece) THEN CONTINUE;END IF;
    relation:=organization_master.operating_snapshot(p_actor,(segment->'relation'->>'id')::uuid,'RELATION');
    scope_fact:=organization_master.operating_snapshot(p_actor,(segment->'scope'->>'id')::uuid,'SCOPE');
    IF relation->>'subject_id' IS DISTINCT FROM p_scope->'subject'->>'id' OR relation->>'campus_id' IS DISTINCT FROM p_scope->'campus'->>'id' OR scope_fact->>'subject_id' IS DISTINCT FROM p_scope->'subject'->>'id' OR scope_fact->>'campus_id' IS DISTINCT FROM p_scope->'campus'->>'id' THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
    SELECT e.item INTO rv FROM jsonb_array_elements(relation->'versions') e(item) WHERE e.item->>'id'=segment->'relation'->>'versionId' AND e.item->>'number'=segment->'relation'->>'version' AND (e.item->>'recorded_at')::timestamp<=p_r;
    SELECT e.item INTO sv FROM jsonb_array_elements(scope_fact->'versions') e(item) WHERE e.item->>'id'=segment->'scope'->>'versionId' AND e.item->>'number'=segment->'scope'->>'version' AND (e.item->>'recorded_at')::timestamp<=p_r;
    IF rv IS NULL OR sv IS NULL OR rv->'facts'->>'role' IS DISTINCT FROM 'OPERATOR' OR NOT rv->'facts'->'services' ? code OR NOT sv->'facts'->'services' ? code OR sv->'facts'->'license' IS DISTINCT FROM segment->'license' THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
    SELECT coalesce(range_agg(tsrange((e.item->>'valid_from')::timestamp,(e.item->>'valid_to')::timestamp,'[)')),'{}'::tsmultirange) INTO cuts FROM jsonb_array_elements(relation->'versions') e(item) WHERE (e.item->>'number')::bigint>(rv->>'number')::bigint AND (e.item->>'recorded_at')::timestamp<=p_r;
    effective:=tsmultirange(tsrange((rv->>'valid_from')::timestamp,(rv->>'valid_to')::timestamp,'[)'))-cuts;IF NOT effective @> piece THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
    SELECT coalesce(range_agg(tsrange((e.item->>'valid_from')::timestamp,(e.item->>'valid_to')::timestamp,'[)')),'{}'::tsmultirange) INTO cuts FROM jsonb_array_elements(scope_fact->'versions') e(item) WHERE (e.item->>'number')::bigint>(sv->>'number')::bigint AND (e.item->>'recorded_at')::timestamp<=p_r;
    effective:=tsmultirange(tsrange((sv->>'valid_from')::timestamp,(sv->>'valid_to')::timestamp,'[)'))-cuts;IF NOT effective @> piece THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
    IF governance_catalog.operating_catalog(p_actor,rv->'facts'->'catalog',lower(piece),upper(piece),p_r) IS NULL OR governance_catalog.operating_catalog(p_actor,sv->'facts'->'catalog',lower(piece),upper(piece),p_r) IS NULL THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
    SELECT e.item INTO license FROM jsonb_array_elements(registration->'licenses') e(item) WHERE e.item->>'id'=segment->'license'->>'versionId' AND e.item->>'license_id'=segment->'license'->>'id' AND e.item->>'number'=segment->'license'->>'version' AND (e.item->>'recorded_at')::timestamp<=p_r;
    IF license IS NULL OR coalesce((license->>'revoked')::boolean,true) OR license->>'end_kind'='UNKNOWN' THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
    SELECT coalesce(range_agg(tsrange((e.item->>'valid_from')::timestamp,(e.item->>'valid_to')::timestamp,'[)')),'{}'::tsmultirange) INTO cuts FROM jsonb_array_elements(registration->'licenses') e(item) WHERE e.item->>'license_id'=license->>'license_id' AND (e.item->>'number')::bigint>(license->>'number')::bigint AND (e.item->>'recorded_at')::timestamp<=p_r;
    effective:=tsmultirange(tsrange((license->>'valid_from')::timestamp,(license->>'valid_to')::timestamp,'[)'))-cuts;
    IF NOT effective @> piece THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;qualified:='{}';
    FOR verification IN SELECT e.item FROM jsonb_array_elements(registration->'verifications') e(item) WHERE e.item->'licenses' ? (license->>'id') AND (e.item->>'recorded_at')::timestamp<=p_r LOOP
     SELECT e.item INTO profile FROM jsonb_array_elements(registration->'versions') e(item) WHERE e.item->>'id'=verification->>'subject_version' AND (e.item->>'recorded_at')::timestamp<=p_r;
     IF profile IS NULL THEN CONTINUE;END IF;
     SELECT coalesce(range_agg(tsrange((e.item->>'valid_from')::timestamp,(e.item->>'valid_to')::timestamp,'[)')),'{}'::tsmultirange) INTO cuts FROM jsonb_array_elements(registration->'versions') e(item) WHERE (e.item->>'number')::bigint>(profile->>'number')::bigint AND (e.item->>'recorded_at')::timestamp<=p_r;
     qualified:=qualified+((tsmultirange(tsrange((profile->>'valid_from')::timestamp,(profile->>'valid_to')::timestamp,'[)'))-cuts)*tsmultirange(tsrange((verification->>'valid_from')::timestamp,(verification->>'valid_to')::timestamp,'[)'))*effective);
    END LOOP;
    IF NOT qualified @> piece THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;spans:=spans+tsmultirange(piece);
   END LOOP;
   IF NOT spans @> requested THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
  END LOOP;
 END LOOP;
 IF NOT declared @> tsrange(p_from,p_to,'[)') THEN RAISE EXCEPTION 'LICENSE_PERIOD_NOT_COVERED';END IF;
END $$;
REVOKE ALL ON FUNCTION organization_master.capability_operating_guard(text,jsonb,jsonb,timestamp,timestamp,timestamp) FROM PUBLIC,hdi_prototype;
DO $guard$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.capability_mutate(text,text)'::regprocedure);
 needle:='PERFORM care_organization.capability_admission(actor,u.applicability,w->''facts''->''rule'',from_at,CASE WHEN w->>''action'' IN (''ACTIVATE'',''RESUME'') THEN declaration.valid_to ELSE to_at END,record_at);';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAPABILITY_SQL_ADMISSION_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,needle||E'\n PERFORM organization_master.capability_operating_guard(actor,u.applicability,w->''facts''->''dependencies'',from_at,CASE WHEN w->>''action'' IN (''ACTIVATE'',''RESUME'') THEN declaration.valid_to ELSE to_at END,record_at);');
END $guard$;
