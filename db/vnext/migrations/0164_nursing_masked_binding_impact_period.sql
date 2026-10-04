SELECT pg_advisory_xact_lock(901002);

-- A suspension can precede an already recorded future binding. Retain its
-- accepted evidence, but expose an empty historical current interval rather
-- than a reversed range. Unbounded active bindings keep an unbounded end.
DO $repair$
DECLARE body text;period text;current_flag text;
BEGIN
 body:=pg_get_functiondef('care_organization.nursing_department_references(text,jsonb,text)'::regprocedure);
 period:='to_char(least((last_binding->>''validTo'')::timestamp,ending),''YYYY-MM-DD"T"HH24:MI:SS.US'')';
 current_flag:='''current'',true';
 IF position(period IN body)=0 OR position(current_flag IN body)=0 THEN RAISE EXCEPTION 'NURSING_MASKED_IMPACT_PREDECESSOR_MISMATCH';END IF;
 body:=replace(body,period,'to_char(CASE WHEN least((last_binding->>''validTo'')::timestamp,ending) IS NULL THEN NULL ELSE greatest((last_binding->>''validFrom'')::timestamp,least((last_binding->>''validTo'')::timestamp,ending)) END,''YYYY-MM-DD"T"HH24:MI:SS.US'')');
 body:=replace(body,current_flag,'''current'',coalesce(least((last_binding->>''validTo'')::timestamp,ending)>(last_binding->>''validFrom'')::timestamp,true)');
 EXECUTE body;
END $repair$;
