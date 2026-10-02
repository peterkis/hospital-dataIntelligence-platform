import {test,expect,beforeAll,afterAll} from 'vitest';
import {randomUUID,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider,canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationEvolutions} from '../../apps/governance-api/src/modules/department-master/index.js';
import {evolutionFixture} from './p2-05-fixture.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {ORG26_FIELDS,ORG27_FIELDS} from '../../apps/governance-api/src/modules/department-master/index.js';
import {ORG04_FIELDS} from '../../apps/governance-api/src/modules/department-master/vnext/contracts.js';
import {peer,quote} from './lineage.mjs';
import {Pool} from 'pg';
import {unzip} from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import {zipText} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';

const provider=new LocalSyntheticKeyProvider(),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const catalog=await openCatalog(connection,provider);
let owner:ReturnType<typeof openOrganizationEvolutions>,f:Awaited<ReturnType<typeof evolutionFixture>>;
beforeAll(async()=>{owner=openOrganizationEvolutions(connection,provider);f=await evolutionFixture(receipt,catalog,provider,connection);});
afterAll(async()=>{await owner?.close();await catalog.close();});

async function prepare(input:Parameters<typeof owner.stage>[1]){
 const staged=await owner.stage('maker',input);
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST POLICY ONLY independent material review',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
 expect(await owner.validate('maker',{inputId:staged.inputId})).toMatchObject({decision:'PASS',issues:[]});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});
 await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 return {staged,candidate,requestId};
}

async function splitInput(){
 const source=await f.newDepartment();f.grantTarget(source);
 const input=await f.input();input.event.change_type='SPLIT';input.rename=null;input.predecessors=[{owner:'department-master',id:source,expectedVersion:'1'}];input.successors=[f.department.entry(),f.department.entry()];input.contextEvidenceId=f.material.artifactId;
 for(const next of input.successors){next.row.valid_from=input.event.effective_at;next.row.established_on='2026-06-01';}
 input.relations=input.successors.map((next,i)=>({succession_id:randomUUID(),org_event_id:input.event.org_event_id,from_target_type:'ORG',from_target_id:source,to_target_type:'ORG',to_target_id:next.row.org_id,transfer_scope:i?'INPATIENT':'OUTPATIENT',context_rule:'TEST POLICY ONLY explicit future destination',recorded_at:input.event.recorded_at}));
 return input;
}

async function renameInput(){
 const input=await f.input(),id=await f.newDepartment();f.grantTarget(id);input.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];input.relations[0]!.from_target_id=id;input.relations[0]!.to_target_id=id;return input;
}

function formalFactsDigest(){
 const tables=['department_master.department','department_master.version','department_master.evolution_event','department_master.evolution_relation','department_master.replacement','department_master.organization_mapping','department_master.organization_mapping_version','department_master.organization_identifier','department_master.organization_identifier_version','governance_catalog.apply_commit'];
 return peer(receipt.name,`SELECT encode(sha256(convert_to(jsonb_build_array(${tables.map(table=>`(SELECT coalesce(jsonb_agg(to_jsonb(facts) ORDER BY to_jsonb(facts)::text),'[]') FROM ${table} facts)`).join(',')},(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM vnext_control.audit a WHERE action='EVOLUTION_APPLY'))::text,'UTF8')),'hex');`);
}

function withdraw(table:string,predicate:string){
 const rows=peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]')::text FROM ${table} g WHERE ${predicate};`);
 expect(JSON.parse(rows).length).toBeGreaterThan(0);
 peer(receipt.name,`DELETE FROM ${table} WHERE ${predicate};`);
 return ()=>peer(receipt.name,`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},${quote(rows)}::jsonb);`);
}
const withdrawSource=(actor:string,id:string)=>withdraw('vnext_control.object_grant',`actor_code=${quote(actor)} AND object_id=${quote(id)}::uuid AND permission='READ' AND purpose='SYNTHETIC_REFERENCE'`);
const withdrawMaterial=(actor:string,id:string)=>withdraw('vnext_control.protected_grant',`actor_code=${quote(actor)} AND dataset_id=${quote(id)}::uuid AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ'`);
async function failureCode(work:()=>Promise<unknown>){try{await work();return 'ACCEPTED';}catch(error){return error instanceof Error?error.message:'UNKNOWN_ERROR';}}

