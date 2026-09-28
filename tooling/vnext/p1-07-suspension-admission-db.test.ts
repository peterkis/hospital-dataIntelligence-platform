import {afterAll,expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import type {OperatingCommand} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {operatingScenario,prepare} from './operating-scenario.js';
import {peer,quote} from './lineage.mjs';

const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')) as {name:string};
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!;
const provider=new LocalSyntheticKeyProvider();
const catalog=await openCatalog(connection,provider);
const scenario=await operatingScenario(receipt,connection,provider,catalog);
afterAll(async()=>{await scenario.close();await catalog.close();});

const target=(fact:{id:string;version:string})=>({owner:'organization-master/campus' as const,id:fact.id,expectedVersion:fact.version});
const formalCount=(campusId:string)=>Number(peer(receipt.name,`SELECT count(*)::text FROM organization_master.operating_object WHERE campus_id=${quote(campusId)}::uuid;`));

test('profile revision cannot end suspension for planning or final operating admission',async()=>{
 const subject=await scenario.createSubject();
 const campus=await scenario.createCampus('DEMO suspended profile revision');
 scenario.grantPair(subject.id,campus.id);
 const relation:OperatingCommand={
  ...scenario.common,
  validFrom:'2026-03-01T00:00:00',
  ...scenario.endpoints(subject,campus),
  action:'ESTABLISH',
  evidence:scenario.artifact.artifactId,
  facts:{role:'MANAGER',relationTypeText:'DEMO suspension gate',primary:'N',catalog:scenario.codeSet.reference,services:[],licenseScopeText:null,scopeTargets:[]},
 };
 const approvedBeforeSuspension=await prepare(scenario.operating,scenario.operatingInput(relation));
 const suspended=await scenario.campusApply({...scenario.common,action:'SUSPEND',target:target(campus),evidence:scenario.artifact.artifactId,sourceOperationStatus:'SUSPENDED',reason:'DEMO temporary stop'});
 const current=await scenario.campus.references.read('maker',{id:campus.id});
 if(!current.facts)throw new Error('CAMPUS_PROFILE_REQUIRED');
 await scenario.campusApply({...scenario.common,action:'REVISE',target:target(suspended),evidence:scenario.artifact.artifactId,sourceOperationStatus:'SUSPENDED',facts:{...current.facts,campusName:`${current.facts.campusName} corrected`}});
 const events=JSON.parse(peer(receipt.name,`SELECT coalesce(jsonb_agg(jsonb_build_object('action',e.action,'operational',o.event_id IS NOT NULL) ORDER BY e.number),'[]'::jsonb)::text FROM organization_master.campus_event e LEFT JOIN organization_master.campus_operation o ON o.event_id=e.id WHERE e.campus_id=${quote(campus.id)}::uuid;`)) as Array<{action:string;operational:boolean}>;
 expect(events.at(-2)).toEqual({action:'SUSPEND',operational:true});
 expect(events.at(-1)).toEqual({action:'REVISE',operational:false});
 expect(await scenario.campus.references.read('maker',{id:campus.id})).toMatchObject({operationStatus:'SUSPENDED'});
 const before=formalCount(campus.id);
 await expect(scenario.operating.applyUnit('maker',approvedBeforeSuspension)).rejects.toThrow('CAMPUS_SUSPENDED');
 expect(await scenario.operating.resumeOutcome('maker',approvedBeforeSuspension)).toBeNull();
 await expect(prepare(scenario.operating,scenario.operatingInput(relation))).rejects.toThrow('CAMPUS_SUSPENDED');
 expect(formalCount(campus.id)).toBe(before);
});
