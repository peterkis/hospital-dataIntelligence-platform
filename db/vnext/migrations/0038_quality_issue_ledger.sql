-- P0-06 quality issue ledger. The source issue is immutable; dispositions are
-- append-only events. No quarantined payload is copied into this ledger.
SELECT pg_advisory_xact_lock(901002);

ALTER TABLE governance_catalog.import_job DROP CONSTRAINT IF EXISTS import_job_status_check;
ALTER TABLE governance_catalog.import_job ADD CONSTRAINT import_job_status_check CHECK(status IN ('WAITING_INPUT','REJECTED'));
ALTER TABLE governance_catalog.import_job ADD COLUMN quality_disposition_sequence bigint NOT NULL DEFAULT 0 CHECK(quality_disposition_sequence>=0);
ALTER TABLE governance_catalog.import_job ADD COLUMN quality_issue_sequence bigint NOT NULL DEFAULT 0 CHECK(quality_issue_sequence>=0);
ALTER TABLE governance_catalog.validation_run ADD CONSTRAINT validation_run_job_revision_unique UNIQUE(id,job_id,revision_id);
ALTER TABLE governance_catalog.validation_run ADD COLUMN quality_candidate_digest text CHECK(quality_candidate_digest IS NULL OR quality_candidate_digest ~ '^[a-f0-9]{64}$');
ALTER TABLE governance_catalog.validation_run ADD COLUMN quality_eligibility_digest text CHECK(quality_eligibility_digest IS NULL OR quality_eligibility_digest ~ '^[a-f0-9]{64}$');

CREATE TABLE governance_catalog.quality_issue (
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),
 issue_sequence bigint NOT NULL CHECK(issue_sequence>0),
 revision_id uuid NOT NULL,
 run_id uuid NOT NULL,
 dataset_code text NOT NULL CHECK(dataset_code ~ '^[A-Z0-9_]{2,64}$'),
 campus text NOT NULL CHECK(campus IN ('NORTH','SOUTH')),
 purpose text NOT NULL CHECK(purpose IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED')),
 source_format text NOT NULL CHECK(source_format IN ('CSV','JSON','XLSX')),
 sheet_name text,
 source_kind text NOT NULL CHECK(source_kind IN ('RULE','LAYER')),
 source_status text NOT NULL CHECK(source_status IN ('FAIL','UNKNOWN','NOT_EVALUATED','NOT_RUN')),
 classification text NOT NULL CHECK(classification IN ('ERROR','REVIEW','BLOCKED_DEPENDENCY')),
 layer smallint NOT NULL CHECK(layer BETWEEN 0 AND 10),
 rule_code text NOT NULL CHECK(rule_code ~ '^[A-Z0-9_.-]{1,64}$'),
 requirement_id text NOT NULL DEFAULT '' CHECK(requirement_id=' ' OR requirement_id='' OR requirement_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
 row_number integer NOT NULL CHECK(row_number BETWEEN 0 AND 1000),
 field_code text NOT NULL DEFAULT '' CHECK(field_code='' OR field_code ~ '^[A-Za-z0-9_.-]{1,128}$'),
 owner_ref text NOT NULL DEFAULT '' CHECK(length(owner_ref)<=128),
 related_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(related_refs)='array' AND jsonb_array_length(related_refs)<=16),
 bounded_code text NOT NULL CHECK(bounded_code ~ '^[A-Z0-9_]{1,64}$'),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(run_id,source_kind,rule_code,requirement_id,row_number,field_code,bounded_code),
 UNIQUE(job_id,issue_sequence),
 UNIQUE(id,job_id),
 FOREIGN KEY(job_id,revision_id) REFERENCES governance_catalog.import_input_revision(job_id,id),
 FOREIGN KEY(run_id,job_id,revision_id) REFERENCES governance_catalog.validation_run(id,job_id,revision_id),
 CHECK((source_format='XLSX' AND sheet_name='Data') OR (source_format IN ('CSV','JSON') AND sheet_name IS NULL))
);

CREATE TABLE governance_catalog.issue_disposition (
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 job_id uuid NOT NULL REFERENCES governance_catalog.import_job(id),
 issue_id uuid,
 disposition_no bigint NOT NULL CHECK(disposition_no>0),
 kind text NOT NULL CHECK(kind IN ('ASSIGN','CORRECTION_PROPOSED','RESOLVED','BATCH_REJECTED')),
 actor_identity text NOT NULL,
 request_id uuid NOT NULL,
 reason text NOT NULL CHECK(reason ~ '^[A-Z0-9_]{1,64}$'),
 owner_ref text NOT NULL DEFAULT '' CHECK(length(owner_ref)<=128),
 target_run_id uuid,
 target_revision_id uuid,
 target_row integer CHECK(target_row IS NULL OR target_row BETWEEN 1 AND 1000),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload)='object' AND length(payload::text)<=16384),
 recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),
 UNIQUE(job_id,disposition_no),
 UNIQUE(job_id,request_id),
 FOREIGN KEY(issue_id,job_id) REFERENCES governance_catalog.quality_issue(id,job_id),
 FOREIGN KEY(target_run_id,job_id,target_revision_id) REFERENCES governance_catalog.validation_run(id,job_id,revision_id),
 CHECK((kind IN ('ASSIGN','CORRECTION_PROPOSED','RESOLVED'))= (issue_id IS NOT NULL)),
 CHECK((kind IN ('CORRECTION_PROPOSED','RESOLVED'))= (target_run_id IS NOT NULL OR kind='CORRECTION_PROPOSED'))
);

CREATE INDEX quality_issue_job_recorded ON governance_catalog.quality_issue(job_id,recorded_at,id);
CREATE INDEX quality_issue_run ON governance_catalog.quality_issue(run_id);
CREATE INDEX issue_disposition_issue ON governance_catalog.issue_disposition(issue_id,disposition_no);

CREATE TRIGGER quality_issue_immutable BEFORE UPDATE OR DELETE ON governance_catalog.quality_issue FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
CREATE TRIGGER issue_disposition_immutable BEFORE UPDATE OR DELETE ON governance_catalog.issue_disposition FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
REVOKE ALL ON governance_catalog.quality_issue,governance_catalog.issue_disposition FROM PUBLIC,hdi_prototype;
ALTER TABLE governance_catalog.quality_issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_catalog.issue_disposition ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON governance_catalog.quality_issue,governance_catalog.issue_disposition TO hdi_prototype;

