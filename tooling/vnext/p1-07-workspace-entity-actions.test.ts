import {describe,expect,test} from 'vitest';
import {canReviseWorkspaceEntity} from '../../apps/admin-web/src/vnext/workspace-entity-actions.js';

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
