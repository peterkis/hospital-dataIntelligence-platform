import {createOrganizationIdentifierClient,type OrganizationIdentifierInput} from './index.js';
declare const input:OrganizationIdentifierInput;
const client=createOrganizationIdentifierClient('http://127.0.0.1','maker');
void client.stage(input);
void client.resolve({scheme:'SYNTHETIC_DEPARTMENT_CODE',value:'0012',campus:'NORTH',businessAt:'2026-01-01T00:00:00'});
// @ts-expect-error An explicit campus is required; null cannot imply all-campus authority.
void client.list({campus:null});
// @ts-expect-error A caller cannot assign a platform identity to a new relation.
void client.stage({...input,platformId:'arbitrary'});
// @ts-expect-error Source text identifiers cannot be numeric inputs.
void client.stage({...input,entries:[{...input.entries[0]!,row:{...input.entries[0]!.row,identifier_value:12}}]});
void client.review({candidateId:'candidate'}).then(({data})=>{if(data){void data.entries[0]?.row.identifier_value;void data.commandFacts[0]?.step;void data.basis.heads[0]?.versions[0]?.value;}});