CREATE FUNCTION governance_catalog.quality_candidate_frame(p_campus text,p_purpose text,p_candidates jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT 'A2['||length(p_campus)::text||':'||p_campus||length(p_purpose)::text||':'||p_purpose||']'||coalesce((SELECT string_agg('A11['||length(coalesce(item.c->>'sourceKind',''))::text||':'||coalesce(item.c->>'sourceKind','')||length(coalesce(item.c->>'sourceStatus',''))::text||':'||coalesce(item.c->>'sourceStatus','')||length(coalesce(item.c->>'classification',''))::text||':'||coalesce(item.c->>'classification','')||length(coalesce(item.c->>'layer',''))::text||':'||coalesce(item.c->>'layer','')||length(coalesce(item.c->>'rule',''))::text||':'||coalesce(item.c->>'rule','')||length(coalesce(item.c->>'requirementId',''))::text||':'||coalesce(item.c->>'requirementId','')||length(coalesce(item.c->>'row',''))::text||':'||coalesce(item.c->>'row','')||length(coalesce(item.c->>'field',''))::text||':'||coalesce(item.c->>'field','')||length(coalesce(item.c->>'ownerRef',''))::text||':'||coalesce(item.c->>'ownerRef','')||'A'||jsonb_array_length(coalesce(item.c->'relatedRefs','[]'::jsonb))::text||'['||coalesce((SELECT string_agg(length(x#>>'{}')::text||':'||(x#>>'{}'),'') FROM jsonb_array_elements(coalesce(item.c->'relatedRefs','[]'::jsonb)) x),'')||']'||length(coalesce(item.c->>'boundedCode',''))::text||':'||coalesce(item.c->>'boundedCode','')||']','' ORDER BY item.ordinal) FROM jsonb_array_elements(p_candidates) WITH ORDINALITY AS item(c,ordinal)),'');
$$;
CREATE FUNCTION governance_catalog.quality_candidate_digest(p_campus text,p_purpose text,p_candidates jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(governance_catalog.quality_candidate_frame(p_campus,p_purpose,p_candidates),'UTF8')),'hex');
$$;
CREATE FUNCTION governance_catalog.quality_eligibility_digest(p_campus text,p_purpose text,p_candidates jsonb,p_not_run jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(governance_catalog.quality_candidate_frame(p_campus,p_purpose,p_candidates)||'A'||jsonb_array_length(p_not_run)::text||'['||coalesce((SELECT string_agg(length(item.x#>>'{}')::text||':'||(item.x#>>'{}'),'') FROM jsonb_array_elements(p_not_run) WITH ORDINALITY AS item(x,ordinal)),'')||']','UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION governance_catalog.quality_candidate_frame(text,text,jsonb),governance_catalog.quality_candidate_digest(text,text,jsonb),governance_catalog.quality_eligibility_digest(text,text,jsonb,jsonb) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.quality_issue_ingest(p_actor text,p_input jsonb,p_candidates jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; req uuid; requested_digest text; existing vnext_control.outcome;
 j governance_catalog.import_job; r governance_catalog.validation_run; rev governance_catalog.import_input_revision;
 candidate jsonb; issue_id uuid; result jsonb; ids jsonb:='[]'::jsonb; inserted_count integer:=0; replayed_count integer:=0; next_issue_no bigint; candidate_digest text;
 v_source_kind text; v_source_status text; v_classification text; v_dataset_code text; v_source_format text; v_sheet_name text;
 v_rule_code text; v_requirement_id text; layer_no integer; row_no integer; v_field_code text; v_owner_ref text; refs jsonb; v_bounded_code text;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','reason','runId')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 IF p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'requestId' !~ '^[a-f0-9-]{36}$' OR p_input->>'runId' !~ '^[a-f0-9-]{36}$' OR p_input->>'reason' !~ '^[A-Z0-9_]{1,64}$' OR jsonb_typeof(p_candidates) IS DISTINCT FROM 'array' OR jsonb_array_length(p_candidates)>10000 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE'); PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 PERFORM pg_advisory_xact_lock(901002);
 req:=(p_input->>'requestId')::uuid;
 requested_digest:=encode(sha256(convert_to(jsonb_build_object('operation','QUALITY_ISSUE_OPEN','input',p_input,'candidates',p_candidates)::text,'UTF8')),'hex');
 SELECT o.* INTO existing FROM vnext_control.request_identity i JOIN vnext_control.outcome o ON o.actor_code=i.original_actor_code AND o.request_id=i.request_id WHERE i.identity_code=identity AND i.request_id=req;
 IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN existing.result; END IF;
 SELECT vr.* INTO r FROM governance_catalog.validation_run vr WHERE vr.id=(p_input->>'runId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF NOT EXISTS(SELECT 1 FROM governance_catalog.protected_artifact a JOIN governance_catalog.protected_payload p ON p.artifact_id=a.id WHERE a.id=r.result_artifact_id AND a.campus=p_input->>'campus' AND a.purpose=p_input->>'purpose' AND a.expires_at>timezone('Asia/Shanghai',clock_timestamp())) THEN RAISE EXCEPTION 'VALIDATION_EVIDENCE_UNAVAILABLE'; END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=r.job_id AND scope='SYNTHETIC' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 SELECT * INTO rev FROM governance_catalog.import_input_revision WHERE job_id=j.id AND id=r.revision_id;
 IF NOT FOUND OR rev.metadata->>'kind' IS DISTINCT FROM 'FILE' THEN RAISE EXCEPTION 'FILE_REVISION_REQUIRED'; END IF;
 v_dataset_code:=j.contract_snapshot->>'dataset'; v_source_format:=rev.metadata->>'format'; v_sheet_name:=CASE WHEN v_source_format='XLSX' THEN 'Data' ELSE NULL END;
 FOR candidate IN SELECT value FROM jsonb_array_elements(p_candidates) LOOP
  IF jsonb_typeof(candidate) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(candidate) k WHERE k NOT IN ('sourceKind','sourceStatus','classification','layer','rule','requirementId','row','field','ownerRef','relatedRefs','boundedCode')) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  v_source_kind:=candidate->>'sourceKind'; v_source_status:=candidate->>'sourceStatus'; v_classification:=candidate->>'classification'; v_rule_code:=candidate->>'rule'; v_requirement_id:=coalesce(candidate->>'requirementId',''); v_field_code:=coalesce(candidate->>'field',''); v_owner_ref:=coalesce(candidate->>'ownerRef',''); refs:=coalesce(candidate->'relatedRefs','[]'::jsonb); v_bounded_code:=candidate->>'boundedCode';
  IF v_source_kind NOT IN ('RULE','LAYER') OR v_source_status NOT IN ('FAIL','UNKNOWN','NOT_EVALUATED','NOT_RUN') OR v_classification NOT IN ('ERROR','REVIEW','BLOCKED_DEPENDENCY') OR v_rule_code !~ '^[A-Z0-9_.-]{1,64}$' OR v_requirement_id<>'' AND v_requirement_id !~ '^[A-Za-z0-9_.:-]{1,128}$' OR v_field_code<>'' AND v_field_code !~ '^[A-Za-z0-9_.-]{1,128}$' OR length(v_owner_ref)>128 OR v_bounded_code !~ '^[A-Z0-9_]{1,64}$' OR jsonb_typeof(refs) IS DISTINCT FROM 'array' OR jsonb_array_length(refs)>16 OR candidate->>'row' !~ '^(0|[1-9][0-9]{0,3})$' OR candidate->>'layer' !~ '^(0|[1-9]|10)$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  IF v_source_status='NOT_RUN' OR v_classification='ERROR' AND v_source_status<>'FAIL' THEN RAISE EXCEPTION 'QUALITY_CANDIDATE_INVALID'; END IF;
  row_no:=(candidate->>'row')::integer; layer_no:=(candidate->>'layer')::integer;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(refs) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string' OR length(x#>>'{}')>256) THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
  UPDATE governance_catalog.import_job SET quality_issue_sequence=quality_issue_sequence+1 WHERE id=j.id RETURNING quality_issue_sequence INTO next_issue_no;
  INSERT INTO governance_catalog.quality_issue(job_id,issue_sequence,revision_id,run_id,dataset_code,campus,purpose,source_format,sheet_name,source_kind,source_status,classification,layer,rule_code,requirement_id,row_number,field_code,owner_ref,related_refs,bounded_code)
  VALUES(j.id,next_issue_no,r.revision_id,r.id,v_dataset_code,p_input->>'campus',p_input->>'purpose',v_source_format,v_sheet_name,v_source_kind,v_source_status,v_classification,layer_no,v_rule_code,v_requirement_id,row_no,v_field_code,v_owner_ref,refs,v_bounded_code)
  ON CONFLICT(run_id,source_kind,rule_code,requirement_id,row_number,field_code,bounded_code) DO NOTHING
  RETURNING id INTO issue_id;
  IF FOUND THEN inserted_count:=inserted_count+1; ELSE replayed_count:=replayed_count+1; SELECT q.id INTO issue_id FROM governance_catalog.quality_issue q WHERE q.run_id=r.id AND q.source_kind=v_source_kind AND q.rule_code=v_rule_code AND q.requirement_id=v_requirement_id AND q.row_number=row_no AND q.field_code=v_field_code AND q.bounded_code=v_bounded_code; END IF;
  ids:=ids||to_jsonb(issue_id);
 END LOOP;
 candidate_digest:=governance_catalog.quality_candidate_digest(p_input->>'campus',p_input->>'purpose',p_candidates);
 IF r.quality_candidate_digest IS NULL OR r.quality_candidate_digest<>candidate_digest THEN RAISE EXCEPTION 'VALIDATION_PROVENANCE_REQUIRED'; END IF;
 result:=jsonb_build_object('jobId',j.id,'runId',r.id,'issueIds',ids,'inserted',inserted_count,'replayed',replayed_count,'total',inserted_count+replayed_count);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'QUALITY_ISSUES_OPEN',p_input->>'reason',requested_digest);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,req,requested_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,p_actor);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_issue_ingest(text,jsonb,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_issue_ingest(text,jsonb,jsonb) TO hdi_prototype;

CREATE FUNCTION governance_catalog.quality_issue_read(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE j governance_catalog.import_job; result jsonb; total_count integer; page_size integer; page_offset integer;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','jobId','pageSize','offset')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'jobId' !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 page_size:=coalesce((p_input->>'pageSize')::integer,50); page_offset:=coalesce((p_input->>'offset')::integer,0);
 IF page_size NOT BETWEEN 1 AND 100 OR page_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',p_input->>'jobId'));
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=(p_input->>'jobId')::uuid;
 IF EXISTS(SELECT 1 FROM governance_catalog.quality_issue i WHERE i.job_id=j.id AND (i.campus<>p_input->>'campus' OR i.purpose<>p_input->>'purpose')) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT count(*)::integer INTO total_count FROM governance_catalog.quality_issue WHERE job_id=j.id;
 SELECT coalesce(jsonb_agg(item ORDER BY (item->>'sequence')::bigint),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('id',i.id,'sequence',i.issue_sequence,'jobId',i.job_id,'revisionId',i.revision_id,'runId',i.run_id,'dataset',i.dataset_code,'campus',i.campus,'purpose',i.purpose,'format',i.source_format,'sheet',i.sheet_name,'sourceKind',i.source_kind,'sourceStatus',i.source_status,'classification',i.classification,'layer',i.layer,'rule',i.rule_code,'requirementId',nullif(i.requirement_id,''),'row',i.row_number,'field',nullif(i.field_code,''),'ownerRef',nullif(i.owner_ref,''),'relatedRefs',i.related_refs,'boundedCode',i.bounded_code,'status',CASE WHEN EXISTS(SELECT 1 FROM governance_catalog.issue_disposition d WHERE d.issue_id=i.id AND d.kind='RESOLVED') THEN 'RESOLVED' ELSE 'OPEN' END,'recordedAt',to_char(i.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) AS item
  FROM governance_catalog.quality_issue i WHERE i.job_id=j.id ORDER BY i.issue_sequence OFFSET page_offset LIMIT page_size
 ) page;
 RETURN jsonb_build_object('jobId',j.id,'jobStatus',j.status,'items',result,'total',total_count,'pageSize',page_size,'offset',page_offset);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_issue_read(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_issue_read(text,jsonb) TO hdi_prototype;

CREATE FUNCTION governance_catalog.quality_issue_detail(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE i governance_catalog.quality_issue; j governance_catalog.import_job; issue jsonb; history jsonb; evidence_available boolean;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','issueId')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'issueId' !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 SELECT * INTO i FROM governance_catalog.quality_issue WHERE id=(p_input->>'issueId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF i.campus<>p_input->>'campus' OR i.purpose<>p_input->>'purpose' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',i.job_id));
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=i.job_id;
 issue:=jsonb_build_object('id',i.id,'sequence',i.issue_sequence,'jobId',i.job_id,'revisionId',i.revision_id,'runId',i.run_id,'dataset',i.dataset_code,'campus',i.campus,'purpose',i.purpose,'format',i.source_format,'sheet',i.sheet_name,'sourceKind',i.source_kind,'sourceStatus',i.source_status,'classification',i.classification,'layer',i.layer,'rule',i.rule_code,'requirementId',nullif(i.requirement_id,''),'row',i.row_number,'field',nullif(i.field_code,''),'ownerRef',nullif(i.owner_ref,''),'relatedRefs',i.related_refs,'boundedCode',i.bounded_code,'status',CASE WHEN EXISTS(SELECT 1 FROM governance_catalog.issue_disposition d WHERE d.issue_id=i.id AND d.kind='RESOLVED') THEN 'RESOLVED' ELSE 'OPEN' END,'recordedAt',to_char(i.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'));
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'head',d.disposition_no,'kind',d.kind,'ownerRef',nullif(d.owner_ref,''),'targetRunId',d.target_run_id,'targetRevisionId',d.target_revision_id,'targetRow',d.target_row,'reason',d.reason,'payload',d.payload,'recordedAt',to_char(d.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')) ORDER BY d.disposition_no),'[]'::jsonb) INTO history FROM governance_catalog.issue_disposition d WHERE d.issue_id=i.id;
 SELECT EXISTS(SELECT 1 FROM governance_catalog.validation_run vr JOIN governance_catalog.protected_artifact a ON a.id=vr.result_artifact_id JOIN governance_catalog.protected_payload p ON p.artifact_id=a.id WHERE vr.id=i.run_id AND a.expires_at>timezone('Asia/Shanghai',clock_timestamp())) INTO evidence_available;
 RETURN jsonb_build_object('issue',issue,'jobStatus',j.status,'history',history,'evidenceAvailable',evidence_available,'evidenceStatus',CASE WHEN evidence_available THEN 'AVAILABLE' ELSE 'NOT_RECOVERABLE' END);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_issue_detail(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_issue_detail(text,jsonb) TO hdi_prototype;

CREATE FUNCTION governance_catalog.quality_issue_assign(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; req uuid; requested_digest text; existing vnext_control.outcome; j governance_catalog.import_job; i governance_catalog.quality_issue;
 responsibility governance_catalog.object; responsibility_event governance_catalog.event; responsibility_version governance_catalog.version;
 next_no bigint; event_id uuid; result jsonb; owner_ref text;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','reason','issueId','expectedHead','responsibilityId')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'requestId' !~ '^[a-f0-9-]{36}$' OR p_input->>'issueId' !~ '^[a-f0-9-]{36}$' OR p_input->>'responsibilityId' !~ '^[a-f0-9-]{36}$' OR p_input->>'expectedHead' !~ '^(0|[1-9][0-9]*)$' OR p_input->>'reason' !~ '^[A-Z0-9_]{1,64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE'); PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 PERFORM pg_advisory_xact_lock(901002);
 req:=(p_input->>'requestId')::uuid; requested_digest:=encode(sha256(convert_to(jsonb_build_object('operation','QUALITY_ISSUE_ASSIGN','input',p_input)::text,'UTF8')),'hex');
 SELECT o.* INTO existing FROM vnext_control.request_identity ri JOIN vnext_control.outcome o ON o.actor_code=ri.original_actor_code AND o.request_id=ri.request_id WHERE ri.identity_code=identity AND ri.request_id=req;
 IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN existing.result; END IF;
 SELECT * INTO i FROM governance_catalog.quality_issue WHERE id=(p_input->>'issueId')::uuid FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF i.campus<>p_input->>'campus' OR i.purpose<>p_input->>'purpose' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=i.job_id AND scope='SYNTHETIC' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 IF j.quality_disposition_sequence::text<>p_input->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD'; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.issue_disposition d WHERE d.issue_id=i.id AND d.kind='RESOLVED') THEN RAISE EXCEPTION 'ISSUE_ALREADY_RESOLVED'; END IF;
 SELECT o.* INTO responsibility FROM governance_catalog.object o WHERE o.id=(p_input->>'responsibilityId')::uuid AND o.scope='SYNTHETIC' AND o.kind='RESPONSIBILITY';
 IF NOT FOUND THEN RAISE EXCEPTION 'RESPONSIBILITY_NOT_READY'; END IF;
 SELECT e.* INTO responsibility_event FROM governance_catalog.event e WHERE e.object_id=responsibility.id ORDER BY e.head DESC LIMIT 1;
 SELECT v.* INTO responsibility_version FROM governance_catalog.version v WHERE v.id=responsibility_event.version_id;
 IF responsibility_event.status<>'PUBLISHED' OR responsibility_version.payload->>'dataset' IS DISTINCT FROM i.dataset_code OR coalesce(responsibility_version.payload->>'assigneeRole','')='' OR coalesce(responsibility_version.payload->>'authorityScope','') NOT IN ('ALL',i.campus) OR coalesce(responsibility_version.payload->>'fieldGroup','') NOT IN ('ALL',CASE i.purpose WHEN 'IDENTITY_VERIFY' THEN 'IDENTITY' WHEN 'CONTACT_VERIFY' THEN 'CONTACT' ELSE 'ALL' END) THEN RAISE EXCEPTION 'RESPONSIBILITY_NOT_READY'; END IF;
 PERFORM vnext_control.require_object(p_actor,'SYNTHETIC',responsibility.id,'READ','METADATA',responsibility_version.payload);
 owner_ref:=responsibility_version.payload->>'assigneeRole';
 UPDATE governance_catalog.import_job SET quality_disposition_sequence=quality_disposition_sequence+1 WHERE id=j.id RETURNING quality_disposition_sequence INTO next_no;
 INSERT INTO governance_catalog.issue_disposition(job_id,issue_id,disposition_no,kind,actor_identity,request_id,reason,owner_ref,payload) VALUES(j.id,i.id,next_no,'ASSIGN',identity,req,p_input->>'reason',owner_ref,jsonb_build_object('responsibilityId',responsibility.id,'responsibilityCode',responsibility.code,'role',owner_ref)) RETURNING id INTO event_id;
 result:=jsonb_build_object('jobId',j.id,'issueId',i.id,'head',next_no::text,'eventId',event_id,'kind','ASSIGN','ownerRef',owner_ref);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,i.id,'QUALITY_ISSUE_ASSIGN',p_input->>'reason',requested_digest);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,req,requested_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,p_actor);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_issue_assign(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_issue_assign(text,jsonb) TO hdi_prototype;

CREATE FUNCTION governance_catalog.quality_correction_prior(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; req uuid; digest text; existing vnext_control.outcome;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','reason','receiveRequestId','issueId','jobId','sourceRunId','expectedCurrentRevision','format','parserPolicy','retentionSeconds','fileDigest')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'requestId' !~ '^[a-f0-9-]{36}$' OR p_input->>'jobId' !~ '^[a-f0-9-]{36}$' OR p_input->>'issueId' !~ '^[a-f0-9-]{36}$' OR p_input->>'sourceRunId' !~ '^[a-f0-9-]{36}$' OR p_input->>'expectedCurrentRevision' !~ '^[a-f0-9-]{36}$' OR p_input->>'receiveRequestId' !~ '^[a-f0-9-]{36}$' OR p_input->>'fileDigest' !~ '^[a-f0-9]{64}$' OR p_input->>'format' NOT IN ('CSV','JSON','XLSX') OR p_input->>'parserPolicy' NOT IN ('STRICT_V1','STRICT_V2') OR p_input->>'retentionSeconds' !~ '^[1-9][0-9]{0,6}$' OR p_input->>'reason' !~ '^[A-Z0-9_]{1,64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE'); PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',p_input->>'jobId'));
 req:=(p_input->>'requestId')::uuid; digest:=encode(sha256(convert_to(jsonb_build_object('operation','QUALITY_CORRECTION','input',p_input)::text,'UTF8')),'hex');
 SELECT o.* INTO existing FROM vnext_control.request_identity ri JOIN vnext_control.outcome o ON o.actor_code=ri.original_actor_code AND o.request_id=ri.request_id WHERE ri.identity_code=identity AND ri.request_id=req;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF existing.input_digest<>digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 RETURN existing.result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_correction_prior(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_correction_prior(text,jsonb) TO hdi_prototype;

CREATE FUNCTION governance_catalog.quality_issue_record_correction(p_actor text,p_input jsonb,p_revision uuid,p_artifact uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; req uuid; requested_digest text; existing vnext_control.outcome; j governance_catalog.import_job; i governance_catalog.quality_issue; r governance_catalog.validation_run; rev governance_catalog.import_input_revision; previous governance_catalog.import_input_revision; a governance_catalog.protected_artifact;
 next_no bigint; event_id uuid; result jsonb;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','reason','issueId','jobId','sourceRunId','expectedCurrentRevision','receiveRequestId','fileDigest','format','parserPolicy','retentionSeconds')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'requestId' !~ '^[a-f0-9-]{36}$' OR p_input->>'issueId' !~ '^[a-f0-9-]{36}$' OR p_input->>'jobId' !~ '^[a-f0-9-]{36}$' OR p_input->>'sourceRunId' !~ '^[a-f0-9-]{36}$' OR p_input->>'expectedCurrentRevision' !~ '^[a-f0-9-]{36}$' OR p_input->>'receiveRequestId' !~ '^[a-f0-9-]{36}$' OR p_input->>'fileDigest' !~ '^[a-f0-9]{64}$' OR p_input->>'format' NOT IN ('CSV','JSON','XLSX') OR p_input->>'parserPolicy' NOT IN ('STRICT_V1','STRICT_V2') OR p_input->>'retentionSeconds' !~ '^[1-9][0-9]{0,6}$' OR p_input->>'reason' !~ '^[A-Z0-9_]{1,64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE'); PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 PERFORM pg_advisory_xact_lock(901002);
 req:=(p_input->>'requestId')::uuid; requested_digest:=encode(sha256(convert_to(jsonb_build_object('operation','QUALITY_CORRECTION','input',p_input)::text,'UTF8')),'hex');
 SELECT o.* INTO existing FROM vnext_control.request_identity ri JOIN vnext_control.outcome o ON o.actor_code=ri.original_actor_code AND o.request_id=ri.request_id WHERE ri.identity_code=identity AND ri.request_id=req;
 IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN existing.result; END IF;
 SELECT * INTO i FROM governance_catalog.quality_issue WHERE id=(p_input->>'issueId')::uuid FOR SHARE;
 IF NOT FOUND OR i.job_id<>(p_input->>'jobId')::uuid OR i.run_id<>(p_input->>'sourceRunId')::uuid THEN RAISE EXCEPTION 'ISSUE_REFERENCE_INVALID'; END IF;
 IF i.campus<>p_input->>'campus' OR i.purpose<>p_input->>'purpose' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=i.job_id AND scope='SYNTHETIC' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 IF j.status<>'WAITING_INPUT' OR j.current_revision_id<>p_revision THEN RAISE EXCEPTION 'BATCH_REJECTED'; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.issue_disposition d WHERE d.issue_id=i.id AND d.kind='RESOLVED') THEN RAISE EXCEPTION 'ISSUE_ALREADY_RESOLVED'; END IF;
 SELECT * INTO r FROM governance_catalog.validation_run WHERE id=(p_input->>'sourceRunId')::uuid AND job_id=j.id; IF NOT FOUND THEN RAISE EXCEPTION 'RUN_REFERENCE_INVALID'; END IF;
 SELECT * INTO rev FROM governance_catalog.import_input_revision WHERE id=p_revision AND job_id=j.id; IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_REFERENCE_INVALID'; END IF;
 SELECT * INTO previous FROM governance_catalog.import_input_revision WHERE id=rev.previous_revision_id AND job_id=j.id;
 IF rev.id<>j.current_revision_id OR rev.previous_revision_id<>(p_input->>'expectedCurrentRevision')::uuid OR previous.id IS NULL OR rev.metadata->>'kind' IS DISTINCT FROM 'FILE' THEN RAISE EXCEPTION 'REVISION_REFERENCE_INVALID'; END IF;
 SELECT * INTO a FROM governance_catalog.protected_artifact WHERE id=p_artifact AND job_id=j.id AND revision_id=rev.id AND kind='RAW_FILE' AND campus=p_input->>'campus' AND purpose=p_input->>'purpose';
 IF NOT FOUND THEN RAISE EXCEPTION 'PROTECTED_ARTIFACT_REQUIRED'; END IF;
 UPDATE governance_catalog.import_job SET quality_disposition_sequence=quality_disposition_sequence+1 WHERE id=j.id RETURNING quality_disposition_sequence INTO next_no;
 INSERT INTO governance_catalog.issue_disposition(job_id,issue_id,disposition_no,kind,actor_identity,request_id,reason,target_revision_id,payload) VALUES(j.id,i.id,next_no,'CORRECTION_PROPOSED',identity,req,p_input->>'reason',rev.id,jsonb_build_object('sourceRunId',r.id,'newRevisionId',rev.id,'expectedCurrentRevision',p_input->>'expectedCurrentRevision')) RETURNING id INTO event_id;
 result:=jsonb_build_object('jobId',j.id,'issueId',i.id,'head',next_no::text,'eventId',event_id,'kind','CORRECTION_PROPOSED','revisionId',rev.id,'artifactId',a.id,'storageStatus','QUARANTINED');
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,i.id,'QUALITY_CORRECTION_PROPOSED',p_input->>'reason',requested_digest);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,req,requested_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,p_actor);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_issue_record_correction(text,jsonb,uuid,uuid) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_issue_record_correction(text,jsonb,uuid,uuid) TO hdi_prototype;

CREATE FUNCTION governance_catalog.quality_issue_resolve(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; req uuid; requested_digest text; existing vnext_control.outcome; j governance_catalog.import_job; i governance_catalog.quality_issue; r governance_catalog.validation_run; rev governance_catalog.import_input_revision;
 next_no bigint; event_id uuid; result jsonb; target_row integer; target_field text;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','reason','issueId','expectedHead','newRunId','newRevisionId','targetRow','targetField','matchStatus','candidate')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'requestId' !~ '^[a-f0-9-]{36}$' OR p_input->>'issueId' !~ '^[a-f0-9-]{36}$' OR p_input->>'newRunId' !~ '^[a-f0-9-]{36}$' OR p_input->>'newRevisionId' !~ '^[a-f0-9-]{36}$' OR p_input->>'expectedHead' !~ '^(0|[1-9][0-9]*)$' OR p_input->>'targetRow' !~ '^[1-9][0-9]{0,3}$' OR p_input->>'targetField' !~ '^[A-Za-z0-9_.-]{1,128}$' OR p_input->>'matchStatus' IS DISTINCT FROM 'MATCHED' OR p_input->>'reason' !~ '^[A-Z0-9_]{1,64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE'); PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 PERFORM pg_advisory_xact_lock(901002);
 req:=(p_input->>'requestId')::uuid; requested_digest:=encode(sha256(convert_to(jsonb_build_object('operation','QUALITY_RESOLVE','input',p_input)::text,'UTF8')),'hex');
 SELECT o.* INTO existing FROM vnext_control.request_identity ri JOIN vnext_control.outcome o ON o.actor_code=ri.original_actor_code AND o.request_id=ri.request_id WHERE ri.identity_code=identity AND ri.request_id=req;
 IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN existing.result; END IF;
 SELECT * INTO i FROM governance_catalog.quality_issue WHERE id=(p_input->>'issueId')::uuid FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF i.campus<>p_input->>'campus' OR i.purpose<>p_input->>'purpose' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=i.job_id AND scope='SYNTHETIC' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 IF j.quality_disposition_sequence::text<>p_input->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD'; END IF;
 IF j.current_revision_id<>(p_input->>'newRevisionId')::uuid OR EXISTS(SELECT 1 FROM governance_catalog.issue_disposition d WHERE d.issue_id=i.id AND d.kind='RESOLVED') THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 SELECT * INTO r FROM governance_catalog.validation_run WHERE id=(p_input->>'newRunId')::uuid AND job_id=j.id AND revision_id=(p_input->>'newRevisionId')::uuid; IF NOT FOUND THEN RAISE EXCEPTION 'RUN_REFERENCE_INVALID'; END IF;
 IF r.quality_candidate_digest IS NULL OR NOT EXISTS(SELECT 1 FROM governance_catalog.validation_run old_run WHERE old_run.id=i.run_id AND old_run.job_id=j.id AND old_run.quality_candidate_digest IS NOT NULL) THEN RAISE EXCEPTION 'VALIDATION_PROVENANCE_REQUIRED'; END IF;
 SELECT * INTO rev FROM governance_catalog.import_input_revision WHERE id=r.revision_id AND job_id=j.id; IF NOT FOUND OR rev.metadata->>'kind' IS DISTINCT FROM 'FILE' THEN RAISE EXCEPTION 'REVISION_REFERENCE_INVALID'; END IF;
 target_row:=(p_input->>'targetRow')::integer; target_field:=p_input->>'targetField';
 UPDATE governance_catalog.import_job SET quality_disposition_sequence=quality_disposition_sequence+1 WHERE id=j.id RETURNING quality_disposition_sequence INTO next_no;
 INSERT INTO governance_catalog.issue_disposition(job_id,issue_id,disposition_no,kind,actor_identity,request_id,reason,target_run_id,target_revision_id,target_row,payload) VALUES(j.id,i.id,next_no,'RESOLVED',identity,req,p_input->>'reason',r.id,rev.id,target_row,jsonb_build_object('matchStatus','MATCHED','targetField',target_field,'newRunId',r.id,'newRevisionId',rev.id)) RETURNING id INTO event_id;
 result:=jsonb_build_object('jobId',j.id,'issueId',i.id,'head',next_no::text,'eventId',event_id,'kind','RESOLVED','newRunId',r.id,'newRevisionId',rev.id,'targetRow',target_row,'targetField',target_field);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,i.id,'QUALITY_ISSUE_RESOLVED',p_input->>'reason',requested_digest);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,req,requested_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,p_actor);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_issue_resolve(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_issue_resolve(text,jsonb) TO hdi_prototype;

-- Import-job lifecycle remains owned by the import-job capability. The quality
-- command only orchestrates this internal transition with its disposition event.
CREATE FUNCTION governance_catalog.import_job_reject(p_actor text,p_job uuid,p_expected_head bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE j governance_catalog.import_job;
BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','WRITE');
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=p_job AND scope='SYNTHETIC' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF j.quality_disposition_sequence<>p_expected_head THEN RAISE EXCEPTION 'STALE_HEAD'; END IF;
 IF j.status<>'WAITING_INPUT' THEN RAISE EXCEPTION 'BATCH_ALREADY_REJECTED'; END IF;
 UPDATE governance_catalog.import_job SET status='REJECTED' WHERE id=j.id;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.import_job_reject(text,uuid,bigint) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION governance_catalog.quality_batch_reject(p_actor text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; req uuid; requested_digest text; existing vnext_control.outcome; j governance_catalog.import_job; next_no bigint; event_id uuid; result jsonb;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','reason','jobId','expectedHead')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'requestId' !~ '^[a-f0-9-]{36}$' OR p_input->>'jobId' !~ '^[a-f0-9-]{36}$' OR p_input->>'expectedHead' !~ '^(0|[1-9][0-9]*)$' OR p_input->>'reason' !~ '^[A-Z0-9_]{1,64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE'); PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 PERFORM pg_advisory_xact_lock(901002);
 req:=(p_input->>'requestId')::uuid; requested_digest:=encode(sha256(convert_to(jsonb_build_object('operation','QUALITY_BATCH_REJECT','input',p_input)::text,'UTF8')),'hex');
 SELECT o.* INTO existing FROM vnext_control.request_identity ri JOIN vnext_control.outcome o ON o.actor_code=ri.original_actor_code AND o.request_id=ri.request_id WHERE ri.identity_code=identity AND ri.request_id=req;
 IF FOUND THEN IF existing.input_digest<>requested_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN existing.result; END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=(p_input->>'jobId')::uuid AND scope='SYNTHETIC' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 IF j.quality_disposition_sequence::text<>p_input->>'expectedHead' THEN RAISE EXCEPTION 'STALE_HEAD'; END IF;
 PERFORM governance_catalog.import_job_reject(p_actor,j.id,(p_input->>'expectedHead')::bigint);
 UPDATE governance_catalog.import_job SET quality_disposition_sequence=quality_disposition_sequence+1 WHERE id=j.id RETURNING quality_disposition_sequence INTO next_no;
 INSERT INTO governance_catalog.issue_disposition(job_id,disposition_no,kind,actor_identity,request_id,reason,payload) VALUES(j.id,next_no,'BATCH_REJECTED',identity,req,p_input->>'reason',jsonb_build_object('jobId',j.id,'status','REJECTED')) RETURNING id INTO event_id;
 result:=jsonb_build_object('jobId',j.id,'head',next_no::text,'eventId',event_id,'kind','BATCH_REJECTED','status','REJECTED');
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,j.id,'QUALITY_BATCH_REJECT',p_input->>'reason',requested_digest);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,req,requested_digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,req,p_actor);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_batch_reject(text,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_batch_reject(text,jsonb) TO hdi_prototype;

CREATE FUNCTION governance_catalog.quality_eligibility(p_actor text,p_input jsonb,p_expected jsonb,p_not_run jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE j governance_catalog.import_job; r governance_catalog.validation_run; rev governance_catalog.import_input_revision; expected_count integer; ingested_count integer; missing_count integer; unresolved_count integer; manual_count integer; dependency_count integer; not_run_count integer; eligibility_digest text;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','jobId','revisionId','runId')) OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR p_input->>'campus' NOT IN ('NORTH','SOUTH') OR p_input->>'purpose' NOT IN ('IDENTITY_VERIFY','CONTACT_VERIFY','HR_RESTRICTED') OR p_input->>'jobId' !~ '^[a-f0-9-]{36}$' OR p_input->>'revisionId' !~ '^[a-f0-9-]{36}$' OR p_input->>'runId' !~ '^[a-f0-9-]{36}$' OR jsonb_typeof(p_expected) IS DISTINCT FROM 'array' OR jsonb_typeof(p_not_run) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',p_input->>'jobId'));
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=(p_input->>'jobId')::uuid AND scope='SYNTHETIC';
 SELECT * INTO r FROM governance_catalog.validation_run WHERE id=(p_input->>'runId')::uuid AND job_id=j.id AND revision_id=(p_input->>'revisionId')::uuid;
 IF NOT FOUND OR j.current_revision_id<>r.revision_id THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 SELECT * INTO rev FROM governance_catalog.import_input_revision WHERE id=r.revision_id AND job_id=j.id;
 IF NOT FOUND OR rev.metadata->>'kind' IS DISTINCT FROM 'FILE' THEN RAISE EXCEPTION 'FILE_REVISION_REQUIRED'; END IF;
 eligibility_digest:=governance_catalog.quality_eligibility_digest(p_input->>'campus',p_input->>'purpose',p_expected,p_not_run);
 IF r.quality_eligibility_digest IS NULL OR r.quality_eligibility_digest<>eligibility_digest THEN RAISE EXCEPTION 'VALIDATION_PROVENANCE_REQUIRED'; END IF;
 SELECT count(*)::integer INTO expected_count FROM jsonb_array_elements(p_expected);
 SELECT count(*)::integer INTO ingested_count FROM governance_catalog.quality_issue i WHERE i.run_id=r.id;
 SELECT count(*)::integer INTO missing_count FROM jsonb_array_elements(p_expected) c WHERE NOT EXISTS(SELECT 1 FROM governance_catalog.quality_issue i WHERE i.run_id=r.id AND i.source_kind=c->>'sourceKind' AND i.rule_code=c->>'rule' AND i.requirement_id=coalesce(c->>'requirementId','') AND i.row_number=(c->>'row')::integer AND i.field_code=coalesce(c->>'field','') AND i.bounded_code=c->>'boundedCode');
 SELECT count(*)::integer INTO unresolved_count FROM governance_catalog.quality_issue i WHERE i.run_id=r.id AND NOT EXISTS(SELECT 1 FROM governance_catalog.issue_disposition d WHERE d.issue_id=i.id AND d.kind='RESOLVED');
 SELECT count(*)::integer INTO manual_count FROM governance_catalog.quality_issue i WHERE i.run_id=r.id AND i.classification='BLOCKED_DEPENDENCY' AND i.requirement_id<>'' AND NOT EXISTS(SELECT 1 FROM governance_catalog.issue_disposition d WHERE d.issue_id=i.id AND d.kind='RESOLVED');
 SELECT count(*)::integer INTO dependency_count FROM governance_catalog.quality_issue i WHERE i.run_id=r.id AND i.classification='BLOCKED_DEPENDENCY' AND NOT EXISTS(SELECT 1 FROM governance_catalog.issue_disposition d WHERE d.issue_id=i.id AND d.kind='RESOLVED');
 SELECT count(*)::integer INTO not_run_count FROM jsonb_array_elements(p_not_run);
 RETURN jsonb_build_object('jobId',j.id,'currentRevisionId',j.current_revision_id,'currentRunId',r.id,'jobStatus',j.status,'expectedIssueCount',expected_count,'ingestedIssueCount',ingested_count,'missingIssueCount',missing_count,'unresolvedIssueCount',unresolved_count,'manualEvidenceBlocked',manual_count,'domainDependencyBlocked',dependency_count,'notRunLayers',p_not_run,'currentEvidenceAvailable',true,'isolationBlocked',true,'applyImplemented',false,'eligible',j.status='WAITING_INPUT' AND missing_count=0 AND unresolved_count=0 AND manual_count=0 AND dependency_count=0 AND not_run_count=0);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.quality_eligibility(text,jsonb,jsonb,jsonb) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.quality_eligibility(text,jsonb,jsonb,jsonb) TO hdi_prototype;

CREATE OR REPLACE FUNCTION governance_catalog.read_validation(p_actor text,p_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE r governance_catalog.validation_run; p governance_catalog.parse_provenance;
BEGIN
 SELECT * INTO r FROM governance_catalog.validation_run WHERE id=p_run;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',r.job_id));
 SELECT * INTO p FROM governance_catalog.parse_provenance WHERE artifact_id=r.parse_artifact_id;
 RETURN jsonb_build_object('runId',r.id,'jobId',r.job_id,'revisionId',r.revision_id,'parseArtifactId',r.parse_artifact_id,'sourceArtifactId',p.source_artifact_id,'parserPolicy',p.policy,'contractVersionId',r.contract_version_id,'ruleVersion',r.rule_version,'interpretationPolicy',r.interpretation_policy,'decision',r.decision,'issueCount',r.issue_count,'resultArtifactId',r.result_artifact_id,'recordedAt',to_char(r.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),'adapterReadiness','NOT_READY','securityScan','NOT_RUN','signature',r.signature,'qualityCandidateDigest',r.quality_candidate_digest,'qualityEligibilityDigest',r.quality_eligibility_digest);
END $$;

REVOKE ALL ON FUNCTION governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text) FROM PUBLIC,hdi_prototype;
DROP FUNCTION governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text);
CREATE FUNCTION governance_catalog.accept_validation(p_actor text,p_input jsonb,p_result uuid,p_decision text,p_count integer,p_run uuid,p_recorded text,p_signature text,p_quality_digest text,p_quality_eligibility_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog,vnext_control AS $$
DECLARE identity text; j jsonb; p governance_catalog.parse_provenance; a governance_catalog.protected_artifact; run governance_catalog.validation_run; result jsonb; digest text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR p_input->>'scope' IS DISTINCT FROM 'SYNTHETIC' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('scope','campus','purpose','requestId','outputRequestId','retentionSeconds','jobId','revisionId','artifactId')) OR p_quality_digest !~ '^[a-f0-9]{64}$' OR p_quality_eligibility_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED'; END IF;
 identity:=vnext_control.authorize(p_actor,'SYNTHETIC','WRITE');
 j:=governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',p_input->>'jobId'));
 IF j->>'currentRevisionId' IS DISTINCT FROM p_input->>'revisionId' THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(j->'contract'->>'versionId')::uuid,'WRITE');
 SELECT * INTO p FROM governance_catalog.parse_provenance WHERE artifact_id=(p_input->>'artifactId')::uuid;
 IF p.artifact_id IS NULL OR p.job_id::text<>j->>'id' OR p.revision_id::text<>j->>'currentRevisionId' OR p.contract_version_id::text<>j->'contract'->>'versionId' THEN RAISE EXCEPTION 'PARSE_PROVENANCE_REQUIRED'; END IF;
 IF p.structural_status<>'PARSED' THEN RAISE EXCEPTION 'STRUCTURAL_REJECTED'; END IF;
 SELECT * INTO a FROM governance_catalog.protected_artifact WHERE id=p_result;
 IF a.id IS NULL OR a.kind<>'ERROR_REPORT' OR a.job_id<>p.job_id OR a.revision_id<>p.revision_id OR a.campus IS DISTINCT FROM p_input->>'campus' OR a.purpose IS DISTINCT FROM p_input->>'purpose' THEN RAISE EXCEPTION 'VALIDATION_RESULT_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES ('READ'),('STORE')) required(permission) WHERE NOT EXISTS(SELECT 1 FROM vnext_control.protected_grant g JOIN governance_catalog.version v ON v.object_id=g.dataset_id JOIN governance_catalog.import_contract_version c ON c.dataset_version_id=v.id WHERE c.id=p.contract_version_id AND g.actor_code=p_actor AND g.campus=a.campus AND g.purpose=a.purpose AND g.permission=required.permission)) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.protected_artifact x WHERE x.id IN (p.artifact_id,p.source_artifact_id,a.id) AND (x.expires_at<=timezone('Asia/Shanghai',clock_timestamp()) OR NOT EXISTS(SELECT 1 FROM governance_catalog.protected_payload WHERE artifact_id=x.id))) THEN RAISE EXCEPTION 'PAYLOAD_UNAVAILABLE'; END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('operation','VALIDATE_REVISION','input',p_input)::text,'UTF8')),'hex');
 IF EXISTS(SELECT 1 FROM vnext_control.request_identity WHERE identity_code=identity AND request_id=(p_input->>'requestId')::uuid) THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
 INSERT INTO governance_catalog.validation_run(id,job_id,revision_id,parse_artifact_id,result_artifact_id,contract_version_id,rule_version,interpretation_policy,request_identity,request_id,decision,issue_count,quality_candidate_digest,quality_eligibility_digest,recorded_at,signature)
 VALUES(p_run,p.job_id,p.revision_id,p.artifact_id,a.id,p.contract_version_id,j->'contract'->'definition'->>'ruleVersion','EXACT_TEXT_V1',identity,(p_input->>'requestId')::uuid,p_decision,p_count,p_quality_digest,p_quality_eligibility_digest,governance_catalog.contract_time(p_recorded),p_signature) RETURNING * INTO run;
 result:=governance_catalog.read_validation(p_actor,run.id);
 INSERT INTO vnext_control.outcome(actor_code,request_id,input_digest,result) VALUES(p_actor,run.request_id,digest,result);
 INSERT INTO vnext_control.request_identity(identity_code,request_id,original_actor_code) VALUES(identity,run.request_id,p_actor);
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,run.id,'VALIDATE_REVISION','BOUNDED_VALIDATION',digest);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text) FROM PUBLIC,hdi_prototype;
GRANT EXECUTE ON FUNCTION governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text) TO hdi_prototype;

-- A rejected batch cannot receive a new revision or accept a new parse/validation.
DO $reject_guard$
DECLARE body text; needle text;
BEGIN
 body:=pg_get_functiondef('governance_catalog.import_job_command(text,jsonb)'::regprocedure);
 needle:='  IF NOT FOUND THEN RAISE EXCEPTION ''NOT_FOUND''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_IMPORT_GUARD_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||E'\n  IF job.status=''REJECTED'' THEN RAISE EXCEPTION ''BATCH_REJECTED''; END IF;');
 EXECUTE body;
 body:=pg_get_functiondef('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text)'::regprocedure);
 needle:=' IF j->>''currentRevisionId'' IS DISTINCT FROM p_input->>''revisionId'' THEN RAISE EXCEPTION ''STALE_REVISION''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'QUALITY_VALIDATION_GUARD_BASELINE_MISMATCH'; END IF;
 body:=replace(body,needle,needle||E'\n IF j->>''status''=''REJECTED'' THEN RAISE EXCEPTION ''BATCH_REJECTED''; END IF;');
 EXECUTE body;
END $reject_guard$;
