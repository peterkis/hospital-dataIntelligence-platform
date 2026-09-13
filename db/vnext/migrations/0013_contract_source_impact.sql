-- Extend source impact governance without reinterpreting historical SOURCE cases.
SELECT pg_advisory_xact_lock(901002);
ALTER TABLE governance_catalog.import_contract_event ADD COLUMN approval_context jsonb;
ALTER TABLE governance_catalog.import_contract_event ADD CONSTRAINT import_contract_event_object UNIQUE(head,contract_id);
CREATE TABLE governance_catalog.contract_impact_event (
 case_id uuid NOT NULL DEFAULT uuidv7(), event_sequence integer NOT NULL CHECK(event_sequence IN (1,2)),
 upstream_object uuid NOT NULL, upstream_event bigint NOT NULL,
 assessment_head bigint NOT NULL REFERENCES governance_catalog.source_assessment(event_head),
 contract_id uuid NOT NULL REFERENCES governance_catalog.import_contract(id), contract_version uuid NOT NULL,
 obligation_spans tsmultirange NOT NULL CHECK(NOT isempty(obligation_spans)),
 resolution_contract_event bigint, resolution_source_event bigint REFERENCES governance_catalog.event(head),
 evidence jsonb NOT NULL, recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 PRIMARY KEY(case_id,event_sequence),
 FOREIGN KEY(upstream_event,upstream_object) REFERENCES governance_catalog.event(head,object_id),
 FOREIGN KEY(contract_version,contract_id) REFERENCES governance_catalog.import_contract_version(id,contract_id),
 FOREIGN KEY(resolution_contract_event,contract_id) REFERENCES governance_catalog.import_contract_event(head,contract_id),
 CHECK((event_sequence=1 AND resolution_contract_event IS NULL AND resolution_source_event IS NULL) OR
       (event_sequence=2 AND ((resolution_contract_event IS NOT NULL)::integer+(resolution_source_event IS NOT NULL)::integer)=1))
);
CREATE TRIGGER contract_impact_immutable BEFORE UPDATE OR DELETE ON governance_catalog.contract_impact_event FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE governance_catalog.contract_impact_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON governance_catalog.contract_impact_event FROM PUBLIC,hdi_prototype;
GRANT SELECT ON governance_catalog.contract_impact_event TO hdi_prototype;

CREATE FUNCTION governance_catalog.contract_source_versions(p_version uuid) RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
 SELECT (definition->>'sourceVersionId')::uuid FROM governance_catalog.import_contract_version WHERE id=p_version AND definition->>'sourceVersionId' IS NOT NULL
 UNION SELECT (item->>'sourceVersionId')::uuid FROM governance_catalog.import_contract_version v CROSS JOIN LATERAL jsonb_array_elements(v.definition->'codeSets') item WHERE v.id=p_version AND item->>'sourceVersionId' IS NOT NULL
