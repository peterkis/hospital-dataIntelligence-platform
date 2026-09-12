-- Event-scoped obligations; installed assessments and historical decisions remain unchanged.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND application_name='hdi-vnext-catalog') THEN RAISE EXCEPTION 'CATALOG_RUNTIME_MUST_BE_STOPPED'; END IF;
END $$;
SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION governance_catalog.impact_obligation(p_case uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE item governance_catalog.impact_event; frozen governance_catalog.source_assessment; entry jsonb; matches bigint; at_r timestamp; before_bad tsmultirange; affected tsmultirange; basis text;
BEGIN
 SELECT * INTO item FROM governance_catalog.impact_event WHERE case_id=p_case AND event_sequence=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_OBLIGATION_EVIDENCE_MISSING'; END IF;
 IF item.assessment_head IS NOT NULL THEN
  SELECT * INTO frozen FROM governance_catalog.source_assessment WHERE event_head=item.assessment_head;
  IF NOT FOUND THEN RAISE EXCEPTION 'IMPACT_OBLIGATION_EVIDENCE_MISSING'; END IF;
  SELECT count(*),(jsonb_agg(value))->0 INTO matches,entry FROM jsonb_array_elements(frozen.content->'opening') WHERE
   (value->>'downstreamObject')::uuid=item.downstream_object AND (value->>'downstreamVersion')::uuid=item.downstream_version AND
   (value->>'upstreamObject')::uuid=item.upstream_object AND value->>'reason'=item.reason AND
   (CASE WHEN value->>'upstreamEvent'='PROPOSED_EVENT' THEN frozen.event_head::text ELSE value->>'upstreamEvent' END)=item.upstream_event::text;
  IF matches<>1 OR entry->>'affectedSpans' IS NULL OR frozen.content->>'asOf' IS NULL THEN RAISE EXCEPTION 'IMPACT_OBLIGATION_EVIDENCE_MISMATCH'; END IF;
  at_r:=(frozen.content->>'asOf')::timestamp;
  affected:=(entry->>'affectedSpans')::tsmultirange;
  IF entry->>'scopeBasis'='EVENT_DELTA_V1' THEN basis:='FROZEN_EVENT_DELTA';
  ELSIF NOT entry ? 'scopeBasis' THEN
   -- 0010 recorded the whole proposed unsupported range. Derive its event delta at its original pre-event R.
   before_bad:=governance_catalog.source_projected_span(item.downstream_version,at_r,NULL,NULL,false)-governance_catalog.source_valid_spans(item.downstream_version,at_r);
   IF before_bad IS NULL THEN RAISE EXCEPTION 'IMPACT_OBLIGATION_EVIDENCE_MISSING'; END IF;
   affected:=affected-before_bad;basis:='DERIVED_LEGACY_ASSESSMENT_DELTA';
  ELSE RAISE EXCEPTION 'IMPACT_OBLIGATION_BASIS_UNSUPPORTED'; END IF;
 ELSE
  -- This is an observed legacy obligation, not proof of approval or attribution to its upstream event.
  at_r:=item.recorded_at;
  affected:=governance_catalog.source_projected_span(item.downstream_version,at_r,NULL,NULL,false)-governance_catalog.source_valid_spans(item.downstream_version,at_r);
  basis:='LEGACY_OBSERVED_UNSUPPORTED';
 END IF;
 IF affected IS NULL THEN RAISE EXCEPTION 'IMPACT_OBLIGATION_EVIDENCE_MISSING'; END IF;
 IF item.assessment_head IS NOT NULL AND isempty(affected) THEN RAISE EXCEPTION 'IMPACT_OBLIGATION_EVIDENCE_MISMATCH'; END IF;
 RETURN jsonb_build_object('affectedSpans',affected::text,'basis',basis,'derivationVersion','1','knowledgeAt',to_char(at_r,'YYYY-MM-DD"T"HH24:MI:SS.US'));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'IMPACT_OBLIGATION_EVIDENCE_INVALID';
END $$;
REVOKE ALL ON FUNCTION governance_catalog.impact_obligation(uuid) FROM PUBLIC,hdi_prototype;

CREATE OR REPLACE FUNCTION governance_catalog.impact_cases(p_actor text,p_scope text,p_target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE result jsonb; entry jsonb; payload jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM vnext_control.require_object(p_actor,p_scope,p_target,'READ','METADATA');
 result:=governance_catalog.impact_cases_raw(p_actor,p_scope,p_target);
 FOR entry IN SELECT value FROM jsonb_array_elements(result) LOOP
  SELECT v.payload INTO payload FROM governance_catalog.version v WHERE id=(entry->>'downstream_version')::uuid;
  PERFORM vnext_control.require_object(p_actor,p_scope,(entry->>'downstream_object')::uuid,'READ','METADATA',payload);
  PERFORM vnext_control.require_source_access(p_actor,p_scope,(entry->>'downstream_object')::uuid,(entry->>'downstream_version')::uuid);
  SELECT v.payload INTO payload FROM governance_catalog.event e JOIN governance_catalog.version v ON v.id=e.version_id WHERE e.head=(entry->>'upstream_event')::bigint;
  PERFORM vnext_control.require_object(p_actor,p_scope,(entry->>'upstream_object')::uuid,'READ','METADATA',payload);
 END LOOP;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION governance_catalog.source_proposed_impact(p_target uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE at_r timestamp; maintenance governance_catalog.event; accepted governance_catalog.event; preview uuid; base jsonb; ref jsonb; ver governance_catalog.version; before_span tsmultirange; after_span tsmultirange; before_bad tsmultirange; after_bad tsmultirange; opening jsonb:='[]'; closing jsonb:='[]'; definitions jsonb:='[]'; item governance_catalog.impact_event; parent_event bigint; chosen uuid; definition_digest text; obligation jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('PUBLISH','RETIRE') THEN RAISE EXCEPTION 'INVALID_IMPACT_ACTION'; END IF;
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=p_target AND kind='SOURCE') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 -- A stable knowledge watermark, not wall-clock time: unchanged facts yield the same reviewed digest.
 SELECT greatest((SELECT max(recorded_at) FROM governance_catalog.event),(SELECT max(recorded_at) FROM governance_catalog.impact_event)) INTO at_r;
 SELECT * INTO maintenance FROM governance_catalog.event WHERE object_id=p_target ORDER BY head DESC LIMIT 1;
 SELECT * INTO accepted FROM governance_catalog.event WHERE object_id=p_target AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1;
 preview:=CASE WHEN p_action='PUBLISH' THEN maintenance.version_id ELSE NULL END;
 chosen:=CASE WHEN p_action='PUBLISH' THEN maintenance.version_id ELSE accepted.version_id END;
 SELECT encode(sha256(convert_to(jsonb_build_object('payload',v.payload,'validFrom',v.valid_from,'validTo',v.valid_to)::text,'UTF8')),'hex') INTO definition_digest FROM governance_catalog.version v WHERE v.id=chosen;
 base:=governance_catalog.source_impact(p_target);
 FOR ref IN SELECT value FROM jsonb_array_elements(base->'current') LOOP
  before_span:=governance_catalog.source_projected_span((ref->>'versionId')::uuid,at_r,NULL,NULL,false);
  before_bad:=before_span-governance_catalog.source_valid_spans((ref->>'versionId')::uuid,at_r);
  after_span:=governance_catalog.source_projected_span((ref->>'versionId')::uuid,at_r,p_target,preview,p_action='RETIRE');
  after_bad:=after_span-governance_catalog.source_projected_valid_spans((ref->>'versionId')::uuid,at_r,p_target,preview,p_action='RETIRE');
  IF NOT isempty(after_bad-before_bad) THEN opening:=opening||jsonb_build_array(jsonb_build_object('upstreamObject',p_target,'upstreamEvent','PROPOSED_EVENT','downstreamObject',ref->>'id','downstreamVersion',ref->>'versionId','effectiveSpans',after_span::text,'affectedSpans',(after_bad-before_bad)::text,'scopeBasis','EVENT_DELTA_V1','reason',CASE WHEN p_action='RETIRE' THEN 'UPSTREAM_SOURCE_RETIRED' ELSE 'UPSTREAM_SOURCE_REPUBLISHED' END)); END IF;
 END LOOP;
 FOR ver IN SELECT * FROM governance_catalog.version WHERE object_id=p_target ORDER BY number LOOP
  before_span:=governance_catalog.source_projected_span(ver.id,at_r,NULL,NULL,false);
  after_span:=governance_catalog.source_projected_span(ver.id,at_r,p_target,preview,p_action='RETIRE');
  IF NOT isempty(before_span) OR NOT isempty(after_span) OR ver.id=maintenance.version_id THEN
   definitions:=definitions||jsonb_build_array(jsonb_build_object('id',p_target,'versionId',ver.id,'beforeSpans',before_span::text,'proposedSpans',after_span::text,'digest',encode(sha256(convert_to(jsonb_build_object('payload',ver.payload,'validFrom',ver.valid_from,'validTo',ver.valid_to)::text,'UTF8')),'hex')));
  END IF;
  before_bad:=before_span-governance_catalog.source_valid_spans(ver.id,at_r);
  after_bad:=after_span-governance_catalog.source_projected_valid_spans(ver.id,at_r,p_target,preview,p_action='RETIRE');
  IF NOT isempty(after_bad-before_bad) AND ver.payload->>'sourceEvidence'<>'SYNTHETIC_BOOTSTRAP' THEN
   SELECT head INTO STRICT parent_event FROM governance_catalog.event WHERE object_id=(ver.payload->>'sourceEvidence')::uuid AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1;
   opening:=opening||jsonb_build_array(jsonb_build_object('upstreamObject',ver.payload->>'sourceEvidence','upstreamEvent',parent_event::text,'downstreamObject',p_target,'downstreamVersion',ver.id,'effectiveSpans',after_span::text,'affectedSpans',(after_bad-before_bad)::text,'scopeBasis','EVENT_DELTA_V1','reason','SOURCE_REVISION_EXPOSED_PIN'));
  END IF;
 END LOOP;
 FOR item IN SELECT i.* FROM governance_catalog.impact_event i WHERE i.downstream_object=p_target AND i.event_sequence=1 AND NOT EXISTS(SELECT 1 FROM governance_catalog.impact_event c WHERE c.case_id=i.case_id AND c.event_sequence=2) ORDER BY i.case_id LOOP
  after_span:=governance_catalog.source_projected_span(item.downstream_version,at_r,p_target,preview,p_action='RETIRE');
  after_bad:=after_span-governance_catalog.source_projected_valid_spans(item.downstream_version,at_r,p_target,preview,p_action='RETIRE');
  obligation:=governance_catalog.impact_obligation(item.case_id);
  IF isempty(after_bad*(obligation->>'affectedSpans')::tsmultirange) THEN closing:=closing||jsonb_build_array(jsonb_build_object('caseId',item.case_id,'upstreamObject',item.upstream_object,'upstreamEvent',item.upstream_event::text,'downstreamObject',item.downstream_object,'downstreamVersion',item.downstream_version,'obligation',obligation)); END IF;
 END LOOP;
 RETURN base||jsonb_build_object('action',p_action,'asOf',to_char(at_r,'YYYY-MM-DD"T"HH24:MI:SS.US'),'catalogHead',(SELECT max(head)::text FROM governance_catalog.event),'candidateVersionId',maintenance.version_id,'definitionVersionId',chosen,'definitionDigest',definition_digest,'targetDefinitions',definitions,'opening',opening,'closing',closing);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.source_proposed_impact(uuid,text) FROM PUBLIC,hdi_prototype;

CREATE OR REPLACE FUNCTION governance_catalog.impact_cases_raw(actor text, requested_scope text, target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE result jsonb;
BEGIN
 PERFORM vnext_control.authorize(actor,requested_scope,'READ');
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.object WHERE id=target AND scope=requested_scope AND kind='SOURCE') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('obligation',governance_catalog.impact_obligation(i.case_id),'assessment_head',i.assessment_head::text,'upstream_event',i.upstream_event::text,'resolution_event',i.resolution_event::text,'events',(SELECT jsonb_agg(to_jsonb(h)||jsonb_build_object('assessment_head',h.assessment_head::text,'upstream_event',h.upstream_event::text,'resolution_event',h.resolution_event::text) ORDER BY h.event_sequence) FROM governance_catalog.impact_event h WHERE h.case_id=i.case_id)) ORDER BY i.case_id),'[]'::jsonb) INTO result FROM (SELECT DISTINCT ON(case_id) * FROM governance_catalog.impact_event WHERE upstream_object=target ORDER BY case_id,event_sequence DESC) i;
 RETURN result;
