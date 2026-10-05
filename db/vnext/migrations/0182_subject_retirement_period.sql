SELECT pg_advisory_xact_lock(901002);

-- Closing a permission cannot extend or precede its declared business interval.
-- Keep installed migrations and all historical declarations unchanged.
DO $retirement$ DECLARE body text;needle text:=$old$IF after_at IS NOT NULL OR w->'facts'->'adoption'$old$;BEGIN
 body:=pg_get_functiondef('care_organization.subject_mutate(text,text)'::regprocedure);
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'SUBJECT_RETIREMENT_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,$new$IF after_at IS NOT NULL OR before_at<declaration.valid_from OR (declaration.valid_to IS NOT NULL AND before_at>declaration.valid_to) OR w->'facts'->'adoption'$new$);
END $retirement$;
REVOKE ALL ON FUNCTION care_organization.subject_mutate(text,text) FROM PUBLIC,hdi_prototype;