$$;
CREATE FUNCTION governance_catalog.contract_depends_on(p_version uuid,p_source uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
 WITH RECURSIVE pins(id,path) AS (
  SELECT x,ARRAY[x] FROM governance_catalog.contract_source_versions(p_version) x
  UNION ALL SELECT (v.payload->>'sourceEvidenceVersion')::uuid,p.path||(v.payload->>'sourceEvidenceVersion')::uuid FROM pins p JOIN governance_catalog.version v ON v.id=p.id
  WHERE v.payload->>'sourceEvidenceVersion' IS NOT NULL AND NOT (v.payload->>'sourceEvidenceVersion')::uuid=ANY(p.path)
 ) SELECT EXISTS(SELECT 1 FROM pins p JOIN governance_catalog.version v ON v.id=p.id WHERE v.object_id=p_source)
$$;
CREATE FUNCTION governance_catalog.contract_supported_spans(p_version uuid,p_as_of timestamp,p_target uuid DEFAULT NULL,p_preview uuid DEFAULT NULL,p_retire boolean DEFAULT false) RETURNS tsmultirange
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE supported tsmultirange; pin uuid;
BEGIN
 SELECT tsmultirange(tsrange(valid_from,valid_to,'[)')) INTO supported FROM governance_catalog.import_contract_version WHERE id=p_version;
 IF supported IS NULL THEN RETURN '{}'::tsmultirange; END IF;
 FOR pin IN SELECT * FROM governance_catalog.contract_source_versions(p_version) LOOP
  supported:=supported*coalesce(governance_catalog.source_projected_valid_spans(pin,p_as_of,p_target,p_preview,p_retire),'{}'::tsmultirange);
 END LOOP;
 RETURN supported;
END $$;

ALTER FUNCTION governance_catalog.source_proposed_impact(uuid,text) RENAME TO source_proposed_impact_sources;
CREATE FUNCTION governance_catalog.source_proposed_impact(p_target uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE base jsonb; at_r timestamp; preview uuid; ver governance_catalog.import_contract_version; publication governance_catalog.import_contract_event;
 before_bad tsmultirange; after_bad tsmultirange; own_span tsmultirange; delta tsmultirange; entry jsonb; case_row governance_catalog.contract_impact_event;
 current_refs jsonb:='[]'; historical_refs jsonb:='[]'; openings jsonb:='[]'; closings jsonb:='[]';
BEGIN
 base:=governance_catalog.source_proposed_impact_sources(p_target,p_action);
 at_r:=greatest((base->>'asOf')::timestamp,(SELECT max(recorded_at) FROM governance_catalog.import_contract_event),(SELECT max(recorded_at) FROM governance_catalog.contract_impact_event));
 preview:=CASE WHEN p_action='PUBLISH' THEN (base->>'candidateVersionId')::uuid ELSE NULL END;
 FOR ver IN SELECT v.* FROM governance_catalog.import_contract_version v WHERE EXISTS(SELECT 1 FROM governance_catalog.import_contract_event e WHERE e.version_id=v.id AND e.status='PUBLISHED' AND e.recorded_at<=at_r) ORDER BY v.contract_id,v.number LOOP
  IF NOT governance_catalog.contract_depends_on(ver.id,p_target) THEN CONTINUE; END IF;
  SELECT * INTO publication FROM governance_catalog.import_contract_event WHERE contract_id=ver.contract_id AND status IN ('PUBLISHED','RETIRED') AND recorded_at<=at_r ORDER BY head DESC LIMIT 1;
  own_span:=tsmultirange(tsrange(ver.valid_from,ver.valid_to,'[)'));
  before_bad:=own_span-governance_catalog.contract_supported_spans(ver.id,at_r);
  after_bad:=own_span-governance_catalog.contract_supported_spans(ver.id,at_r,p_target,preview,p_action='RETIRE');
  entry:=jsonb_build_object('contractId',ver.contract_id,'contractVersionId',ver.id,'datasetVersionId',ver.dataset_version_id,
   'publicationHead',(SELECT max(head)::text FROM governance_catalog.import_contract_event WHERE version_id=ver.id AND status='PUBLISHED' AND recorded_at<=at_r),
   'sourceVersions',(SELECT jsonb_agg(pin ORDER BY pin) FROM governance_catalog.contract_source_versions(ver.id) pin),
   'definitionDigest',encode(sha256(convert_to(to_jsonb(ver)::text,'UTF8')),'hex'),'effectiveSpans',own_span::text,'beforeBadSpans',before_bad::text,'afterBadSpans',after_bad::text);
  IF publication.status='PUBLISHED' AND publication.version_id=ver.id THEN
   current_refs:=current_refs||jsonb_build_array(entry);delta:=after_bad-before_bad;
   IF NOT isempty(delta) THEN openings:=openings||jsonb_build_array(entry||jsonb_build_object('obligationSpans',delta::text,'obligationModel','EVENT_DELTA_V1')); END IF;
  ELSE historical_refs:=historical_refs||jsonb_build_array(entry); END IF;
 END LOOP;
 FOR case_row IN SELECT e.* FROM governance_catalog.contract_impact_event e WHERE e.event_sequence=1 AND NOT EXISTS(SELECT 1 FROM governance_catalog.contract_impact_event c WHERE c.case_id=e.case_id AND c.event_sequence=2) ORDER BY e.case_id LOOP
  IF NOT governance_catalog.contract_depends_on(case_row.contract_version,p_target) THEN CONTINUE; END IF;
  SELECT * INTO publication FROM governance_catalog.import_contract_event WHERE contract_id=case_row.contract_id AND status IN ('PUBLISHED','RETIRED') AND recorded_at<=at_r ORDER BY head DESC LIMIT 1;
  IF publication.status='PUBLISHED' THEN
   SELECT tsmultirange(tsrange(valid_from,valid_to,'[)')) INTO own_span FROM governance_catalog.import_contract_version WHERE id=publication.version_id;
   after_bad:=own_span-governance_catalog.contract_supported_spans(publication.version_id,at_r,p_target,preview,p_action='RETIRE');
  ELSE after_bad:='{}'::tsmultirange; END IF;
  IF isempty(after_bad*case_row.obligation_spans) THEN closings:=closings||jsonb_build_array(jsonb_build_object('caseId',case_row.case_id,'contractId',case_row.contract_id,'contractVersionId',case_row.contract_version,'obligationSpans',case_row.obligation_spans::text,'remainingBadSpans',after_bad::text)); END IF;
 END LOOP;
 RETURN base||jsonb_build_object('asOf',to_char(at_r,'YYYY-MM-DD"T"HH24:MI:SS.US'),'contractHead',(SELECT coalesce(max(head),0)::text FROM governance_catalog.import_contract_event),
  'contractCurrent',current_refs,'contractHistory',historical_refs,'contractOpening',openings,'contractClosing',closings);
END $$;

ALTER FUNCTION vnext_control.require_assessment_access(text,text,jsonb) RENAME TO require_assessment_access_sources;
CREATE FUNCTION vnext_control.require_assessment_access(p_actor text,p_scope text,p_assessment jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
DECLARE entry jsonb;
BEGIN
 PERFORM vnext_control.require_assessment_access_sources(p_actor,p_scope,p_assessment);
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_assessment->'contractCurrent','[]')||coalesce(p_assessment->'contractHistory','[]')||coalesce(p_assessment->'contractOpening','[]')||coalesce(p_assessment->'contractClosing','[]')) LOOP
  PERFORM governance_catalog.contract_require_access(p_actor,p_scope,(entry->>'contractVersionId')::uuid,'READ');
 END LOOP;
END $$;

-- The existing owner continues to bind/insert the full assessment in its original
-- root transaction. Extend just its required-preview condition, fail on drift.
DO $extend_source_command$ DECLARE definition text; needle text:='jsonb_array_length(assessment->''closing'')>0)'; BEGIN
 definition:=pg_get_functiondef('governance_catalog.command_raw(text,jsonb)'::regprocedure);
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'SOURCE_COMMAND_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,needle,'jsonb_array_length(assessment->''closing'')>0 OR jsonb_array_length(assessment->''contractOpening'')>0 OR jsonb_array_length(assessment->''contractClosing'')>0)');
 EXECUTE definition;
