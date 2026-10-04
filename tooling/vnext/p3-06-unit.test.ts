import {test,expect} from 'vitest';
import {selectImportAdapter} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {validateLocationTree,locationTime,type LocationHistory,type LocationFacts} from '../../apps/governance-api/src/modules/location-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';

test('ORG12 CORE has an explicit Location Owner, FULL remains unavailable',()=>{
 const request={dataset:'ORG12',profile:'CORE' as const,contractVersion:1,templateVersion:'ORG12_CORE_V1',parserPolicy:'STRICT_LOCATION_V1'};
 expect(selectImportAdapter(request)).toMatchObject({owner:'location-master',capability:'READY'});
 expect(selectImportAdapter({...request,profile:'FULL'}).capability).toBe('NOT_READY');
});

test('P3-06-AC-01 an empty physical tree is valid and cannot fabricate a root',()=>{
 expect(()=>validateLocationTree([])).not.toThrow();
});

const from='2026-01-01T00:00:00.000000',later='2026-02-01T00:00:00.000000';
function node(id:string,type:LocationFacts['locationType'],parentId:string|null,validFrom=from,validTo:string|null=null):LocationHistory {
 return {id,campusId:'campus',scope:'NORTH',codes:[id],versions:[{id:id+'v',number:'1',action:'CREATE',validFrom,validTo,recordedAt:from,reason:'TEST POLICY ONLY',changeId:null,facts:{locationCode:id,locationName:id,locationType:type,parentId,floorLabel:type==='CAMPUS'||type==='BUILDING'?null:'1',roomNumber:['ROOM','CLINIC_ROOM','OPERATING_ROOM'].includes(type)?'001':null,addressDetail:null,isAccessible:null,source:{} as LocationFacts['source'],contractVersionId:'contract',dependencyEvidence:null}}]};
}
test('P3-06-AC-01 a child cannot bridge an unrepresented parent interval',()=>{
 expect(()=>validateLocationTree([node('c','CAMPUS',null),node('b','BUILDING','c',from,later),node('f','FLOOR','b')])).toThrow('PARENT_PERIOD_NOT_COVERED');
});
test('P3-06-AC-01 cycles, orphaning, illegal types and a foreign campus parent are rejected',()=>{
 const c=node('c','CAMPUS',null),b=node('b','BUILDING','c'),f=node('f','FLOOR','b'),r=node('r','ROOM','f');
 c.versions[0]!.facts.parentId='r';expect(()=>validateLocationTree([c,b,f,r])).toThrow('LOCATION_CYCLE');c.versions[0]!.facts.parentId=null;
 r.versions[0]!.facts.parentId='absent';expect(()=>validateLocationTree([c,b,f,r])).toThrow('PARENT_PERIOD_NOT_COVERED');
 r.versions[0]!.facts.parentId='b';expect(()=>validateLocationTree([c,b,f,r])).toThrow('LOCATION_TYPE_INVALID');
 r.versions[0]!.facts.parentId='f';f.campusId='another';expect(()=>validateLocationTree([c,b,f,r])).toThrow('LOCATION_CAMPUS_MISMATCH');
});
test('whole-window validation catches a middle-only parent gap',()=>{
 const c=node('c','CAMPUS',null),b=node('b','BUILDING','c'),f=node('f','FLOOR','b');
 b.versions[0]!.validTo=later;b.versions.push({...b.versions[0]!,id:'bv2',number:'2',validFrom:'2026-03-01T00:00:00.000000',validTo:null});
 expect(()=>validateLocationTree([c,b,f])).toThrow('PARENT_PERIOD_NOT_COVERED');
});
test('only explicit +08 conversion preserves microseconds and rejects other offsets and invalid calendars',()=>{
 expect(locationTime('2026-02-01T12:30:00.123456+08:00','SOURCE_PLUS08_TO_LOCAL')).toBe('2026-02-01T12:30:00.123456');
 for(const value of ['2026-02-01T12:30:00Z','2026-02-01T12:30:00+09:00','2026-02-30T12:30:00+08:00'])expect(()=>locationTime(value,'SOURCE_PLUS08_TO_LOCAL')).toThrow('LOCAL_TIME_REQUIRED');
});
test('the Location HTTP interface fails closed when no Owner is composed',async()=>{
 const app=await buildCatalogServer();
 try{const response=await app.inject({method:'POST',url:'/api/vnext/locations/query',payload:{id:'00000000-0000-7000-8000-000000000001'}});expect(response.statusCode).toBe(503);expect(response.json().code).toBe('BLOCKED_DEPENDENCY');}finally{await app.close();}
},30000);
