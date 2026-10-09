SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_mutate(text,text)'::regprocedure);
 needle:='DECLARE t jsonb:=';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_RESOLUTION_DECLARATION_BASELINE';END IF;body:=replace(body,needle,'DECLARE resolution jsonb;t jsonb:=');
 needle:=$old$'digest','recordAt','recordAtProof']);$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_RESOLUTION_TICKET_BASELINE';END IF;body:=replace(body,needle,$new$'digest','recordAt','recordAtProof','resolutions']);$new$);
 needle:=$old$FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_RESOLUTION_COUNT_BASELINE';END IF;
 body:=replace(body,needle,$new$
 IF jsonb_typeof(coalesce(t->'resolutions','[]'::jsonb)) IS DISTINCT FROM 'array' OR (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(coalesce(t->'resolutions','[]')) x)<>jsonb_array_length(coalesce(t->'resolutions','[]')) OR jsonb_array_length(coalesce(t->'resolutions','[]'))<>(SELECT count(*) FROM jsonb_array_elements(t->'writes') x CROSS JOIN LATERAL jsonb_array_elements(x->'bindingChanges') b WHERE b->'dependencies'->>'kind'='LIFECYCLE_CARE_INPUT') THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP$new$);
 needle:=$old$FOR bc IN SELECT value FROM jsonb_array_elements(w->'bindingChanges') LOOP$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_RESOLUTION_BINDING_BASELINE';END IF;
 body:=replace(body,needle,$new$i:=-1;
 FOR bc IN SELECT value FROM jsonb_array_elements(w->'bindingChanges') LOOP
  i:=i+1;
  IF bc->'dependencies'->>'kind'='LIFECYCLE_CARE_INPUT' THEN
   IF bc->'dependencies'->>'owner' IS DISTINCT FROM 'UNIT' OR bc->'dependencies'->>'id' IS DISTINCT FROM bc->'binding'->'unit'->>'id' OR bc->'dependencies'->>'campusId' IS DISTINCT FROM bc->'binding'->'campus'->>'id' OR care_organization.local_time(bc->'dependencies'->>'validFrom') IS DISTINCT FROM care_organization.local_time(bc->>'validFrom') OR (bc->'dependencies'->>'validTo') IS DISTINCT FROM bc->>'validTo' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
   PERFORM care_organization.lifecycle_care_input_guard(bc->'dependencies',record_at);
   SELECT x INTO resolution FROM jsonb_array_elements(t->'resolutions') x WHERE x->>'key'=w->>'key'||'/'||i::text;
   PERFORM care_organization.ward_closed(resolution,ARRAY['key','basis']);IF resolution IS NULL OR jsonb_typeof(resolution->'basis') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
   IF (resolution->'basis')-'current' IS DISTINCT FROM care_organization.ward_admission(actor,bc->'binding',care_organization.local_time(bc->>'validFrom'),CASE WHEN bc->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(bc->>'validTo') END,record_at) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
   PERFORM care_organization.unit_ward_operating_guard(actor,resolution->'basis'->'current',care_organization.local_time(bc->>'validFrom'),CASE WHEN bc->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(bc->>'validTo') END,record_at);
   PERFORM care_organization.unit_ward_operating_guard(approved_by,resolution->'basis'->'current',care_organization.local_time(bc->>'validFrom'),CASE WHEN bc->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(bc->>'validTo') END,record_at);
   PERFORM care_organization.unit_ward_operating_guard(verify.actor,resolution->'basis'->'current',care_organization.local_time(bc->>'validFrom'),CASE WHEN bc->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(bc->>'validTo') END,record_at);
   bc:=jsonb_set(bc,'{dependencies}',resolution->'basis');
  END IF;
$new$);EXECUTE body;
END $$;
