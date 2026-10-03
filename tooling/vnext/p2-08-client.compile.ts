import {createDepartmentLifecycleClient,createOrganizationEvolutionClient} from '../../packages/generated-api-client/src/index.js';
const client=createDepartmentLifecycleClient('http://127.0.0.1','maker');
void client.admission({id:'00000000-0000-0000-0000-000000000001',validFrom:'2026-01-01T00:00:00',validTo:null});
// @ts-expect-error a Department admission query requires its stable ID
void client.admission({campus:null,validFrom:'2026-01-01T00:00:00',validTo:null});
// @ts-expect-error time strings cannot be numbers
void client.admission({id:'00000000-0000-0000-0000-000000000001',validFrom:123,validTo:null});
type Stage=Parameters<typeof client.stage>[0];
const id='00000000-0000-0000-0000-000000000001';
const base:Omit<Stage,'commands'>={requestId:id,jobId:id,revisionId:id,campus:'NORTH',profile:'CORE',impacts:[]};
const department={owner:'department-master' as const,id,expectedVersion:'1',expectedLifecycleHead:'0'};
void client.stage({...base,commands:[{action:'ASSIGN',department,campus:{owner:'organization-master/campus',id},subject:{owner:'organization-master',id},services:['DEMO_MEDICAL_A'],validFrom:'2026-01-01T00:00:00',validTo:null,reason:'TEST',evidenceId:id}]});
// @ts-expect-error every other field is present; optimistic lifecycle head is required
void client.stage({...base,commands:[{action:'SUSPEND',department:{owner:'department-master',id,expectedVersion:'1'},effectiveAt:'2026-01-01T00:00:00',reason:'TEST',evidenceId:id}]});
// @ts-expect-error an ASSIGN needs a real typed Campus endpoint
void client.stage({...base,commands:[{action:'ASSIGN',department,campus:null,subject:{owner:'organization-master',id},services:['DEMO_MEDICAL_A'],validFrom:'2026-01-01T00:00:00',validTo:null,reason:'TEST',evidenceId:id}]});
void createOrganizationEvolutionClient('http://127.0.0.1','maker');
