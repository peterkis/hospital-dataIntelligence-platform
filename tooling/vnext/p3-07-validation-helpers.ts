import {createHmac,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {ORG13_FIELDS,type LocationUseEntry,type LocationUseReceive,type LocationUseRow} from '../../apps/governance-api/src/modules/location-master/index.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {locationUseFixture} from './p3-07-fixture.js';
import {validationKeys} from './p3-07-validation-keys.mjs';
export type LocationUseFixture=Awaited<ReturnType<typeof locationUseFixture>>;
export type FileFormat='CSV'|'JSON'|'XLSX';
const csvCell=(v:string)=>/[\r\n,"]/.test(v)?'"'+v.replaceAll('"','""')+'"':v;
export function locationUseFile(rows:LocationUseRow[],format:FileFormat,fields:readonly(keyof LocationUseRow)[]=ORG13_FIELDS):Buffer{
 if(format==='JSON')return Buffer.from(JSON.stringify(rows.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]])))));
 const cells=rows.map(row=>fields.map(field=>row[field]===null?'':String(row[field])));
 return format==='CSV'?Buffer.from([[...fields],...cells].map(row=>row.map(csvCell).join(',')).join('\r\n')):organizationWorkbook({ORG13:[[...fields],...cells]});
}
export function locationUseFileRequest(f:LocationUseFixture,entries:LocationUseEntry[],format:FileFormat):LocationUseReceive{return {requestId:randomUUID(),fileRequestId:randomUUID(),job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_LOCATION_USE_FILE',profile:'CORE',contractId:f.contract!.id,contractVersionId:f.contract!.versionId,input:{kind:'FILE',format,parserPolicy:'STRICT_LOCATION_USE_V1'}},campus:'NORTH',timePolicy:'LOCAL',retentionSeconds:7200,operations:entries.map(({row:_row,...operation})=>operation)};}
export async function signedUseAttempt(connection:string,receipt:{name:string;oid:string},candidate:Awaited<ReturnType<LocationUseFixture['owner']['readApplyCandidate']>>,q:{candidateId:string;requestId:string},transform=(value:Record<string,unknown>)=>value):Promise<string>{
 const value=candidate.unit.commands[0]!.value,pool=new Pool({connectionString:connection,max:1}),client=await pool.connect(),key=Buffer.from(planBinding(validationKeys(receipt),'LOCATION_USE_SQL_AUTHORITY_V1',{}),'hex');
 try{await client.query('BEGIN');const transaction=(await client.query('select pg_current_xact_id()::text v')).rows[0]!.v,point=(await client.query('select location_master.use_record_time() r')).rows[0]!.r,ticket=canonicalPlan(transform({operation:'APPLY',actor:'maker',transaction,inputId:value['inputId'],writes:JSON.parse(value['writes']!),writeIndex:1,writesDigest:value['writesDigest'],candidateId:q.candidateId,digest:candidate.digest,...point}));return await client.query('select location_master.use_mutate($1,$2)',[ticket,createHmac('sha256',key).update(ticket).digest('hex')]).then(()=>'AUTHORIZED',(e:Error)=>{if('where' in e&&typeof e.where==='string'){const frames=e.where.split('\n').filter(line=>/^PL\/pgSQL function [a-z_]+\.[a-z_]+\([a-z, ]*\) line [0-9]+ at [a-z ]+$/.test(line));console.error(JSON.stringify({gate:'P3_07_CONTROLLED_SQL_DIAGNOSTIC',frames}));}return e.message;});}finally{await client.query('ROLLBACK');client.release();await pool.end();key.fill(0);}
}
