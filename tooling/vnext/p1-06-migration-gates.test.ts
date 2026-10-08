import {beforeEach,test,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

type Entry={id:string;sha256:string};
// These are orchestration unit tests. No WSL service, installed key file or
// user's persistent database is touched. Real SQL upgrades have separate tests.
const state=vi.hoisted(()=>({
 receipt:{name:'hdi_mc_vnext_0123456789abcdef',oid:'12345',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
 ledger:[] as Entry[],files:undefined as undefined|Array<Entry&{sql:string}>,
 events:[] as string[],writes:[] as Array<{path:string;content:string}>,sql:[] as string[],
 stopAt:undefined as number|undefined,typesStatus:0,
 role:'hdi_owner_0123456789abcdef',ownerDatabase:'hdi_mc_vnext_0123456789abcdef',
 rowSnapshots:[] as string[][],
}));
vi.mock('./lineage.mjs',async importOriginal=>{
 const real=await importOriginal<typeof import('./lineage.mjs')>();
 const view=()=>({identity:{name:state.receipt.name,oid:state.receipt.oid},ledger:state.ledger,tables:['organization_master.subject']});
 return {...real,
  readReceipt:vi.fn(()=>state.receipt),
  migrationFiles:vi.fn(()=>state.files??real.migrationFiles()),
  inspect:vi.fn(async()=>{state.events.push('inspect');return view();}),
  migrate:vi.fn(async(_receipt:unknown,files:Array<Entry>)=>{state.events.push('migrate');state.ledger=files.slice(0,state.stopAt??files.length).map(({id,sha256})=>({id,sha256}));return view();}),
  peer:vi.fn((_name:string,sql:string)=>{state.sql.push(sql);return sql.includes('jsonb_agg')?JSON.stringify(state.rowSnapshots.shift()??[]):'[]';}),
 };
});
vi.mock('./owner-service.mjs',()=>({ownerServiceConnection:vi.fn(async()=>{state.events.push('connection');return 'postgresql://'+state.role+':unit-only@127.0.0.1:55434/'+state.receipt.name;})}));
vi.mock('./organization-keys.mjs',()=>({organizationKeys:vi.fn(()=>{state.events.push('keys');return {};})}));
vi.mock('./department-provisioning.mjs',()=>({assertDepartmentProvisioned:vi.fn(async()=>{state.events.push('department-provisioned');})}));
vi.mock('./organization-mapping-provisioning.mjs',()=>({assertOrganizationMappingsProvisioned:vi.fn(async()=>{state.events.push('mapping-provisioned');})}));
vi.mock('./organization-identifier-provisioning.mjs',()=>({assertOrganizationIdentifiersProvisioned:vi.fn(async()=>{state.events.push('identifier-provisioned');})}));
vi.mock('./organization-evolution-provisioning.mjs',()=>({assertOrganizationEvolutionsProvisioned:vi.fn(async()=>{state.events.push('evolution-provisioned');})}));
vi.mock('./department-impact-provisioning.mjs',()=>({assertDepartmentImpactsProvisioned:vi.fn(async()=>{state.events.push('impacts-provisioned');})}));
vi.mock('./department-lifecycle-provisioning.mjs',()=>({assertDepartmentLifecycleProvisioned:vi.fn(async()=>{state.events.push('lifecycle-provisioned');})}));
vi.mock('./p3-06-provisioning.mjs',()=>({assertLocationProvisioned:vi.fn(async()=>{state.events.push('location-provisioned');})}));
vi.mock('./p3-01-provisioning.mjs',()=>({assertBusinessUnitProvisioned:vi.fn(async()=>{state.events.push('business-unit-provisioned');})}));
vi.mock('./p3-03-provisioning.mjs',()=>({assertNursingUnitProvisioned:vi.fn(async()=>{state.events.push('nursing-unit-provisioned');})}));
vi.mock('./p3-08-provisioning.mjs',()=>({assertUnitCapabilityProvisioned:vi.fn(async()=>{state.events.push('capability-provisioned');})}));
vi.mock('./p3-09-provisioning.mjs',()=>({assertSubjectsProvisioned:vi.fn(async()=>{state.events.push('subjects-provisioned');})}));
vi.mock('./p3-04-provisioning.mjs',()=>({assertUnitWardProvisioned:vi.fn(async()=>{state.events.push('unit-ward-provisioned');})}));
vi.mock('./p3-05-provisioning.mjs',()=>({provisionWardNursing:vi.fn(()=>{state.events.push('ward-nursing-provision');}),assertWardNursingProvisioned:vi.fn(async()=>{state.events.push('ward-nursing-provisioned');})}));
vi.mock('./p3-07-provisioning.mjs',()=>({assertLocationUseProvisioned:vi.fn(async()=>{state.events.push('location-use-provisioned');})}));
vi.mock('../../apps/governance-api/src/modules/location-master/index.ts',async importOriginal=>{const real=await importOriginal<typeof import('../../apps/governance-api/src/modules/location-master/index.ts')>();const owner=(name:string)=>vi.fn(()=>{state.events.push(name);return {close:async()=>{state.events.push('close-'+name);}};});return {...real,openLocation:owner('location'),openLocationUsageTypes:owner('usage-types'),openLocationUse:owner('location-use')};});
vi.mock('./p3-02-provisioning.mjs',()=>({assertWardProvisioned:vi.fn(async()=>{state.events.push('ward-provisioned');})}));
vi.mock('../../apps/governance-api/src/modules/care-organization/index.ts',async importOriginal=>{const real=await importOriginal<typeof import('../../apps/governance-api/src/modules/care-organization/index.ts')>();return {...real,openWardNursingCoverage:vi.fn(()=>{state.events.push('ward-nursing');return {close:async()=>{}};}),openUnitWardRelations:vi.fn(()=>{state.events.push('unit-ward');return {close:async()=>{}};}),openBusinessUnit:vi.fn(()=>{state.events.push('business-unit');return {close:async()=>{}};}),openNursingUnit:vi.fn(()=>{state.events.push('nursing-unit');return {close:async()=>{}};}),openUnitCapabilities:vi.fn(()=>{state.events.push('unit-capability');return {close:async()=>{}};}),openWard:vi.fn(()=>{state.events.push('ward');return {close:async()=>{}};})};});
vi.mock('./hierarchy-provisioning.mjs',async importOriginal=>{
 const real=await importOriginal<typeof import('./hierarchy-provisioning.mjs')>();
 return {...real,assertHierarchyProvisioned:vi.fn(async()=>{state.events.push('hierarchy-provisioned');})};
});
vi.mock('./p1-02-preservation.mjs',()=>({predecessorTables:(tables:string[])=>tables,predecessorDigest:()=> 'unit-row-digest'}));
vi.mock('node:fs',async importOriginal=>{
 const real=await importOriginal<typeof import('node:fs')>();
 return {...real,
  readFileSync:(path:unknown,...args:unknown[])=>{
   if(path==='.runtime/vnext/p1-01/keys.secret.json')return Buffer.from('unit-only-key-bytes');
   if(path==='.runtime/vnext/p0-09/owner-service.json')return JSON.stringify({role:state.role,roleOid:'54321',database:state.ownerDatabase,databaseOid:state.receipt.oid,databaseRequestId:state.receipt.requestId});
   return Reflect.apply(real.readFileSync,real,[path,...args]);
  },
  mkdirSync:(path:unknown,...args:unknown[])=>String(path).startsWith('.runtime/vnext/p1-06')?undefined:Reflect.apply(real.mkdirSync,real,[path,...args]),
  writeFileSync:(path:unknown,content:unknown,...args:unknown[])=>{
   if(String(path).startsWith('.runtime/vnext/p1-06')){state.writes.push({path:String(path),content:String(content)});return;}
   return Reflect.apply(real.writeFileSync,real,[path,content,...args]);
  },
 };
});
vi.mock('node:child_process',async importOriginal=>{
 const real=await importOriginal<typeof import('node:child_process')>();
 return {...real,spawnSync:(command:unknown,args:unknown[],...rest:unknown[])=>{
  if(args[0]==='tooling/vnext/managed.mjs'){state.events.push('types-verify');return {status:state.typesStatus};}
  return Reflect.apply(real.spawnSync,real,[command,args,...rest]);
 }};
});
vi.mock('../../apps/governance-api/src/modules/governance-catalog/index.ts',async importOriginal=>{
 const real=await importOriginal<typeof import('../../apps/governance-api/src/modules/governance-catalog/index.ts')>();
 return {...real,openParameterValues:vi.fn(()=>{state.events.push('parameter-values');return {close:async()=>{}};}),openCatalog:vi.fn(async()=>{state.events.push('catalog');return {close:async()=>{}};})};
});
vi.mock('../../apps/governance-api/src/modules/organization-master/index.ts',async importOriginal=>{
 const real=await importOriginal<typeof import('../../apps/governance-api/src/modules/organization-master/index.ts')>();
 const owner=(name:string)=>vi.fn(()=>{state.events.push(name);return {references:{},close:async()=>{}};});
 return {...real,openOrganization:owner('organization'),openCampus:owner('campus'),openOperatingRelations:owner('operating'),openOrganizationImport:owner('bundle'),openOrganizationWorkspace:owner('workspace')};
});
vi.mock('../../apps/governance-api/src/composition/build-vnext-catalog.ts',()=>({buildCatalogServer:vi.fn(async(...args:unknown[])=>{
 state.events.push(args[6]?'workspace-routes':'catalog-routes');
 return {register:async()=>{},get:()=>{},listen:async()=>{state.events.push('listen');},close:async()=>{}};
})}));

const {migrationFiles,migrate}=await import('./lineage.mjs');
const {workspaceMigration,workspaceReleaseFiles,workspaceStartupPrefix,workspaceDeploymentPrefix}=await import('./workspace-migrations.mjs');
const {startWorkbench}=await import('./workbench-runtime.mjs');
const {prepareWorkspaceDeployment}=await import('./p1-06-deployment.mjs');
const files=migrationFiles();
const ledger=(count=files.length)=>files.slice(0,count).map(({id,sha256}:Entry)=>({id,sha256}));
beforeEach(()=>{
 vi.clearAllMocks();state.ledger=ledger();state.files=undefined;state.events=[];state.writes=[];state.sql=[];state.stopAt=undefined;state.typesStatus=0;state.ownerDatabase=state.receipt.name;state.rowSnapshots=[];
});

for(const prefix of [71,72,73,74,75,76,77,78,79,80,81,87,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204])test(`persistent startup rejects prefix ${prefix} before credentials, keys, Owners or listen`,async()=>{
 state.ledger=ledger(prefix);await expect(startWorkbench({persistent:true})).rejects.toThrow('WORKSPACE_MIGRATION_REQUIRED');
 expect(state.events).toEqual(['inspect']);expect(state.sql).toEqual([]);expect(state.writes).toEqual([]);
});
test('complete checksummed release enables workspace and takes one ledger snapshot',async()=>{
 const runtime=await startWorkbench({persistent:true});
 try{expect(state.events[0]).toBe('inspect');expect(state.events.filter(v=>v==='inspect')).toHaveLength(1);expect(state.events).toContain('workspace');expect(state.events).toContain('workspace-routes');expect(state.events.indexOf('evolution-provisioned')).toBeLessThan(state.events.indexOf('listen'));expect(state.events).toContain('ward-nursing-provisioned');expect(state.events).toContain('ward-nursing');expect(state.events.indexOf('ward-nursing-provisioned')).toBeLessThan(state.events.indexOf('ward-nursing'));expect(state.events.indexOf('ward-nursing')).toBeLessThan(state.events.indexOf('listen'));expect(state.events.at(-1)).toBe('listen');}finally{await runtime.close();}
});
test('missing evolution provisioning prevents the repaired persistent service from listening',async()=>{
 const {assertOrganizationEvolutionsProvisioned}=await import('./organization-evolution-provisioning.mjs');
 vi.mocked(assertOrganizationEvolutionsProvisioned).mockRejectedValueOnce(new Error('ORGANIZATION_EVOLUTION_PROVISIONING_REQUIRED'));
 await expect(startWorkbench({persistent:true})).rejects.toThrow('ORGANIZATION_EVOLUTION_PROVISIONING_REQUIRED');expect(state.events).not.toContain('listen');
});
test('missing business unit provisioning prevents listening before the new Owner is constructed',async()=>{const {assertBusinessUnitProvisioned}=await import('./p3-01-provisioning.mjs');vi.mocked(assertBusinessUnitProvisioned).mockRejectedValueOnce(new Error('BUSINESS_UNIT_OWNER_NOT_PROVISIONED'));await expect(startWorkbench({persistent:true})).rejects.toThrow('BUSINESS_UNIT_OWNER_NOT_PROVISIONED');expect(state.events).not.toContain('business-unit');expect(state.events).not.toContain('listen');});
test('missing Ward provisioning prevents construction of business Owners and listening',async()=>{const {assertWardProvisioned}=await import('./p3-02-provisioning.mjs');vi.mocked(assertWardProvisioned).mockRejectedValueOnce(new Error('WARD_OWNER_NOT_PROVISIONED'));await expect(startWorkbench({persistent:true})).rejects.toThrow('WARD_OWNER_NOT_PROVISIONED');expect(state.events).not.toContain('business-unit');expect(state.events).not.toContain('ward');expect(state.events).not.toContain('listen');});
test('missing impact provisioning prevents persistent service from listening',async()=>{
 const {assertDepartmentImpactsProvisioned}=await import('./department-impact-provisioning.mjs');
 vi.mocked(assertDepartmentImpactsProvisioned).mockRejectedValueOnce(new Error('DEPARTMENT_IMPACT_PROVISIONING_REQUIRED'));
 await expect(startWorkbench({persistent:true})).rejects.toThrow('DEPARTMENT_IMPACT_PROVISIONING_REQUIRED');expect(state.events).not.toContain('listen');
});
test('pre-workspace prefix 70 retains catalog routing without a workspace Owner',async()=>{
 state.ledger=ledger(70);const runtime=await startWorkbench({persistent:true});
 try{expect(state.events).toContain('catalog-routes');expect(state.events).not.toContain('workspace');expect(state.events).toContain('listen');}finally{await runtime.close();}
});
for(const defect of ['checksum','hole','reordered','extra'] as const)test(`startup refuses ${defect} ledger instead of trusting its count`,async()=>{
 if(defect==='checksum')state.ledger[72]={...state.ledger[72]!,sha256:'0'.repeat(64)};
 if(defect==='hole')state.ledger.splice(70,1);
 if(defect==='reordered')[state.ledger[71],state.ledger[72]]=[state.ledger[72]!,state.ledger[71]!];
 if(defect==='extra')state.ledger.push({id:'0078_unknown',sha256:'0'.repeat(64)});
 await expect(startWorkbench({persistent:true})).rejects.toThrow('LINEAGE_MISMATCH');expect(state.events).toEqual(['inspect']);
});
test('a release missing the security migration cannot enable the workspace',async()=>{
 state.files=files.slice(0,-1);state.ledger=ledger(files.length-1);
 await expect(startWorkbench({persistent:true})).rejects.toThrow('WORKSPACE_RELEASE_MANIFEST_MISMATCH');expect(state.events).toEqual(['inspect']);
});
test('unexpected future migration requires an explicit shared release-boundary update',()=>{
  expect(()=>workspaceReleaseFiles([...files,{id:`${String(files.length+1).padStart(4,'0')}_unreviewed`,sha256:'0'.repeat(64),sql:''}])).toThrow('WORKSPACE_RELEASE_MANIFEST_MISMATCH');
});

for(const prefix of [70,71,72,73,74,75,76,77,78,79,80,81,130,131,132])test(`deployment upgrades supported prefix ${prefix} to the entire release`,async()=>{
 state.ledger=ledger(prefix);const deployment=await prepareWorkspaceDeployment();await deployment.complete();
 expect(migrate).toHaveBeenCalledWith(state.receipt,files);expect(state.ledger).toEqual(ledger());
 const report=state.writes.find(v=>v.path.endsWith('.migration.json'))!;expect(JSON.parse(report.content)).toMatchObject({status:'PASS',previousPrefix:prefix,currentPrefix:files.length});
 expect(state.events.indexOf('migrate')).toBeLessThan(state.events.indexOf('connection'));
 expect(state.sql.some(sql=>sql.includes('GRANT EXECUTE ON FUNCTION organization_master.workspace_save'))).toBe(true);
});
for(const prefix of [70,71,72,73,74,75,76,77,78,79,80,81,130,131,132])test(`reuse-existing refuses prefix ${prefix} without attempting migration or grants`,async()=>{
 state.ledger=ledger(prefix);await expect(prepareWorkspaceDeployment({reuseExisting:true})).rejects.toThrow('WORKSPACE_ALREADY_DEPLOYED_REQUIRED');
 expect(state.events).toEqual(['inspect']);expect(state.writes).toEqual([]);expect(state.sql).toEqual([]);
});
test('reuse-existing verifies the current release without migration or new grants',async()=>{
 const deployment=await prepareWorkspaceDeployment({reuseExisting:true});await deployment.complete();
 expect(migrate).not.toHaveBeenCalled();expect(state.sql.every(sql=>!sql.includes('GRANT'))).toBe(true);
 expect(JSON.parse(state.writes.find(v=>v.path.endsWith('.migration.json'))!.content)).toMatchObject({mode:'VERIFY_EXISTING',currentPrefix:files.length});
});
test('deployment refuses a stale checksum before evidence, keys or migration',async()=>{
 state.ledger[72]={...state.ledger[72]!,sha256:'f'.repeat(64)};
 await expect(prepareWorkspaceDeployment()).rejects.toThrow('LINEAGE_MISMATCH');expect(state.events).toEqual(['inspect']);expect(state.writes).toEqual([]);
});
test('an incomplete migration result cannot grant workspace functions or report PASS',async()=>{
 state.ledger=ledger(70);state.stopAt=files.length-1;
 await expect(prepareWorkspaceDeployment()).rejects.toThrow('WORKSPACE_ALREADY_DEPLOYED_REQUIRED');
 expect(state.events).toEqual(['inspect','migrate']);expect(state.sql.every(sql=>!sql.includes('GRANT'))).toBe(true);expect(state.writes.every(v=>v.path.endsWith('.before.json'))).toBe(true);
});
test('unsupported predecessor remains blocked',async()=>{
 state.ledger=ledger(69);await expect(prepareWorkspaceDeployment()).rejects.toThrow('P1_05_LATEST_DEPLOYMENT_REQUIRED');expect(state.writes).toEqual([]);
});
test('a type-verification failure still prevents a deployment PASS receipt',async()=>{
 state.typesStatus=1;await expect(prepareWorkspaceDeployment()).rejects.toThrow();expect(state.writes.every(v=>v.path.endsWith('.before.json'))).toBe(true);
});
test('owner receipt identity mismatch cannot grant functions',async()=>{
 state.ownerDatabase='different_database';await expect(prepareWorkspaceDeployment()).rejects.toThrow();expect(state.sql.every(sql=>!sql.includes('GRANT'))).toBe(true);
});
test('both gates use the same exact ordered and checksummed release',()=>{
 expect(workspaceStartupPrefix(files,ledger())).toBe(files.length);expect(workspaceDeploymentPrefix(files,ledger(),true)).toBe(files.length);
 expect(files.find(file=>file.id===workspaceMigration)?.id).toBe('0087_department_catalog_interfaces');
 expect(files[199]?.id).toBe('0200_nursing_owner_handover_confirmation');
 expect(files.at(-1)?.id).toBe('0205_location_usage_type_evidence_campus');
});

test('the original 200 migration bytes match the approved P3-05 Git tree',()=>{
 const baseline='cb7cbfecf692bdfbac8f017bd570ac1b31256123';
 const tree=execFileSync('git',['ls-tree','-r',baseline,'--','db/vnext/migrations'],{encoding:'utf8',windowsHide:true});
 const originals=new Map(tree.trim().split('\n').map(line=>{const match=/^100644 blob ([a-f0-9]{40})\tdb\/vnext\/migrations\/([a-z0-9_]+)\.sql$/u.exec(line);if(!match)throw new Error('BASELINE_MIGRATION_TREE_INVALID');return [match[2]!,match[1]!] as const;}));
 expect(originals.size).toBe(200);
 for(const file of files.slice(0,200)){const bytes=Buffer.from(file.sql),blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');expect(blob,file.id).toBe(originals.get(file.id));}
});

test('P3-07 deployment rejects an older predecessor before writes or migration',async()=>{
 state.ledger=ledger(199);await expect(prepareWorkspaceDeployment({evidenceTask:'p3-07'})).rejects.toThrow('P3_05_CURRENT_DEPLOYMENT_REQUIRED');expect(state.events).toEqual(['inspect']);expect(state.sql).toEqual([]);expect(state.writes).toEqual([]);
});

test('preservation rejects a missing duplicate predecessor row',async()=>{
 state.rowSnapshots=[['same-hash','same-hash'],['same-hash']];const deployment=await prepareWorkspaceDeployment();await expect(deployment.complete()).rejects.toThrow('Previous rows or duplicate counts changed');expect(state.writes.some(item=>item.path.endsWith('.preservation.json'))).toBe(false);
});

test('preservation accepts unchanged duplicate counts and appended rows',async()=>{
 state.rowSnapshots=[['same-hash','same-hash'],['same-hash','same-hash','added-hash']];const deployment=await prepareWorkspaceDeployment();await deployment.complete();expect(state.writes.some(item=>item.path.endsWith('.preservation.json'))).toBe(true);
});

test('0080 replaces the installed 0061 suspension guard rather than the obsolete 0057 body',()=>{
 const installed=files.find(file=>file.id==='0061_campus_terminal_suspension')!.sql.match(/replacement:=\$after\$([\s\S]*?)\$after\$;/u)?.[1];
 expect(installed).toBeDefined();
 expect(files.find(file=>file.id==='0080_campus_effective_activation')!.sql).toContain('needle:=$old$'+installed+'$old$;');
});

test('0081 does not shadow the workspace operating-object record with a SQL alias',()=>{
 const migration=files.find(file=>file.id==='0081_campus_explicit_resume_basis')!.sql;
 expect(migration).toContain('campus_operation suspended_operation ON suspended_operation.event_id=e.id');
 expect(migration.match(/campus_operation resume_operation ON resume_operation\.event_id=e\.id/gu)).toHaveLength(2);
 expect(migration).not.toMatch(/campus_operation o ON o\.event_id=e\.id/u);
});

test('0082 binds planned opening time to the scheduled retirement boundary',()=>{
 const migration=files.find(file=>file.id==='0082_campus_opening_retirement_boundary')!.sql;
 expect(migration).toContain("p_command->>'plannedOpeningAt'");
 expect(migration).toContain('>=ce.valid_from');
});

test('0083 repairs the immutable 0079 suspension subtraction before department release',()=>{
 const migration=files.find(file=>file.id==='0083_campus_retirement_history_repair')!.sql;
 expect(migration).toContain('CAMPUS_HISTORY_REPAIR_BASELINE_MISMATCH');
 expect(migration).toContain("n.action IN ('CREATE','ACTIVATE','SUSPEND','RESUME','RETIRE')");
});

test('missing capability authority prevents business Owner construction and listening',async()=>{
 const {assertUnitCapabilityProvisioned}=await import('./p3-08-provisioning.mjs');vi.mocked(assertUnitCapabilityProvisioned).mockRejectedValueOnce(new Error('CAPABILITY_OWNER_NOT_PROVISIONED'));
 await expect(startWorkbench({persistent:true})).rejects.toThrow('CAPABILITY_OWNER_NOT_PROVISIONED');expect(state.events).not.toContain('unit-capability');expect(state.events).not.toContain('listen');
});

test('missing subject authority prevents the new Owner from being served',async()=>{
 const {assertSubjectsProvisioned}=await import('./p3-09-provisioning.mjs');vi.mocked(assertSubjectsProvisioned).mockRejectedValueOnce(new Error('SUBJECT_OWNER_NOT_PROVISIONED'));
 await expect(startWorkbench({persistent:true})).rejects.toThrow('SUBJECT_OWNER_NOT_PROVISIONED');expect(state.events).not.toContain('listen');expect(state.events).not.toContain('organization');
});
test('missing Unit Ward authority prevents business Owner construction and listening',async()=>{
 const {assertUnitWardProvisioned}=await import('./p3-04-provisioning.mjs');vi.mocked(assertUnitWardProvisioned).mockRejectedValueOnce(new Error('UNIT_WARD_OWNER_NOT_PROVISIONED'));
 await expect(startWorkbench({persistent:true})).rejects.toThrow('UNIT_WARD_OWNER_NOT_PROVISIONED');expect(state.events).not.toContain('listen');expect(state.events).not.toContain('organization');
});

test('missing Ward Nursing authority prevents business Owner construction and listening',async()=>{
 const {assertWardNursingProvisioned}=await import('./p3-05-provisioning.mjs');
 vi.mocked(assertWardNursingProvisioned).mockRejectedValueOnce(new Error('WARD_NURSING_OWNER_NOT_PROVISIONED'));
 await expect(startWorkbench({persistent:true})).rejects.toThrow('WARD_NURSING_OWNER_NOT_PROVISIONED');
 expect(assertWardNursingProvisioned).toHaveBeenCalledTimes(1);
 expect(state.events).not.toContain('organization');expect(state.events).not.toContain('business-unit');expect(state.events).not.toContain('ward-nursing');expect(state.events).not.toContain('catalog');expect(state.events).not.toContain('listen');
});

test('missing Location use authority prevents Owner construction and listening',async()=>{
 const {assertLocationUseProvisioned}=await import('./p3-07-provisioning.mjs');vi.mocked(assertLocationUseProvisioned).mockRejectedValueOnce(new Error('LOCATION_USE_OWNER_NOT_PROVISIONED'));
 await expect(startWorkbench({persistent:true})).rejects.toThrow('LOCATION_USE_OWNER_NOT_PROVISIONED');expect(state.events).not.toContain('organization');expect(state.events).not.toContain('usage-types');expect(state.events).not.toContain('location-use');expect(state.events).not.toContain('listen');
});

test('Location use Owner closes before its purpose dictionary dependency',async()=>{
 const runtime=await startWorkbench({persistent:true});await runtime.close();expect(state.events.indexOf('close-location-use')).toBeLessThan(state.events.indexOf('close-usage-types'));
});

test('supplied validation transport hooks cannot target a retained receipt',async()=>{
 const beforeListen=vi.fn();await expect(startWorkbench({validationContext:{receipt:state.receipt,beforeListen}})).rejects.toThrow('TEMPORARY_VALIDATION_REQUIRED');expect(state.events).toEqual([]);expect(beforeListen).not.toHaveBeenCalled();
});
