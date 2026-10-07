import {beforeAll,afterAll,test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {selectImportAdapter} from '../../apps/governance-api/src/modules/governance-catalog/import-adapter.js';
import {readFileSync,existsSync} from 'node:fs';
import {verifyVNextCallerRegistration} from './current-contract.mjs';
import Fastify from 'fastify';
test('only exact independently adopted ORG13 CORE selects the location-use file Owner',()=>{expect(selectImportAdapter({dataset:'ORG13',profile:'CORE',contractVersion:1,templateVersion:'ORG13_CORE_V1',parserPolicy:'STRICT_LOCATION_USE_V1'})).toMatchObject({owner:'location-master',capability:'READY',allowedIntents:['CREATE','REVISE','END']});expect(selectImportAdapter({dataset:'ORG13',profile:'FULL',contractVersion:1,templateVersion:'ORG13_CORE_V1',parserPolicy:'STRICT_LOCATION_USE_V1'})).toMatchObject({capability:'NOT_READY'});});
let app:Awaited<ReturnType<typeof buildCatalogServer>>,url:string;
beforeAll(async()=>{app=await buildCatalogServer();url=await app.listen({host:'127.0.0.1',port:0});});afterAll(async()=>{await app?.close();});
const post=(path:string,value:unknown)=>fetch(url+'/api/vnext/'+path,{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify(value)});
const stage=()=>{const id=randomUUID();return {requestId:id,jobId:id,revisionId:id,campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',entries:[{action:'CREATE',applicability:{targetType:'ORG',target:{owner:'department-master',id},campus:{owner:'organization-master/campus',id},location:{owner:'location-master',id},usageType:{owner:'location-master/usage-type',id}},usageType:{owner:'location-master/usage-type',id,versionId:id,version:'1'},policy:{kind:'SHARED',version:'WHOLE_LOCATION_V1'},evidenceId:id,reason:'TEST closed HTTP',row:{object_location_rel_id:id,target_type:'ORG',target_id:id,location_id:id,usage_type:'OFFICE',is_primary:'N',sharing_description:null,version_no:9,valid_from:'2026-01-01T00:00:00',valid_to:null,record_status:'ACTIVE',source_system_id:id,source_record_id:'TEST/ORG13',approval_ref:'TEST',recorded_at:'2026-01-02T00:00:00'}}]};};
test('native numbers and null reach the unavailable Owner; string numbers and decoded duplicate fields fail first',async()=>{const value=stage(),body=JSON.stringify(value),send=(text:string)=>fetch(url+'/api/vnext/location-uses/inputs',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:text});expect((await send(body)).status).toBe(503);expect((await send(body.replace('"version_no":9','"version_no":"9"'))).status).toBe(400);for(const duplicate of ['version_no','version_\\u006eo'])expect((await send(body.replace('"version_no":9',`"version_no":8,"${duplicate}":9`))).status).toBe(400);});
test('closed typed anchors reject undeclared fields and wrong Owner tokens before unavailable Owner',async()=>{const value=stage(),entry=value.entries[0]!;for(const changed of [{...entry,unknownPurpose:true},{...entry,applicability:{...entry.applicability,unowned:true}},{...entry,applicability:{...entry.applicability,target:{...entry.applicability.target,owner:'governance-catalog/source'}}}])expect((await post('location-uses/inputs',{...value,entries:[changed]})).status).toBe(400);});
test('dictionary commands refuse scheduled lifecycle time, and oversized bodies return the declared 413',async()=>{const id=randomUUID(),command={action:'DISABLE',requestId:id,target:id,expectedHead:'1',reason:'TEST current lifecycle'};expect((await post('location-usage-types/command',command)).status).toBe(503);expect((await post('location-usage-types/command',{...command,validFrom:'2027-01-01T00:00:00'})).status).toBe(400);const response=await post('location-usage-types/command',{...command,reason:'x'.repeat(300001)});expect(response.status).toBe(413);expect(await response.json()).toMatchObject({code:'FST_ERR_CTP_BODY_TOO_LARGE'});});

test('every P3-07 request and response object is closed and declares actual error statuses',()=>{
 const api=app.swagger(),gaps:string[]=[];
 const visit=(value:unknown,path:string)=>{if(typeof value!=='object'||value===null)return;const object=value as Record<string,unknown>;if(object['type']==='object'&&object['additionalProperties']!==false)gaps.push(path);for(const [key,child]of Object.entries(object))visit(child,path+'/'+key);};
 const paths=Object.entries(api.paths??{}).filter(([path])=>path.startsWith('/api/vnext/location-uses/')||path.startsWith('/api/vnext/location-usage-types/'));
 expect(paths).toHaveLength(24);
 for(const [path,route]of paths){visit(route,path);const responses=route?.post?.responses;for(const status of ['400','403','404','409','413','500','503'])expect(responses,path+' '+status).toHaveProperty(status);}
 expect(gaps).toEqual([]);
});

test('official current-contract caller registration rejects missing callers or undeclared operations',()=>{
 const api=app.swagger(),registry=JSON.parse(readFileSync('docs/vnext/current-callers.json','utf8'));
 expect(verifyVNextCallerRegistration(api,registry,existsSync)).toMatchObject({status:'PASS',ticket:'P3-07',callers:8});
 expect(()=>verifyVNextCallerRegistration(api,registry,()=>false)).toThrow('CURRENT_CALLER_PATH_INVALID');
 const stale=structuredClone(registry);stale.vNextCurrentCallers.callers[0].operations.push('missingPurposeOperation');expect(()=>verifyVNextCallerRegistration(api,stale,existsSync)).toThrow('CURRENT_CALLER_OPERATION_INVALID');
});

test('the actual HTTP response serializer preserves source approval null, empty and original strings',async()=>{
 const version=app.swagger().paths?.['/api/vnext/location-uses/exact']?.post?.responses?.['200'];
 if(!version||!('content' in version))throw new Error('EXACT_RESPONSE_SCHEMA_REQUIRED');
 const schema=version.content?.['application/json']?.schema;
 if(!schema||!('properties' in schema))throw new Error('EXACT_RESPONSE_SCHEMA_REQUIRED');
 const facts=schema.properties?.['facts'];if(!facts||!('properties' in facts))throw new Error('SOURCE_RESPONSE_SCHEMA_REQUIRED');
 const sourceSchema=facts.properties?.['source'];if(!sourceSchema)throw new Error('SOURCE_RESPONSE_SCHEMA_REQUIRED');
 const id=randomUUID(),source={sourceAlias:'TEST source',sourceVersion:'9',sourceSystemId:id,sourceRecordedAt:'2026-01-02T00:00:00',recordLocatorEvidence:{inputId:id,row:1},recordStatus:'ACTIVE',approvalReference:null as string|null};
 const serializer=Fastify();serializer.get('/source',{schema:{response:{200:sourceSchema}}},()=>source);
 try{for(const value of [null,'',' ORIGINAL APPROVAL ']){source.approvalReference=value;const result=await serializer.inject({method:'GET',url:'/source'});expect(result.statusCode).toBe(200);expect(result.json().approvalReference).toBe(value);}}
 finally{await serializer.close();}
});
