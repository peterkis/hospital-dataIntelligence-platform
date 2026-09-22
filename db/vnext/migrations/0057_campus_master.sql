SELECT pg_advisory_xact_lock(901002);
ALTER TABLE organization_master.input ADD COLUMN domain text NOT NULL DEFAULT 'ORG01' CHECK(domain IN ('ORG01','ORG02'));

CREATE TABLE organization_master.campus(id uuid PRIMARY KEY DEFAULT uuidv7(),scope text NOT NULL CHECK(scope IN ('NORTH','SOUTH')));
CREATE TABLE organization_master.campus_event(id uuid PRIMARY KEY DEFAULT uuidv7(),campus_id uuid NOT NULL REFERENCES organization_master.campus(id),number bigint NOT NULL CHECK(number>0),action text NOT NULL CHECK(action IN ('CREATE','REVISE','SCHEDULE_OPENING','CANCEL_OPENING','ACTIVATE','SUSPEND')),valid_from timestamp NOT NULL,valid_to timestamp,recorded_at timestamp NOT NULL DEFAULT timezone('Asia/Shanghai',clock_timestamp()),input_id uuid NOT NULL UNIQUE REFERENCES organization_master.input(id),UNIQUE(campus_id,number),CHECK(valid_to IS NULL OR valid_to>valid_from));
CREATE TABLE organization_master.campus_version(event_id uuid PRIMARY KEY REFERENCES organization_master.campus_event(id),facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='object'));
CREATE TABLE organization_master.campus_code(code text PRIMARY KEY CHECK(length(code)>0),campus_id uuid NOT NULL REFERENCES organization_master.campus(id));
CREATE TABLE organization_master.campus_plan(event_id uuid PRIMARY KEY REFERENCES organization_master.campus_event(id),planned_opening_at timestamp);
CREATE TABLE organization_master.campus_operation(event_id uuid PRIMARY KEY REFERENCES organization_master.campus_event(id),state text NOT NULL CHECK(state IN ('PLANNING','TRIAL_RUNNING','RUNNING','SUSPENDED')));
ALTER TABLE organization_master.input DROP CONSTRAINT input_target_fkey;
CREATE FUNCTION organization_master.input_target_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.target IS NOT NULL AND NOT (CASE NEW.domain WHEN 'ORG01' THEN EXISTS(SELECT 1 FROM organization_master.subject WHERE id=NEW.target AND campus=NEW.campus) WHEN 'ORG02' THEN EXISTS(SELECT 1 FROM organization_master.campus WHERE id=NEW.target AND scope=NEW.campus) ELSE false END) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER input_target_guard BEFORE INSERT ON organization_master.input FOR EACH ROW EXECUTE FUNCTION organization_master.input_target_guard();

CREATE OR REPLACE FUNCTION organization_master.stage(p_actor text,p_input jsonb,p_digest text,p_envelope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i text; r organization_master.input; j governance_catalog.import_job; target uuid:=(p_input->>'target')::uuid; BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 i:=organization_master.authorize(p_actor,target,p_input->>'campus','WRITE');
 PERFORM organization_master.authorize(p_actor,target,p_input->>'campus','READ');
 SELECT * INTO r FROM organization_master.input WHERE identity_code=i AND request_id=(p_input->>'requestId')::uuid;
 IF FOUND THEN IF r.digest<>p_digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF; RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision); END IF;
 SELECT * INTO j FROM governance_catalog.import_job WHERE id=(p_input->>'jobId')::uuid;
 IF j.submitter_identity IS DISTINCT FROM i OR j.current_revision_id IS DISTINCT FROM (p_input->>'revisionId')::uuid THEN RAISE EXCEPTION 'STALE_VALIDATION'; END IF;
 PERFORM governance_catalog.import_job_read(p_actor,jsonb_build_object('scope','SYNTHETIC','jobId',j.id));
 IF j.profile<>'CORE' THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY'; END IF;
 INSERT INTO organization_master.input(domain,job_id,job_revision,maker,identity_code,request_id,digest,campus,target,envelope) VALUES(coalesce(p_input->>'domain','ORG01'),j.id,j.current_revision_id,p_actor,i,(p_input->>'requestId')::uuid,p_digest,p_input->>'campus',target,p_envelope) RETURNING * INTO r;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'ORGANIZATION_INPUT','MANUAL_CORE',p_digest);
 RETURN jsonb_build_object('inputId',r.id,'revisionId',r.revision);
