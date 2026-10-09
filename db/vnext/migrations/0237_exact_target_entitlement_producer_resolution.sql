SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text;entry record;BEGIN
 FOR entry IN SELECT * FROM (VALUES('capability','unit','record_at'),('subject','target','point')) x(owner,basis_path,time_name) LOOP
  body:=pg_get_functiondef(format('care_organization.%s_mutate(text,text)',entry.owner)::regprocedure);
  needle:='DECLARE t jsonb';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_ENTITLEMENT_RESOLUTION_DECLARATION_BASELINE';END IF;
  body:=replace(body,needle,'DECLARE resolution jsonb;care_input jsonb;resolved_row integer:=0;t jsonb');
  needle:=$old$'recordAt','recordAtProof']);$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_ENTITLEMENT_RESOLUTION_TICKET_BASELINE';END IF;
  body:=replace(body,needle,$new$'recordAt','recordAtProof']||(CASE WHEN t ? 'resolutions' THEN ARRAY['resolutions'] ELSE ARRAY[]::text[] END));$new$);
  needle:=$old$FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP$old$;IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_ENTITLEMENT_RESOLUTION_WRITE_BASELINE';END IF;
  body:=replace(body,needle,format($new$
 IF jsonb_typeof(coalesce(t->'resolutions','[]'::jsonb)) IS DISTINCT FROM 'array' OR (SELECT count(DISTINCT x->>'row') FROM jsonb_array_elements(coalesce(t->'resolutions','[]')) x)<>jsonb_array_length(coalesce(t->'resolutions','[]')) OR jsonb_array_length(coalesce(t->'resolutions','[]'))<>(SELECT count(*) FROM jsonb_array_elements(t->'writes') x WHERE x->'facts'->'dependencies'->'%1$s'->>'kind'='LIFECYCLE_CARE_INPUT') THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
 FOR w IN SELECT value FROM jsonb_array_elements(t->'writes') LOOP
  resolved_row:=resolved_row+1;care_input:=w->'facts'->'dependencies'->'%1$s';
  IF care_input->>'kind'='LIFECYCLE_CARE_INPUT' THEN
   IF care_input->>'owner' IS DISTINCT FROM 'UNIT' OR care_input->>'id' IS DISTINCT FROM %3$s OR care_input->>'campusId' IS DISTINCT FROM %4$s OR care_organization.local_time(care_input->>'validFrom') IS DISTINCT FROM care_organization.local_time(w->>'validFrom') OR (CASE WHEN care_input->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(care_input->>'validTo') END) IS DISTINCT FROM (CASE WHEN w->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(w->>'validTo') END) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
   PERFORM care_organization.lifecycle_care_input_guard(care_input,%2$s);
   SELECT x INTO resolution FROM jsonb_array_elements(t->'resolutions') x WHERE (x->>'row')::integer=resolved_row;
   PERFORM care_organization.closed(resolution,ARRAY['row','basis']);IF resolution IS NULL OR jsonb_typeof(resolution->'basis'->'%1$s') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_PLAN_TOKEN';END IF;
   %5$s
   w:=jsonb_set(w,'{facts,dependencies,%1$s}',resolution->'basis'->'%1$s');
  END IF;
$new$,entry.basis_path,entry.time_name,
 CASE WHEN entry.owner='capability' THEN 'w->''applicability''->''unit''->>''id''' ELSE 'w->''scope''->''target''->>''id''' END,
 CASE WHEN entry.owner='capability' THEN 'w->''applicability''->''campus''->>''id''' ELSE 'w->''scope''->''campus''->>''id''' END,
 CASE WHEN entry.owner='capability' THEN $guard$IF resolution->'basis'->'unit' IS DISTINCT FROM care_organization.capability_admission(actor,w->'applicability',w->'facts'->'rule',care_organization.local_time(w->>'validFrom'),CASE WHEN w->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(w->>'validTo') END,record_at) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;$guard$
 ELSE $guard$IF w->'scope'->'target'->>'type' IS DISTINCT FROM 'UNIT' OR resolution->'basis'->'target' IS DISTINCT FROM care_organization.subject_target_coverage(actor,w->'scope',w->'facts'->'context',care_organization.local_time(w->>'validFrom'),CASE WHEN w->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(w->>'validTo') END,point) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;$guard$ END));EXECUTE body;
 END LOOP;
END $$;