END $extend_source_command$;

CREATE FUNCTION governance_catalog.contract_impact_context(p_contract uuid,p_version uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE case_row governance_catalog.contract_impact_event; bad tsmultirange; closings jsonb:='[]'; content jsonb;
BEGIN
 IF p_action NOT IN ('PUBLISH','RETIRE') THEN RAISE EXCEPTION 'INVALID_IMPACT_ACTION'; END IF;
 IF p_action='RETIRE' THEN bad:='{}'::tsmultirange;
 ELSE SELECT tsmultirange(tsrange(valid_from,valid_to,'[)'))-governance_catalog.contract_supported_spans(id,timezone('Asia/Shanghai',clock_timestamp())) INTO bad FROM governance_catalog.import_contract_version WHERE id=p_version AND contract_id=p_contract; END IF;
 FOR case_row IN SELECT e.* FROM governance_catalog.contract_impact_event e WHERE e.contract_id=p_contract AND e.event_sequence=1 AND NOT EXISTS(SELECT 1 FROM governance_catalog.contract_impact_event c WHERE c.case_id=e.case_id AND c.event_sequence=2) ORDER BY e.case_id LOOP
  IF isempty(bad*case_row.obligation_spans) THEN closings:=closings||jsonb_build_array(jsonb_build_object('caseId',case_row.case_id,'contractId',case_row.contract_id,'contractVersionId',case_row.contract_version,'obligationSpans',case_row.obligation_spans::text)); END IF;
 END LOOP;
 content:=jsonb_build_object('contractId',p_contract,'contractVersionId',p_version,'action',p_action,'closing',closings);
 RETURN content||jsonb_build_object('impactDigest',encode(sha256(convert_to(content::text,'UTF8')),'hex'));
END $$;
CREATE FUNCTION governance_catalog.contract_change_impact(p_actor text,p_scope text,p_contract uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE selected_version uuid; context jsonb; entry jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT version_id INTO selected_version FROM governance_catalog.import_contract_event WHERE contract_id=p_contract AND (p_action='PUBLISH' OR status IN ('PUBLISHED','RETIRED')) ORDER BY head DESC LIMIT 1;
 PERFORM governance_catalog.contract_require_access(p_actor,p_scope,selected_version,'READ');
 context:=governance_catalog.contract_impact_context(p_contract,selected_version,p_action);
 FOR entry IN SELECT value FROM jsonb_array_elements(context->'closing') LOOP PERFORM governance_catalog.contract_require_access(p_actor,p_scope,(entry->>'contractVersionId')::uuid,'READ'); END LOOP;
 RETURN context||jsonb_build_object('head',(SELECT max(head)::text FROM governance_catalog.import_contract_event WHERE contract_id=p_contract));
END $$;

CREATE FUNCTION governance_catalog.record_contract_source_impact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE assessment governance_catalog.source_assessment; entry jsonb; opened governance_catalog.contract_impact_event;
BEGIN
 SELECT * INTO assessment FROM governance_catalog.source_assessment WHERE event_head=NEW.head;
 IF NOT FOUND THEN RETURN NULL; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(assessment.content->'contractOpening','[]')) LOOP
  INSERT INTO governance_catalog.contract_impact_event(event_sequence,upstream_object,upstream_event,assessment_head,contract_id,contract_version,obligation_spans,evidence)
  VALUES(1,NEW.object_id,NEW.head,NEW.head,(entry->>'contractId')::uuid,(entry->>'contractVersionId')::uuid,(entry->>'obligationSpans')::tsmultirange,entry);
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(assessment.content->'contractClosing','[]')) LOOP
  SELECT * INTO STRICT opened FROM governance_catalog.contract_impact_event WHERE case_id=(entry->>'caseId')::uuid AND event_sequence=1;
  INSERT INTO governance_catalog.contract_impact_event(case_id,event_sequence,upstream_object,upstream_event,assessment_head,contract_id,contract_version,obligation_spans,resolution_source_event,evidence)
  VALUES(opened.case_id,2,opened.upstream_object,opened.upstream_event,opened.assessment_head,opened.contract_id,opened.contract_version,opened.obligation_spans,NEW.head,entry||jsonb_build_object('resolutionAssessment',NEW.head));
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER contract_source_impact AFTER INSERT ON governance_catalog.event FOR EACH ROW EXECUTE FUNCTION governance_catalog.record_contract_source_impact();
CREATE FUNCTION governance_catalog.record_contract_impact_closure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE entry jsonb; opened governance_catalog.contract_impact_event;
BEGIN
 IF NEW.status NOT IN ('PUBLISHED','RETIRED') THEN RETURN NULL; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(NEW.approval_context->'closing','[]')) LOOP
  SELECT * INTO STRICT opened FROM governance_catalog.contract_impact_event WHERE case_id=(entry->>'caseId')::uuid AND event_sequence=1 AND contract_id=NEW.contract_id;
  INSERT INTO governance_catalog.contract_impact_event(case_id,event_sequence,upstream_object,upstream_event,assessment_head,contract_id,contract_version,obligation_spans,resolution_contract_event,evidence)
  VALUES(opened.case_id,2,opened.upstream_object,opened.upstream_event,opened.assessment_head,opened.contract_id,opened.contract_version,opened.obligation_spans,NEW.head,entry||jsonb_build_object('resolutionVersionId',NEW.version_id,'resolutionStatus',NEW.status));
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER contract_impact_closure AFTER INSERT ON governance_catalog.import_contract_event FOR EACH ROW EXECUTE FUNCTION governance_catalog.record_contract_impact_closure();
CREATE FUNCTION governance_catalog.contract_impact_cases(p_actor text,p_scope text,p_contract uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE entry governance_catalog.contract_impact_event; current_version uuid; result jsonb:='[]';
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 SELECT version_id INTO current_version FROM governance_catalog.import_contract_event WHERE contract_id=p_contract ORDER BY (status IN ('PUBLISHED','RETIRED')) DESC,head DESC LIMIT 1;
 PERFORM governance_catalog.contract_require_access(p_actor,p_scope,current_version,'READ');
 FOR entry IN SELECT * FROM governance_catalog.contract_impact_event WHERE contract_id=p_contract ORDER BY recorded_at,case_id,event_sequence LOOP
  PERFORM governance_catalog.contract_require_access(p_actor,p_scope,entry.contract_version,'READ');
  result:=result||jsonb_build_array(jsonb_build_object('caseId',entry.case_id,'eventSequence',entry.event_sequence,'contractId',entry.contract_id,'contractVersionId',entry.contract_version,'upstreamObject',entry.upstream_object,'upstreamEvent',entry.upstream_event::text,'assessmentHead',entry.assessment_head::text,'obligationSpans',entry.obligation_spans::text,'resolutionContractEvent',entry.resolution_contract_event::text,'resolutionSourceEvent',entry.resolution_source_event::text,'evidence',entry.evidence,'recordedAt',to_char(entry.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.contract_source_versions(uuid),governance_catalog.contract_depends_on(uuid,uuid),governance_catalog.contract_supported_spans(uuid,timestamp,uuid,uuid,boolean),governance_catalog.source_proposed_impact_sources(uuid,text),governance_catalog.source_proposed_impact(uuid,text),vnext_control.require_assessment_access_sources(text,text,jsonb),vnext_control.require_assessment_access(text,text,jsonb),governance_catalog.contract_impact_context(uuid,uuid,text),governance_catalog.record_contract_source_impact(),governance_catalog.record_contract_impact_closure(),governance_catalog.contract_change_impact(text,text,uuid,text),governance_catalog.contract_impact_cases(text,text,uuid) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.contract_change_impact(text,text,uuid,text),governance_catalog.contract_impact_cases(text,text,uuid) TO hdi_prototype;

ALTER FUNCTION governance_catalog.impact_cases(text,text,uuid) RENAME TO impact_cases_sources;
CREATE FUNCTION governance_catalog.impact_cases(p_actor text,p_scope text,p_target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE result jsonb; opened governance_catalog.contract_impact_event; closed governance_catalog.contract_impact_event;
BEGIN
 result:=governance_catalog.impact_cases_sources(p_actor,p_scope,p_target);
 FOR opened IN SELECT * FROM governance_catalog.contract_impact_event WHERE upstream_object=p_target AND event_sequence=1 ORDER BY recorded_at,case_id LOOP
  PERFORM governance_catalog.contract_require_access(p_actor,p_scope,opened.contract_version,'READ');
  SELECT * INTO closed FROM governance_catalog.contract_impact_event WHERE case_id=opened.case_id AND event_sequence=2;
  result:=result||jsonb_build_array(jsonb_build_object('case_id',opened.case_id,'consumerKind','IMPORT_CONTRACT','status',CASE WHEN closed.case_id IS NULL THEN 'OPEN' ELSE 'CLOSED' END,'reason','SOURCE_DEPENDENCY_CHANGED','contractId',opened.contract_id,'contractVersionId',opened.contract_version,'obligationSpans',opened.obligation_spans::text,'assessmentHead',opened.assessment_head::text,'upstreamEvent',opened.upstream_event::text,'resolutionContractEvent',closed.resolution_contract_event::text,'resolutionSourceEvent',closed.resolution_source_event::text));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.impact_cases_sources(text,text,uuid),governance_catalog.impact_cases(text,text,uuid) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.impact_cases(text,text,uuid) TO hdi_prototype;
