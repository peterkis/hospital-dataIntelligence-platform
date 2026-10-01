import {createHmac,timingSafeEqual} from 'node:crypto';
import {Type} from 'typebox';
import {Check} from 'typebox/value';
import type {KeyProviderPort} from './protected-artifact.js';
import {organizationSheets,evolutionSheets,type CanonicalRow,type OrganizationSheet,type EvolutionSheet,type EvolutionWorkbookResult,type OrganizationWorkbookResult,type ParserResult,type ParserField,type RawCellProvenance} from './file-parser.js';

const Int=Type.Integer({minimum:0,maximum:100000});
const IssueRow=Type.Integer({minimum:0,maximum:1048576});
const Text=Type.String({maxLength:8192});
const Id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const Hex=Type.String({pattern:'^[a-f0-9]{64}$'});
const Sheet=Type.Union(organizationSheets.map(value=>Type.Literal(value)));
const ManifestSchema=Type.Object({bomDetected:Type.Boolean(),bomMembers:Type.Array(Text,{maxItems:16}),defaultRowsHidden:Type.Boolean(),hiddenSheets:Type.Array(Text,{maxItems:16}),hiddenRows:Type.Array(Int,{maxItems:1000}),hiddenColumns:Type.Array(Text,{maxItems:100})},{additionalProperties:false});
const RowSchema=Type.Record(Type.String(),Text);
const IssueSchema=Type.Object({code:Type.String({pattern:'^[A-Z_]{1,64}$'}),row:IssueRow,column:Int,sheet:Type.Optional(Text)},{additionalProperties:false});
const ResultSchema=Type.Object({
 policy:Type.Union([Type.Literal('STRICT_V1'),Type.Literal('STRICT_V2'),Type.Literal('STRICT_DEPARTMENT_V1'),Type.Literal('STRICT_ORGANIZATION_MAPPING_V1'),Type.Literal('STRICT_ORGANIZATION_IDENTIFIER_V1')]),structuralStatus:Type.Union([Type.Literal('PARSED'),Type.Literal('REJECTED')]),
 manifest:ManifestSchema,rows:Type.Array(RowSchema,{maxItems:1000}),
 cells:Type.Array(Type.Object({row:Int,sourceRow:IssueRow,column:Int,field:Text,value:Text,sourceType:Type.Union(['CSV','JSON','inlineStr','s'].map(value=>Type.Literal(value)))},{additionalProperties:false}),{maxItems:100000}),
 issues:Type.Array(IssueSchema,{maxItems:100000}),
},{additionalProperties:false});
const PayloadSchema=Type.Object({sourceArtifactId:Type.String(),result:ResultSchema},{additionalProperties:false});
const BundleCellSchema=Type.Object({row:Int,sourceRow:IssueRow,column:Int,field:Text,value:Text,sourceType:Type.Union([Type.Literal('inlineStr'),Type.Literal('s')]),sheet:Sheet},{additionalProperties:false});
const BundleSheetSchema=Type.Object({rows:Type.Array(RowSchema,{maxItems:1000}),cells:Type.Array(BundleCellSchema,{maxItems:100000})},{additionalProperties:false});
const BundleResultSchema=Type.Object({
 policy:Type.Literal('STRICT_ORG_BUNDLE_V1'),structuralStatus:Type.Union([Type.Literal('PARSED'),Type.Literal('REJECTED')]),manifest:ManifestSchema,
 sheets:Type.Object({ORG01:BundleSheetSchema,ORG02:BundleSheetSchema,ORG03:BundleSheetSchema},{additionalProperties:false}),issues:Type.Array(IssueSchema,{maxItems:100000}),
},{additionalProperties:false});
const BundleBindingSchema=Type.Object({dataset:Sheet,contractId:Id,contractVersionId:Id},{additionalProperties:false});
const BundlePayloadSchema=Type.Object({sourceArtifactId:Id,manifestDigest:Hex,contractsDigest:Hex,contracts:Type.Array(BundleBindingSchema,{minItems:3,maxItems:3}),result:BundleResultSchema},{additionalProperties:false});
const EvolutionSheetSchema=Type.Union(evolutionSheets.map(value=>Type.Literal(value)));
const EvolutionCellSchema=Type.Object({...BundleCellSchema.properties,sheet:EvolutionSheetSchema},{additionalProperties:false});
const EvolutionTableSchema=Type.Object({rows:Type.Array(RowSchema,{maxItems:1000}),cells:Type.Array(EvolutionCellSchema,{maxItems:100000})},{additionalProperties:false});
const EvolutionResultSchema=Type.Object({policy:Type.Literal('STRICT_ORGANIZATION_EVOLUTION_V1'),structuralStatus:Type.Enum(['PARSED','REJECTED']),manifest:ManifestSchema,sheets:Type.Object({ORG26:EvolutionTableSchema,ORG27:EvolutionTableSchema,ORG04:EvolutionTableSchema},{additionalProperties:false}),issues:Type.Array(IssueSchema,{maxItems:100000})},{additionalProperties:false});
const EvolutionPayloadSchema=Type.Object({sourceArtifactId:Id,result:EvolutionResultSchema},{additionalProperties:false});
export type VerifiedParsedPayload=ParserResult|OrganizationWorkbookResult|EvolutionWorkbookResult;

