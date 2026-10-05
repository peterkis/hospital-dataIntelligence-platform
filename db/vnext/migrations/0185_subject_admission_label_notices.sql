SELECT pg_advisory_xact_lock(901002);

-- Return informational differences through a catalog-owned, internal interface.
-- Coverage retains its existing result shape and material admission semantics.
CREATE FUNCTION governance_catalog.subject_code_label_changes(p_actor text,p_pin jsonb,p_from timestamp,p_to timestamp,p_r timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;code jsonb;result jsonb;BEGIN
 PERFORM governance_catalog.subject_code_coverage(p_actor,p_pin,p_from,p_to,p_r);
 item:=governance_catalog.subject_code_read(p_actor,jsonb_build_object('id',p_pin->>'systemId','versionId',p_pin->>'versionId','recordAsOf',to_char(p_r,'YYYY-MM-DD"T"HH24:MI:SS.US')))->0;
 SELECT value INTO code FROM jsonb_array_elements(item->'codes') WHERE value->>'code'=p_pin->>'code';
 WITH known AS(SELECT v.* FROM governance_catalog.subject_code_version v JOIN governance_catalog.subject_code_approval a ON a.version_id=v.id WHERE v.system_id=(p_pin->>'systemId')::uuid AND v.recorded_at<=p_r AND a.recorded_at<=p_r),
 points AS(SELECT p_from b UNION SELECT p_to WHERE p_to IS NOT NULL UNION SELECT governance_catalog.contract_time(metadata->>'validFrom') FROM known WHERE governance_catalog.contract_time(metadata->>'validFrom')>p_from AND (p_to IS NULL OR governance_catalog.contract_time(metadata->>'validFrom')<p_to) UNION SELECT governance_catalog.contract_time(metadata->>'validTo') FROM known WHERE metadata->>'validTo' IS NOT NULL AND governance_catalog.contract_time(metadata->>'validTo')>p_from AND (p_to IS NULL OR governance_catalog.contract_time(metadata->>'validTo')<p_to)),
 pieces AS(SELECT b,lead(b) OVER(ORDER BY b) e FROM points),
 winners AS(SELECT chosen.id,p.b,p.e FROM pieces p JOIN LATERAL(SELECT k.* FROM known k WHERE governance_catalog.contract_time(k.metadata->>'validFrom')<=p.b ORDER BY governance_catalog.contract_time(k.metadata->>'validFrom') DESC,k.number DESC LIMIT 1) chosen ON true
 WHERE (p_to IS NULL OR p.b<p_to) AND (SELECT value->>'name' FROM jsonb_array_elements(chosen.metadata->'codes') WHERE value->>'code'=p_pin->>'code') IS DISTINCT FROM code->>'name'),
 spans AS(SELECT id,min(b) b,CASE WHEN bool_or(e IS NULL) THEN NULL ELSE max(e) END e FROM winners GROUP BY id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('versionId',id,'from',to_char(b,'YYYY-MM-DD"T"HH24:MI:SS.US'),'to',to_char(e,'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY b),'[]') INTO result FROM spans;
 RETURN result;
END $$;

DO $notices$ DECLARE body text;declaration text:=$old$current_basis jsonb;BEGIN$old$;needle text:=$old$IF w->>'action'='REVISE' THEN INSERT INTO care_organization.subject_review_resolution(case_id,relation_version_id,recorded_at) SELECT x.id,vid,point FROM care_organization.subject_review_case x WHERE x.relation_id=target AND NOT EXISTS(SELECT 1 FROM care_organization.subject_review_resolution y WHERE y.case_id=x.id);END IF;$old$;BEGIN
 body:=pg_get_functiondef('care_organization.subject_mutate(text,text)'::regprocedure);
 IF position(declaration IN body)=0 OR (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'SUBJECT_LABEL_NOTICE_BASELINE_MISMATCH';END IF;
 body:=replace(body,declaration,'current_basis jsonb;label_change jsonb;BEGIN');
 EXECUTE replace(body,needle,needle||$new$
 IF w->>'action'<>'RETIRE' THEN
  FOR label_change IN SELECT value FROM jsonb_array_elements(governance_catalog.subject_code_label_changes(actor,w->'facts'->'adoption',before_at,after_at,point)) LOOP
   INSERT INTO care_organization.subject_review_case(relation_id,accepted_version_id,code_version_id,reason,blocking,valid_from,valid_to,recorded_at) VALUES(target,vid,(label_change->>'versionId')::uuid,'TARGET_LABEL_CHANGED',false,governance_catalog.contract_time(label_change->>'from'),CASE WHEN label_change->>'to' IS NULL THEN NULL ELSE governance_catalog.contract_time(label_change->>'to') END,point) ON CONFLICT DO NOTHING;
  END LOOP;
 END IF;$new$);
END $notices$;
REVOKE ALL ON FUNCTION governance_catalog.subject_code_label_changes(text,jsonb,timestamp,timestamp,timestamp),care_organization.subject_mutate(text,text) FROM PUBLIC,hdi_prototype;
