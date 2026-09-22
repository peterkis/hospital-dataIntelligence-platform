-- The independent ORG03 manual CORE contract must not revive a retired job contract.
SELECT pg_advisory_xact_lock(901002);
ALTER TABLE governance_catalog.import_contract ADD COLUMN manual_org03 boolean NOT NULL DEFAULT false;
ALTER TABLE governance_catalog.import_contract DISABLE TRIGGER import_contract_immutable;
UPDATE governance_catalog.import_contract c SET manual_org03=true
 WHERE c.profile='CORE' AND EXISTS(SELECT 1 FROM governance_catalog.object o WHERE o.id=c.dataset_id AND o.scope='SYNTHETIC' AND o.code='ORG03')
 AND EXISTS(SELECT 1 FROM governance_catalog.import_contract_version v WHERE v.contract_id=c.id AND v.definition->>'templateVersion'='ORG03_MANUAL_CORE_V1');
ALTER TABLE governance_catalog.import_contract ENABLE TRIGGER import_contract_immutable;
ALTER TABLE governance_catalog.import_contract DROP CONSTRAINT import_contract_dataset_id_profile_key;
ALTER TABLE governance_catalog.import_contract ADD CONSTRAINT import_contract_channel_key UNIQUE(dataset_id,profile,manual_org03);
ALTER TABLE governance_catalog.import_contract ADD CONSTRAINT manual_org03_core CHECK(NOT manual_org03 OR profile='CORE');
DO $patch$
DECLARE body text;needle text;channel text := $channel$(obj.scope='SYNTHETIC' AND obj.code='ORG03' AND coalesce(contract.profile,input->>'profile')='CORE' AND input->'definition'->>'templateVersion'='ORG03_MANUAL_CORE_V1')$channel$;
BEGIN
 body:=pg_get_functiondef('governance_catalog.contract_command(text,jsonb)'::regprocedure);
 needle:='  PERFORM governance_catalog.contract_definition(input->''definition'',dataset.id,coalesce(contract.profile,input->>''profile''));';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'MANUAL_CONTRACT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'  IF action=''REVISE'' AND contract.manual_org03 IS DISTINCT FROM '||channel||' THEN RAISE EXCEPTION ''FIXED_DATASET_REFERENCE_REQUIRED'';END IF;'||E'\n'||needle);
 needle:='IF EXISTS(SELECT 1 FROM governance_catalog.import_contract WHERE dataset_id=obj.id AND profile=input->>''profile'') THEN RAISE EXCEPTION ''CONTRACT_EXISTS''; END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'MANUAL_CONTRACT_BASELINE_MISMATCH';END IF;
 body:=replace(body,needle,'IF EXISTS(SELECT 1 FROM governance_catalog.import_contract WHERE dataset_id=obj.id AND profile=input->>''profile'' AND manual_org03='||channel||') THEN RAISE EXCEPTION ''CONTRACT_EXISTS''; END IF;');
 needle:='INSERT INTO governance_catalog.import_contract(dataset_id,profile) VALUES(obj.id,input->>''profile'') RETURNING * INTO contract;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'MANUAL_CONTRACT_BASELINE_MISMATCH';END IF;
 EXECUTE replace(body,needle,'INSERT INTO governance_catalog.import_contract(dataset_id,profile,manual_org03) VALUES(obj.id,input->>''profile'','||channel||') RETURNING * INTO contract;');
END $patch$;
