import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocationUsageTypeClient} from '../../packages/generated-api-client/src/index.js';
import {localTime} from '../../apps/governance-api/src/modules/organization-master/index.js';

// Deployment examples only. The domain dictionary accepts independently approved
// new codes through its public maintenance interface without a code enum change.
const samples=[
 {code:'CLINICAL',name:'TEST 临床业务空间用途',meaning:'TEST POLICY ONLY 临床业务使用空间的用途分类'},
 {code:'OFFICE',name:'TEST 行政办公用途',meaning:'TEST POLICY ONLY 日常行政办公使用空间的用途分类'},
 {code:'NURSING_STATION',name:'TEST 护理站用途',meaning:'TEST POLICY ONLY 护理工作站使用空间的用途分类'},
 {code:'STORAGE',name:'TEST 储存用途',meaning:'TEST POLICY ONLY 物资或设备存放使用空间的用途分类'},
];
const success=<T>(response:{response:Response;data?:T;error?:{code?:string}}):T=>{assert.equal(response.response.status,200,response.error?.code);assert.ok(response.data);return response.data;};

/** Install the four initial synthetic examples through real generated HTTP. */
export async function installSyntheticPurposeSamples(baseUrl:string,fixture:{source:{id:string;versionId:string};artifact:{artifactId:string}}){
 const maker=createLocationUsageTypeClient(baseUrl,'maker'),reviewer=createLocationUsageTypeClient(baseUrl,'reviewer'),first=success(await maker.list({limit:100})),existing=[...first.items];let after=first.nextAfterId;
 while(after!==null){const page=success(await maker.list({after,limit:100}));existing.push(...page.items);after=page.nextAfterId;}
 const result:Array<{id:string;code:string;name:string;meaning:string;versionId:string;version:string;head:string;enabled:boolean;status:'APPROVED';mode:'CREATED_AND_APPROVED'|'REUSED_APPROVED'}>=[];
 for(const sample of samples){
  const description='TEST POLICY ONLY 初始合成用途样例',matches=existing.filter(item=>item.code===sample.code);
  if(matches.length>1)throw new Error('P3_07_SYNTHETIC_SAMPLE_CONFLICT');
  let item=matches[0],mode:'CREATED_AND_APPROVED'|'REUSED_APPROVED'='REUSED_APPROVED';
  if(item){
   // Stable code ownership forbids silently changing meaning or publishing an
   // unexpected draft during a deployment rerun. Existing enablement is retained.
   if(item.status!=='APPROVED'||item.name!==sample.name||item.meaning!==sample.meaning||item.description!==description||localTime(item.validFrom)!=='2026-01-01T00:00:00.000000'||item.validTo!==null)throw new Error('P3_07_SYNTHETIC_SAMPLE_CONFLICT');
  }else{
   const draft=success(await maker.command({action:'CREATE',requestId:randomUUID(),reason:'TEST POLICY ONLY initial synthetic '+sample.code+' purpose',...sample,description,validFrom:'2026-01-01T00:00:00',validTo:null,sourceId:fixture.source.id,sourceVersionId:fixture.source.versionId,evidenceId:fixture.artifact.artifactId}));
   success(await reviewer.command({action:'VERIFY',requestId:randomUUID(),reason:'TEST independent initial purpose meaning verification',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest,evidenceId:fixture.artifact.artifactId,meaningAccepted:true}));
   item=success(await reviewer.command({action:'APPROVE',requestId:randomUUID(),reason:'TEST independent initial purpose approval',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest}));mode='CREATED_AND_APPROVED';
  }
  assert.ok(item.status==='APPROVED');assert.equal(item.code,sample.code);assert.equal(item.name,sample.name);assert.equal(item.meaning,sample.meaning);
  result.push({id:item.id,code:item.code,name:item.name,meaning:item.meaning,versionId:item.versionId,version:item.version,head:item.head,enabled:item.enabled,status:'APPROVED',mode});
 }
 return result;
}