test.each(['bad successor time','bad event time'] as const)('REVIEW raw-source authorization precedes %s validation in HTTP preview',async(kind)=>{
 const input=await splitInput(),source=await f.newSource();input.successors[0]!.row.source_system_id=source.id;
 input.successors[0]!.row.org_name='TEST ONLY restricted successor name';
 if(kind==='bad successor time')input.successors[0]!.row.valid_from='invalid-local-time';else input.event.effective_at='invalid-local-time';
 const staged=await owner.stage('maker',input),restore=withdrawSource('reviewer',source.id);
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  await expect(owner.readInput('reviewer',{inputId:staged.inputId})).rejects.toThrow('ACCESS_DENIED');
  const url=await app.listen({host:'127.0.0.1',port:0}),response=await fetch(url+'/api/vnext/organization-evolutions/preview',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'reviewer'},body:JSON.stringify({inputId:staged.inputId})});
  const body=await response.json();console.log(JSON.stringify({probe:'raw-source-preview',kind,status:response.status,returnedRestrictedName:body.input?.successors?.[0]?.row?.org_name??null}));
  expect(response.status).toBe(403);
 }finally{await app.close();restore();}
});

test('REVIEW stage cannot store successors whose source READ was revoked',async()=>{
 const input=await splitInput(),source=await f.newSource();input.successors[0]!.row.source_system_id=source.id;
 const restore=withdrawSource('maker',source.id);
 try{const code=await failureCode(()=>owner.stage('maker',input));const persisted=Number(peer(receipt.name,`SELECT count(*) FROM department_master.evolution_input WHERE request_id=${quote(input.requestId)}::uuid;`));console.log(JSON.stringify({probe:'stage-raw-source',code,persisted}));expect(code).toBe('ACCESS_DENIED');expect(persisted).toBe(0);}finally{restore();}
});

