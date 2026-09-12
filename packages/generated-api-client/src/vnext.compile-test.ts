import { createVNextCatalogClient, type VNextCommand } from './vnext-client.js';
const client=createVNextCatalogClient('http://127.0.0.1:4317','maker');
const valid:VNextCommand={action:'CREATE',scope:'SYNTHETIC',kind:'SOURCE',code:'TEST',requestId:'synthetic-test',reason:'TEST',values:{name:'Synthetic'}};
void valid;
// @ts-expect-error Unknown scopes cannot be requested by a current typed client.
void client.GET('/api/vnext/catalog',{params:{query:{scope:'UNKNOWN'}}});
// @ts-expect-error Caller-generated stable IDs are not a create input field.
const invalid:VNextCommand={...valid,stableId:'caller-forged'};
void invalid;
// @ts-expect-error Source material approval is not an editable field.
const approval:VNextCommand={...valid,values:{approval_status:'APPROVED'}};
void approval;
