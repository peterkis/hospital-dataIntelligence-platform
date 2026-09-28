SELECT pg_advisory_xact_lock(901002);
ALTER TABLE organization_master.campus_event DROP CONSTRAINT campus_event_action_check;
ALTER TABLE organization_master.campus_event ADD CONSTRAINT campus_event_action_check CHECK(action IN ('CREATE','REVISE','SCHEDULE_OPENING','CANCEL_OPENING','ACTIVATE','SUSPEND','RESUME','RETIRE','RECORD_DISPOSITION','COMPLETE_DISPOSITION'));
ALTER TABLE organization_master.campus_operation DROP CONSTRAINT campus_operation_state_check;
ALTER TABLE organization_master.campus_operation ADD CONSTRAINT campus_operation_state_check CHECK(state IN ('PLANNING','TRIAL_RUNNING','RUNNING','SUSPENDED','RETIRED'));
-- Safe references/status only. Authored plans, reasons and evidence remain encrypted inputs.
ALTER TABLE organization_master.campus_event ADD COLUMN lifecycle jsonb;

CREATE FUNCTION organization_master.campus_impact(p_actor text,p_id uuid,p_from timestamp,p_to timestamp,p_as_of timestamp DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb;o organization_master.operating_object;items jsonb:='[]';head text;active boolean;outstanding boolean;r timestamp:=coalesce(p_as_of,timezone('Asia/Shanghai',clock_timestamp()));
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF p_from IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
 s:=organization_master.campus_snapshot(p_actor,p_id);
 SELECT max(e.number)::text INTO head FROM organization_master.campus_event e WHERE campus_id=p_id AND recorded_at<=r;
 IF head IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 FOR o IN SELECT obj.* FROM organization_master.operating_object obj WHERE campus_id=p_id AND EXISTS(SELECT 1 FROM organization_master.operating_version v WHERE v.object_id=obj.id AND v.recorded_at<=r) ORDER BY id LOOP
  PERFORM organization_master.operating_authorize(p_actor,o.subject_id,o.campus_id,'READ');
  WITH spans AS (
   SELECT unnest(tsmultirange(tsrange(v.valid_from,v.valid_to,'[)'))-coalesce((SELECT range_agg(tsrange(n.valid_from,n.valid_to,'[)')) FROM organization_master.operating_version n WHERE n.object_id=o.id AND n.number>v.number AND n.recorded_at<=r),'{}'::tsmultirange)) AS period
   FROM organization_master.operating_version v WHERE v.object_id=o.id AND v.recorded_at<=r AND v.facts IS NOT NULL
  ) SELECT coalesce(bool_or(period && tsrange(p_from,p_to,'[)')),false),
    coalesce(bool_or(CASE WHEN p_to IS NOT NULL AND p_to<=r THEN false ELSE period && tsrange(greatest(p_from,r),p_to,'[)') END),false)
   INTO active,outstanding FROM spans;
  items:=items||jsonb_build_array(jsonb_build_object('owner',o.kind,'id',o.id,'version',(SELECT max(number)::text FROM organization_master.operating_version WHERE object_id=o.id AND recorded_at<=r),'active',active,'outstanding',outstanding));
 END LOOP;
 RETURN jsonb_build_object('campusId',p_id,'campusHead',head,'validFrom',to_char(p_from,'YYYY-MM-DD"T"HH24:MI:SS.US'),'validTo',to_char(p_to,'YYYY-MM-DD"T"HH24:MI:SS.US'),'dependencies',items,
 'unavailable',jsonb_build_array('BUSINESS_UNIT','LOCATION','ASSIGNMENT','CONSUMPTION'),
 'dispositions',coalesce((SELECT jsonb_agg(jsonb_build_object('eventId',id,'inputId',input_id,'owner',lifecycle->'resolution'->>'owner','status',lifecycle->'resolution'->>'status','dependencyDigest',lifecycle->>'dependencyDigest') ORDER BY number) FROM organization_master.campus_event WHERE campus_id=p_id AND action='RECORD_DISPOSITION' AND recorded_at<=r),'[]'),
 'completed',EXISTS(SELECT 1 FROM organization_master.campus_event WHERE campus_id=p_id AND action='COMPLETE_DISPOSITION' AND recorded_at<=r));
END $$;

-- Used by the existing Owner and the signed SQL write authority under the same lock.
CREATE FUNCTION organization_master.campus_admission(p_actor text,p_id uuid,p_from timestamp,p_to timestamp) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);s:=organization_master.campus_snapshot(p_actor,p_id);
 IF EXISTS(SELECT 1 FROM organization_master.campus_event WHERE campus_id=p_id AND action='RETIRE' AND (valid_from<=timezone('Asia/Shanghai',clock_timestamp()) OR tsrange(valid_from,valid_to,'[)') && tsrange(p_from,p_to,'[)'))) THEN RAISE EXCEPTION 'CAMPUS_RETIRED';END IF;
 IF EXISTS(SELECT 1 FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=p_id AND o.state='SUSPENDED' AND
  (tsmultirange(tsrange(e.valid_from,e.valid_to,'[)'))-coalesce((SELECT range_agg(tsrange(n.valid_from,n.valid_to,'[)')) FROM organization_master.campus_event n JOIN organization_master.campus_operation no2 ON no2.event_id=n.id WHERE n.campus_id=p_id AND n.number>e.number),'{}'::tsmultirange)) && tsrange(p_from,p_to,'[)')) THEN RAISE EXCEPTION 'CAMPUS_SUSPENDED';END IF;
END $$;
REVOKE ALL ON FUNCTION organization_master.campus_impact(text,uuid,timestamp,timestamp,timestamp),organization_master.campus_admission(text,uuid,timestamp,timestamp) FROM PUBLIC,hdi_prototype;

