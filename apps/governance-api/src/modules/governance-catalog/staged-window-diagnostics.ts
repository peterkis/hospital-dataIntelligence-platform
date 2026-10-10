import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';

const id=Type.String({format:'uuid'}),time=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
const request=Type.Object({inputId:id,revisionId:id,digest:Type.String({pattern:'^[a-f0-9]{64}$'}),contractVersionId:id,validFrom:time,validTo:Type.Union([time,Type.Null()])},{additionalProperties:false});
export type StagedWindowRequest=Static<typeof request>;
export const checkStagedWindowRequest=(value:unknown)=>{if(!Check(request,value))throw new Error('CLOSED_INPUT_REQUIRED');};
interface Window {from:string;to:string|null}
interface Issue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface StagedWindowFailure extends Window {row:number;field:string;code:string;boundaries():Promise<string[]>;evaluate(window:Window):Promise<unknown>}
export interface StagedWindowDiagnostic extends Issue,Window {issue:number}

/** Record only a failed original temporal check, after its Owner's preparation.
 * Callbacks remain inside the transaction and are never serialized or frozen. */
export async function trackStagedWindow<T>(failures:StagedWindowFailure[],row:Omit<StagedWindowFailure,'code'|'evaluate'>&{evaluate(window:Window):Promise<T>}):Promise<T>{
 try{return await row.evaluate(row);}catch(error){if(error instanceof Error)failures.push({...row,code:error.message});throw error;}
}

/** Interval orchestration only: selection, authorization and admission remain
 * the original Owner callbacks. A successful split never replaces preflight. */
export async function diagnoseStagedWindows(failures:StagedWindowFailure[],issues:Issue[],requested:Window):Promise<StagedWindowDiagnostic[]>{
 const result:StagedWindowDiagnostic[]=[];
 for(const[issueIndex,issue]of issues.entries())for(const row of failures.filter(row=>row.row===issue.row&&row.code===issue.code)){
  const overlap={from:row.from>requested.from?row.from:requested.from,to:row.to===null?requested.to:requested.to===null?row.to:row.to<requested.to?row.to:requested.to},window=overlap.to!==null&&overlap.to<=overlap.from?{from:row.from,to:row.to}:overlap;
  const starts=[window.from,...new Set((await row.boundaries()).filter(point=>point>window.from&&(window.to===null||point<window.to)))].sort(),first=result.length;
  for(const[index,from]of starts.entries()){const piece={from,to:starts[index+1]??window.to};try{await row.evaluate(piece);}catch(error){const code=error instanceof Error?error.message:'';if(!/^[A-Z][A-Z0-9_]+$/.test(code)||['ACCESS_DENIED','KEY_UNAVAILABLE','PAYLOAD_UNAVAILABLE'].includes(code))throw error;result.push({...issue,field:issue.field||row.field,...piece,code,issue:issueIndex});}}
  // A whole-window invariant can fail even though every cell is individually
  // legal. Report that original failure; never invent an admission success.
  if(result.length===first)result.push({...issue,field:issue.field||row.field,from:row.from,to:row.to,issue:issueIndex});
 }
 return result;
}
