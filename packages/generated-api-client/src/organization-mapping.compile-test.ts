import {createOrganizationMappingClient,type OrganizationMappingInput} from './index.js';
declare const input:OrganizationMappingInput;
const client=createOrganizationMappingClient('http://127.0.0.1','maker');
void client.stage(input);
void client.resolve({fromSystemId:'source',sourceEntityType:'DEPARTMENT',sourceCode:'001',sourceContext:'DEFAULT',campus:'NORTH',businessAt:'2026-01-01T00:00:00'});
// @ts-expect-error Incarnation is not an implicit extra dimension in this contract.
void client.resolve({fromSystemId:'source',sourceEntityType:'DEPARTMENT',sourceCode:'001',sourceContext:'DEFAULT',campus:'NORTH',businessAt:'2026-01-01T00:00:00',incarnation:'2'});
// @ts-expect-error An explicit supported campus is required; null is not all-campus authorization.
void client.list({campus:null});
void client.review({candidateId:'candidate'}).then(({data})=>{if(data){
 void data.basis.verification?.rows[0]?.sourceKeyReuse;
 void data.basis.heads[0]?.versions[0]?.facts.target.parts[0]?.versionId;
 void data.commandFacts[0]?.facts.sourcePins;
 void data.diff[0]?.mapping?.expectedHead;
 void data.input.revisionId;
}});
