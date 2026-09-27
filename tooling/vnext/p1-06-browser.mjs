import {workspaceManualFixture} from './workspace-manual-fixture.ts';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {randomUUID} from 'node:crypto';
import {campusCodeSet} from './campus-fixture.ts';
import {organizationBundleFixture} from './organization-bundle-fixture.ts';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import staticPlugin from '@fastify/static';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {migrate,root,peer,quote} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {LocalSyntheticKeyProvider,openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openOrganization,openCampus,openOperatingRelations,openOrganizationWorkspace,openOrganizationImport} from '../../apps/governance-api/src/modules/organization-master/index.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
const args=process.argv.slice(2);if(args.length>2||args.some(a=>!['--persistent','--reuse-existing'].includes(a))||(args.includes('--reuse-existing')&&!args.includes('--persistent')))throw new Error('CLOSED_COMMAND_REQUIRED');
const persistent=args.includes('--persistent'),reuseExisting=args.includes('--reuse-existing');
const deployment=persistent?await prepareWorkspaceDeployment({reuseExisting}):null;
const owned=deployment?{receipt:deployment.receipt,receiptPath:'.runtime/vnext/creation.json'}:createTemporary('P1-06');let session,owner,catalog,app,fixture,bundle,readOwners;
try{
 if(!deployment){await migrate(owned.receipt);await seed(owned.receipt);session=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp) TO ${session.receipt.role};`);}
 const connection=deployment?.connection??session.connectionString;
 const provider=deployment?.provider??new LocalSyntheticKeyProvider();owner=openOrganizationWorkspace(connection,provider);catalog=await openCatalog(connection,provider);
 bundle=openOrganizationImport(connection,provider);
 if(!reuseExisting){
 fixture=await organizationBundleFixture(owned.receipt,connection,provider,catalog,persistent,persistent);
 const manualTransports=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'});
 if(!manualTransports.some(c=>c.dataset==='ORG01'&&c.profile==='CORE'&&c.status==='PUBLISHED'&&c.definition.templateVersion==='ORG01_MANUAL_CORE_V1'&&c.definition.sourceVersionId===fixture.x.source.versionId))await workspaceManualFixture(catalog);

 const transportDataset=peer(owned.receipt.name,`SELECT c.dataset_id FROM governance_catalog.protected_artifact a JOIN governance_catalog.import_job j ON j.id=a.job_id JOIN governance_catalog.import_contract c ON c.id=j.contract_id WHERE a.id=${quote(fixture.x.artifact.artifactId)}::uuid;`);
 if(!/^[a-f0-9-]{36}$/.test(transportDataset))throw new Error('FIXTURE_TRANSPORT_NOT_FOUND');
 const reviewObjects=`object_id IN (SELECT id FROM governance_catalog.object WHERE kind='DATASET' AND code IN ('ORG01','ORG02','ORG03') UNION SELECT ${quote(fixture.x.source.id)}::uuid UNION SELECT ${quote(transportDataset)}::uuid)`;
 const reviewDatasets=`dataset_id IN (SELECT id FROM governance_catalog.object WHERE kind='DATASET' AND code IN ('ORG01','ORG02','ORG03') UNION SELECT ${quote(transportDataset)}::uuid)`;
 const stewardObjects=`object_id IN (SELECT id FROM governance_catalog.object WHERE kind='DATASET' AND code='ORG02' UNION SELECT ${quote(fixture.x.source.id)}::uuid UNION SELECT ${quote(transportDataset)}::uuid)`;
 const stewardDatasets=`dataset_id IN (SELECT id FROM governance_catalog.object WHERE kind='DATASET' AND code='ORG02' UNION SELECT ${quote(transportDataset)}::uuid)`;
 peer(owned.receipt.name,`INSERT INTO vnext_control.actor VALUES('workspace-reviewer','DEMO_WORKSPACE_REVIEWER',true),('workspace-steward','DEMO_WORKSPACE_STEWARD',true) ON CONFLICT DO NOTHING;
 DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code='workspace-reviewer' AND identity_code='DEMO_WORKSPACE_REVIEWER' AND active) OR NOT EXISTS(SELECT 1 FROM vnext_control.actor WHERE code='workspace-steward' AND identity_code='DEMO_WORKSPACE_STEWARD' AND active) THEN RAISE EXCEPTION 'SYNTHETIC_ACTOR_IDENTITY_MISMATCH';END IF;END $$;
 INSERT INTO vnext_control.actor_grant SELECT 'workspace-reviewer','SYNTHETIC',p FROM unnest(ARRAY['READ','REVIEW']) p ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.actor_grant SELECT 'workspace-steward','SYNTHETIC',p FROM unnest(ARRAY['READ','WRITE']) p ON CONFLICT DO NOTHING;
 INSERT INTO organization_master.access SELECT 'workspace-reviewer','00000000-0000-0000-0000-000000000000',s,p FROM unnest(ARRAY['NORTH','SOUTH']) s CROSS JOIN unnest(ARRAY['READ','REVIEW','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.object_grant SELECT 'workspace-reviewer',object_id,scope,object_kind,campus,purpose,field_group,permission FROM vnext_control.object_grant WHERE actor_code='reviewer' AND scope='SYNTHETIC' AND ${reviewObjects} AND permission IN ('READ','REVIEW') ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.protected_grant SELECT 'workspace-reviewer',dataset_id,campus,purpose,permission FROM vnext_control.protected_grant WHERE actor_code='reviewer' AND ${reviewDatasets} AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ' ON CONFLICT DO NOTHING;`);
 const existingDivision=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).some(c=>c.status==='PUBLISHED'&&c.definition.codeSets.some(s=>s.field==='admin_division_code'&&s.status==='SYNTHETIC_ADOPTED'));if(!persistent||!existingDivision)await campusCodeSet(catalog,fixture.x.source.versionId);const temporalSubject=await fixture.x.createSubject();const beforeLicense=(await fixture.x.org.read('maker',{mode:'EXACT',id:temporalSubject.id,version:temporalSubject.version}))[0].recordedAt;const futureLicense=await fixture.x.addLicense(temporalSubject,'2030-01-01T00:00:00');
 const assigned=await fixture.x.createCampus('DEMO 院区管家维护院区');
 const currentSubject=await fixture.x.orgApply({...fixture.x.common,action:'CREATE',facts:{legalName:'DEMO 当前证照机构',entityNature:'DEMO',authority:'DEMO office',legalAddress:'DEMO address',registrationEvidence:fixture.x.artifact.artifactId},identifiers:[{kind:'INSTITUTION_CODE',namespace:'DEMO_REGISTRY',value:randomUUID()}]});const currentLicense=await fixture.x.addLicense(currentSubject);fixture.x.grantPair(currentSubject.id,assigned.id);peer(owned.receipt.name,`INSERT INTO organization_master.operating_access SELECT 'workspace-reviewer','${currentSubject.id}'::uuid,'${assigned.id}'::uuid,p FROM unnest(ARRAY['READ','REVIEW','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;`);
 peer(owned.receipt.name,`INSERT INTO organization_master.access SELECT 'workspace-steward','${assigned.id}'::uuid,'NORTH',p FROM unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p;INSERT INTO vnext_control.object_grant SELECT 'workspace-steward',object_id,scope,object_kind,campus,purpose,field_group,permission FROM vnext_control.object_grant WHERE actor_code='maker' AND scope='SYNTHETIC' AND ${stewardObjects} AND permission='READ' ON CONFLICT DO NOTHING;INSERT INTO vnext_control.protected_grant SELECT 'workspace-steward',dataset_id,campus,purpose,permission FROM vnext_control.protected_grant WHERE actor_code='maker' AND ${stewardDatasets} AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission IN ('READ','STORE') ON CONFLICT DO NOTHING;`);
 mkdirSync('.runtime/vnext/p1-06',{recursive:true});writeFileSync('.runtime/vnext/p1-06/DEMO-organization.xlsx',fixture.workbook());writeFileSync('.runtime/vnext/p1-06/browser-fixture.json',JSON.stringify({assigned,temporalSubject,beforeLicense,futureLicense,currentSubject,currentLicense,input:fixture.input}));
 }else{readOwners={org:openOrganization(connection,provider),campus:openCampus(connection,provider),operating:openOperatingRelations(connection,provider)};}
 const domains=fixture?.x??readOwners;
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',{owner:domains.org,actor:r=>actor(r.headers)},{owner:domains.campus,references:domains.campus.references,actor:r=>actor(r.headers)},{owner:domains.operating,actor:r=>actor(r.headers)},{owner:bundle,actor:r=>actor(r.headers)},{owner,actor:r=>actor(r.headers)});
 const holdFile=resolve(root,'.runtime/vnext/p1-06/hold-draft-read-'+process.pid);
 app.addHook('onSend',async(request,_reply,payload)=>{if(request.url==='/api/vnext/organization-workspace/drafts/read'&&request.headers['x-catalog-actor']==='maker'&&existsSync(holdFile)&&readFileSync(holdFile,'utf8').trim()==='HOLD'){console.log(JSON.stringify({status:'WORKSPACE_TEST_REPLY_HELD'}));const began=performance.now();while(existsSync(holdFile)&&readFileSync(holdFile,'utf8').trim()==='HOLD'&&performance.now()-began<15000)await delay(25);}return payload;});
 await app.register(staticPlugin,{root:resolve(root,'apps/admin-web/dist-vnext'),prefix:'/admin/vnext/'});
 app.get('/admin/vnext/organizations',(_request,reply)=>reply.sendFile('vnext.html'));
 await app.listen({host:'127.0.0.1',port:4317});
 mkdirSync('.runtime/vnext/p1-06',{recursive:true});const stopFile=resolve(root,'.runtime/vnext/p1-06/stop-'+process.pid);
 writeFileSync('.runtime/vnext/p1-06/browser-server.json',JSON.stringify({url:'http://127.0.0.1:4317/admin/vnext/organizations',stopFile,holdFile,receipt:owned.receiptPath,persistent,evidence:deployment?.evidence??null}));
 console.log(JSON.stringify({status:'WORKSPACE_BROWSER_READY',stopFile,persistent,reuseExisting}));while(!existsSync(stopFile))await delay(500);if(deployment)await deployment.complete();
}finally{await app?.close();await owner?.close();await bundle?.close();await fixture?.close();if(readOwners){await readOwners.org.close();await readOwners.campus.close();await readOwners.operating.close();}await catalog?.close();if(!deployment)dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);}