DO $extend$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('organization_master.campus_write_approved(text,text)'::regprocedure);
 needle:=$n$ IF action='RESUME' AND NOT ($n$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_RETIREMENT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$n$ IF EXISTS(SELECT 1 FROM organization_master.campus_event ce WHERE ce.campus_id=s AND ce.action='RETIRE' AND NOT (p_command->>'action'='SUSPEND' AND (p_command->>'validFrom')::timestamp<ce.valid_from AND timezone('Asia/Shanghai',clock_timestamp())<ce.valid_from) AND (p_command->>'action'='RETIRE' OR ce.valid_from<=timezone('Asia/Shanghai',clock_timestamp()) OR tsrange(ce.valid_from,ce.valid_to,'[)') && tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)'))) AND action NOT IN ('RECORD_DISPOSITION','COMPLETE_DISPOSITION','CANCEL_OPENING') THEN RAISE EXCEPTION 'CAMPUS_RETIRED';END IF;
 IF action IN ('RETIRE','RECORD_DISPOSITION','COMPLETE_DISPOSITION') THEN
  IF p_command->>'validTo' IS NOT NULL OR ticket->'lifecycle'->'report' IS DISTINCT FROM organization_master.campus_impact(p_actor,s,(p_command->>'validFrom')::timestamp,NULL,NULL) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  IF action<>'RETIRE' AND NOT EXISTS(SELECT 1 FROM organization_master.campus_event ce WHERE ce.campus_id=s AND ce.action='RETIRE' AND valid_from=(p_command->>'validFrom')::timestamp) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
  IF action='COMPLETE_DISPOSITION' AND (EXISTS(SELECT 1 FROM jsonb_array_elements(ticket->'lifecycle'->'report'->'dependencies') item WHERE (item->>'outstanding')::boolean) OR
   EXISTS(SELECT 1 FROM unnest(ARRAY['BUSINESS_UNIT','LOCATION','ASSIGNMENT','CONSUMPTION']) owner WHERE
    (SELECT lifecycle->'resolution'->>'status' FROM organization_master.campus_event ce WHERE ce.campus_id=s AND ce.action='RECORD_DISPOSITION' AND lifecycle->'resolution'->>'owner'=owner AND lifecycle->>'dependencyDigest'=ticket->'lifecycle'->>'dependencyDigest' ORDER BY number DESC LIMIT 1) IS DISTINCT FROM 'CLEAR')) THEN RAISE EXCEPTION 'DISPOSITION_INCOMPLETE';END IF;
 END IF;
 IF action='RESUME' AND NOT ($n$);
 body:=replace(body,$n$IF action='SUSPEND' AND p_command->>'validTo'$n$,$n$IF action IN ('SUSPEND','RETIRE') AND p_command->>'validTo'$n$);
 body:=replace(body,$n$campus_event(campus_id,number,action,valid_from,valid_to,input_id) VALUES(s,n,action,(p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,r.id)$n$,$n$campus_event(campus_id,number,action,valid_from,valid_to,input_id,lifecycle) VALUES(s,n,action,(p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,r.id,ticket->'lifecycle')$n$);
 body:=replace(body,$n$('CREATE','ACTIVATE','SUSPEND','RESUME')$n$,$n$('CREATE','ACTIVATE','SUSPEND','RESUME','RETIRE')$n$);
 body:=replace(body,$n$WHEN 'SUSPEND' THEN 'SUSPENDED' ELSE$n$,$n$WHEN 'SUSPEND' THEN 'SUSPENDED' WHEN 'RETIRE' THEN 'RETIRED' ELSE$n$);
 EXECUTE body;
 body:=pg_get_functiondef('organization_master.operating_write(text,text)'::regprocedure);
 needle:=$n$ kind:=r->>'kind';$n$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'OPERATING_LIFECYCLE_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,$n$ IF c->>'action' NOT IN ('CLOSE','REVOKE_SCOPE') THEN PERFORM organization_master.campus_admission(ticket->>'actor',(r->>'campusId')::uuid,(c->>'validFrom')::timestamp,(c->>'validTo')::timestamp);END IF;
 kind:=r->>'kind';$n$);
END $extend$;

DO $workspace$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('organization_master.workspace_object_context(text,text,uuid)'::regprocedure);
 IF position($n$op.state='SUSPENDED'$n$ IN body)=0 THEN RAISE EXCEPTION 'WORKSPACE_LIFECYCLE_BASELINE_MISMATCH';END IF;
 body:=replace(body,$n$op.state='SUSPENDED'$n$,$n$op.state='RETIRED' AND e.valid_from<=timezone('Asia/Shanghai',clock_timestamp())$n$);
 body:=replace(body,$n$'canActivate',p_kind='CAMPUS' AND can_write AND NOT terminal$n$,$n$'canActivate',p_kind='CAMPUS' AND can_write AND NOT terminal AND NOT EXISTS(SELECT 1 FROM organization_master.campus_event ce WHERE ce.campus_id=node_id AND ce.action='SUSPEND')$n$);
 EXECUTE body;
END $workspace$;

-- A campus-only reader must not obtain saved cross-Owner impact metadata.
DO $snapshot$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('organization_master.campus_snapshot(text,uuid)'::regprocedure);
 IF position('to_jsonb(e)||jsonb_build_object' IN body)=0 THEN RAISE EXCEPTION 'CAMPUS_SNAPSHOT_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,'to_jsonb(e)||jsonb_build_object',$body$(to_jsonb(e)-'lifecycle')||jsonb_build_object$body$);
END $snapshot$;
