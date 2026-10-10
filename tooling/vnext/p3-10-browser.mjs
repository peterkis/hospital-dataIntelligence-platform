import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createTemporary} from './fresh.mjs';
import {migrate,peer,root,inspect} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {disposeOwnedValidationDatabase} from './owned-validation-disposal.mjs';
import {validationKeys,removeValidationKeys} from './p3-10-validation-keys.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {prepareCareBrowser} from './p3-10-browser-fixture.ts';
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const directory=root+'/.runtime/vnext/p3-10',stopFile=directory+'/browser-stop-'+process.pid,restartFile=directory+'/browser-restart-'+process.pid,armFile=directory+'/browser-arm-'+process.pid+'.json';mkdirSync(directory,{recursive:true});const owned=createTemporary('P3-10');let session,child,port=0;
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
async function launch(){const process_=fork('tooling/vnext/p3-10-browser-engine.mjs',[],{execArgv:['--import','tsx'],env:{...process.env,VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-10',VNEXT_P3_10_PORT:String(port),VNEXT_P3_10_ARM:armFile,GOMAXPROCS:'1'},stdio:['ignore','inherit','inherit','ipc'],windowsHide:true});child=process_;return new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(new Error('BROWSER_STARTUP_TIMEOUT')),60000);process_.once('message',message=>{clearTimeout(deadline);assert.equal(message.event,'READY');port=Number(new URL(message.url).port);resolve(message);});process_.once('exit',code=>{clearTimeout(deadline);reject(new Error('BROWSER_STARTUP_FAILED:'+code));});});}
async function stop(){if(!child||child.exitCode!==null)return;const process_=child;process_.send({action:'STOP'});await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(new Error('BROWSER_SHUTDOWN_TIMEOUT')),30000);process_.once('exit',code=>{clearTimeout(deadline);code===0?resolve():reject(new Error('BROWSER_SHUTDOWN_FAILED:'+code));});});child=null;}
try{
 await migrate(owned.receipt);await seed(owned.receipt);session=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);const fixtures=await prepareCareBrowser(owned.receipt,session.receipt.role,session.connectionString,validationKeys(owned.receipt)),fixtureFile=directory+'/browser-fixtures-'+process.pid+'.json';writeFileSync(fixtureFile,JSON.stringify(fixtures,null,2),{flag:'wx'});const keyPath=directory+'/'+owned.receipt.name+'.secret.json',keysDigest=digest(keyPath),receiptDigest=digest(owned.receiptPath),first=await launch();
 const readiness={event:'P3_10_BROWSER_READY',url:first.url+'/admin/vnext/care-space',pid:first.pid,scope:fixtures.scope,receipt:owned.receiptPath,stopFile,restartFile,armFile,fixtureFile,browser:'NOT_RUN',restart:'NOT_RUN'};writeFileSync(directory+'/browser-server.json',JSON.stringify(readiness,null,2));console.log(JSON.stringify(readiness));let count=0;
 while(!existsSync(stopFile)){if(child?.exitCode!==null)throw new Error('BROWSER_PROCESS_EXITED');if(existsSync(restartFile)){const old=child.pid,before=await inspect(owned.receipt);await stop();const next=await launch();assert.notEqual(next.pid,old);assert.equal(digest(keyPath),keysDigest);assert.equal(digest(owned.receiptPath),receiptDigest);assert.deepEqual((await inspect(owned.receipt)).ledger,before.ledger);const report={event:'P3_10_NEW_PROCESS_STARTED',oldPid:old,newPid:next.pid,url:next.url,receiptPreserved:true,keyBytesPreserved:true,ledgerPreserved:true,recovery:'PENDING_BROWSER_RESUME'};writeFileSync(directory+'/browser-restart-'+process.pid+'-'+(++count)+'.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));const {renameSync}=await import('node:fs');renameSync(restartFile,restartFile+'.consumed-'+count);}await delay(500);}
}catch(error){session??=error.ownerSession;throw error;}
finally{await stop();disposeOwnedValidationDatabase(owned.receipt);if(session)dropValidationOwnerSession(session);removeValidationKeys(owned.receipt);}
