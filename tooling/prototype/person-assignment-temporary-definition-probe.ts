import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { AssignmentSemanticTermVersion } from '../../apps/governance-api/src/modules/person-master/index.js';
import type { TemporaryCheck, TemporaryFixture } from './person-assignment-temporary-fixture.js';
import { requireTemporaryFixtureTarget } from './person-assignment-temporary-fixture-guard.js';
import { temporarySource, temporarySourceSnapshot } from './person-assignment-temporary-test-support.js';
import { Jan, Jun, Jul, Aug, departmentScope } from './person-assignment-fixture.js';

export async function runTemporaryDefinitions(database:Kysely<DB>,f:TemporaryFixture,check:TemporaryCheck) {
  if(f.ownership.mode==='RETAINED') {
    await check(['SC-06','SO-10','DW-09','LF-03'],'Retained shared definitions are read-only; retirement/narrowing cases require matching fresh execution',async()=>({
      reason:'C04_RETAINED_SHARED_MUTATION_FORBIDDEN',database:f.ownership.identity.database}),'SKIPPED_BY_SCOPE');return;
  }
  async function current(dimension:'PURPOSE'|'MODE',code:string) {
    const term=await f.semantics().findAssignmentSemanticTermAsOf({...f.scope,dimension,code,recordAsOf:await f.now()});assert.ok(term);return term;
  }
  async function change(prior:AssignmentSemanticTermVersion,definitionState:'ENABLED'|'RETIRED',to:string|null,label=prior.label) {
    await requireTemporaryFixtureTarget(database,'SHARED_DEFINITION_MUTATION');
    return f.semantics().appendAssignmentSemanticTermVersion({...f.scope,termId:prior.termId,expectedCurrentVersionId:prior.termVersionId,
      label,definitionState,businessValidFrom:prior.businessValidFrom,businessValidTo:to,
      reasonCode:definitionState==='RETIRED'?'RETIREMENT':'APPLICABILITY_CORRECTION'});
  }
  await check(['SC-06','SO-10','LF-03','MD-10'],'Retired current PRIMARY preserves the source fact; an unavailable source and retired SECONDMENT do not block minimal-permission END',async()=>{
    await requireTemporaryFixtureTarget(database,'SHARED_DEFINITION_MUTATION');
    const department=await f.createDepartment('C04-RETIRED-SOURCE');
    const {source}=await temporarySource(f,{placement:{scope:'DEPARTMENT',departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:department.departmentId}});
    const primary=await current('MODE','PRIMARY_AFFILIATION'),mode=await current('MODE','SECONDMENT');
    try {
      const retiredPrimary=await change(primary,'RETIRED',primary.businessValidTo);
      const resolution=await f.semantics().resolvePrimaryAffiliation({...f.scope,engagementId:source.acceptanceEvidence.engagement.engagementId,
        purposeCode:'ORGANIZATIONAL_AFFILIATION',scopeCode:'HOSPITAL_DEPARTMENT_PLACEMENTS',businessAt:Jul,recordAsOf:retiredPrimary.recordedFrom});
      assert.equal(resolution.resolution,'UNIQUE');assert.equal(resolution.selectedAssignmentVersionId,source.assignmentVersionId);
      const child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
      const frozen=await temporarySourceSnapshot(database,child.targetAssignmentId);
      const retiredMode=await change(mode,'RETIRED',mode.businessValidTo);
      const sourceClosed=await f.closure().endAssignment(f.endCommand(source,Jun));
      await f.reviseDepartment(department.departmentId,'SUSPENDED','SYNTHETIC C04 UNAVAILABLE SOURCE');
      const minimal=await f.principal(['PERSON_MASTER_ASSIGNMENT_READ','PERSON_MASTER_ASSIGNMENT_END','PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ']);
      const closed=await f.closure(undefined,minimal).endAssignment(f.endCommand(child.targetAdmission,'2026-07-20T00:00:00'));
      const semantic=await f.semantics(undefined,minimal).getAssignmentVersionSemantics({...f.scope,assignmentId:child.targetAssignmentId,assignmentVersionId:closed.assignmentVersionId});
      assert.equal(semantic.classification,'CLASSIFIED');
      if(semantic.classification==='CLASSIFIED'){assert.equal(semantic.mode.code,'SECONDMENT');assert.equal(semantic.semanticRole,'INHERITED_FOR_CLOSURE');}
      assert.deepEqual((await f.temporary().getTemporaryAssignment({...f.scope,targetAssignmentId:child.targetAssignmentId})).sourceLink,child.sourceLink);
      return {resolution,retiredPrimary,child,frozen,retiredMode,sourceClosed,minimal,closed,semantic};
    } finally {
      await change(await current('MODE','PRIMARY_AFFILIATION'),primary.definitionState,primary.businessValidTo,primary.label);
      await change(await current('MODE','SECONDMENT'),mode.definitionState,mode.businessValidTo,mode.label);
    }
  });
  await check(['DW-09','SC-06'],'Target Purpose and SECONDMENT each require the latest enabled definition covering the full window, with no old-open fallback',async()=>{
    const observations=[];
    for(const dimension of ['PURPOSE','MODE'] as const) for(const state of ['RETIRED','NARROW'] as const) {
      const {source}=await temporarySource(f),code=dimension==='MODE'?'SECONDMENT':'ORGANIZATIONAL_AFFILIATION',prior=await current(dimension,code);
      try {
        const altered=await change(prior,state==='RETIRED'?'RETIRED':'ENABLED',state==='NARROW'?Jul:prior.businessValidTo);
        const before=await temporarySourceSnapshot(database,source.assignmentId);
        await assert.rejects(f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source)),{message:'ASSIGNMENT_TERM_NOT_APPLICABLE'});
        assert.deepEqual(await temporarySourceSnapshot(database,source.assignmentId),before);
        const exact=await f.semantics().getAssignmentSemanticTermVersion({...f.scope,termVersionId:prior.termVersionId});
        assert.equal(exact.definitionState,'ENABLED');assert.equal(exact.businessValidTo,null);
        observations.push({dimension,state,prior:prior.termVersionId,altered,oldOpenStillExists:exact.termVersionId});
      } finally {await change(await current(dimension,code),prior.definitionState,prior.businessValidTo,prior.label);}
    }
    return {window:{from:Jul,to:Aug},observations};
  });
}
