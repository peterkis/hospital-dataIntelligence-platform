SELECT pg_advisory_xact_lock(901002);

-- Hospital-wide usage types inherit the protected artifact's immutable campus.
-- This is a metadata authorization port: historical reads and replay do not
-- require retained payload bytes. Byte reads still use registration_evidence.
CREATE FUNCTION governance_catalog.usage_type_evidence_context(
 p_actor text,p_artifact uuid,p_source_version uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE evidence_campus text;source_id uuid;
BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_artifact IS NULL OR p_source_version IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT artifact.campus INTO evidence_campus
 FROM governance_catalog.protected_artifact artifact WHERE artifact.id=p_artifact;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM governance_catalog.registration_evidence_access(
  p_actor,p_artifact,p_source_version,evidence_campus
 );
 SELECT source_version.object_id INTO source_id
 FROM governance_catalog.version source_version WHERE source_version.id=p_source_version;
 IF NOT FOUND OR source_id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 RETURN jsonb_build_object('id',p_artifact,'campus',evidence_campus,
  'purpose','IDENTITY_VERIFY','sourceId',source_id,'sourceVersionId',p_source_version);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.usage_type_evidence_context(text,uuid,uuid) FROM PUBLIC,hdi_prototype;

-- The original read/write bodies differ only at their five evidence-access
-- calls. Identity, source pins, B/R, expected heads, signatures, material
-- digests, request replay, approvals, lifecycle events and audit stay intact.
CREATE OR REPLACE FUNCTION location_master.usage_type_read(p_actor text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r timestamp;b timestamp;result jsonb;entry jsonb;BEGIN
 PERFORM location_master.usage_type_authorize(p_actor,'READ');IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR NOT p_input ? 'id' OR p_input-ARRAY['id','versionId','businessAt','recordAsOf','history']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 r:=CASE WHEN p_input ? 'recordAsOf' THEN governance_catalog.contract_time(p_input->>'recordAsOf') ELSE timezone('Asia/Shanghai',clock_timestamp()) END;
 b:=CASE WHEN p_input ? 'businessAt' THEN governance_catalog.contract_time(p_input->>'businessAt') ELSE r END;
 SELECT coalesce(jsonb_agg(item ORDER BY number),'[]') INTO result FROM(SELECT v.number,v.content||jsonb_build_object('id',u.id,'versionId',v.id,'version',v.number::text,'head',location_master.usage_type_head(u.id,r)::text,'status',CASE WHEN a.version_id IS NOT NULL THEN 'APPROVED' WHEN q.id IS NOT NULL THEN 'REVIEW' ELSE 'DRAFT' END,'enabled',location_master.usage_type_enabled(u.id,b,r),'applicableAtBusinessTime',CASE WHEN p_input ? 'businessAt' THEN tsrange(governance_catalog.contract_time(v.content->>'validFrom'),CASE WHEN v.content->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(v.content->>'validTo') END,'[)') @> b ELSE NULL END,'reviewDigest',v.review_digest,'recordedAt',to_char(v.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'approvedAt',to_char(a.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'verification',CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object('id',q.id,'actor',q.actor,'identity',q.identity_code,'evidenceId',q.evidence_id,'meaningAccepted',q.meaning_accepted,'recordedAt',to_char(q.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) END,'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'sequence',e.sequence::text,'action',e.action,'actor',e.actor,'identity',e.identity_code,'reason',e.reason,'requestId',e.request_id,'recordedAt',to_char(e.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY e.sequence) FROM location_master.usage_type_action e WHERE e.usage_type_id=u.id AND e.action IN ('ENABLE','DISABLE') AND e.recorded_at<=r),'[]')) item
 FROM location_master.usage_type_version v JOIN location_master.usage_type u ON u.id=v.usage_type_id
 LEFT JOIN location_master.usage_type_approval a ON a.version_id=v.id AND a.recorded_at<=r
 LEFT JOIN LATERAL(SELECT q.* FROM location_master.usage_type_verification q WHERE q.version_id=v.id AND q.recorded_at<=r AND (a.version_id IS NULL OR q.id=a.verification_id) ORDER BY q.sequence DESC LIMIT 1) q ON true
 WHERE u.id=(p_input->>'id')::uuid AND v.recorded_at<=r AND (NOT p_input ? 'versionId' OR v.id=(p_input->>'versionId')::uuid) ORDER BY v.number DESC LIMIT CASE WHEN coalesce((p_input->>'history')::boolean,false) THEN 10000 ELSE 1 END) items;
 FOR entry IN SELECT value FROM jsonb_array_elements(result) LOOP PERFORM vnext_control.require_source_access(p_actor,'SYNTHETIC',(entry->>'sourceId')::uuid,(entry->>'sourceVersionId')::uuid);PERFORM governance_catalog.usage_type_evidence_context(p_actor,(entry->>'evidenceId')::uuid,(entry->>'sourceVersionId')::uuid);IF entry->'verification'<>'null'::jsonb THEN PERFORM governance_catalog.usage_type_evidence_context(p_actor,(entry->'verification'->>'evidenceId')::uuid,(entry->>'sourceVersionId')::uuid);END IF;END LOOP;RETURN result;
END $$;

CREATE OR REPLACE FUNCTION location_master.usage_type_command(p_ticket text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb;c jsonb;identity text;d text;prior location_master.usage_type_action;u location_master.usage_type;v location_master.usage_type_version;q location_master.usage_type_verification;response jsonb;keys text[];usage_id uuid;selected_version_id uuid;event_id uuid;next_number bigint;now_at timestamp:=timezone('Asia/Shanghai',clock_timestamp());f timestamp;e timestamp;BEGIN
 t:=location_master.use_attest(p_ticket,p_signature);now_at:=timezone('Asia/Shanghai',clock_timestamp());PERFORM location_master.use_closed(t,ARRAY['actor','transaction','command','materialDigest']);c:=t->'command';IF coalesce(c->>'reason','') !~ '\S' OR length(c->>'reason')>2000 OR t->>'materialDigest' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 identity:=location_master.usage_type_authorize(t->>'actor',CASE c->>'action' WHEN 'VERIFY' THEN 'VERIFY' WHEN 'APPROVE' THEN 'REVIEW' ELSE 'WRITE' END);d:=encode(sha256(convert_to(c::text,'UTF8')),'hex');
 SELECT * INTO prior FROM location_master.usage_type_action WHERE identity_code=identity AND request_id=(c->>'requestId')::uuid;IF FOUND THEN IF prior.digest<>d THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;PERFORM location_master.usage_type_read(t->>'actor',jsonb_build_object('id',prior.usage_type_id,'versionId',prior.result->>'versionId'));RETURN prior.result;END IF;
 IF c->>'action' IN ('CREATE','REVISE') THEN
  keys:=ARRAY['action','requestId','reason','code','name','meaning','description','validFrom','validTo','sourceId','sourceVersionId','evidenceId']||CASE WHEN c->>'action'='REVISE' THEN ARRAY['target','expectedHead'] ELSE ARRAY[]::text[] END;PERFORM location_master.usage_type_command_shape(c,keys);
  IF c->>'code' !~ '^[A-Z][A-Z0-9_]{0,63}$' OR coalesce(c->>'name','') !~ '\S' OR coalesce(c->>'meaning','') !~ '\S' OR length(c->>'name')>2000 OR length(c->>'meaning')>2000 OR (jsonb_typeof(c->'description') NOT IN ('string','null')) OR length(c->>'description')>2000 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  f:=governance_catalog.contract_time(c->>'validFrom');e:=CASE WHEN c->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(c->>'validTo') END;IF e<=f THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
  PERFORM vnext_control.require_source_access(t->>'actor','SYNTHETIC',(c->>'sourceId')::uuid,(c->>'sourceVersionId')::uuid);PERFORM governance_catalog.usage_type_evidence_context(t->>'actor',(c->>'evidenceId')::uuid,(c->>'sourceVersionId')::uuid);
  IF NOT governance_catalog.source_valid_spans((c->>'sourceVersionId')::uuid,now_at) @> tsrange(f,e,'[)') THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;
  IF c->>'action'='CREATE' THEN IF EXISTS(SELECT 1 FROM location_master.usage_type WHERE code=c->>'code') THEN RAISE EXCEPTION 'USAGE_TYPE_CODE_CONFLICT';END IF;INSERT INTO location_master.usage_type(code,meaning) VALUES(c->>'code',c->>'meaning') RETURNING * INTO u;next_number:=1;
  ELSE SELECT * INTO u FROM location_master.usage_type WHERE id=(c->>'target')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;IF location_master.usage_type_head(u.id,now_at)::text IS DISTINCT FROM c->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;IF u.code IS DISTINCT FROM c->>'code' OR u.meaning IS DISTINCT FROM c->>'meaning' THEN RAISE EXCEPTION 'USAGE_TYPE_MEANING_IMMUTABLE';END IF;IF governance_catalog.contract_time(c->>'validFrom') IS DISTINCT FROM (SELECT governance_catalog.contract_time(v0.content->>'validFrom') FROM location_master.usage_type_version v0 WHERE v0.usage_type_id=u.id ORDER BY v0.number LIMIT 1) THEN RAISE EXCEPTION 'USAGE_TYPE_START_IMMUTABLE';END IF;SELECT coalesce(max(v1.number),0)+1 INTO next_number FROM location_master.usage_type_version v1 WHERE usage_type_id=u.id;END IF;
  usage_id:=u.id;INSERT INTO location_master.usage_type_version(usage_type_id,number,content,maker_identity,review_digest,recorded_at) VALUES(usage_id,next_number,c-ARRAY['action','requestId','reason','target','expectedHead'],identity,encode(sha256(convert_to((c-ARRAY['action','requestId','reason'])::text,'UTF8')),'hex'),now_at) RETURNING * INTO v;selected_version_id:=v.id;
 ELSIF c->>'action' IN ('ENABLE','DISABLE') THEN
  PERFORM location_master.usage_type_command_shape(c,ARRAY['action','requestId','reason','target','expectedHead']);SELECT * INTO u FROM location_master.usage_type WHERE id=(c->>'target')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;IF location_master.usage_type_head(u.id,now_at)::text IS DISTINCT FROM c->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD';END IF;
  SELECT v1.* INTO v FROM location_master.usage_type_version v1 JOIN location_master.usage_type_approval a ON a.version_id=v1.id WHERE v1.usage_type_id=u.id ORDER BY v1.number DESC LIMIT 1;IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;PERFORM location_master.usage_type_read(t->>'actor',jsonb_build_object('id',u.id,'versionId',v.id));usage_id:=u.id;selected_version_id:=v.id;
 ELSE
  keys:=ARRAY['action','requestId','reason','target','expectedHead','versionId','reviewDigest']||CASE WHEN c->>'action'='VERIFY' THEN ARRAY['evidenceId','meaningAccepted'] ELSE ARRAY[]::text[] END;PERFORM location_master.usage_type_command_shape(c,keys);IF c->>'action' NOT IN ('VERIFY','APPROVE') THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  SELECT v1.* INTO v FROM location_master.usage_type_version v1 WHERE v1.id=(c->>'versionId')::uuid AND v1.usage_type_id=(c->>'target')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;IF location_master.usage_type_head(v.usage_type_id,now_at)::text IS DISTINCT FROM c->>'expectedHead' OR v.number<>(SELECT max(number) FROM location_master.usage_type_version WHERE usage_type_id=v.usage_type_id) OR v.review_digest IS DISTINCT FROM c->>'reviewDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
  IF identity=v.maker_identity THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED';END IF;PERFORM location_master.usage_type_read(t->>'actor',jsonb_build_object('id',v.usage_type_id,'versionId',v.id));IF EXISTS(SELECT 1 FROM location_master.usage_type_approval WHERE version_id=v.id) THEN RAISE EXCEPTION 'ALREADY_COMMITTED';END IF;usage_id:=v.usage_type_id;selected_version_id:=v.id;
  IF c->>'action'='VERIFY' THEN IF jsonb_typeof(c->'meaningAccepted') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;PERFORM governance_catalog.usage_type_evidence_context(t->>'actor',(c->>'evidenceId')::uuid,(v.content->>'sourceVersionId')::uuid);INSERT INTO location_master.usage_type_verification(version_id,sequence,actor,identity_code,evidence_id,meaning_accepted,material_digest,recorded_at) VALUES(v.id,(SELECT coalesce(max(sequence),0)+1 FROM location_master.usage_type_verification WHERE version_id=v.id),t->>'actor',identity,(c->>'evidenceId')::uuid,(c->>'meaningAccepted')::boolean,t->>'materialDigest',now_at);
  ELSE SELECT * INTO q FROM location_master.usage_type_verification WHERE version_id=v.id ORDER BY sequence DESC LIMIT 1;IF NOT FOUND OR NOT q.meaning_accepted THEN RAISE EXCEPTION 'LEGAL_REVIEW_REQUIRED';END IF;IF q.material_digest IS DISTINCT FROM t->>'materialDigest' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;IF location_master.usage_type_authorize(q.actor,'VERIFY') IS DISTINCT FROM q.identity_code OR q.identity_code=v.maker_identity THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;PERFORM governance_catalog.usage_type_evidence_context(q.actor,q.evidence_id,(v.content->>'sourceVersionId')::uuid);IF NOT governance_catalog.source_valid_spans((v.content->>'sourceVersionId')::uuid,now_at) @> tsrange(governance_catalog.contract_time(v.content->>'validFrom'),CASE WHEN v.content->>'validTo' IS NULL THEN NULL ELSE governance_catalog.contract_time(v.content->>'validTo') END,'[)') THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;INSERT INTO location_master.usage_type_approval VALUES(v.id,q.id,t->>'actor',identity,now_at);END IF;
 END IF;
 -- Insert the event before projection so direct ENABLE/DISABLE returns its new head and state.
 INSERT INTO location_master.usage_type_action(usage_type_id,sequence,actor,identity_code,request_id,action,reason,digest,recorded_at) VALUES(usage_id,(SELECT coalesce(max(sequence),0)+1 FROM location_master.usage_type_action WHERE usage_type_id=usage_id),t->>'actor',identity,(c->>'requestId')::uuid,c->>'action',c->>'reason',d,now_at) RETURNING id INTO event_id;
 response:=location_master.usage_type_read(t->>'actor',jsonb_build_object('id',usage_id,'versionId',selected_version_id))->0;UPDATE location_master.usage_type_action x SET result=response WHERE x.id=event_id;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(t->>'actor',usage_id,'LOCATION_USAGE_TYPE_'||(c->>'action'),'OWNER_PURPOSE_GOVERNANCE',d);RETURN response;
END $$;
REVOKE ALL ON FUNCTION location_master.usage_type_read(text,jsonb),location_master.usage_type_command(text,text) FROM PUBLIC,hdi_prototype;
