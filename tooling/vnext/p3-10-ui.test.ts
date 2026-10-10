import {test,expect,vi} from 'vitest';
import {initialForm,fixedForm} from '../../apps/admin-web/src/vnext/department-form.js';
import {careSchema} from '../../apps/admin-web/src/vnext/care-model.js';
import {careFormBranch,careRequestIds,newCareRequest} from '../../apps/admin-web/src/vnext/care-request.js';
import {bindCareReferenceFields,careContextChoices} from '../../apps/admin-web/src/vnext/care-reference-fields.js';
import * as careRequests from '../../apps/admin-web/src/vnext/care-request.js';
import {careMaintenance} from '../../apps/admin-web/src/vnext/care-maintenance.js';

test('maintenance from a stored file input copies only its located producer row and binds the current head',async()=>{
 const selected={action:'CREATE',row:{unit_name:'TEST located physical row4'},binding:{department:{id:'department',owner:'department-master'}}};
 const history={versions:[{number:'1',action:'CREATE',facts:{source:{recordLocatorEvidence:{inputId:'original-input',row:4}}}},{number:'2',action:'SUSPEND'}]};
 const original={requestId:'old-request',jobId:'old-job',revisionId:'old-revision',campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',sourceArtifactId:'old-protected-file',sourceRows:[2,4],entries:[{action:'CREATE',row:{unit_name:'TEST another row'}},selected]};
 const read=vi.spyOn(careRequests,'careExecute').mockResolvedValueOnce(history).mockResolvedValueOnce(original);
 try{
  const draft=await careMaintenance('maker-alias','UNIT','stable-unit');
  expect(read).toHaveBeenNthCalledWith(1,'maker-alias','getBusinessUnitHistory',{id:'stable-unit'});
  expect(read).toHaveBeenNthCalledWith(2,'maker-alias','readBusinessUnitInput',{inputId:'original-input'});
  expect(draft).toEqual({campus:'NORTH',profile:'CORE',payload:{timePolicy:'LOCAL',entries:[{action:'REVISE',row:selected.row,target:{owner:'care-organization/unit',id:'stable-unit',expectedHead:'2'}}]}});
  expect(original.entries[1]).toEqual(selected);expect(original.sourceRows).toEqual([2,4]);
 }finally{read.mockRestore();}
});

test('location maintenance uses the native expectedVersion and leaves the accepted containment out of REVISE',async()=>{
 const original={campus:'SOUTH',profile:'CORE',campusId:'campus',timePolicy:'LOCAL',entries:[{action:'CREATE',row:{location_name:'TEST room'},parent:{kind:'EXISTING',reference:{owner:'location-master',id:'parent'}}}]};
 const read=vi.spyOn(careRequests,'careExecute').mockResolvedValueOnce({versions:[{number:'3',action:'REVISE',facts:{source:{recordLocatorEvidence:{inputId:'location-input',row:1}}}}]}).mockResolvedValueOnce(original);
 try{expect(await careMaintenance('maker','LOCATION','room')).toEqual({campus:'SOUTH',profile:'CORE',payload:{campusId:'campus',timePolicy:'LOCAL',entries:[{action:'REVISE',row:original.entries[0]!.row,target:{owner:'location-master',id:'room',expectedVersion:'3'}}]}});}finally{read.mockRestore();}
});

test.each(['UNIT_WARD','WARD_NURSING','LOCATION_USE'] as const)('%s maintenance converts a stored source version to the direct integer contract without changing the original',async kind=>{
 const original={campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',entries:[{action:'CREATE',row:{version_no:'9'},applicability:{campus:{id:'campus'}}}]};
 const read=vi.spyOn(careRequests,'careExecute').mockResolvedValueOnce({versions:[{number:'1',action:'CREATE',facts:{source:{recordLocatorEvidence:{inputId:'input',row:1}}}}]}).mockResolvedValueOnce(original);
 try{expect((await careMaintenance('maker',kind,'id')).payload.entries).toEqual([expect.objectContaining({row:{version_no:9},applicability:original.entries[0]!.applicability})]);expect(original.entries[0]!.row.version_no).toBe('9');}finally{read.mockRestore();}
});

test.each(['MAPPING','PERMISSION'] as const)('%s file maintenance retains its native kind and target Owner while preparing an integer source version',async kind=>{
 const original={campus:'SOUTH',profile:'FULL',timePolicy:'LOCAL',sourceArtifactId:'protected',sourceRows:[2],entries:[{kind,action:'RECORD',row:{version_no:'9'},applicability:{campus:{id:'campus'}}}]};
 const read=vi.spyOn(careRequests,'careExecute').mockResolvedValueOnce({versions:[{number:'3',action:'RECORD',facts:{source:{recordLocatorEvidence:{inputId:'original',row:2}}}}]}).mockResolvedValueOnce(original);
 try{expect(await careMaintenance('maker','PERMISSION','stable')).toEqual({campus:'SOUTH',profile:'FULL',payload:{timePolicy:'LOCAL',entries:[{kind,action:'REVISE',row:{version_no:9},applicability:original.entries[0]!.applicability,target:{owner:kind==='MAPPING'?'care-organization/subject-mapping':'care-organization/subject-permission',id:'stable',expectedHead:'3'}}]}});expect(original.entries[0]!.row.version_no).toBe('9');}finally{read.mockRestore();}
});

test('explicit basis selection binds the complete native reference and limits choices to that exact version',()=>{
 const option={value:'system',label:'TEST adopted system',versionId:'exact',version:'3',fields:{systemId:'system',versionId:'exact',version:'3',code:'',codes:[{code:'A',name:'TEST A'}]}},choices={systemId:[option],subjectAdoption:[option]},schema={properties:{systemId:{type:'string'},versionId:{type:'string'},version:{type:'string'},code:{type:'string'}}};
 expect(bindCareReferenceFields(schema,'systemId',{systemId:'system',code:'OLD'},choices)).toEqual({systemId:'system',versionId:'exact',version:'3',code:''});
 expect(careContextChoices(choices,'code',{systemId:'system',versionId:'exact'})).toEqual([expect.objectContaining({value:'A'})]);expect(careContextChoices(choices,'code',{systemId:'system',versionId:'other'})).toEqual([]);
 expect(careContextChoices(choices,'code',{code:'new',name:'TEST new code'})).toBeUndefined();
 expect(bindCareReferenceFields(schema,'code',{systemId:'system',versionId:'exact',version:'3',code:'A'},choices)).toHaveProperty('code','A');
});

test('removing or reordering entries cannot adopt a current reference or erase accepted fields in other entries',()=>{
 const accepted={systemId:'B',versionId:'B-accepted',version:'2',code:'B1'},current={value:'B',label:'TEST B current',fields:{systemId:'B',versionId:'B-current',version:'3',code:''}},schema={properties:{entries:{type:'array',items:{properties:{systemId:{type:'string'},versionId:{type:'string'},version:{type:'string'},code:{type:'string'}}}}}};
 expect(bindCareReferenceFields(schema,'entries',{entries:[accepted]},{systemId:[current]})).toEqual({entries:[accepted]});expect(accepted.versionId).toBe('B-accepted');
});

test('input-bound material review initializes the exact INPUT branch without OWN authority fields',()=>{
 const schema=careSchema('readCareWorkspaceMaterial'),initial={access:'INPUT',kind:'UNIT',inputId:'original-input'},body={...initialForm(careFormBranch(schema,initial)) as Record<string,unknown>,...initial};
 expect(body).toMatchObject(initial);expect(body).not.toHaveProperty('jobId');expect(body).not.toHaveProperty('campus');expect(body).not.toHaveProperty('dimensions');
});
test('independent confirmations remain false until the reviewer explicitly confirms',()=>{
 const schema={type:'boolean',enum:[true]};expect(initialForm(schema)).toBe(false);expect(fixedForm(schema,false)).toBe(false);expect(fixedForm(schema,true)).toBe(true);
});

test('request allocation retains an explicit absent license in the native verification contract',()=>{
 const schema=careSchema('verifySubjectPermissionInput'),body={requestId:'existing',inputId:'input',inputDigest:'digest',reason:'TEST',policyVersion:'ORG17_CORE_V1',rows:[{row:1,evidenceId:'evidence',classificationAccepted:true,scopeAccepted:true,adoptionConfirmed:true,limitationsConfirmed:true,license:null,semantic:'EQUIVALENT',validFrom:'2026-01-01T00:00:00',validTo:null}]};
 expect(careRequestIds(schema,body)).toEqual(body);expect(body.rows[0]!.license).toBeNull();
});
test('editing allocates a new request while leaving exact references and original protected contents intact',()=>{
 const value={requestId:'old',candidateId:'exact',nested:{fileRequestId:'old-file',artifactId:'material'},rows:[{requestId:'old-row',reference:{version:'3'}}]};
 expect(newCareRequest(value)).toEqual({candidateId:'exact',nested:{artifactId:'material'},rows:[{reference:{version:'3'}}]});expect(value.requestId).toBe('old');
});
test('request allocation selects the exact discriminator and preserves supplied original request IDs',()=>{
 const schema={anyOf:[{properties:{kind:{enum:['A']},requestId:{type:'string'}}},{properties:{kind:{enum:['B']},fileRequestId:{type:'string'}}}]};
 const result=careRequestIds(schema,{kind:'B',fileRequestId:'exact-original'});expect(result).toEqual({kind:'B',fileRequestId:'exact-original'});
});
