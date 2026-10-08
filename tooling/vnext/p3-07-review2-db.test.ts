import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {beforeAll,afterAll,test,expect} from 'vitest';
import {openCatalog,type Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createLocationUseClient} from '../../packages/generated-api-client/src/index.js';
import {locationUseFixture} from './p3-07-fixture.js';
import {validationKeys} from './p3-07-validation-keys.mjs';
import {peer,quote} from './lineage.mjs';
import type {LocationUseFixture} from './p3-07-validation-helpers.js';
import {createReview2DepartmentFixture} from './p3-07-review2-department-fixture.js';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Catalog,f:LocationUseFixture,app:Awaited<ReturnType<typeof buildCatalogServer>>,url:string;
beforeAll(async()=>{
 const provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1});
 try{catalog=await openCatalog(connection,provider);const role=(await pool.query('select current_user r')).rows[0]!.r;f=await locationUseFixture(receipt,role,catalog,provider,connection,process.env['VNEXT_P3_07_UPGRADED']==='1');const contexts:Parameters<typeof buildCatalogServer>=[catalog,'CONTROL_PLANE'];contexts[24]={owner:f.owner,usageTypes:f.dictionary,actor:r=>actor(r.headers)};app=await buildCatalogServer(...contexts);url=await app.listen({host:'127.0.0.1',port:0});}finally{await pool.end();}
});
afterAll(async()=>{await app?.close();await f?.close();await catalog?.close();});
async function departmentBoundaries(id:string,recordAsOf:string,validFrom='2026-04-01T00:00:00',validTo='2026-07-01T00:00:00'){
 const pool=new Pool({connectionString:connection,max:1});
 try{const identity=(await pool.query<{role:string;database:string;oid:string;superuser:boolean;createdb:boolean;createrole:boolean;bypassrls:boolean;factInsert:boolean;portExecute:boolean}>("select current_user role,current_database() database,d.oid::text oid,r.rolsuper superuser,r.rolcreatedb createdb,r.rolcreaterole createrole,r.rolbypassrls bypassrls,has_table_privilege(current_user,'department_master.version','INSERT') \"factInsert\",has_function_privilege(current_user,'department_master.use_department_boundaries(text,uuid,timestamp,timestamp,timestamp)','EXECUTE') \"portExecute\" from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()")).rows[0]!;
  expect(identity).toMatchObject({database:receipt.name,oid:receipt.oid,superuser:false,createdb:false,createrole:false,bypassrls:false,factInsert:false,portExecute:true});expect(identity.role).toMatch(/^hdi_validation_[a-f0-9]{16}$/);
  const result=await pool.query<{r:string[]}>('select department_master.use_department_boundaries($1,$2::uuid,$3::timestamp,$4::timestamp,$5::timestamp) r',['maker',id,validFrom,validTo,recordAsOf]).then(rows=>({boundaries:rows.rows[0]!.r,error:undefined}),error=>({boundaries:undefined,error:error instanceof Error?error.message:'SQL_FAILED'}));return {identity,...result};
 }finally{await pool.end();}
}

