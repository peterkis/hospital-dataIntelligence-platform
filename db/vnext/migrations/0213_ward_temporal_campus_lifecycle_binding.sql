SELECT pg_advisory_xact_lock(901002);
DO $$ DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_mutate(text,text)'::regprocedure);
 needle:='IF u.campus_id IS DISTINCT FROM (w->''binding''->''campus''->>''id'')::uuid THEN RAISE EXCEPTION ''WARD_CAMPUS_CHANGE_REQUIRES_LIFECYCLE'';END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_CROSS_CAMPUS_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,$new$
 IF w->>'action'='REBIND' AND NOT EXISTS(SELECT 1 FROM care_organization.ward_unit_binding raw JOIN LATERAL (SELECT * FROM care_organization.ward_binding_version bv WHERE bv.binding_id=raw.id ORDER BY number DESC LIMIT 1) bv ON true WHERE raw.unit_id=target AND tsrange(bv.valid_from,bv.valid_to,'[)') @> from_at AND raw.campus_id=(w->'binding'->'campus'->>'id')::uuid) AND NOT care_organization.lifecycle_member_matches(actor,'WARD',(c->>'id')::uuid,r.id,r.revision,r.identity_code,t->>'digest') THEN RAISE EXCEPTION 'WARD_CAMPUS_CHANGE_REQUIRES_LIFECYCLE';END IF;
$new$);EXECUTE body;
 body:=pg_get_functiondef('care_organization.ward_nursing_master_window(text,text,uuid,uuid,timestamp,timestamp,timestamp)'::regprocedure);
 needle:='IF h->>''campusId'' IS DISTINCT FROM p_campus::text THEN RAISE EXCEPTION ''CROSS_CAMPUS_POLICY_REQUIRED'';END IF;';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_NURSING_CAMPUS_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,'');
 body:=pg_get_functiondef('care_organization.unit_ward_admission(text,jsonb,jsonb,timestamp,timestamp,timestamp)'::regprocedure);
 needle:='IF h->>''campusId'' IS DISTINCT FROM p_scope->''campus''->>''id'' THEN RAISE EXCEPTION ''CROSS_CAMPUS_POLICY_REQUIRED'';END IF;';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_UNIT_WARD_CAMPUS_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,'');
 body:=pg_get_functiondef('care_organization.unit_ward_ward_guard(text,jsonb,jsonb,timestamp,timestamp,timestamp)'::regprocedure);
 needle:='p_basis->>''campusId'' IS DISTINCT FROM h->>''campusId''';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_GUARD_CAMPUS_BASELINE_MISMATCH';END IF;EXECUTE replace(body,needle,'p_basis->>''campusId'' IS DISTINCT FROM p_scope->''campus''->>''id''');
END $$;
