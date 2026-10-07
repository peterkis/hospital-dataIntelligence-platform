import {test,expect} from 'vitest';
import {Check} from 'typebox/value';
import {randomUUID} from 'node:crypto';
import {projectImpactReference} from '../../apps/governance-api/src/modules/department-master/vnext/department-impact.js';
import {RecordMigrationReceiptSchema,AssessDepartmentChangeSchema,type ImpactReference} from '../../apps/governance-api/src/modules/department-master/vnext/department-impact-contracts.js';
const T='2027-01-01T00:00:00.000000';
function reference(to:string|null):ImpactReference{
 const id=randomUUID(),versionId=randomUUID();
 return {owner:'SOURCE_MAPPING',referenceRole:'TARGET',sourceSystemIds:[],id,versionId,version:'1',departmentId:id,departmentVersionId:versionId,acceptedVersions:[{versionId,version:'1',from:'2026-01-01T00:00:00.000000',to}],originalPeriod:{from:'2026-01-01T00:00:00.000000',to},originalDigest:'a'.repeat(64),frozenLabel:'original',currentVersionId:versionId,currentPeriod:{from:'2026-01-01T00:00:00.000000',to},currentAction:'REGISTER',currentTargetId:id,current:true,currentReferencesDepartment:true,change:'UNCHANGED',constraint:'SATISFIED',reason:'REFERENCE_UNCHANGED',affectedSpans:[]};
}
test('future split includes one microsecond beyond T, excludes T and preserves unbounded spans',()=>{
 for(const [to,affected] of [[T,false],['2027-01-01T00:00:00.000001',true],[null,true]] as const){
  const ref=reference(to),original=structuredClone(ref.acceptedVersions);projectImpactReference(ref,T,'SPLIT',null);
  expect(ref.constraint).toBe(affected?'UNSATISFIED':'SATISFIED');expect(ref.change).toBe(affected?'CHANGED':'UNCHANGED');expect(ref.affectedSpans).toEqual(affected?[{from:T,to}]:[]);expect(ref.acceptedVersions).toEqual(original);
 }
});
test('a rename remains label-only until a later accepted exit constrains the reference',()=>{
 const ref=reference(null);projectImpactReference(ref,T,'RENAME',null);expect(ref.constraint).toBe('SATISFIED');expect(ref.change).toBe('CHANGED');
 projectImpactReference(ref,T,'RENAME','2027-02-01T00:00:00.000001');expect(ref.affectedSpans).toEqual([{from:'2027-02-01T00:00:00.000001',to:null}]);
});
test('closed inputs reject client dependency lists and non-simulated receipt claims',()=>{
 const assessment={requestId:randomUUID(),reason:'TEST',target:{kind:'INPUT',id:randomUUID()}};
 expect(Check(AssessDepartmentChangeSchema,assessment)).toBe(true);expect(Check(AssessDepartmentChangeSchema,{...assessment,references:[]})).toBe(false);
 const receipt={requestId:randomUUID(),reason:'TEST',caseId:randomUUID(),campus:'NORTH',expectedHead:'0',proposalEventId:randomUUID(),consumerActor:'synthetic',outcome:'SIMULATED_COMPLETED',receiptRef:'TEST',simulated:true};
 expect(Check(RecordMigrationReceiptSchema,receipt)).toBe(true);expect(Check(RecordMigrationReceiptSchema,{...receipt,simulated:false})).toBe(false);expect(Check(RecordMigrationReceiptSchema,{...receipt,outcome:'COMPLETED'})).toBe(false);
});

test('Ward nursing obligations preserve disjoint binding windows and frozen accepted pins',()=>{
 const ref=reference(null);ref.owner='WARD_NURSING_COVERAGE';ref.referenceRole='OWNER';
 ref.currentPeriods=[{from:'2027-02-01T00:00:00.000000',to:'2027-03-01T00:00:00.000000'},{from:'2027-06-01T00:00:00.000001',to:null}];
 const original=structuredClone({pins:ref.acceptedVersions,period:ref.originalPeriod,digest:ref.originalDigest});
 projectImpactReference(ref,T,'SUSPEND',null);
 expect(ref.current).toBe(true);expect(ref.constraint).toBe('UNSATISFIED');expect(ref.affectedSpans).toEqual(ref.currentPeriods);
 expect({pins:ref.acceptedVersions,period:ref.originalPeriod,digest:ref.originalDigest}).toEqual(original);
});

test('cancelled and ended Ward nursing windows do not create obligations from their envelope',()=>{
 for(const periods of [[],[{from:T,to:T}],[{from:'2026-01-01T00:00:00.000000',to:T}]]){
  const ref=reference(null);ref.owner='WARD_NURSING_COVERAGE';ref.currentPeriods=periods;
  projectImpactReference(ref,T,'SPLIT',null);expect(ref.current).toBe(false);expect(ref.constraint).toBe('SATISFIED');expect(ref.affectedSpans).toEqual([]);
 }
});
