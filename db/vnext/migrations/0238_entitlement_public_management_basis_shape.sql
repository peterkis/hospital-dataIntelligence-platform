SELECT pg_advisory_xact_lock(901002);
DO $$DECLARE body text;needle text:='resolution->''basis''->''unit'' IS DISTINCT FROM care_organization.capability_admission';BEGIN
 body:=pg_get_functiondef('care_organization.capability_mutate(text,text)'::regprocedure);
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'P3_11_ENTITLEMENT_PUBLIC_MANAGEMENT_BASIS_BASELINE';END IF;
 EXECUTE replace(body,needle,'((resolution->''basis''->''unit'')-''current'') IS DISTINCT FROM care_organization.capability_admission');
END $$;
