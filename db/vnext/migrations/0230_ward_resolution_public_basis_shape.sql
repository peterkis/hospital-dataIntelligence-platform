SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('care_organization.ward_mutate(text,text)'::regprocedure);
 needle:=$old$(resolution->'basis')-'current' IS DISTINCT FROM care_organization.ward_admission(actor,bc->'binding',care_organization.local_time(bc->>'validFrom'),CASE WHEN bc->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(bc->>'validTo') END,record_at)$old$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_WARD_PUBLIC_BASIS_SHAPE_BASELINE';END IF;
 EXECUTE replace(body,needle,$new$(resolution->'basis')-'current' IS DISTINCT FROM care_organization.ward_management_coverage(actor,(bc->'binding'->'unit'->>'id')::uuid,(bc->'binding'->'campus'->>'id')::uuid,care_organization.local_time(bc->>'validFrom'),CASE WHEN bc->>'validTo' IS NULL THEN NULL ELSE care_organization.local_time(bc->>'validTo') END,record_at)$new$);
END $$;
