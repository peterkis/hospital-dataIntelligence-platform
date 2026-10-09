SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.unit_ward_mutate(text,text)'::regprocedure);
 needle:='DECLARE t jsonb';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_WARD_RESOLUTION_DECLARATION_BASELINE';END IF;
 body:=replace(body,needle,'DECLARE resolution jsonb;care_input jsonb;t jsonb');
 needle:=$old$'digest','recordAt','recordAtProof']);$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_WARD_RESOLUTION_TICKET_BASELINE';END IF;
 body:=replace(body,needle,$new$'digest','recordAt','recordAtProof']||(CASE WHEN t ? 'resolutions' THEN ARRAY['resolutions'] ELSE ARRAY[]::text[] END));$new$);
 needle:=$old$FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_WARD_RESOLUTION_WRITE_BASELINE';END IF;
 body:=replace(body,needle,$new$
 IF jsonb_typeof(coalesce(t->'resolutions','[]'::jsonb)) IS DISTINCT FROM 'array' OR (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(coalesce(t->'resolutions','[]')) x)<>jsonb_array_length(coalesce(t->'resolutions','[]')) OR jsonb_array_length(coalesce(t->'resolutions','[]'))<>(SELECT count(*) FROM jsonb_array_elements(t->'writes') x WHERE jsonb_path_exists(x,'$.facts.dependencies.upstream.** ? (@.kind == "LIFECYCLE_CARE_INPUT")')) THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  IF jsonb_path_exists(w,'$.facts.dependencies.upstream.** ? (@.kind == "LIFECYCLE_CARE_INPUT")') THEN
   FOR care_input IN SELECT jsonb_path_query(w,'$.facts.dependencies.upstream.** ? (@.kind == "LIFECYCLE_CARE_INPUT")') LOOP
    IF care_input->>'campusId' IS DISTINCT FROM w->'applicability'->'campus'->>'id' OR care_input->>'owner' NOT IN ('WARD','UNIT') THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
    PERFORM care_organization.lifecycle_care_input_guard(care_input,record_at);
   END LOOP;
   SELECT x INTO resolution FROM jsonb_array_elements(t->'resolutions') x WHERE x->>'key'=w->>'key';PERFORM care_organization.unit_ward_closed(resolution,ARRAY['key','basis']);IF resolution IS NULL OR jsonb_typeof(resolution->'basis') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
   w:=jsonb_set(w,'{facts,dependencies,upstream}',resolution->'basis');
  END IF;
$new$);EXECUTE body;
END $$;
