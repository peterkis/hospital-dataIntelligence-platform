import {createHash,createHmac} from 'node:crypto';
import type {ImportJob} from './import-job.js';
import type {ParserResult} from './file-parser.js';
import type {ValidationEvaluation} from './validation-rules.js';
import type {KeyProviderPort} from './protected-artifact.js';

/** Internal proof only: keyed row identities are never returned by public readers. */
export function qualityResolutionProof(provider:KeyProviderPort|undefined,job:ImportJob,parsed:ParserResult,evaluation:ValidationEvaluation,dimensions:{campus:string;purpose:string}):string {
 if(!provider)throw new Error('KEY_UNAVAILABLE');
 const fields=job.contract.definition.businessKey??[];
 const keys=parsed.rows.map(row=>fields.length&&fields.every(field=>typeof row[field]==='string'&&row[field]!.length>0)
  ?createHmac('sha256',provider.lookup()).update(JSON.stringify(['P0_06_ROW_KEY_V1',job.id,job.contract.versionId,fields,fields.map(field=>row[field])])).digest('hex'):null);
 const pass=evaluation.executionCoverage?.version==='RULE_EXECUTION_V1'
  ?evaluation.executionCoverage.checks.filter(check=>check.status==='PASS').map(check=>[check.rule,check.field,check.rows]):[];
 return JSON.stringify({version:'QUALITY_RESOLUTION_V1',campus:dimensions.campus,purpose:dimensions.purpose,keys,pass});
}
export function qualityResolutionDigest(proof:string){return createHash('sha256').update(proof).digest('hex');}