test('REVIEW independent verifier must read each successor material before recording acceptance',async()=>{
 const input=await splitInput(),staged=await owner.stage('maker',input),restore=withdrawMaterial('reviewer',f.department.dataset.id);
 try{
  const code=await failureCode(()=>owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST ONLY acceptance without ORG04 material access',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews}));
  const recorded=Number(peer(receipt.name,`SELECT count(*) FROM department_master.evolution_verification WHERE input_id=${quote(staged.inputId)}::uuid;`));
  console.log(JSON.stringify({probe:'verify-successor-material',code,recorded}));expect(code).toBe('ACCESS_DENIED');expect(recorded).toBe(0);
 }finally{restore();}
});

test('REVIEW frozen plan retry rechecks successor material authorization',async()=>{
 const p=await prepare(await splitInput()),restore=withdrawMaterial('maker',f.department.dataset.id);
 try{
  const code=await failureCode(()=>owner.plan('maker',{inputId:p.staged.inputId,requestId:p.requestId}));
  console.log(JSON.stringify({probe:'frozen-plan-retry',code}));expect(code).toBe('ACCESS_DENIED');
 }finally{restore();}
});

test('REVIEW event list cannot reveal IDs whose material access has been withdrawn',async()=>{
 const p=await prepare(await renameInput()),accepted=await owner.applyUnit('maker',{candidateId:p.candidate.candidateId,requestId:p.requestId});if(accepted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const id=accepted.facts[0]!.id,restore=withdrawMaterial('reviewer',f.eventDataset.id);
 try{await expect(owner.query('reviewer',{id,campus:'NORTH',businessAt:'2026-06-01T00:00:00'})).rejects.toThrow('ACCESS_DENIED');let visible=false;const code=await failureCode(async()=>{visible=(await owner.list('reviewer',{campus:'NORTH',limit:100})).includes(id);});console.log(JSON.stringify({probe:'list-material-access',code,visible}));expect(visible).toBe(false);expect(['ACCESS_DENIED','ACCEPTED']).toContain(code);}finally{restore();}
});

test.each(['valid rows','business-invalid rows','older read protocol'])('REVIEW generic original-file read cannot bypass successor source authorization for %s',async(kind)=>{
 const input=await splitInput(),source=await f.newSource();input.successors[0]!.row.source_system_id=source.id;
 if(kind==='business-invalid rows')input.successors[0]!.row.valid_from='2026-05-01T00:00:00';
 const {requestId,jobId:_,revisionId:__,profile:___,event,relations,successors,...control}=input;
 const bytes=organizationWorkbook({ORG26:[ORG26_FIELDS,ORG26_FIELDS.map(field=>event[field])],ORG27:[ORG27_FIELDS,...relations.map(row=>ORG27_FIELDS.map(field=>row[field]))],ORG04:[ORG04_FIELDS,...successors.map(entry=>ORG04_FIELDS.map(field=>entry.row[field]))]});
 const received=await owner.receiveFile('maker',{requestId,fileRequestId:randomUUID(),job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_INDEPENDENT_REVIEW_FILE',contractId:f.eventContract.id,contractVersionId:f.eventContract.versionId,profile:'CORE',input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_ORGANIZATION_EVOLUTION_V1'}},retentionSeconds:3600,...control,successors:successors.map(({row:_,...entry})=>entry)},bytes);
 if(!received.input)throw new Error('FILE_NOT_STAGED');
 await owner.validate('maker',{inputId:received.input.inputId});
 const derived: string[]=JSON.parse(peer(receipt.name,`SELECT coalesce(jsonb_agg(id),'[]')::text FROM governance_catalog.protected_artifact WHERE job_id=${quote(received.jobId)}::uuid AND revision_id=${quote(received.revisionId)}::uuid AND kind IN ('RAW_CELL','ERROR_REPORT');`));expect(derived.length).toBeGreaterThan(0);
 for(const artifactId of derived){const raw=await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId});expect(raw.length).toBeGreaterThan(0);raw.fill(0);}
 const allowed=await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:received.sourceArtifactId});expect(allowed.length).toBe(bytes.length);allowed.fill(0);const restore=withdrawSource('maker',source.id);
 try{
  await expect(owner.readInput('maker',{inputId:received.input.inputId})).rejects.toThrow('ACCESS_DENIED');
  let returnedBytes=0;const code=await failureCode(async()=>{const raw=await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:received.sourceArtifactId});returnedBytes=raw.length;raw.fill(0);});
  console.log(JSON.stringify({probe:'original-file-source-read',code,returnedBytes}));expect(code).toBe('ACCESS_DENIED');expect(returnedBytes).toBe(0);
  for(const artifactId of derived)await expect(catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId})).rejects.toThrow('ACCESS_DENIED');
 }finally{restore();}
 const recovered=await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:received.sourceArtifactId});expect(Buffer.from(recovered)).toEqual(bytes);recovered.fill(0);
 if(kind==='older read protocol'){
  // The temporary database reproduces the installed 0119 READ result shape.
  // Keep all source grants restored, so denial is specifically fail-closed
  // compatibility rather than a second manifestation of the revoked grant.
  const definition=peer(receipt.name,"SELECT pg_get_functiondef('governance_catalog.protected_command(text,text,jsonb,jsonb,text)'::regprocedure);"),legacy=definition.replace("result:=result||jsonb_build_object('evolutionScope',department_master.evolution_original_context(p_actor,a.id));",'');
  expect(legacy).not.toBe(definition);peer(receipt.name,legacy);
  try{await expect(catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:received.sourceArtifactId})).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,definition);}
 }
});

test('REVIEW signed SQL STAGE independently rejects an unreadable raw successor source',async()=>{
 const input=await splitInput(),source=await f.newSource();input.successors[0]!.row.source_system_id=source.id;
 const restore=withdrawSource('maker',source.id),pool=new Pool({connectionString:connection,max:1}),client=await pool.connect(),before=formalFactsDigest();
 try{
  await client.query('BEGIN');const transaction=(await client.query('SELECT pg_current_xact_id()::text id')).rows[0].id;
  const ticket=canonicalPlan({...input,operation:'STAGE',actor:'maker',transaction,digest:'a'.repeat(64),envelope:{}}),key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');let signature:string;
  try{signature=createHmac('sha256',key).update(ticket).digest('hex');}finally{key.fill(0);}
  await expect(client.query('SELECT department_master.evolution_mutate($1,$2)',[ticket,signature])).rejects.toThrow('ACCESS_DENIED');
  await client.query('ROLLBACK');expect(formalFactsDigest()).toBe(before);expect(Number(peer(receipt.name,`SELECT count(*) FROM department_master.evolution_input WHERE request_id=${quote(input.requestId)}::uuid;`))).toBe(0);
 }finally{await client.query('ROLLBACK').catch(()=>{});client.release();await pool.end();restore();}
});

