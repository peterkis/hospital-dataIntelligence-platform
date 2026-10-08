import {writeFileSync,existsSync,mkdirSync,readFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,root} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {validationKeys,removeValidationKeys} from './p3-07-validation-keys.mjs';
import {disposeOwnedValidationDatabase} from './owned-validation-disposal.mjs';
import {openCatalog,canonicalPlan} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
import {locationUseFixture} from './p3-07-fixture.ts';
import {startWorkbench} from './workbench-runtime.mjs';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
mkdirSync(resolve(root,'.runtime/vnext/p3-07'),{recursive:true});
const directory=resolve(root,'.runtime/vnext/p3-07'),stopFile=resolve(directory,'browser-stop-'+process.pid),armFile=resolve(directory,'browser-arm-'+process.pid+'.json'),fixtureFile=resolve(directory,'browser-fixtures-'+process.pid+'.json');
const owned=createTemporary('P3-07');let session,catalog,fixture,server;
const readArm=()=>{
 if(!existsSync(armFile))return null;const arm=JSON.parse(readFileSync(armFile,'utf8'));if(!arm||typeof arm!=='object'||Array.isArray(arm))throw new Error('CLOSED_BROWSER_ARM_REQUIRED');
 const allowed=arm.action==='CREATE'?['armId','kind','actor','action','code','deadlineMs']:['armId','kind','actor','action','target','deadlineMs'];
 if(Object.keys(arm).some(key=>!allowed.includes(key))||!['armId','kind','actor','action',arm.action==='CREATE'?'code':'target'].every(key=>key in arm)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(arm.armId)||!['DROP_ONCE','DELAY_ONCE'].includes(arm.kind)||!['maker','maker-alias','reviewer','outsider'].includes(arm.actor)||!['CREATE','REVISE','VERIFY','APPROVE','ENABLE','DISABLE'].includes(arm.action)||!(arm.action==='CREATE'?/^[A-Z][A-Z0-9_]{0,63}$/.test(arm.code):/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(arm.target))||(arm.deadlineMs!==undefined&&(!Number.isSafeInteger(arm.deadlineMs)||arm.deadlineMs<1000||arm.deadlineMs>60000)))throw new Error('CLOSED_BROWSER_ARM_REQUIRED');
 return arm;
};
const beforeListen=async app=>{
 // Fixture-only transport faults occur after the real command returned200.
 // Consume the exact tuple once; retries then reach normal HTTP delivery.
 app.addHook('onSend',async(request,reply,payload)=>{
  if(reply.statusCode!==200||request.routeOptions.url!=='/api/vnext/location-usage-types/command')return payload;
  const arm=readArm(),body=request.body;if(!arm||!body||typeof body!=='object'||actor(request.headers)!==arm.actor||body.action!==arm.action||(arm.action==='CREATE'?body.code!==arm.code:body.target!==arm.target))return payload;
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.requestId))throw new Error('BROWSER_REQUEST_ID_REQUIRED');
  const responseText=typeof payload==='string'?payload:Buffer.isBuffer(payload)?payload.toString('utf8'):null;if(responseText===null)throw new Error('BROWSER_JSON_RESPONSE_REQUIRED');const result=JSON.parse(responseText),releaseFile=resolve(directory,'browser-release-'+process.pid+'-'+arm.armId),captureFile=resolve(directory,'browser-captured-'+process.pid+'-'+arm.armId+'.json');
  renameSync(armFile,resolve(directory,'browser-consumed-'+process.pid+'-'+arm.armId+'.json'));
  const truncatedBody=arm.kind==='DROP_ONCE'?responseText.slice(0,Math.max(1,Math.floor(responseText.length/2))):null;
  const captured={armId:arm.armId,kind:arm.kind,tuple:{actor:arm.actor,action:arm.action,...(arm.action==='CREATE'?{code:arm.code}:{target:arm.target})},capturedRequestId:body.requestId,objectId:result.id,head:result.head,versionId:result.versionId,databaseResultDigest:createHash('sha256').update(canonicalPlan(result)).digest('hex'),responseDigest:createHash('sha256').update(responseText).digest('hex'),releaseFile,committedResponseStatus:200,delivery:arm.kind==='DROP_ONCE'?'TRUNCATED_JSON':'HELD',originalBodyByteLength:Buffer.byteLength(responseText),deliveredBodyByteLength:truncatedBody===null?null:Buffer.byteLength(truncatedBody),deliveredBodyDigest:truncatedBody===null?null:createHash('sha256').update(truncatedBody).digest('hex'),recordedAt:result.recordedAt};
  writeFileSync(captureFile,JSON.stringify(captured,null,2),{flag:'wx'});console.log(JSON.stringify({event:'P3_07_BROWSER_RESPONSE_CAPTURED',captureFile,kind:arm.kind,requestId:body.requestId,releaseFile}));
  // A complete HTTP200 carrying incomplete JSON is unreadable after COMMIT.
  // Receiving response bytes prevents transparent pre-response socket retry.
  if(arm.kind==='DROP_ONCE')return truncatedBody;
  const deadline=Date.now()+(arm.deadlineMs??30000);while(!existsSync(releaseFile)&&!existsSync(stopFile)&&Date.now()<deadline)await delay(100);
  const delivery=existsSync(releaseFile)?'RELEASED':existsSync(stopFile)?'RUNNER_STOP':'FIXTURE_DEADLINE';writeFileSync(resolve(directory,'browser-delivery-'+process.pid+'-'+arm.armId+'.json'),JSON.stringify({...captured,delivery},null,2),{flag:'wx'});console.log(JSON.stringify({event:'P3_07_BROWSER_RESPONSE_RELEASED',armId:arm.armId,delivery}));return payload;
 });
};
try{
 await migrate(owned.receipt);await seed(owned.receipt);
 session=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);
 const provider=validationKeys(owned.receipt),connection=session.connectionString;catalog=await openCatalog(connection,provider);
 fixture=await locationUseFixture(owned.receipt,session.receipt.role,catalog,provider,connection);
 server=await startWorkbench({port:0,validationContext:{receipt:owned.receipt,connection,provider,locationUse:{owner:fixture.owner,usageTypes:fixture.dictionary,actor:request=>actor(request.headers)},beforeListen}});
 const url=server.url+'/admin/vnext/location-usage-types';
 const context={policy:'TEST POLICY ONLY',scope:'SYNTHETIC_OWNED_TEMPORARY',actors:{maker:'content submitter and direct lifecycle maintainer',reviewer:'independent meaning verifier and approver',outsider:'no purpose dictionary authority'},create:{sourceId:fixture.source.id,sourceVersionId:fixture.source.versionId,evidenceId:fixture.artifact.artifactId,validFrom:'2026-01-01T00:00:00',validTo:null},transport:{armFile,dropOnce:{armId:'fresh UUID',kind:'DROP_ONCE',actor:'exact actor',action:'exact command',target:'exact published/draft UUID for nonCREATE',code:'exact unique code for CREATE only'},delayOnce:{armId:'fresh UUID',kind:'DELAY_ONCE',actor:'exact actor',action:'exact command',target:'exact UUID for nonCREATE',code:'exact code for CREATE only',deadlineMs:30000},instructions:['Write one closed arm JSON using either target or code, never both. No HTTP test control exists.','Arm affects only the next successful200 dictionary command matching exact actor+action+target or CREATE code. Other requests are untouched.','DROP_ONCE records capturedRequestId, committed databaseResultDigest and full responseDigest, then delivers a strict JSON prefix with its own digest/length. The actual client cannot parse the committed response. Replay the pending exact request through the page.','DELAY_ONCE records a capture JSON with releaseFile. Switch identity or finish a newer action through the page, then create that exact releaseFile.','delay deadlineMs defaults30000 and is bounded1000..60000; it only prevents a stuck validation runner. No business retry or timeout is changed.','Original arm, capture and delivery JSON files remain separate ignored evidence. Use a fresh armId for each case.','Create the exact stopFile after browser evidence is saved; caller closes only this runtime, fixture Owners and receipt-owned temporary database.']},requiredViewports:[{width:1366,height:768},{width:1920,height:1080}],browserStatus:'NOT_RUN'};
 writeFileSync(fixtureFile,JSON.stringify(context,null,2),{flag:'wx'});
 writeFileSync(resolve(directory,'browser-server.json'),JSON.stringify({url,stopFile,armFile,fixtureFile,receipt:owned.receiptPath,scope:context.scope},null,2));
 console.log(JSON.stringify({status:'P3_07_BROWSER_READY',url,stopFile,armFile,fixtureFile,receipt:owned.receiptPath,scope:context.scope}));
 // This runner supplies a real runtime; it never promotes readiness to browser PASS.
 while(!existsSync(stopFile))await delay(500);
}catch(error){session??=error.ownerSession;throw error;}
finally{await server?.close();await fixture?.close();await catalog?.close();disposeOwnedValidationDatabase(owned.receipt);if(session)dropValidationOwnerSession(session);removeValidationKeys(owned.receipt);}
