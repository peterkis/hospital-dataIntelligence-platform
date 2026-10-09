import {Type,type Static} from 'typebox';
import {CoverageScopeSchema,WardNursingHead,WardNursingId,WardNursingScopeSchema,WardNursingTime} from './ward-nursing-contracts.js';

const closed={additionalProperties:false} as const;
const End=Type.Union([WardNursingTime,Type.Null()]);
const Period=Type.Object({from:WardNursingTime,to:End},closed);
const Successor=Type.Object({id:WardNursingId,versionId:WardNursingId,version:WardNursingHead,nursing:WardNursingScopeSchema.properties.nursing,coverage:CoverageScopeSchema,sourceAlias:Type.String({minLength:1,maxLength:64,pattern:'\\S'})},closed);
const Completed={source:Type.Object({id:WardNursingId,versionId:WardNursingId,version:WardNursingHead,expectedHead:WardNursingHead},closed),cutover:WardNursingTime,successors:Type.Array(Successor,{minItems:1,maxItems:100}),clinicalReadiness:Type.Literal('NOT_READY')};

export const WardNursingHandoverReceiptSchema=Type.Union([
 Type.Object({source:Type.Object({id:WardNursingId,head:WardNursingHead},closed),cutover:End,status:Type.Literal('NOT_COMPLETED'),successors:Type.Array(Successor,{maxItems:0}),clinicalReadiness:Type.Literal('NOT_READY')},closed),
 Type.Object({...Completed,status:Type.Literal('CONFIRMED_SCHEDULED')},closed),
 Type.Object({...Completed,status:Type.Literal('CONFIRMED_EFFECTIVE')},closed),
]);
export type WardNursingHandoverReceipt=Static<typeof WardNursingHandoverReceiptSchema>;

export const WardNursingEndpointImpactResultSchema=Type.Object({
 owner:Type.Literal('WARD_NURSING_COVERAGE'),endpoint:Type.Object({kind:Type.Enum(['NURSING','WARD']),id:WardNursingId},closed),
 validFrom:WardNursingTime,validTo:End,recordAsOf:WardNursingTime,status:Type.Literal('EVALUATED'),clinicalReadiness:Type.Literal('NOT_READY'),
 items:Type.Array(Type.Object({
  id:WardNursingId,applicability:WardNursingScopeSchema,
  original:Type.Object({versionId:WardNursingId,version:WardNursingHead,period:Period,coverage:CoverageScopeSchema,digest:Type.String({pattern:'^[a-f0-9]{64}$'}),dependencies:Type.Unknown()},closed),
  current:Type.Object({versionId:WardNursingId,version:WardNursingHead,action:Type.Enum(['CREATE','REVISE','END']),period:Period,coverage:CoverageScopeSchema},closed),
  active:Type.Boolean(),outstanding:Type.Boolean(),affectedSpans:Type.Array(Period),
  lifecycle:Type.Array(Type.Object({versionId:WardNursingId,action:Type.Enum(['SUSPEND','RESUME','CLOSE']),from:WardNursingTime,to:End},closed)),
  constraint:Type.Enum(['SATISFIED','UNSATISFIED']),
 },closed)),
},closed);