test('R4: current B-only Department window ignores inaccessible historical A at Owner, generated HTTP and restricted SQL seams',async()=>{
 const d=await createReview2DepartmentFixture(f,catalog),earlyWindow={id:d.early.facts[0]!.id,validFrom:'2026-01-01T00:00:00',validTo:'2026-02-01T00:00:00',mode:'CURRENT_ADMISSION' as const},lateWindow={id:d.late.facts[0]!.id,validFrom:'2026-04-01T00:00:00',validTo:'2026-07-01T00:00:00',mode:'CURRENT_ADMISSION' as const};
 expect((await f.owner.evaluateWindow('maker',lateWindow)).currentAdmissionCovered).toBe(true);
 const before=await departmentBoundaries(d.scope.target.id,d.sourceBOutcome.recordedAt);expect(before.error).toBeUndefined();expect(before.boundaries).toEqual(expect.any(Array));
 const predicate=`actor_code='maker' AND object_id=${quote(d.sourceA.id)}::uuid AND scope='SYNTHETIC' AND object_kind='SOURCE' AND purpose='SYNTHETIC_REFERENCE' AND permission='READ'`,grants=JSON.parse(peer(receipt.name,`SELECT coalesce(jsonb_agg(g),'[]')::text FROM vnext_control.object_grant g WHERE ${predicate};`));expect(grants.length).toBeGreaterThan(0);peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
 try{
  const current=await f.owner.evaluateWindow('maker',lateWindow).then(value=>({value,error:undefined}),error=>({value:undefined,error:String(error.message)}));expect.soft(current.error).toBeUndefined();expect.soft(current.value?.currentAdmissionCovered).toBe(true);
  const http=await createLocationUseClient(url,'maker').evaluate(lateWindow);expect.soft(http.response.status,JSON.stringify(http.error)).toBe(200);expect.soft(http.data?.currentAdmissionCovered).toBe(true);
  const sqlResult=await departmentBoundaries(d.scope.target.id,d.sourceBOutcome.recordedAt);expect.soft(sqlResult.error).toBeUndefined();expect.soft(sqlResult.boundaries).toEqual(before.boundaries);
  await expect(f.owner.evaluateWindow('maker',earlyWindow)).rejects.toThrow('ACCESS_DENIED');
  await expect(f.owner.evaluateWindow('maker',{...earlyWindow,mode:'HISTORICAL',recordAsOf:d.sourceAOutcome.recordedAt})).rejects.toThrow('ACCESS_DENIED');
  expect((await f.owner.evaluateWindow('maker',{...earlyWindow,mode:'HISTORICAL',recordAsOf:d.early.recordedAt})).currentAdmissionCovered).toBe(true);
  await expect(f.owner.evaluateWindow('maker',{...lateWindow,validFrom:'2026-08-01T00:00:00',validTo:'2026-12-01T00:00:00'})).rejects.toThrow('ACCESS_DENIED');
  console.log(JSON.stringify({gate:'P3_07_REVIEW2_DEPARTMENT_SOURCE_WINDOW',owner:current.error??'PASS',httpStatus:http.response.status,httpCode:http.error?.code??null,restrictedSql:sqlResult.error??'PASS',sqlIdentity:sqlResult.identity,sourceBoundariesBeforeRevocation:before.boundaries,relevantCurrentA:'ACCESS_DENIED',historicalA:'ACCESS_DENIED',historicalOriginalB:'PASS',finiteBEndReturnsA:'ACCESS_DENIED',recordAt:d.sourceBOutcome.recordedAt,scope:'ORG_DIRECT_DEPARTMENT_PORT',unitWard:'SEPARATE_PORT_NOT_CLAIMED'}));
 }finally{peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(JSON.stringify(grants))}::jsonb) ON CONFLICT DO NOTHING;`);}
 const F='2026-05-01T00:00:00.000001',T='2026-06-01T00:00:00.000001',actualHead=(await f.base.department.history('maker',d.departmentId)).versions.at(-1)!,actualB=await f.base.department.exact('maker',{id:d.departmentId,version:actualHead.number}),terminal=['2026-07-15T00:00:00.000001','2026-07-01T00:00:00.000001'].find(at=>actualB.validTo!==null&&actualB.validFrom<T&&T<at&&at<actualB.validTo);
 if(!terminal)throw new Error('REVIEW2_TERMINAL_INSIDE_CURRENT_B_REQUIRED');
 peer(receipt.name,`INSERT INTO department_master.mapping_target_access SELECT a,'ORG',${quote(d.departmentId)}::uuid,'NORTH' FROM unnest(ARRAY['maker','maker-alias','reviewer']) a ON CONFLICT DO NOTHING;`);
 await d.changeLifecycle('SUSPEND',F);const resumed=await d.changeLifecycle('RESUME',T);
 peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
 try{
  expect(await f.owner.evaluateWindow('maker',lateWindow)).toMatchObject({declarationCovered:true,currentAdmissionCovered:false,currentGaps:[{from:F,to:T}]});
  const gapHttp=await createLocationUseClient(url,'maker').evaluate(lateWindow);expect(gapHttp.response.status,JSON.stringify(gapHttp.error)).toBe(200);expect(gapHttp.data).toMatchObject({currentAdmissionCovered:false,currentGaps:[{from:F,to:T}]});
  expect(await f.owner.evaluateWindow('maker',{...lateWindow,validTo:F})).toMatchObject({currentAdmissionCovered:true});expect(await f.owner.evaluateWindow('maker',{...lateWindow,validFrom:T})).toMatchObject({currentAdmissionCovered:true});
  const gapSql=await departmentBoundaries(d.scope.target.id,resumed.recordedAt);expect(gapSql.error).toBeUndefined();expect(gapSql.boundaries).toEqual(expect.arrayContaining([F,T]));
 }finally{peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(JSON.stringify(grants))}::jsonb) ON CONFLICT DO NOTHING;`);}
 const deprecated=await d.changeLifecycle('DEPRECATE',terminal);peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
 try{
  const full={...lateWindow,validTo:'2026-12-01T00:00:00'},expectedGaps=[{from:F,to:T},{from:terminal,to:'2026-12-01T00:00:00.000000'}];expect(await f.owner.evaluateWindow('maker',full)).toMatchObject({declarationCovered:true,currentAdmissionCovered:false,currentGaps:expectedGaps});
  const terminalHttp=await createLocationUseClient(url,'maker').evaluate(full);expect(terminalHttp.response.status,JSON.stringify(terminalHttp.error)).toBe(200);expect(terminalHttp.data?.currentGaps).toEqual(expectedGaps);
  const terminalSql=await departmentBoundaries(d.scope.target.id,deprecated.recordedAt,full.validFrom,full.validTo);expect(terminalSql.error).toBeUndefined();expect(terminalSql.boundaries).toEqual(expect.arrayContaining([F,T,terminal]));
  expect((await f.owner.evaluateWindow('maker',{...lateWindow,mode:'HISTORICAL',recordAsOf:d.sourceBOutcome.recordedAt})).currentAdmissionCovered).toBe(true);
  console.log(JSON.stringify({gate:'P3_07_REVIEW2_DEPARTMENT_LIFECYCLE_CLIPPING',suspend:F,resume:T,terminal,terminalAction:'DEPRECATE',currentGaps:expectedGaps,irrelevantRestoredSourceA:'NOT_READ',originalBeforeLifecycleR:'PASS',replacementDynamic:'NOT_RUN',unitWard:'SEPARATE_PORT_NOT_CLAIMED'}));
 }finally{peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(JSON.stringify(grants))}::jsonb) ON CONFLICT DO NOTHING;`);}
});
