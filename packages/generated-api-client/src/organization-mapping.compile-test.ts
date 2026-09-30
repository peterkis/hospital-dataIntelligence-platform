import {createOrganizationMappingClient,type OrganizationMappingInput} from './index.js';
declare const input:OrganizationMappingInput;
const client=createOrganizationMappingClient('http://127.0.0.1','maker');
void client.stage(input);
void client.resolve({fromSystemId:'source',sourceEntityType:'DEPARTMENT',sourceCode:'001',sourceContext:'DEFAULT',campus:'NORTH',businessAt:'2026-01-01T00:00:00'});
// @ts-expect-error Incarnation is not an implicit extra dimension in this contract.
void client.resolve({fromSystemId:'source',sourceEntityType:'DEPARTMENT',sourceCode:'001',sourceContext:'DEFAULT',campus:'NORTH',businessAt:'2026-01-01T00:00:00',incarnation:'2'});
// @ts-expect-error An explicit supported campus is required; null is not all-campus authorization.
void client.list({campus:null});
