import {Type,type Static} from 'typebox';
import {ParameterValueCommandSchema,SubjectCodeCommandSchema} from '../governance-catalog/index.js';
import {UnitId,UnitTime} from './contracts.js';
const closed={additionalProperties:false} as const;
export const CareBasisContentSchema=Type.Union([
 Type.Object({operation:Type.Literal('commandParameterValue'),command:ParameterValueCommandSchema},closed),
 Type.Object({operation:Type.Literal('commandSubjectCodeSnapshot'),command:SubjectCodeCommandSchema},closed),
]);
export type CareBasisContent=Static<typeof CareBasisContentSchema>;
export type CareBasisSave=CareBasisContent&{requestId:string};
export const CareBasisSaveSchema=Type.Unsafe<CareBasisSave>(Type.Union(CareBasisContentSchema.anyOf.map(branch=>Type.Object({...branch.properties,requestId:UnitId},closed))));
export const CareBasisReadSchema=Type.Object({requestId:UnitId},closed);
export const CareBasisResultSchema=Type.Object({requestId:UnitId,id:UnitId,recordedAt:UnitTime,content:CareBasisContentSchema},closed);
