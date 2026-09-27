import {test,expect,vi} from 'vitest';
import {retainWorkspaceSubmit,workspaceSubmitRequest,type WorkspaceSubmitRequest} from '../../apps/admin-web/src/vnext/workspace-submit-request.js';
const a={id:'00000000-0000-0000-0000-000000000001',version:'1',state:'EDITING' as const};
const b={...a,id:'00000000-0000-0000-0000-000000000002'};
const pending:WorkspaceSubmitRequest={id:a.id,expectedVersion:a.version,requestId:'00000000-0000-0000-0000-000000000003'};
const fresh='00000000-0000-0000-0000-000000000004';

test('a first submission binds the selected draft and expected version',()=>{
 const uuid=vi.fn(()=>fresh);
 expect(workspaceSubmitRequest(null,b,uuid)).toEqual({id:b.id,expectedVersion:b.version,requestId:fresh});expect(uuid).toHaveBeenCalledTimes(1);
});
test('uncertain same-draft retries and same-revision restoration retain the exact request',()=>{
 const uuid=vi.fn(()=>fresh),restored=JSON.parse(JSON.stringify(a));
 expect(retainWorkspaceSubmit(pending,restored)).toBe(pending);
 expect(workspaceSubmitRequest(pending,restored,uuid)).toBe(pending);expect(uuid).not.toHaveBeenCalled();
});
test('restoring B invalidates A and dispatch also rejects A without relying on restoration',()=>{
 expect(retainWorkspaceSubmit(pending,b)).toBeNull();
 expect(workspaceSubmitRequest(pending,b,()=>fresh)).toEqual({id:b.id,expectedVersion:b.version,requestId:fresh});
});
test('a newer saved revision cannot reuse the old optimistic concurrency target',()=>{
 const next={...a,version:'2'};
 expect(retainWorkspaceSubmit(pending,next)).toBeNull();
 expect(workspaceSubmitRequest(pending,next,()=>fresh)).toEqual({id:a.id,expectedVersion:'2',requestId:fresh});
});
for(const state of ['SUBMITTED','DISCARDED'] as const)test(state+' restoration clears retries and cannot dispatch',()=>{
 const uuid=vi.fn(()=>fresh),target={...a,state};
 expect(retainWorkspaceSubmit(pending,target)).toBeNull();expect(workspaceSubmitRequest(pending,target,uuid)).toBeNull();expect(uuid).not.toHaveBeenCalled();
});
test('leaving the draft editor cannot create a submit request without a saved target',()=>{
 const uuid=vi.fn(()=>fresh);expect(retainWorkspaceSubmit(pending,null)).toBeNull();expect(workspaceSubmitRequest(pending,null,uuid)).toBeNull();expect(uuid).not.toHaveBeenCalled();
});
test('A to B to A does not resurrect a request from a different selected draft',()=>{
 const bRequest=workspaceSubmitRequest(retainWorkspaceSubmit(pending,b),b,()=>fresh)!;
 const aAgain=workspaceSubmitRequest(retainWorkspaceSubmit(bRequest,a),a,()=>fresh+'5')!;
 expect(aAgain.id).toBe(a.id);expect(aAgain.requestId).not.toBe(pending.requestId);expect(aAgain.requestId).not.toBe(bRequest.requestId);
});
