import {createHmac, randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {canonicalPlan, planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {ORG11_FIELDS, type WardNursingEntry, type WardNursingReceive, type WardNursingRow} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {unzip} from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import {zipText} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {wardNursingFixture} from './p3-05-fixture.js';
import {validationKeys} from './p3-05-validation-keys.mjs';

export type NursingCoverageFixture = Awaited<ReturnType<typeof wardNursingFixture>>;
export type FileFormat = 'CSV'|'JSON'|'XLSX';
export type CoverageCandidate = Awaited<ReturnType<NursingCoverageFixture['owner']['readApplyCandidate']>>;

const csvCell = (value:string) => /[\r\n,"]/.test(value) ? '"'+value.replaceAll('"','""')+'"' : value;

/** Author actual files; tests exercise the released intake, never the parser directly. */
export function coverageFile(rows:WardNursingRow[], format:FileFormat, fields:readonly (keyof WardNursingRow)[]=ORG11_FIELDS):Buffer {
  if (format==='JSON') return Buffer.from(JSON.stringify(rows.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]])))));
  const cells=rows.map(row=>fields.map(field=>row[field]===null?'':String(row[field])));
  return format==='CSV'
    ? Buffer.from([[...fields],...cells].map(row=>row.map(csvCell).join(',')).join('\r\n'))
    : organizationWorkbook({ORG11:[[...fields],...cells]});
}

export function coverageFileRequest(f:NursingCoverageFixture, entries:WardNursingEntry[], format:FileFormat):WardNursingReceive {
  return {
    requestId:randomUUID(), fileRequestId:randomUUID(),
    job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_WARD_NURSING_FILE',profile:'CORE',contractId:f.contract!.id,contractVersionId:f.contract!.versionId,input:{kind:'FILE',format,parserPolicy:'STRICT_WARD_NURSING_V1'}},
    campus:'NORTH',timePolicy:'LOCAL',retentionSeconds:7200,
    operations:entries.map(({row:_row,...operation})=>operation),
  };
}

/** Mutate file bytes for active-content fixtures; no product admission is bypassed. */
export function workbookBarrier(bytes:Buffer, barrier:'MACRO'|'FORMULA'|'HIDDEN'|'EXTERNAL'):Buffer {
  const files=Object.fromEntries(unzip(bytes,true)),sheet='xl/worksheets/sheet9.xml';
  if (!files[sheet]?.includes('<row r="2">')) throw new Error('TEST_WORKBOOK_SHAPE');
  switch (barrier) {
    case 'MACRO': files['[Content_Types].xml']=files['[Content_Types].xml']!.replace('</Types>','<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'); break;
    case 'FORMULA': files[sheet]=files[sheet]!.replace(/<c r="A2"[^>]*>.*?<\/c>/,'<c r="A2"><f>1+1</f><v>2</v></c>'); break;
    case 'HIDDEN': files[sheet]=files[sheet]!.replace('<row r="2">','<row r="2" hidden="1">'); break;
    case 'EXTERNAL': files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels']!.replace('Target="worksheets/sheet9.xml"','Target="https://example.invalid/never-fetch" TargetMode="External"'); break;
  }
  return zipText(files);
}

/** Independently signs a released controlled-SQL call using the real restricted role. */
export async function signedCoverageAttempt(connection:string,receipt:{name:string;oid:string},candidate:CoverageCandidate,q:{candidateId:string;requestId:string}):Promise<string> {
  const value=candidate.unit.commands[0]!.value,pool=new Pool({connectionString:connection,max:1}),client=await pool.connect(),key=Buffer.from(planBinding(validationKeys(receipt),'WARD_NURSING_SQL_AUTHORITY_V1',{}),'hex');
  try {
    await client.query('BEGIN');
    const transaction=(await client.query('select pg_current_xact_id()::text v')).rows[0]!.v;
    const point=(await client.query('select care_organization.ward_nursing_record_time() r')).rows[0]!.r;
    const ticket=canonicalPlan({operation:'APPLY',actor:'maker',transaction,inputId:value['inputId'],writes:JSON.parse(value['writes']!),writeIndex:1,writesDigest:value['writesDigest'],candidateId:q.candidateId,digest:candidate.digest,...point});
    return await client.query('select care_organization.ward_nursing_mutate($1,$2)',[ticket,createHmac('sha256',key).update(ticket).digest('hex')]).then(()=> 'AUTHORIZED',(error:Error)=>error.message);
  } finally {
    await client.query('ROLLBACK');client.release();await pool.end();key.fill(0);
  }
}
