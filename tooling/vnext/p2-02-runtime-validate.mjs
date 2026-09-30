import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startWorkbench} from './workbench-runtime.mjs';
import {peer} from './lineage.mjs';
import {createHierarchyClient} from '../../packages/generated-api-client/src/index.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
// The public startup path owns a fresh receipt-bound database and HTTP server.
// Do not replace buildCatalogServer or inject an independently constructed Owner.
const runtime=await startWorkbench();
try {
 const client=createHierarchyClient(runtime.url,'maker');
 const denied=await client.read({viewId:randomUUID()});
 assert.equal(denied.response.status,403,'Started workbench must route hierarchy authorization instead of returning missing-context 503');
 assert.equal(denied.error?.code,'ACCESS_DENIED');
 peer(runtime.receipt.name,"INSERT INTO department_master.access(actor,scope,permission) SELECT 'maker','HOSPITAL',p FROM unnest(ARRAY['READ','WRITE']) p ON CONFLICT DO NOTHING;");
 const source=(await runtime.catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.kind==='SOURCE'&&item.status==='PUBLISHED');
 assert.ok(source);
 const definition={requestId:randomUUID(),sourceClientKey:'RUNTIME_HIERARCHY',viewCode:'RUNTIME_HIERARCHY',viewName:'Runtime hierarchy',viewType:'ADMINISTRATIVE',purpose:'Runtime integration regression',aggregationRule:'NONE',ownerDepartmentId:null,sourceSystemId:source.id,sourceRecordId:'RUNTIME:1',sourceVersion:'1',validFrom:'2026-09-01T00:00:00',validTo:null,recordedAt:'2026-09-01T00:00:00',approvalRef:'SYNTHETIC_RUNTIME'};
 const registered=await client.createView(definition);
 assert.equal(registered.response.status,200);
 assert.ok(registered.data?.viewId);
 const snapshot=await client.read({viewId:registered.data.viewId});
 assert.equal(snapshot.response.status,200);
 assert.equal(snapshot.data,null,'A registered draft has no published snapshot');
 const candidate=await client.importCandidate({...definition,requestId:randomUUID(),viewId:registered.data.viewId,parentCardinality:'STRICT_TREE',recordStatus:'ACTIVE',nodes:[{nodeKey:'root',parentNodeKey:null,nodeKind:'GROUP',groupCode:'RUNTIME_GROUP',groupId:null,groupVersionId:null,displayName:'Runtime group',relationName:'组织',sortOrder:0,isPrimaryPath:true,sourceEvidence:{sourceClientKey:'RUNTIME_EDGE',sourceVersion:'1',sourceSystemId:source.id,sourceRecordId:'RUNTIME:2',validFrom:definition.validFrom,validTo:null,recordedAt:definition.recordedAt,recordStatus:'ACTIVE',approvalRef:'SYNTHETIC_RUNTIME'}}]});
 assert.equal(candidate.response.status,200,'Runtime service must execute the complete candidate authorization path');
 assert.equal(candidate.data?.decision,'PASS');
 assert.ok(candidate.data.candidateId);
 peer(runtime.receipt.name,`INSERT INTO department_master.access(actor,scope,permission) SELECT 'reviewer','HOSPITAL',p FROM unnest(ARRAY['READ','REVIEW']) p ON CONFLICT DO NOTHING;
 INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT 'reviewer','${registered.data.viewId}'::uuid,p FROM unnest(ARRAY['READ','REVIEW']) p;`);
 const reviewer=createHierarchyClient(runtime.url,'reviewer');
 const approval=await reviewer.approve({candidateId:candidate.data.candidateId,digest:candidate.data.digest});
 assert.equal(approval.response.status,200);
 console.log(JSON.stringify({gate:'P2-02-RUNTIME',status:'PASS',authorization:403,registration:200,draftSnapshot:null,candidate:200,approval:200}));
} finally {await runtime.close();}
