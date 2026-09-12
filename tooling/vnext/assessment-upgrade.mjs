import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,migrationFiles,resolveTarget,peer,quote } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
const owned=createTemporary();let catalog;
try{
 await migrate(owned.receipt,migrationFiles().slice(0,9));await seed(owned.receipt);catalog=await openCatalog(resolveTarget(owned.receipt));
 const cmd=(action,extra={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'ASSESSMENT_UPGRADE',...extra});
 // This deliberately exercises the actual historical 3-argument v9 port, not a current compatibility adapter.
 const publish=async item=>{const review=await catalog.command('maker',cmd('SUBMIT',{target:item.id,expectedHead:item.head}));const impact=JSON.parse(peer(owned.receipt.name,`SELECT governance_catalog.change_impact('reviewer','SYNTHETIC',${quote(item.id)});`));return catalog.command('reviewer',cmd('PUBLISH',{target:item.id,expectedHead:review.head,reviewDigest:review.reviewDigest,impactDigest:impact.impactDigest}));};
 const source=async(code,evidence)=>publish(await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code,values:{name:'合成冻结审批升级',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:evidence},validFrom:'2026-01-01T00:00:00'})));
 let root=await source('UPGRADE_ASSESS_ROOT','SYNTHETIC_BOOTSTRAP');let child=await source('UPGRADE_ASSESS_CHILD',root.id);
 root=await publish(await catalog.command('maker',cmd('REVISE',{target:root.id,expectedHead:root.head,values:{},validFrom:'2027-01-01T00:00:00'})));
 child=await publish(await catalog.command('maker',cmd('REVISE',{target:child.id,expectedHead:child.head,values:{},validFrom:'2027-01-01T00:00:00'})));
 const historical=(await catalog.impactCases('reviewer','SYNTHETIC',root.id))[0];assert.equal(historical.status,'CLOSED');
 child=await publish(await catalog.command('maker',cmd('REVISE',{target:child.id,expectedHead:child.head,values:{},validFrom:'2027-01-01T00:00:00',validTo:'2028-01-01T00:00:00'})));
 assert.equal((await catalog.impactCases('reviewer','SYNTHETIC',root.id)).filter(c=>c.status==='OPEN').length,0);
 await assert.rejects(catalog.resolveSource('maker','SYNTHETIC',child.id,'2028-01-01T00:00:00'),/SOURCE_EVIDENCE_NOT_READY/);
 const original=peer(owned.receipt.name,`SELECT jsonb_agg(to_jsonb(i) ORDER BY event_sequence) FROM governance_catalog.impact_event i WHERE case_id=${quote(historical.case_id)};`);
 const audit=peer(owned.receipt.name,'SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM vnext_control.audit a;');const auditIds=JSON.parse(audit).map(a=>a.id);
 await catalog.close();catalog=null;await migrate(owned.receipt);await migrate(owned.receipt);
 assert.equal(peer(owned.receipt.name,`SELECT jsonb_agg(to_jsonb(i)-'assessment_head' ORDER BY event_sequence) FROM governance_catalog.impact_event i WHERE case_id=${quote(historical.case_id)};`),original);
 assert.equal(peer(owned.receipt.name,`SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM vnext_control.audit a WHERE id IN(${auditIds.map(quote).join(',')});`),audit);
 assert.equal(peer(owned.receipt.name,'SELECT count(*) FROM governance_catalog.source_assessment;'),'0');
 catalog=await openCatalog(resolveTarget(owned.receipt));const cases=await catalog.impactCases('reviewer','SYNTHETIC',root.id);
 const observations=cases.filter(c=>c.reason==='UPGRADE_ASSESSMENT_IMPACT_OBSERVATION');assert.equal(observations.length,1);assert.equal(observations[0].status,'OPEN');assert.equal(observations[0].assessment_head,null);
 assert.equal(cases.find(c=>c.case_id===historical.case_id).status,'CLOSED');await catalog.verifyAudit('auditor');
 console.log(JSON.stringify({status:'PASS',originalCaseAndAuditPreserved:true,originalAuditRows:auditIds.length,currentObservationCount:1,noInventedHistoricalAssessment:true,migrationReplayNoDuplicate:true,receipt:owned.receipt}));
}finally{await catalog?.close();dropTemporary(owned.receipt);}
