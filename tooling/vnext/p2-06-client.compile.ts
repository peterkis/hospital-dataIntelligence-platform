import {createDepartmentImpactClient} from '../../packages/generated-api-client/src/index.js';
const client=createDepartmentImpactClient('http://localhost','maker');
const command={requestId:'uuid',caseId:'uuid',campus:'NORTH' as const,reason:'TEST',expectedHead:'0'};
void client.assess({requestId:'uuid',reason:'TEST',target:{kind:'EVENT',id:'uuid',campus:'NORTH'}});
void client.receipt({...command,proposalEventId:'uuid',consumerActor:'synthetic',outcome:'SIMULATED_COMPLETED',simulated:true,receiptRef:'TEST'});
// @ts-expect-error A production completion is not a receipt outcome.
void client.receipt({...command,proposalEventId:'uuid',consumerActor:'synthetic',outcome:'COMPLETED',simulated:true,receiptRef:'TEST'});
// @ts-expect-error Consumers cannot supply the server actor.
void client.assess({requestId:'uuid',reason:'TEST',actor:'reviewer',target:{kind:'INPUT',id:'uuid'}});
// @ts-expect-error A new relationship must state the old relationship disposition.
void client.disposition({...command,disposition:{kind:'NEW_RELATION',evidenceId:'uuid',result:{owner:'SOURCE_MAPPING',id:'uuid',versionId:'uuid',candidateId:'uuid',requestId:'uuid'}}});
