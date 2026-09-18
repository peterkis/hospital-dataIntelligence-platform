import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {verifyEvidencePackage,verifySourceArtifacts} from './p0-10-evidence.ts';
const [directory,expectedDigest]=process.argv.slice(2);
if(!directory || process.argv.length!==4 || !expectedDigest || !/^[a-f0-9]{64}$/u.test(expectedDigest))throw new Error('EXTERNAL_DIGEST_REQUIRED');
const result=verifyEvidencePackage(resolve(directory),expectedDigest);
for(const name of ['package-coverage','parser-boundaries','db-integration','browser','review','m0-result']){
  const report=JSON.parse(readFileSync(resolve(directory,name+'.json'),'utf8'));
  if(!['PASS','PARTIAL','BLOCKED','NOT_RUN'].includes(report.status))throw new Error('EVIDENCE_REPORT_INVALID');
}
const acceptance=JSON.parse(readFileSync(resolve(directory,'m0-result.json'),'utf8')).status;
if(acceptance==='PASS'){
  const cleanup=JSON.parse(readFileSync(resolve(directory,'wrapper-cleanup.json'),'utf8'));
  if(cleanup.status!=='DATABASE_SESSION_CLOSED'||cleanup.ready!==true||cleanup.cleanupPassed!==true||cleanup.targetExitCode!==0)throw new Error('WRAPPER_CLEANUP_REQUIRED');
  const manifest=JSON.parse(readFileSync(resolve(directory,'manifest.json'),'utf8'));
  const index=JSON.parse(readFileSync(resolve(directory,'source-index.json'),'utf8'));
  const mapping=Object.fromEntries(index.entries.map(entry=>[entry.sourcePath,entry.packagedPath]));
  const browser=JSON.parse(readFileSync(resolve(directory,'browser.json'),'utf8'));
  const review=JSON.parse(readFileSync(resolve(directory,'review.json'),'utf8'));
  for(const [sources,kind] of [[browser.sources,'BROWSER_CAPTURE'],[review.standards?.sources,'STANDARDS_REVIEW'],[review.spec?.sources,'SPEC_REVIEW']]){
    if(!verifySourceArtifacts(resolve(directory),sources,manifest.context.candidateDigest,kind,mapping))throw new Error('PACKAGED_PROVENANCE_INVALID');
  }
  if(JSON.parse(readFileSync(resolve(directory,'guardrails.json'),'utf8')).status!=='PASS')throw new Error('GUARDRAIL_EVIDENCE_REQUIRED');
}
console.log(JSON.stringify({...result,acceptance}));
