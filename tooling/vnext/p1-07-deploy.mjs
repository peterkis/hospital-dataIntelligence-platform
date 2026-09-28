import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p1-07',addedColumns:{'organization_master.campus_event':['lifecycle']}});
await deployment.complete();
