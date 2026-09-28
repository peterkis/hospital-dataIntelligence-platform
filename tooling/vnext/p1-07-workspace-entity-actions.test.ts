import {describe,expect,test} from 'vitest';
import {canReviseWorkspaceEntity} from '../../apps/admin-web/src/vnext/workspace-entity-actions.js';
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
