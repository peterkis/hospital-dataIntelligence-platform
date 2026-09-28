import {describe,expect,test} from 'vitest';
import {canCancelCampusOpening,canCompleteCampusDisposition,canRecordCampusDisposition,canReviseWorkspaceEntity,canRetireWorkspaceCampus,isCampusWorkspaceAction} from '../../apps/admin-web/src/vnext/workspace-entity-actions.js';
import {shouldInvalidateCampusImpact,type CampusImpactBinding} from '../../apps/admin-web/src/vnext/workspace-campus-impact.js';

describe('workspace entity revision actions',()=>{
 test('a retired campus never exposes a revision draft entry',()=>{
  expect(canReviseWorkspaceEntity('CAMPUS',{canWrite:true,terminal:true})).toBe(false);
 });
 test('an active writable campus remains revisable',()=>{
  expect(canReviseWorkspaceEntity('CAMPUS',{canWrite:true,terminal:false})).toBe(true);
 });
 test('other writable entity kinds retain their revision actions',()=>{
  for(const kind of ['ORGANIZATION','RELATION','SCOPE'] as const)expect(canReviseWorkspaceEntity(kind,{canWrite:true,terminal:true})).toBe(true);
 });
 test('write revocation hides every revision action',()=>{
  expect(canReviseWorkspaceEntity('CAMPUS',{canWrite:false,terminal:false})).toBe(false);
  expect(canReviseWorkspaceEntity('ORGANIZATION',{canWrite:false,terminal:false})).toBe(false);
 });
});

describe('campus impact digest binding',()=>{
 const base:CampusImpactBinding={actor:'maker',id:'11111111-1111-4111-8111-111111111111',from:'2026-10-01T00:00:00.000000',to:'',digest:'a'.repeat(64)};
 test('invalidates an unchanged digest when its target or period changes',()=>{
  expect(shouldInvalidateCampusImpact(base,{...base,id:'22222222-2222-4222-8222-222222222222'})).toBe(true);
  expect(shouldInvalidateCampusImpact(base,{...base,from:'2026-11-01T00:00:00.000000'})).toBe(true);
  expect(shouldInvalidateCampusImpact(base,{...base,to:'2027-01-01T00:00:00.000000'})).toBe(true);
  expect(shouldInvalidateCampusImpact(base,{...base,actor:'workspace-steward'})).toBe(true);
 });
 test('does not invalidate the current binding or a newly supplied digest',()=>{
  expect(shouldInvalidateCampusImpact(base,{...base})).toBe(false);
  expect(shouldInvalidateCampusImpact(base,{...base,from:'2026-11-01T00:00:00.000000',digest:'b'.repeat(64)})).toBe(false);
  expect(shouldInvalidateCampusImpact({...base,digest:''},{...base,from:'2026-11-01T00:00:00.000000',digest:''})).toBe(false);
 });
});

describe('scheduled campus retirement actions',()=>{
 test('only the duplicate retirement is suppressed before its future effective time',()=>{
  const context={canWrite:true,terminal:false};
  expect(canRetireWorkspaceCampus(context,'2099-01-01T00:00:00')).toBe(false);
  expect(canReviseWorkspaceEntity('CAMPUS',context)).toBe(true);
  expect(canRetireWorkspaceCampus(context,null)).toBe(true);
 });
 test('unwritable, unavailable and terminal contexts never offer retirement',()=>{
  for(const context of [null,undefined,{canWrite:false,terminal:false},{canWrite:true,terminal:true}])expect(canRetireWorkspaceCampus(context,null)).toBe(false);
 });
 test('scheduled retirement opens evidence collection but not premature completion',()=>{
  const retiredFrom='2099-01-01T00:00:00';
  expect(canRecordCampusDisposition({canWrite:true,terminal:false},retiredFrom,false)).toBe(true);
  expect(canCompleteCampusDisposition({canWrite:true,terminal:false},retiredFrom,false)).toBe(false);
  expect(canRecordCampusDisposition({canWrite:true,terminal:true},retiredFrom,false)).toBe(true);
  expect(canCompleteCampusDisposition({canWrite:true,terminal:true},retiredFrom,false)).toBe(true);
 });
 test('completed disposition hides both disposition actions',()=>{
  const retiredFrom='2026-01-01T00:00:00';
  expect(canRecordCampusDisposition({canWrite:true,terminal:true},retiredFrom,true)).toBe(false);
  expect(canCompleteCampusDisposition({canWrite:true,terminal:true},retiredFrom,true)).toBe(false);
 });
 test('unknown disposition status hides both actions until assessment succeeds',()=>{
  const retiredFrom='2026-01-01T00:00:00';
  expect(canRecordCampusDisposition({canWrite:true,terminal:true},retiredFrom,null)).toBe(false);
  expect(canCompleteCampusDisposition({canWrite:true,terminal:true},retiredFrom,null)).toBe(false);
 });
 test('terminal campuses expose cancellation only when a plan remains',()=>{
  expect(canCancelCampusOpening({canWrite:true,terminal:true},'2099-01-01T00:00:00')).toBe(true);
  expect(canCancelCampusOpening({canWrite:true,terminal:true},null)).toBe(false);
  expect(canCancelCampusOpening({canWrite:true,terminal:false},'2099-01-01T00:00:00')).toBe(false);
 });
 test('disposition actions require write permission and an established retirement boundary',()=>{
  for(const context of [null,undefined,{canWrite:false,terminal:false},{canWrite:false,terminal:true}]){
    expect(canRecordCampusDisposition(context,'2099-01-01T00:00:00',false)).toBe(false);
    expect(canCompleteCampusDisposition(context,'2099-01-01T00:00:00',false)).toBe(false);
  }
  expect(canRecordCampusDisposition({canWrite:true,terminal:false},null,false)).toBe(false);
  expect(canCompleteCampusDisposition({canWrite:true,terminal:true},null,false)).toBe(false);
 });
 test('lifecycle source cannot be requested as a profile revision',()=>{
  expect(isCampusWorkspaceAction('REVISE')).toBe(false);expect(isCampusWorkspaceAction('RECORD_DISPOSITION')).toBe(true);expect(isCampusWorkspaceAction('RETIRE')).toBe(true);
 });
});
