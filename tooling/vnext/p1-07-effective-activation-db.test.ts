import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider,type OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,type CampusCommand} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {operatingScenario} from './operating-scenario.js';
import {inspect,migrationFiles} from './lineage.mjs';
import {workspaceStartupPrefix} from './workspace-migrations.mjs';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,scenario:Awaited<ReturnType<typeof operatingScenario>>,trial:OwnerFact;
const target=(node:OwnerFact)=>({owner:'organization-master/campus' as const,id:node.id,expectedVersion:node.version});
const activate=(node:OwnerFact,validFrom='2026-04-01T00:00:00',validTo:string|null=null):CampusCommand=>({...scenario.common,validFrom,validTo,action:'ACTIVATE',target:target(node),evidence:scenario.artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING'});
async function paused(){const node=await scenario.activateCampus(await scenario.createCampus());return scenario.campusApply({...scenario.common,validFrom:'2026-02-01T00:00:00',action:'SUSPEND',target:target(node),evidence:scenario.artifact.artifactId,sourceOperationStatus:'SUSPENDED',reason:'DEMO_PAUSE'});}
async function resumed(validTo:string|null=null){const node=await paused();return scenario.campusApply({...scenario.common,validFrom:'2026-03-01T00:00:00',validTo,action:'RESUME',target:target(node),evidence:scenario.artifact.artifactId,sourceOperationStatus:'TRIAL_RUNNING',state:'TRIAL_RUNNING'});}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);scenario=await operatingScenario(receipt,connection,provider,catalog);workspace=openOrganizationWorkspace(connection,provider);trial=await resumed();
 if(process.env['HDIP_REVIEW_CI_ACTIVATION_UPGRADE']==='1'){
  const before=await inspect(receipt);expect(before.ledger).toHaveLength(79);expect(()=>workspaceStartupPrefix(migrationFiles(),before.ledger)).toThrow('WORKSPACE_MIGRATION_REQUIRED');
  expect(await workspace.objectContext('maker',{kind:'CAMPUS',id:trial.id})).toMatchObject({canActivate:false});
  // With the corrected Owner, the old SQL write guard still reproduces P2.
  await expect(scenario.campusApply(activate(trial))).rejects.toThrow('BLOCKED_DEPENDENCY');
  expect((await scenario.campus.references.read('maker',{id:trial.id})).head).toBe(trial.version);
  const {upgradeEffectiveActivation}=await import('./review-ci-database.mjs');await upgradeEffectiveActivation(receipt);
  const after=await inspect(receipt);expect(workspaceStartupPrefix(migrationFiles(),after.ledger)).toBe(86);
 }
});
afterAll(async()=>{await workspace?.close();await scenario?.close();await catalog?.close();});
test('explicit trial resumption permits a later approved activation through the real SQL writer',async()=>{
 expect(await workspace.objectContext('maker',{kind:'CAMPUS',id:trial.id})).toMatchObject({canActivate:true,terminal:false});
 const running=await scenario.campusApply(activate(trial));expect(running.id).toBe(trial.id);
 expect(await scenario.campus.references.read('maker',{id:trial.id})).toMatchObject({head:running.version,operationStatus:'RUNNING'});
});
test('profile-only revision cannot enable activation during an effective suspension',async()=>{
 const node=await paused();const history=await scenario.campus.references.history('maker',node.id);const draft=await workspace.prepareRevision('maker',{kind:'CAMPUS',id:node.id,version:history.versions.at(-1)!.version});if(draft.domain!=='ORG02')throw new Error('ORG02_REQUIRED');
 const revised=await scenario.campusApply({...draft.command,validFrom:'2026-03-01T00:00:00',sourceOperationStatus:'SUSPENDED'} as CampusCommand);
 expect(await workspace.objectContext('maker',{kind:'CAMPUS',id:node.id})).toMatchObject({canActivate:false});
 await expect(scenario.campusApply(activate(revised))).rejects.toThrow('BLOCKED_DEPENDENCY');
 expect((await scenario.campus.references.read('maker',{id:node.id})).head).toBe(revised.version);
});
test('activation must fit inside a finite resumed period and cannot erase its suspended remainder',async()=>{
 const node=await resumed('2026-05-01T00:00:00');
 await expect(scenario.campusApply(activate(node,'2026-04-01T00:00:00',null))).rejects.toThrow('BLOCKED_DEPENDENCY');
 await expect(scenario.campusApply(activate(node,'2026-04-01T00:00:00','2026-06-01T00:00:00'))).rejects.toThrow('BLOCKED_DEPENDENCY');
 const running=await scenario.campusApply(activate(node,'2026-04-01T00:00:00','2026-05-01T00:00:00'));expect(running.id).toBe(node.id);
 expect(await scenario.campus.references.read('maker',{id:node.id,businessAt:'2026-05-01T00:00:00'})).toMatchObject({operationStatus:'SUSPENDED'});
 expect(await workspace.objectContext('maker',{kind:'CAMPUS',id:node.id})).toMatchObject({canActivate:false});
});
test('a later suspension blocks activation again while retaining the half-open pre-suspension window',async()=>{
 const node=await resumed();const stopped=await scenario.campusApply({...scenario.common,validFrom:'2026-06-01T00:00:00',action:'SUSPEND',target:target(node),evidence:scenario.artifact.artifactId,sourceOperationStatus:'SUSPENDED',reason:'DEMO_SECOND_PAUSE'});
 expect(await workspace.objectContext('maker',{kind:'CAMPUS',id:node.id})).toMatchObject({canActivate:false});
 await expect(scenario.campusApply(activate(stopped,'2026-07-01T00:00:00'))).rejects.toThrow('BLOCKED_DEPENDENCY');
 const bounded=await scenario.campusApply(activate(stopped,'2026-04-01T00:00:00','2026-06-01T00:00:00'));expect(bounded.id).toBe(node.id);
 expect(await scenario.campus.references.read('maker',{id:node.id,businessAt:'2026-06-01T00:00:00'})).toMatchObject({operationStatus:'SUSPENDED'});
});

test('approved RUNNING resumption remains supported without inventing a mandatory trial stage',async()=>{
 const stopped=await paused();
 const running=await scenario.campusApply({...scenario.common,validFrom:'2026-03-01T00:00:00',action:'RESUME',target:target(stopped),evidence:scenario.artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING'});
 expect(running.id).toBe(stopped.id);
 expect(await scenario.campus.references.read('maker',{id:running.id})).toMatchObject({operationStatus:'RUNNING'});
 expect(await workspace.objectContext('maker',{kind:'CAMPUS',id:running.id})).toMatchObject({canActivate:true});
});

test('a future suspension without explicit resumption still forbids a backdated activation source capability',async()=>{
 const node=await scenario.activateCampus(await scenario.createCampus());
 const stopped=await scenario.campusApply({...scenario.common,validFrom:'2099-01-01T00:00:00',action:'SUSPEND',target:target(node),evidence:scenario.artifact.artifactId,sourceOperationStatus:'SUSPENDED',reason:'DEMO_FUTURE_PAUSE'});
 expect(await workspace.objectContext('maker',{kind:'CAMPUS',id:node.id})).toMatchObject({canActivate:false});
 await expect(scenario.campusApply(activate(stopped,'2026-04-01T00:00:00','2099-01-01T00:00:00'))).rejects.toThrow('BLOCKED_DEPENDENCY');
 expect((await scenario.campus.references.read('maker',{id:node.id})).head).toBe(stopped.version);
});