END $$;


CREATE OR REPLACE FUNCTION vnext_control.require_assessment_access(p_actor text,p_scope text,p_assessment jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vnext_control,governance_catalog AS $$
DECLARE ref jsonb; payload jsonb;
BEGIN
 PERFORM vnext_control.require_object(p_actor,p_scope,(p_assessment->>'target')::uuid,'READ','METADATA');
 FOR ref IN SELECT value FROM jsonb_array_elements((p_assessment->'history')||(p_assessment->'current')||(p_assessment->'targetDefinitions')) LOOP
  SELECT v.payload INTO payload FROM governance_catalog.version v WHERE id=(ref->>'versionId')::uuid;
  PERFORM vnext_control.require_object(p_actor,p_scope,(ref->>'id')::uuid,'READ','METADATA',payload);
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements((p_assessment->'opening')||(p_assessment->'closing')) LOOP
  SELECT v.payload INTO payload FROM governance_catalog.version v WHERE id=(ref->>'downstreamVersion')::uuid;
  PERFORM vnext_control.require_object(p_actor,p_scope,(ref->>'downstreamObject')::uuid,'READ','METADATA',payload);
  PERFORM vnext_control.require_source_access(p_actor,p_scope,(ref->>'downstreamObject')::uuid,(ref->>'downstreamVersion')::uuid);
  IF ref->>'upstreamEvent'='PROPOSED_EVENT' THEN
   SELECT v.payload INTO payload FROM governance_catalog.version v WHERE id=(p_assessment->>'definitionVersionId')::uuid AND object_id=(ref->>'upstreamObject')::uuid;
  ELSE
   SELECT v.payload INTO payload FROM governance_catalog.event e JOIN governance_catalog.version v ON v.id=e.version_id WHERE e.head=(ref->>'upstreamEvent')::bigint AND e.object_id=(ref->>'upstreamObject')::uuid;
  END IF;
  IF payload IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM vnext_control.require_object(p_actor,p_scope,(ref->>'upstreamObject')::uuid,'READ','METADATA',payload);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION vnext_control.require_assessment_access(text,text,jsonb) FROM PUBLIC,hdi_prototype;
