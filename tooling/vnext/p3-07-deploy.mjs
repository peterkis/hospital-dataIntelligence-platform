import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {readReceipt,inspect,checkPrefix,migrationFiles} from './lineage.mjs';
import {provisionLocationUse,assertLocationUseProvisioned} from './p3-07-provisioning.mjs';
import {startWorkbench} from './workbench-runtime.mjs';
import {locationUseFixture} from './p3-07-fixture.ts';
import {runLocationUseHttp} from './p3-07-http.ts';
import {installSyntheticPurposeSamples} from './p3-07-purpose-samples.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
// No deployment helper may mutate a different retained lineage or pre0200 DB.
const retained=readReceipt();assert.equal(retained.name,'hdi_mc_vnext_a7049c9e5c2a4364','P3_07_RETAINED_RECEIPT_REQUIRED');assert.equal(retained.oid,'206108','P3_07_RETAINED_RECEIPT_REQUIRED');assert.equal(retained.lineage,'HDIP-MC-VNEXT');
const preflight=await inspect(retained),files=migrationFiles();assert.equal(preflight.identity.name,'hdi_mc_vnext_a7049c9e5c2a4364');assert.equal(preflight.identity.oid,'206108');assert.ok(checkPrefix(files,preflight.ledger)>=200,'P3_05_CURRENT_DEPLOYMENT_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p3-07'}),{receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));let server,fixture;
try{
 provisionLocationUse(receipt,service.role,provider);await assertLocationUseProvisioned(connection,provider);
 server=await startWorkbench({persistent:true,port:0});
 fixture=await locationUseFixture(receipt,service.role,server.catalog,provider,connection,true);
 const syntheticSamples=await installSyntheticPurposeSamples(server.url,fixture);
 const http=await runLocationUseHttp(server,fixture),final=await inspect(receipt);
 assert.equal(final.identity.oid,'206108');assert.equal(checkPrefix(migrationFiles(),final.ledger),migrationFiles().length);
 await deployment.complete();
 const result={...http,gate:'P3_07_PERSISTENT_GENERATED_HTTP',oid:receipt.oid,previousPrefix:preflight.ledger.length,currentPrefix:final.ledger.length,originalPrefixPreserved:true,syntheticSamples};
 writeFileSync(evidence+'.http.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({gate:result.gate,status:'PASS',evidence:evidence+'.http.json'}));
}finally{await fixture?.close();await server?.close();}
