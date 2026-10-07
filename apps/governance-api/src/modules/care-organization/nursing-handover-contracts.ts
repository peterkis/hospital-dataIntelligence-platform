import {Type,type Static} from 'typebox';
import {NursingId,NursingTime} from './nursing-contracts.js';
import {NursingConfirmedHandoverSchema} from './ward-nursing-contracts.js';

const closed={additionalProperties:false} as const;
const Digest=Type.String({pattern:'^[a-f0-9]{64}$'});
const supplied=Type.Omit(NursingConfirmedHandoverSchema,['nursingConfirmation'],closed);
export const NursingCoverageHandoverSchema=Type.Object({...supplied.properties,confirmed:Type.Literal(true)},closed);
export const NursingHandoverBindingSchema=Type.Object({inputId:NursingId,inputDigest:Digest,row:Type.Integer({minimum:1,maximum:100}),handover:NursingCoverageHandoverSchema},closed);
export const NursingHandoverConfirmSchema=Type.Object({requestId:NursingId,...NursingHandoverBindingSchema.properties,reason:Type.String({minLength:1,maxLength:2000,pattern:'\\S'})},closed);
export const NursingHandoverConfirmationSchema=Type.Object({confirmationId:NursingId,digest:Digest,recordedAt:NursingTime},closed);
export const NursingHandoverConfirmationBasisSchema=Type.Object({id:NursingId,digest:Digest},closed);
export type NursingHandoverBinding=Static<typeof NursingHandoverBindingSchema>;
export type NursingHandoverConfirm=Static<typeof NursingHandoverConfirmSchema>;
export type NursingHandoverConfirmation=Static<typeof NursingHandoverConfirmationSchema>;
export type NursingHandoverConfirmationBasis=Static<typeof NursingHandoverConfirmationBasisSchema>;
export interface NursingHandoverConfirmedBasis {id:string;digest:string;recordedAt:string;materialDigest:string}