export function parseSignature(provider:KeyProviderPort|undefined,artifactId:string,jobId:string,revisionId:string,contractVersionId:string,bytes:Uint8Array):string {
 if(!provider)throw new Error('KEY_UNAVAILABLE');
 return createHmac('sha256',provider.lookup()).update(JSON.stringify(['P0_05_PARSE_V1',artifactId,jobId,revisionId,contractVersionId])).update(bytes).digest('hex');
}
function parsePayload(bytes:Uint8Array):unknown {
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('PARSER_RESULT_REQUIRED');}
}
export function verifyParsedPayload(bytes:Uint8Array,expected:{sourceArtifactId:string;policy:ParserResult['policy'];format:string;status:string},fields:ParserField[]):ParserResult {
 const value=parsePayload(bytes);
 if(!Check(PayloadSchema,value)||value.sourceArtifactId!==expected.sourceArtifactId||value.result.policy!==expected.policy||value.result.structuralStatus!==expected.status)throw new Error('PARSER_RESULT_REQUIRED');
 const result:ParserResult=value.result;
 if(result.structuralStatus==='REJECTED'){
  if(result.rows.length!==0||result.issues.length===0)throw new Error('PARSER_RESULT_REQUIRED');
  return result;
 }
  const departmentSourceRows=new Set(result.cells.map(cell=>cell.sourceRow));
  const departmentMaxSourceRow=Math.max(...departmentSourceRows,0);
  const rowLocalDepartmentIssues=['STRICT_DEPARTMENT_V1','STRICT_ORGANIZATION_MAPPING_V1','STRICT_ORGANIZATION_IDENTIFIER_V1'].includes(result.policy)&&result.issues.length>0&&result.issues.every(issue=>{
   if(issue.row<1)return false;
   if(issue.code==='ROW_GAP')return issue.column===0&&issue.row>1&&issue.row<departmentMaxSourceRow&&!departmentSourceRows.has(issue.row);
   return departmentSourceRows.has(issue.row);
  });
  if(!result.rows.length||result.issues.length&&!rowLocalDepartmentIssues||result.cells.length!==result.rows.length*fields.length||result.manifest.defaultRowsHidden||result.manifest.hiddenSheets.length||result.manifest.hiddenRows.length||result.manifest.hiddenColumns.length)throw new Error('PARSER_RESULT_REQUIRED');
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
export function verifyOrganizationBundlePayload(bytes:Uint8Array,expected:{sourceArtifactId:string;status:'PARSED'|'REJECTED';manifestDigest:string;contractsDigest:string}):OrganizationWorkbookResult {
 const value=parsePayload(bytes);
 if(!Check(BundlePayloadSchema,value)||value.sourceArtifactId!==expected.sourceArtifactId||value.result.structuralStatus!==expected.status||value.manifestDigest!==expected.manifestDigest||value.contractsDigest!==expected.contractsDigest)throw new Error('PARSER_RESULT_REQUIRED');
 if(JSON.stringify([...new Set(value.contracts.map(binding=>binding.dataset))].sort())!==JSON.stringify([...organizationSheets]))throw new Error('PARSER_RESULT_REQUIRED');
 const result:OrganizationWorkbookResult=value.result;verifyFiniteWorkbook(result,organizationSheets);return result;
}
export function verifyEvolutionWorkbookPayload(bytes:Uint8Array,expected:{sourceArtifactId:string;status:'PARSED'|'REJECTED'}):EvolutionWorkbookResult{
 const value=parsePayload(bytes);
 if(!Check(EvolutionPayloadSchema,value)||value.sourceArtifactId!==expected.sourceArtifactId||value.result.structuralStatus!==expected.status)throw new Error('PARSER_RESULT_REQUIRED');
 const result:EvolutionWorkbookResult=value.result;verifyFiniteWorkbook(result,evolutionSheets);return result;
}
function verifyFiniteWorkbook<S extends string>(result:{structuralStatus:'PARSED'|'REJECTED';manifest:ParserResult['manifest'];sheets:Record<S,{rows:CanonicalRow[];cells:Array<RawCellProvenance&{sheet:S}>}>;issues:ParserResult['issues']},sheets:readonly S[]):void{
 if(result.structuralStatus==='REJECTED'){
  if(sheets.some(sheet=>result.sheets[sheet].rows.length!==0)||result.issues.length===0)throw new Error('PARSER_RESULT_REQUIRED');
  return;
 }
 if(result.issues.length||result.manifest.defaultRowsHidden||result.manifest.hiddenSheets.length||result.manifest.hiddenRows.length||result.manifest.hiddenColumns.length||sheets.every(sheet=>result.sheets[sheet].rows.length===0))throw new Error('PARSER_RESULT_REQUIRED');
 for(const sheetName of sheets){
  const sheet=result.sheets[sheetName];
  if(!sheet.rows.length){if(sheet.cells.length)throw new Error('PARSER_RESULT_REQUIRED');continue;}
  const names=Object.keys(sheet.rows[0]!).sort();if(!names.length)throw new Error('PARSER_RESULT_REQUIRED');
  const positions=new Set<string>(),fieldColumns=new Map<string,number>();
  for(const row of sheet.rows)if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify(names))throw new Error('PARSER_RESULT_REQUIRED');
  for(const cell of sheet.cells){
   const key=`${cell.row}:${cell.column}`,fieldKey=`${cell.row}:${cell.field}`,knownColumn=fieldColumns.get(cell.field);
   if(cell.sheet!==sheetName||cell.row<1||cell.row>sheet.rows.length||cell.sourceRow<2||cell.column<1||cell.column>names.length||positions.has(key)||positions.has(fieldKey)||!names.includes(cell.field)||sheet.rows[cell.row-1]![cell.field]!==cell.value||(knownColumn!==undefined&&knownColumn!==cell.column))throw new Error('PARSER_RESULT_REQUIRED');
   positions.add(key);positions.add(fieldKey);fieldColumns.set(cell.field,cell.column);
  }
  if(fieldColumns.size!==names.length||sheet.cells.length!==sheet.rows.length*names.length)throw new Error('PARSER_RESULT_REQUIRED');
  for(let row=1;row<=sheet.rows.length;row++)if(new Set(sheet.cells.filter(cell=>cell.row===row).map(cell=>cell.field)).size!==names.length)throw new Error('PARSER_RESULT_REQUIRED');
 }
}
export function parsedRowsForDataset(parsed:VerifiedParsedPayload|undefined,dataset:string):CanonicalRow[] {
 if(!parsed)return [];
 if(parsed.policy==='STRICT_ORGANIZATION_EVOLUTION_V1')return evolutionSheets.includes(dataset as EvolutionSheet)?parsed.sheets[dataset as EvolutionSheet].rows:[];
 if(parsed.policy!=='STRICT_ORG_BUNDLE_V1')return parsed.rows;
 return organizationSheets.includes(dataset as OrganizationSheet)?parsed.sheets[dataset as OrganizationSheet].rows:[];
}
export function signaturesEqual(left:string,right:string):boolean {
 return /^[a-f0-9]{64}$/.test(left)&&/^[a-f0-9]{64}$/.test(right)&&timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'));
}
