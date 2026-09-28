import {Children,createElement,isValidElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect,vi} from 'vitest';
import {WorkspaceLicenseActions,licenseVersionActions,licenseRevocationDraft,type LicenseVersion,type LicenseContext} from '../../apps/admin-web/src/vnext/workspace-license-actions.js';

const row=(version:string,revoked=false,id='license-a'):LicenseVersion=>({id,version,revoked});
const old=row('2'),head=row('10'),revoked=row('11',true),other=row('1',false,'license-b');
const history=[head,other,old];
const context:LicenseContext={kind:'LICENSE',id:head.id,head:head.version,subjectId:'subject-a',subjectHead:'7',campus:'NORTH',campusId:null,canWrite:true,canClose:true,canActivate:false,terminal:false};
const render=(license:LicenseVersion,rows:readonly LicenseVersion[],canMaintain=true,busy=false)=>renderToStaticMarkup(createElement(WorkspaceLicenseActions,{license,history:rows,canMaintain,busy,onRevise:()=>{},onRevoke:()=>{}}));

test('latest live license renders both actions while an old live assertion only renders revision',()=>{
 const current=render(head,history),previous=render(old,history);
 expect(current).toContain('以此证照版本修订');expect(current).toContain('撤销此证照断言');
 expect(previous).toContain('以此证照版本修订');expect(previous).not.toContain('撤销此证照断言');
});
test('heads are compared numerically per license and never depend on response order',()=>{
 for(const rows of [history,[...history].reverse(),[old,head,other]]){
  expect(licenseVersionActions(old,rows,true)).toEqual({canRevise:true,canRevoke:false});
  expect(licenseVersionActions(head,rows,true)).toEqual({canRevise:true,canRevoke:true});
  expect(licenseVersionActions(other,rows,true)).toEqual({canRevise:true,canRevoke:true});
 }
});
test('a revoked head exposes no actions and does not promote an older live row to revocable',()=>{
 const rows=[old,revoked,head];
 expect(render(revoked,rows)).toBe('');
 expect(render(head,rows)).toContain('以此证照版本修订');
 expect(render(head,rows)).not.toContain('撤销此证照断言');
 expect(licenseVersionActions(revoked,rows,true)).toEqual({canRevise:false,canRevoke:false});
});
test('a historical revocation never becomes a revision source after a later live assertion',()=>{
 const restored=row('12'),rows=[old,restored,revoked,head];
 expect(render(revoked,rows)).toBe('');expect(render(restored,rows)).toContain('撤销此证照断言');
});
test('a future-effective head still prevents revocation of its predecessor',()=>{
 const future={...head,validFrom:'2035-01-01T00:00:00'},rows=[old,future];
 expect(licenseVersionActions(old,rows,true).canRevoke).toBe(false);
 expect(licenseVersionActions(future,rows,true).canRevoke).toBe(true);
});
test('historical and permission-denied views render no maintenance buttons',()=>{
 for(const license of history)expect(render(license,history,false)).toBe('');
});
test('busy buttons are disabled and their callbacks cannot create a draft',()=>{
 const onRevise=vi.fn(),onRevoke=vi.fn();
 const props={license:head,history,canMaintain:true,busy:true,onRevise,onRevoke};
 const element=WorkspaceLicenseActions(props);
 expect(renderToStaticMarkup(element).match(/disabled=""/g)).toHaveLength(2);
 for(const child of Children.toArray(element.props.children)){
  if(isValidElement<{onClick:()=>void}>(child))child.props.onClick();
 }
 expect(onRevise).not.toHaveBeenCalled();expect(onRevoke).not.toHaveBeenCalled();
 const enabled=WorkspaceLicenseActions({...props,busy:false});
 for(const child of Children.toArray(enabled.props.children)){
  if(isValidElement<{onClick:()=>void}>(child))child.props.onClick();
 }
 expect(onRevise).toHaveBeenCalledTimes(1);expect(onRevoke).toHaveBeenCalledTimes(1);
});
test('large database version numbers are not rounded through Number',()=>{
 const previous=row('9007199254740992'),latest=row('9007199254740993'),rows=[latest,previous];
 expect(licenseVersionActions(previous,rows,true).canRevoke).toBe(false);
 expect(licenseVersionActions(latest,rows,true).canRevoke).toBe(true);
});
test('unknown or malformed versions fail closed without mutating historical rows',()=>{
 const rows=Object.freeze([Object.freeze(head),Object.freeze(old)]);
 expect(licenseVersionActions(head,rows,true)).toEqual({canRevise:true,canRevoke:true});
 expect(licenseVersionActions(other,rows,true)).toEqual({canRevise:false,canRevoke:false});
 expect(licenseVersionActions(head,[],true)).toEqual({canRevise:false,canRevoke:false});
 const invalid=row('invalid');
 expect(licenseVersionActions(invalid,[invalid],true)).toEqual({canRevise:false,canRevoke:false});
 expect(licenseVersionActions(head,[head,invalid],true).canRevoke).toBe(false);
 expect(rows).toEqual([head,old]);
});
test('revocation uses freshly observed subject and license heads without changing the selected identity',()=>{
 expect(licenseRevocationDraft(head,'subject-a',{...context,subjectHead:'9'})).toEqual({domain:'ORG01',campus:'NORTH',command:{action:'REVOKE_LICENSE',validTo:null,target:{id:'subject-a',version:'9'},licenseTarget:{id:head.id,version:'10'}}});
});
for(const [name,patch] of [
 ['newer license head',{head:'11'}],['another license',{id:'license-b'}],
 ['another subject',{subjectId:'subject-b'}],['missing subject head',{subjectHead:null}],
 ['wrong context kind',{kind:'ORGANIZATION'}],['write permission revoked',{canWrite:false}],
 ['close permission revoked',{canClose:false}],['terminal context',{terminal:true}],
] satisfies Array<[string,Partial<LicenseContext>]>)test(`revocation refuses ${name} instead of silently retargeting`,()=>{
 expect(licenseRevocationDraft(head,'subject-a',{...context,...patch})).toBeNull();
});
test('a revoked selected row cannot produce a revocation draft even with matching context',()=>{
 expect(licenseRevocationDraft(revoked,'subject-a',{...context,head:revoked.version})).toBeNull();
});
