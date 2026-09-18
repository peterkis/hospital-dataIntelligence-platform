import {createHmac,timingSafeEqual} from 'node:crypto';
import {Type} from 'typebox';
import {Check} from 'typebox/value';
import type {KeyProviderPort} from './protected-artifact.js';
import type {ParserResult,ParserField} from './file-parser.js';

const Int=Type.Integer({minimum:0,maximum:100000});
const Text=Type.String({maxLength:8192});
const ResultSchema=Type.Object({
 policy:Type.Union([Type.Literal('STRICT_V1'),Type.Literal('STRICT_V2')]),structuralStatus:Type.Union([Type.Literal('PARSED'),Type.Literal('REJECTED')]),
 manifest:Type.Object({bomDetected:Type.Boolean(),bomMembers:Type.Array(Text,{maxItems:16}),defaultRowsHidden:Type.Boolean(),hiddenSheets:Type.Array(Text,{maxItems:16}),hiddenRows:Type.Array(Int,{maxItems:1000}),hiddenColumns:Type.Array(Text,{maxItems:100})},{additionalProperties:false}),
 rows:Type.Array(Type.Record(Type.String(),Text),{maxItems:1000}),
 cells:Type.Array(Type.Object({row:Int,sourceRow:Int,column:Int,field:Text,value:Text,sourceType:Type.Union(['CSV','JSON','inlineStr','s'].map(value=>Type.Literal(value)))},{additionalProperties:false}),{maxItems:100000}),
 issues:Type.Array(Type.Object({code:Type.String({pattern:'^[A-Z_]{1,64}$'}),row:Int,column:Int,sheet:Type.Optional(Text)},{additionalProperties:false}),{maxItems:100000}),
},{additionalProperties:false});
const PayloadSchema=Type.Object({sourceArtifactId:Type.String(),result:ResultSchema},{additionalProperties:false});
export function parseSignature(provider:KeyProviderPort|undefined,artifactId:string,jobId:string,revisionId:string,contractVersionId:string,bytes:Uint8Array):string {
 if(!provider)throw new Error('KEY_UNAVAILABLE');
 return createHmac('sha256',provider.lookup()).update(JSON.stringify(['P0_05_PARSE_V1',artifactId,jobId,revisionId,contractVersionId])).update(bytes).digest('hex');
}
export function verifyParsedPayload(bytes:Uint8Array,expected:{sourceArtifactId:string;policy:ParserResult['policy'];format:string;status:string},fields:ParserField[]):ParserResult {
 let value:unknown;
 try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('PARSER_RESULT_REQUIRED');}
 if(!Check(PayloadSchema,value)||value.sourceArtifactId!==expected.sourceArtifactId||value.result.policy!==expected.policy||value.result.structuralStatus!==expected.status)throw new Error('PARSER_RESULT_REQUIRED');
 const result:ParserResult=value.result;
 if(result.structuralStatus==='REJECTED'){
  if(result.rows.length!==0||result.issues.length===0)throw new Error('PARSER_RESULT_REQUIRED');
  return result;
 }
 if(!result.rows.length||result.issues.length||result.cells.length!==result.rows.length*fields.length||result.manifest.defaultRowsHidden||result.manifest.hiddenSheets.length||result.manifest.hiddenRows.length||result.manifest.hiddenColumns.length)throw new Error('PARSER_RESULT_REQUIRED');
 const names=fields.map(f=>f.code).sort();const positions=new Set<string>();
 for(const row of result.rows)if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify(names))throw new Error('PARSER_RESULT_REQUIRED');
 for(const cell of result.cells){
  const key=`${cell.row}:${cell.column}`;
  if(cell.row<1||cell.row>result.rows.length||cell.column<1||cell.column>fields.length||cell.sourceRow<1||positions.has(key)||!names.includes(cell.field)||result.rows[cell.row-1]![cell.field]!==cell.value||!(expected.format==='XLSX'?['inlineStr','s'].includes(cell.sourceType):cell.sourceType===expected.format))throw new Error('PARSER_RESULT_REQUIRED');
  positions.add(key);
 }
 for(let row=1;row<=result.rows.length;row++)if(new Set(result.cells.filter(c=>c.row===row).map(c=>c.field)).size!==fields.length)throw new Error('PARSER_RESULT_REQUIRED');
 return result;
}
export function signaturesEqual(left:string,right:string):boolean {
 return /^[a-f0-9]{64}$/.test(left)&&/^[a-f0-9]{64}$/.test(right)&&timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'));
}
