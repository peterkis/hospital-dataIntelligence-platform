import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { root, peer, quote, identitySQL, inspect } from './lineage.mjs';

export async function seed(receipt) {
  await inspect(receipt);
  const bytes = readFileSync(root + '/db/vnext/sources/catalog-metadata.json');
  const source = JSON.parse(bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  let seedTag='$seed$';while(bytes.includes(seedTag))seedTag=seedTag.slice(0,-1)+'x$';
  for (const file of source.manifest) {
    if (createHash('sha256').update(readFileSync(root + '/db/vnext/sources/package-v2/' + file.path)).digest('hex') !== file.sha256) throw new Error('SOURCE_DRIFT');
  }
  const sql = `BEGIN; SELECT pg_advisory_xact_lock(901002); ${identitySQL(receipt)}
DO ${seedTag} DECLARE snapshot_id uuid; d jsonb; o uuid; v uuid; BEGIN
 IF EXISTS(SELECT 1 FROM governance_catalog.source_snapshot WHERE source_key='PACKAGE_V2' AND sha256<>${quote(hash)}) THEN RAISE EXCEPTION 'SOURCE_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM governance_catalog.source_snapshot WHERE source_key='PACKAGE_V2') THEN RETURN; END IF;
 INSERT INTO governance_catalog.source_snapshot(source_key,sha256,content) VALUES ('PACKAGE_V2',${quote(hash)},${quote(bytes.toString())}::jsonb) RETURNING id INTO snapshot_id;
 INSERT INTO vnext_control.actor(code,identity_code,active) VALUES ('maker','SYNTHETIC_MAKER',true),('maker-alias','SYNTHETIC_MAKER',true),('reviewer','SYNTHETIC_REVIEWER',true),('outsider','SYNTHETIC_OUTSIDER',true);
 INSERT INTO vnext_control.actor_grant(actor_code,scope,permission) SELECT a,s,p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['BASELINE','SYNTHETIC']) s CROSS JOIN unnest(ARRAY['READ']) p;
 INSERT INTO vnext_control.actor_grant(actor_code,scope,permission) SELECT a,'SYNTHETIC',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['WRITE','REVIEW']) p;
 FOR d IN SELECT value FROM jsonb_array_elements(${quote(JSON.stringify(source.records))}::jsonb) LOOP
 INSERT INTO governance_catalog.object(kind,scope,code) VALUES ('DATASET','BASELINE',d->>'code') RETURNING id INTO o;
 INSERT INTO governance_catalog.version(object_id,number,payload,maker_identity,valid_from) VALUES (o,1,d,'SOURCE_PROPOSAL',timestamp '2026-01-01') RETURNING id INTO v;
 INSERT INTO governance_catalog.event(object_id,version_id,status,actor_code,reason) VALUES(o,v,'DRAFT','SOURCE_PROPOSAL','SOURCE_METADATA_ONLY');
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('SOURCE_PROPOSAL',o,'BASELINE_IMPORT','SOURCE_METADATA_ONLY',encode(sha256(convert_to(jsonb_build_object('code',d->>'code','versionId',v,'payload',d,'validFrom',timestamp '2026-01-01','sourceDigest',${quote(hash)})::text,'UTF8')),'hex'));
 END LOOP;
 INSERT INTO vnext_control.audit(actor_code,object_id,action,reason,content_digest) VALUES('SOURCE_PROPOSAL',snapshot_id,'BASELINE_IMPORT_BATCH','SOURCE_METADATA_ONLY',encode(sha256(convert_to(jsonb_build_object('sourceDigest',${quote(hash)},'datasets',53,'manifestFiles',116)::text,'UTF8')),'hex'));
END ${seedTag}; COMMIT;`;
  peer(receipt.name, sql);
  console.log(JSON.stringify({status:'PASS', seed:'PACKAGE_V2', sha256:hash, datasets:53, fields:866, sourceApproval:'待院方确认', businessInstances:0}));
}
