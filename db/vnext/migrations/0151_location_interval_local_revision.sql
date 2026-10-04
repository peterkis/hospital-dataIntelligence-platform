SELECT pg_advisory_xact_lock(901002);
-- REVISE keeps every applicable containment segment in its business window.
-- The latest stream head remains the concurrency token, not a global parent.
DO $repair$
DECLARE body text;needle text:='parent IS DISTINCT FROM previous.parent_id OR ';BEGIN
 body:=pg_get_functiondef('location_master.mutate(text,text)'::regprocedure);
 IF position(needle IN body)=0 OR length(body)-length(replace(body,needle,''))<>length(needle) THEN RAISE EXCEPTION 'LOCATION_REVISION_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'');EXECUTE body;
END $repair$;
