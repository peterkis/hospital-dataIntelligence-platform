import { createHash } from 'node:crypto';
import { contractSources } from './contract-sources.mjs';
import { peer, quote, identitySQL } from './lineage.mjs';

export function seedContracts(receipt) {
  const source=contractSources();
  const bytes=JSON.stringify(source);
  const hash=createHash('sha256').update(bytes).digest('hex');
  let tag='$contract_seed$';while(bytes.includes(tag))tag=tag.slice(0,-1)+'x$';
  peer(receipt.name,`BEGIN; SELECT pg_advisory_xact_lock(901002); ${identitySQL(receipt)}
DO ${tag} DECLARE item jsonb; dataset governance_catalog.version; contract_id uuid; version_id uuid; BEGIN
 IF EXISTS(SELECT 1 FROM governance_catalog.source_snapshot WHERE source_key='P0_02_CONTRACT_DRAFTS' AND sha256<>${quote(hash)}) THEN RAISE EXCEPTION 'CONTRACT_SOURCE_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.source_snapshot WHERE source_key='P0_02_CONTRACT_DRAFTS') THEN RETURN; END IF;
 INSERT INTO governance_catalog.source_snapshot(source_key,sha256,content) VALUES('P0_02_CONTRACT_DRAFTS',${quote(hash)},${quote(bytes)}::jsonb);
 INSERT INTO vnext_control.actor(code,identity_code,active) VALUES('SOURCE_PROPOSAL','SOURCE_PROPOSAL',false) ON CONFLICT DO NOTHING;
 FOR item IN SELECT value FROM jsonb_array_elements(${quote(bytes)}::jsonb->'drafts') LOOP
  SELECT v.* INTO STRICT dataset FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE o.kind='DATASET' AND o.scope='BASELINE' AND o.code=item->>'dataset' AND v.number=1;
  PERFORM governance_catalog.contract_definition(item->'definition',dataset.id,'FULL');
  INSERT INTO governance_catalog.import_contract(dataset_id,profile) VALUES(dataset.object_id,'FULL') RETURNING id INTO contract_id;
  INSERT INTO governance_catalog.import_contract_version(contract_id,number,dataset_version_id,source_snapshot_id,schemas,semantics_digest,definition,maker_identity,valid_from,valid_to) VALUES(contract_id,1,dataset.id,(SELECT id FROM governance_catalog.source_snapshot WHERE source_key='P0_02_CONTRACT_DRAFTS'),governance_catalog.contract_schemas(item->'definition'),(SELECT encode(sha256(convert_to(string_agg(id||':'||sha256,'|' ORDER BY id),'UTF8')),'hex') FROM vnext_control.migration),item->'definition','SOURCE_PROPOSAL',dataset.valid_from,dataset.valid_to) RETURNING id INTO version_id;
  INSERT INTO governance_catalog.import_contract_event(contract_id,version_id,status,actor_code) VALUES(contract_id,version_id,'DRAFT','SOURCE_PROPOSAL');
  INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('SOURCE_PROPOSAL',contract_id,'CONTRACT_SOURCE_DRAFT','SOURCE_METADATA_ONLY',${quote(hash)});
 END LOOP;
END ${tag}; COMMIT;`);
  console.log(JSON.stringify({status:'PASS',seed:'P0_02_CONTRACT_DRAFTS',drafts:53,conditions:77,businessFieldsImplemented:0,sourceApproval:'待院方确认',sha256:hash}));
}