END $$;
CREATE OR REPLACE FUNCTION organization_master.input_read(p_actor text,p_id uuid,p_permission text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.input; effective_target uuid; BEGIN
 SELECT * INTO r FROM organization_master.input WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 effective_target:=coalesce(r.target,(SELECT subject_id FROM organization_master.version WHERE input_id=r.id LIMIT 1),(SELECT campus_id FROM organization_master.campus_event WHERE input_id=r.id LIMIT 1));
 PERFORM organization_master.authorize(p_actor,effective_target,r.campus,p_permission);
 IF p_permission='READ_RESTRICTED' THEN
  PERFORM organization_master.authorize(p_actor,effective_target,r.campus,'READ');
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES(p_actor,r.id,'ORGANIZATION_READ_RESTRICTED','IDENTITY_VERIFY',r.digest);
 END IF;
 RETURN jsonb_build_object('domain',r.domain,'id',r.id,'revision',r.revision,'digest',r.digest,'campus',r.campus,'target',r.target,'envelope',r.envelope,'jobId',r.job_id,'jobRevision',r.job_revision,'makerIdentity',r.identity_code,'withdrawn',EXISTS(SELECT 1 FROM organization_master.withdrawal WHERE input_id=r.id),'currentRevision',(SELECT current_revision_id FROM governance_catalog.import_job WHERE id=r.job_id));
END $$;

CREATE FUNCTION organization_master.campus_conflict(p_id uuid,p_code text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM organization_master.campus_code WHERE code=p_code AND campus_id IS DISTINCT FROM p_id) $$;
CREATE FUNCTION organization_master.campus_snapshot(p_actor text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sc text; BEGIN
 SELECT scope INTO sc FROM organization_master.campus WHERE id=p_id;IF sc IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM organization_master.authorize(p_actor,p_id,sc,'READ');
 RETURN jsonb_build_object('id',p_id,'scope',sc,'events',coalesce((SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('facts',v.facts,'planned_opening_at',p.planned_opening_at,'state',o.state) ORDER BY e.number) FROM organization_master.campus_event e LEFT JOIN organization_master.campus_version v ON v.event_id=e.id LEFT JOIN organization_master.campus_plan p ON p.event_id=e.id LEFT JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=p_id),'[]'));
END $$;
CREATE FUNCTION organization_master.campus_write(p_actor text,p_input uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r organization_master.input; s uuid;n bigint;v uuid; action text:=p_command->>'action'; BEGIN
 PERFORM pg_advisory_xact_lock(901002);SELECT * INTO r FROM organization_master.input WHERE id=p_input;
 IF r.domain IS DISTINCT FROM 'ORG02' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 PERFORM organization_master.authorize(p_actor,r.target,r.campus,'WRITE');
 IF EXISTS(SELECT 1 FROM organization_master.withdrawal WHERE input_id=r.id) THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 IF EXISTS(SELECT 1 FROM organization_master.campus_event WHERE input_id=r.id) THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
 IF p_command->'source'->>'recordStatus' IS DISTINCT FROM 'PUBLISHED' OR nullif(btrim(p_command->'source'->>'approvalRef'),'') IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED';END IF;
 s:=r.target;
 IF action='CREATE' THEN
  IF s IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  INSERT INTO organization_master.campus(scope) VALUES(r.campus) RETURNING id INTO s;n:=1;
  INSERT INTO organization_master.access SELECT actor,s,campus,permission FROM organization_master.access WHERE subject_id='00000000-0000-0000-0000-000000000000' AND campus=r.campus;
 ELSE
  SELECT coalesce(max(number),0)+1 INTO n FROM organization_master.campus_event WHERE campus_id=s;
  IF (n-1)::text IS DISTINCT FROM p_command->'target'->>'expectedVersion' OR s::text IS DISTINCT FROM p_command->'target'->>'id' OR p_command->'target'->>'owner' IS DISTINCT FROM 'organization-master/campus' THEN RAISE EXCEPTION 'STALE_VALIDATION';END IF;
 END IF;
 IF action='SUSPEND' AND p_command->>'validTo' IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF action IN ('ACTIVATE','SCHEDULE_OPENING') AND EXISTS(SELECT 1 FROM organization_master.campus_event e JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=s AND o.state='SUSPENDED' AND tsrange(e.valid_from,e.valid_to,'[)') && tsrange((p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,'[)')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 IF action IN ('CREATE','REVISE') THEN
 IF organization_master.campus_conflict(s,p_command->'facts'->>'campusCode') THEN RAISE EXCEPTION 'IDENTIFIER_CONFLICT';END IF;
 INSERT INTO organization_master.campus_code VALUES(p_command->'facts'->>'campusCode',s) ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO organization_master.campus_event(campus_id,number,action,valid_from,valid_to,input_id) VALUES(s,n,action,(p_command->>'validFrom')::timestamp,(p_command->>'validTo')::timestamp,r.id) RETURNING id INTO v;
 IF action IN ('CREATE','REVISE') THEN INSERT INTO organization_master.campus_version VALUES(v,p_command->'facts');END IF;
 IF action IN ('CREATE','ACTIVATE','SUSPEND') THEN INSERT INTO organization_master.campus_operation VALUES(v,CASE action WHEN 'CREATE' THEN 'PLANNING' WHEN 'SUSPEND' THEN 'SUSPENDED' ELSE p_command->>'state' END);END IF;
 IF action IN ('SCHEDULE_OPENING','CANCEL_OPENING') THEN INSERT INTO organization_master.campus_plan VALUES(v,(p_command->>'plannedOpeningAt')::timestamp);END IF;
 RETURN jsonb_build_object('owner','organization-master/campus','id',s,'version',n::text);
END $$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['campus','campus_event','campus_version','campus_code','campus_plan','campus_operation'] LOOP
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON organization_master.%I FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable()',t);
 EXECUTE format('ALTER TABLE organization_master.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('GRANT SELECT ON organization_master.%I TO hdi_prototype',t);
END LOOP;END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA organization_master FROM PUBLIC,hdi_prototype;

CREATE OR REPLACE FUNCTION governance_catalog.validation_rules_valid(definition jsonb,dataset_version uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
DECLARE rule jsonb; field jsonb; code text; source jsonb;
BEGIN
 IF jsonb_array_length(definition->'rules')>100 OR (SELECT count(*)<>count(DISTINCT r->>'id') FROM jsonb_array_elements(definition->'rules') r) THEN RETURN false; END IF;
 SELECT o.code INTO code FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=dataset_version;
 SELECT d->'definition' INTO source FROM governance_catalog.source_snapshot s CROSS JOIN LATERAL jsonb_array_elements(s.content->'drafts') d WHERE s.source_key='P0_02_CONTRACT_DRAFTS' AND d->>'dataset'=code;
 FOR rule IN SELECT value FROM jsonb_array_elements(definition->'rules') LOOP
  IF rule->>'status'='UNRESOLVED' THEN CONTINUE; END IF;
  IF rule->>'version' IS DISTINCT FROM 'P0_05_SOURCE_V1' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'rules') r WHERE r->>'id'=rule->>'id' AND r->>'field'=rule->>'field' AND r->>'text'=rule->>'text') THEN RETURN false; END IF;
  IF rule->>'status'='MACHINE' THEN
   IF NOT ((rule->>'id'='SRC-COND-061' AND code='PER17' AND EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'fields') f WHERE f->>'code'='account_kind')) OR (code='ORG02' AND definition->>'templateVersion'='ORG02_MANUAL_CORE_V1' AND rule->>'id' IN ('SRC-COND-005','SRC-COND-006'))) THEN RETURN false;END IF;
  ELSIF rule->>'status'<>'MANUAL_EVIDENCE' THEN RETURN false;
  END IF;
 END LOOP;
 FOR field IN SELECT value FROM jsonb_array_elements(definition->'fields') LOOP
  IF field->>'condition'='EVALUATED' AND (SELECT count(*) FROM jsonb_array_elements(definition->'rules') r WHERE r->>'field'=field->>'code' AND r->>'status'='MACHINE')<>1 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
-- Catalog-owned, transaction-bound exact code-set admission. No cross-owner DML.
CREATE FUNCTION governance_catalog.campus_division(p_actor text,p_ref jsonb,p_from timestamp,p_to timestamp) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v governance_catalog.import_contract_version;e governance_catalog.import_contract_event;c jsonb;spans tsmultirange;BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 PERFORM governance_catalog.contract_require_access(p_actor,'SYNTHETIC',(p_ref->>'contractVersionId')::uuid,'READ');
 SELECT * INTO v FROM governance_catalog.import_contract_version WHERE id=(p_ref->>'contractVersionId')::uuid AND contract_id=(p_ref->>'contractId')::uuid;
 SELECT * INTO e FROM governance_catalog.import_contract_event WHERE contract_id=v.contract_id AND status IN ('PUBLISHED','RETIRED') ORDER BY head DESC LIMIT 1;
 IF v.id IS NULL OR e.version_id IS DISTINCT FROM v.id OR e.status IS DISTINCT FROM 'PUBLISHED' OR v.definition->>'templateVersion' IS DISTINCT FROM 'ORG02_MANUAL_CORE_V1' OR NOT EXISTS(SELECT 1 FROM governance_catalog.import_contract k JOIN governance_catalog.object o ON o.id=k.dataset_id WHERE k.id=v.contract_id AND k.profile='CORE' AND o.scope='SYNTHETIC' AND o.code='ORG02') THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 SELECT value INTO c FROM jsonb_array_elements(v.definition->'codeSets') WHERE value->>'field'='admin_division_code' AND value->>'codeSystem'=p_ref->>'codeSystem' AND value->>'version'=p_ref->>'version' AND value->>'sourceVersionId'=p_ref->>'sourceVersionId' AND value->>'status'='SYNTHETIC_ADOPTED' AND value->'codes' ? (p_ref->>'code');
 spans:=governance_catalog.contract_supported_spans(v.id,timezone('Asia/Shanghai',clock_timestamp()));
 IF c IS NULL OR NOT (tsrange(p_from,p_to,'[)') <@ spans) OR NOT (tsrange(p_from,p_to,'[)') <@ tsrange((c->>'validFrom')::timestamp,(c->>'validTo')::timestamp,'[)')) THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY';END IF;
 RETURN jsonb_build_object('reference',p_ref,'publication',e.head::text,'semanticsDigest',v.semantics_digest,'supported',spans::text);
END $$;
REVOKE ALL ON FUNCTION governance_catalog.campus_division(text,jsonb,timestamp,timestamp) FROM PUBLIC,hdi_prototype;

CREATE FUNCTION organization_master.campus_list(p_actor text,p_after uuid,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM vnext_control.authorize(p_actor,'SYNTHETIC','READ');
 IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 RETURN coalesce((SELECT jsonb_agg(id ORDER BY id) FROM (SELECT id FROM organization_master.campus WHERE (p_after IS NULL OR id>p_after) AND organization_master.allowed(p_actor,id,scope,'READ') ORDER BY id LIMIT p_limit) x),'[]');
END $$;
REVOKE ALL ON FUNCTION organization_master.campus_list(text,uuid,integer) FROM PUBLIC,hdi_prototype;