test('REVIEW structurally rejected evolution originals stay quarantined without an authenticated complete input',async()=>{
 const input=await splitInput(),{requestId,jobId:_,revisionId:__,profile:___,event,relations,successors,...control}=input;
 const valid=organizationWorkbook({ORG26:[ORG26_FIELDS,ORG26_FIELDS.map(field=>event[field])],ORG27:[ORG27_FIELDS,...relations.map(row=>ORG27_FIELDS.map(field=>row[field]))],ORG04:[ORG04_FIELDS,...successors.map(entry=>ORG04_FIELDS.map(field=>entry.row[field]))]});
 const parts=Object.fromEntries(unzip(valid,true)),original=parts['xl/worksheets/sheet7.xml']!;
 parts['xl/worksheets/sheet7.xml']=original.replace(/<c r="A2" t="inlineStr">.*?<\/c>/,'<c r="A2"><v>42</v></c>');expect(parts['xl/worksheets/sheet7.xml']).not.toBe(original);
 const bytes=zipText(parts);
 const received=await owner.receiveFile('maker',{requestId,fileRequestId:randomUUID(),job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_QUARANTINED_ORIGINAL',contractId:f.eventContract.id,contractVersionId:f.eventContract.versionId,profile:'CORE',input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_ORGANIZATION_EVOLUTION_V1'}},retentionSeconds:3600,...control,successors:successors.map(({row:_,...entry})=>entry)},bytes);
 expect(received.input).toBeNull();expect(received.issues.length).toBeGreaterThan(0);
 await expect(catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:received.sourceArtifactId})).rejects.toThrow('ACCESS_DENIED');
 expect(Number(peer(receipt.name,`SELECT count(*) FROM governance_catalog.protected_payload WHERE artifact_id=${quote(received.sourceArtifactId)}::uuid;`))).toBe(1);
});

test('REVIEW missing predecessor remains a retained bad input rather than poisoning the stage transaction',async()=>{
 const input=await renameInput(),missing=randomUUID();input.predecessors[0]!.id=missing;input.relations[0]!.from_target_id=missing;input.relations[0]!.to_target_id=missing;
 const staged=await owner.stage('maker',input);
 expect(Number(peer(receipt.name,`SELECT count(*) FROM department_master.evolution_input WHERE id=${quote(staged.inputId)}::uuid;`))).toBe(1);
 expect((await owner.readInput('maker',{inputId:staged.inputId})).predecessors).toEqual(input.predecessors);
 const preview=await owner.preview('maker',{inputId:staged.inputId});expect(preview.heads).toEqual([]);expect(preview.issues).toContainEqual(expect.objectContaining({field:'predecessors',code:'BLOCKED_DEPENDENCY'}));
 expect((await owner.validate('maker',{inputId:staged.inputId})).decision).toBe('BLOCKED');
 const candidate=await owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()}),review=await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});
 expect(review.unit.commands).toEqual([]);expect(review.unit.diff[0]).toMatchObject({predecessors:[]});
 const restore=withdrawSource('maker',input.sourceSystemId);
 try{for(const read of [()=>owner.readInput('maker',{inputId:staged.inputId}),()=>owner.preview('maker',{inputId:staged.inputId}),()=>owner.validate('maker',{inputId:staged.inputId})])await expect(read()).rejects.toThrow('ACCESS_DENIED');}finally{restore();}
});

test('REVIEW an expired material does not force a frozen-plan replay to silently replan',async()=>{
 const input=await renameInput(),j=await f.newJob(),proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:5},Buffer.from('TEST ONLY frozen replay evidence; no hospital policy acceptance'));
 input.decisionEvidenceId=proof.artifactId;for(const impact of input.impacts)impact.evidenceId=proof.artifactId;
 const p=await prepare(input);await new Promise(resolve=>setTimeout(resolve,5100));
 expect(await owner.plan('maker',{inputId:p.staged.inputId,requestId:p.requestId})).toEqual(p.candidate);
 const before=formalFactsDigest();expect(await failureCode(()=>owner.applyUnit('maker',{candidateId:p.candidate.candidateId,requestId:p.requestId}))).not.toBe('ACCEPTED');expect(formalFactsDigest()).toBe(before);
});
