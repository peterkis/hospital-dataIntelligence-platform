SELECT pg_advisory_xact_lock(901002);
DO $bounded$
DECLARE body text;needle text;
BEGIN
 body:=pg_get_functiondef('department_master.evolution_mutate(text,text)'::regprocedure);
 needle:='IF EXISTS(SELECT 1 FROM department_master.replacement WHERE department_id=prior.department_id) THEN RAISE EXCEPTION ''UNSUPPORTED_STATE_TRANSITION'';END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'FUTURE_REPLACEMENT_PREDECESSOR_MISMATCH';END IF;
 body:=replace(body,needle,'IF EXISTS(SELECT 1 FROM department_master.replacement WHERE department_id=prior.department_id AND (event->>''change_type''<>''RENAME'' OR effective_at<=at)) THEN RAISE EXCEPTION ''UNSUPPORTED_STATE_TRANSITION'';END IF;');
 needle:='VALUES(prior.department_id,n,at,prior.valid_to,knowledge,e.id,';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'BOUNDED_RENAME_PREDECESSOR_MISMATCH';END IF;
 EXECUTE replace(body,needle,'VALUES(prior.department_id,n,at,least(prior.valid_to,(SELECT effective_at FROM department_master.replacement WHERE department_id=prior.department_id),(SELECT min(effective_at) FROM department_master.lifecycle_version WHERE department_id=prior.department_id AND action=''DEPRECATE'')),knowledge,e.id,');
END $bounded$;
