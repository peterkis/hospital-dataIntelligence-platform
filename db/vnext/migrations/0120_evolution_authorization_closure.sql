SELECT pg_advisory_xact_lock(901002);

-- The signer must not be able to persist a raw event that references a source
-- the current maker cannot read. Missing predecessors remain stageable so a
-- malformed complete input can still be retained and corrected without
-- disclosing any source facts.
CREATE FUNCTION department_master.evolution_stage_references_authorize(p_actor text,p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;source uuid;BEGIN
 IF jsonb_typeof(p_input->'successors') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_input->'predecessors') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 PERFORM department_master.evolution_source_authorize(p_actor,(p_input->>'sourceSystemId')::uuid);
 FOR item IN SELECT value FROM jsonb_array_elements(p_input->'successors') LOOP
  IF jsonb_typeof(item->'row') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  PERFORM department_master.evolution_source_authorize(p_actor,(item->'row'->>'source_system_id')::uuid);
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_input->'predecessors') LOOP
  FOR source IN SELECT DISTINCT (v.facts->>'sourceSystemId')::uuid
   FROM department_master.version v WHERE v.department_id=(item->>'id')::uuid
  LOOP PERFORM department_master.evolution_source_authorize(p_actor,source);END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION department_master.evolution_stage_references_authorize(text,jsonb) FROM PUBLIC,hdi_prototype;
-- Preserve the installed 0118 bytes and add the source closure at the HMAC
-- authority seam, not only in TypeScript.
DO $repair$
DECLARE body text;patched text;BEGIN
 body:=pg_get_functiondef('department_master.evolution_mutate(text,text)'::regprocedure);
 patched:=regexp_replace(body,'PERFORM[[:space:]]+vnext_control\.require_source_access\([^;]*sourceSystemId[^;]*\);','PERFORM department_master.evolution_stage_references_authorize(actor,t);');
 IF patched=body THEN RAISE EXCEPTION 'EVOLUTION_STAGE_AUTHORIZATION_BASELINE_MISMATCH';END IF;
 EXECUTE patched;
END $repair$;

-- Every committed read rechecks the original file, all cited materials and the
-- source facts on both sides of each accepted relation. Expiry is intentionally
-- ignored here; current access, not retention TTL, governs historical reads.
CREATE OR REPLACE FUNCTION department_master.evolution_snapshot(p_actor text,p_id uuid,p_campus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e department_master.evolution_event;source uuid;material jsonb;BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ_RESTRICTED');
 SELECT * INTO e FROM department_master.evolution_event WHERE id=p_id AND campus=p_campus;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',e.source_system_id);
 FOR source IN SELECT DISTINCT (v.facts->>'sourceSystemId')::uuid FROM department_master.evolution_relation rel JOIN department_master.version v ON v.id IN (rel.from_version_id,rel.to_version_id) WHERE rel.event_id=e.id LOOP PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',source);END LOOP;
 FOR material IN SELECT value FROM jsonb_array_elements(coalesce(e.facts->'materials','[]'::jsonb)) LOOP PERFORM governance_catalog.registration_evidence_access(p_actor,(material->>'id')::uuid,NULL,p_campus);END LOOP;
 IF jsonb_typeof(e.facts->'sourceArtifact')='object' THEN PERFORM governance_catalog.registration_evidence_access(p_actor,(e.facts->'sourceArtifact'->>'id')::uuid,NULL,p_campus);END IF;
 RETURN to_jsonb(e)||jsonb_build_object('relations',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('fromVersion',f.number::text,'toVersion',t.number::text,'toSourceRow',t.source_row) ORDER BY r.source_row,r.id) FROM department_master.evolution_relation r JOIN department_master.version f ON f.id=r.from_version_id JOIN department_master.version t ON t.id=r.to_version_id WHERE event_id=e.id),'[]'::jsonb));
END $$;
-- Listing is an information disclosure too. Reuse the complete access
-- predicate and omit inaccessible events exactly as the former event-source
-- check did, instead of leaking their identifiers.
CREATE OR REPLACE FUNCTION department_master.evolution_list(p_actor text,p_campus text,p_after uuid,p_limit integer,p_record timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e department_master.evolution_event;result jsonb:='[]';BEGIN
 PERFORM department_master.evolution_authorize(p_actor,p_campus,'READ_RESTRICTED');IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 FOR e IN SELECT * FROM department_master.evolution_event WHERE campus=p_campus AND (p_after IS NULL OR id>p_after) AND (p_record IS NULL OR recorded_at<=p_record) ORDER BY id LOOP
  BEGIN PERFORM department_master.evolution_snapshot(p_actor,e.id,p_campus);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='ACCESS_DENIED' THEN CONTINUE;ELSE RAISE;END IF;END;
  result:=result||jsonb_build_array(e.id);IF jsonb_array_length(result)>=p_limit THEN EXIT;END IF;
 END LOOP;RETURN result;
END $$;
