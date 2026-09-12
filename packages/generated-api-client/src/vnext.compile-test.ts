import { createVNextCatalogClient, type VNextCommand } from './vnext-client.js';
const client=createVNextCatalogClient('http://127.0.0.1:4317','maker');
const valid:VNextCommand={action:'CREATE',scope:'SYNTHETIC',kind:'SOURCE',code:'TEST',requestId:'synthetic-test',reason:'TEST',values:{name:'Synthetic',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'};
void valid;
// @ts-expect-error Unknown scopes cannot be requested by a current typed client.
void client.GET('/api/vnext/catalog',{params:{query:{scope:'UNKNOWN'}}});
// @ts-expect-error Caller-generated stable IDs are not a create input field.
const invalid:VNextCommand={...valid,stableId:'caller-forged'};
void invalid;
// @ts-expect-error Source material approval is not an editable field.
const approval:VNextCommand={...valid,values:{approval_status:'APPROVED'}};
void approval;
// @ts-expect-error Lifecycle actions do not accept creation fields.
const extraLifecycle:VNextCommand={action:'SUBMIT',scope:'SYNTHETIC',requestId:'test',reason:'TEST',target:'test',expectedHead:'1',code:'IGNORED'};
void extraLifecycle;
// @ts-expect-error Retirement requires an exact reviewed digest.
const unreviewedRetirement:VNextCommand={action:'RETIRE',scope:'SYNTHETIC',requestId:'test',reason:'TEST',target:'test',expectedHead:'1'};
void unreviewedRetirement;
// @ts-expect-error Controlled governance roles are a finite vocabulary.
const invalidRole:VNextCommand={...valid,values:{role:'TYPO'}};
void invalidRole;

// @ts-expect-error SOURCE creation requires its complete declaration, not an empty patch.
const emptySource:VNextCommand={...valid,values:{}};
void emptySource;
// @ts-expect-error SOURCE creation does not accept responsibility fields.
const crossKind:VNextCommand={...valid,values:{dataset:'ORG01',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'}};
void crossKind;
// @ts-expect-error SOFTWARE creation requires vendor and systemVersion.
const softwareMissingVendor:VNextCommand={...valid,values:{...valid.values,sourceKind:'SOFTWARE'}};
void softwareMissingVendor;
// @ts-expect-error RESPONSIBILITY creation requires complete scoped responsibility fields.
const emptyResponsibility:VNextCommand={action:'CREATE',kind:'RESPONSIBILITY',scope:'SYNTHETIC',code:'TEST',requestId:'test',reason:'TEST',values:{name:'Wrong kind'},validFrom:'2026-01-01T00:00:00'};
void emptyResponsibility;
