import {createOrganizationEvolutionClient,type OrganizationEvolutionInput} from '../../packages/generated-api-client/src/vnext-client.js';

/** Compile-only proof of the closed generated request contract. */
export function checkEvolutionClientContract(client:ReturnType<typeof createOrganizationEvolutionClient>,input:OrganizationEvolutionInput){
 void client.stage(input);
 // Source provenance is assigned by the Owner parser, never by a caller.
 // @ts-expect-error sourceRows is outside the public metadata schema
 void client.stage({...input,sourceRows:{event:20,relations:[],successors:[]}});
 // @ts-expect-error undeclared target types cannot replace the typed Department reference
 void client.stage({...input,predecessors:[{owner:'campus-owner',id:'id',expectedVersion:'1'}]});
 // @ts-expect-error generated verify requires every independent impact review
 void client.verify({requestId:'id',inputId:'id',inputDigest:'digest',reason:'reason',policyApproved:true,materialsAccepted:true});
 // @ts-expect-error exact record and business times remain text, without numeric coercion
 void client.query({id:'id',campus:'NORTH',businessAt:123});
}
