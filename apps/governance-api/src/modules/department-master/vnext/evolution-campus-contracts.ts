import {Type,type Static} from 'typebox';
import {Id} from './contracts.js';
const closed={additionalProperties:false} as const;
/** Explicit companion writes use an accepted identity or a successor-local alias. */
export const EvolutionCampusChangeSchema=Type.Union([
 Type.Object({action:Type.Literal('END'),departmentId:Id,relation:Type.Object({owner:Type.Literal('department-master/campus-relation'),id:Id,expectedVersion:Type.String({pattern:'^[1-9][0-9]*$'})},closed)},closed),
 Type.Object({action:Type.Literal('ASSIGN'),department:Type.Union([
  Type.Object({owner:Type.Literal('department-master'),id:Id},closed),
  Type.Object({owner:Type.Literal('department-master/evolution-successor'),alias:Type.String({minLength:1,maxLength:64})},closed),
 ]),campus:Type.Object({owner:Type.Literal('organization-master/campus'),id:Id},closed),subject:Type.Object({owner:Type.Literal('organization-master'),id:Id},closed),services:Type.Array(Type.String({minLength:1,maxLength:64}),{minItems:1,maxItems:100,uniqueItems:true}),validTo:Type.Union([Type.String(),Type.Null()])},closed),
]);
export type EvolutionCampusChange=Static<typeof EvolutionCampusChangeSchema>;
