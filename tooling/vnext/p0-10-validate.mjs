import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,relative,isAbsolute} from 'node:path';
import {root, migrationFiles} from './lineage.mjs';
import {evidenceRunDirectory} from './p0-10-run-directory.mjs';
import {readEvidence, runGateM0, verifyPackageCoverage, workingTreeDigest} from './p0-10-gate.mjs';
import {collectStages, writeEvidence, packageSourceArtifacts} from './p0-10-evidence.ts';

if(!process.env.VNEXT_P0_10_RUN_DIRECTORY)throw new Error('P0_10_WRAPPER_REQUIRED');
const runDirectory = resolve(process.env.VNEXT_P0_10_RUN_DIRECTORY);
const runRelative=relative(resolve(root,'.runtime/vnext/p0-10'),runDirectory);
if(!runRelative||runRelative.startsWith('..')||isAbsolute(runRelative)||runRelative.includes('/')||runRelative.includes('\\'))throw new Error('P0_10_RUN_DIRECTORY_REQUIRED');
evidenceRunDirectory(runDirectory);
const candidate = workingTreeDigest();
const reports = await collectStages([
  {name:'guardrails',run:async()=>{
    const output=resolve(runDirectory,'vitest-guardrails.json');
    const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p0-10.config.ts','--reporter=default','--reporter=json','--outputFile='+output],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
    if(result.status!==0)throw new Error('GUARDRAIL_TESTS_FAILED');
    const report=JSON.parse(readFileSync(output,'utf8'));
    if(report.success!==true || report.numFailedTests!==0 || report.numPassedTests<1)throw new Error('GUARDRAIL_REPORT_INVALID');
    return {status:'PASS',passed:report.numPassedTests};
  }},
  {name:'package-coverage',run:async()=>verifyPackageCoverage()},
  {name:'parser-boundaries',run:async()=>{
    const output=resolve(runDirectory,'parser-observation.json');
    const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p0-10.config.ts','apps/governance-api/src/modules/governance-catalog/p0-10-parser.test.ts','--reporter=default','--reporter=json','--outputFile='+resolve(runDirectory,'vitest-parser.json')],{cwd:root,env:{...process.env,VNEXT_P0_10_PARSER_REPORT:output},stdio:'inherit',windowsHide:true});
    if(result.status!==0)throw new Error('PARSER_VITEST_FAILED');
    return JSON.parse(readFileSync(output,'utf8'));
  }},
  {name:'db-integration',run:async()=>{
    const output = resolve(runDirectory,'db-observation.json');
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p0-10-db.config.ts','--reporter=default','--reporter=json','--outputFile='+resolve(runDirectory,'vitest-db.json')],{
      cwd:root,env:{...process.env,VNEXT_P0_10_DB_REPORT:output,VNEXT_P0_10_LIFECYCLE_REPORT:resolve(runDirectory,'database-lifecycle.json')},stdio:'inherit',windowsHide:true,
    });
    if(result.status!==0) throw new Error('DB_VITEST_FAILED');
    const tests=JSON.parse(readFileSync(resolve(runDirectory,'vitest-db.json'),'utf8'));
    if(tests.success!==true || tests.numPassedTests<1 || tests.numFailedTests!==0) throw new Error('DB_TEST_REPORT_INVALID');
    return JSON.parse(readFileSync(output,'utf8'));
  }},
]);
for(const [name,report] of Object.entries(reports)) writeEvidence(resolve(runDirectory,name+'.json'),report);
const browser=readEvidence(resolve(root,'.runtime/vnext/p0-10/browser-evidence.json'));
const review=readEvidence(resolve(root,'.runtime/vnext/p0-10/review-evidence.json'));
const sourcesDirectory=resolve(runDirectory,'sources');
mkdirSync(sourcesDirectory);
const asSources=value=>Array.isArray(value)?value:[];
const references=[...asSources(browser.sources),...asSources(review.standards?.sources),...asSources(review.spec?.sources)];
let sourcesValid=true;
const sourceIndex=[];
try {
  sourceIndex.push(...packageSourceArtifacts(resolve(root,'.runtime/vnext'),sourcesDirectory,references));
  for(const ref of asSources(browser.sources)) {
    const capture=JSON.parse(readFileSync(resolve(sourcesDirectory,ref.sha256+'.json'),'utf8'));
    if(capture.session?.receipt)sourceIndex.push(...packageSourceArtifacts(resolve(root,'.runtime/vnext'),sourcesDirectory,[capture.session.receipt]));
  }
} catch {sourcesValid=false;}
writeEvidence(resolve(runDirectory,'source-index.json'),{status:sourcesValid?'PASS':'BLOCKED',entries:sourceIndex});
writeEvidence(resolve(runDirectory,'browser.json'),browser);
writeEvidence(resolve(runDirectory,'review.json'),review);
let gate;
try {gate=runGateM0({packageCoverage:reports['package-coverage'],parser:reports['parser-boundaries'],integration:reports['db-integration'],browser,review});}
catch {gate={status:'BLOCKED',checks:{},evidence:{},blockers:['EVIDENCE_EVALUATION_FAILED']};}
if(reports.guardrails.status!=='PASS'){gate.status='BLOCKED';gate.blockers.push('GUARDRAIL_TESTS_REQUIRED');}
if(!sourcesValid){gate.status='BLOCKED';gate.blockers.push('SOURCE_ARTIFACTS_INVALID');}
if(candidate!==workingTreeDigest()){gate.status='BLOCKED';gate.blockers.push('CANDIDATE_CHANGED');}
const digestFile=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const pkg=JSON.parse(readFileSync(resolve(root,'node_modules/vitest/package.json'),'utf8'));
const context={
  scope:'SYNTHETIC',candidateDigest:candidate,node:process.version,vitest:pkg.version,
  containerImages:'NOT_APPLICABLE_NATIVE_POSTGRESQL',fixture:{version:'P0_10_SYNTHETIC_V2',seed:'DEMO_P0_10'},
  lockfileDigest:digestFile(resolve(root,'package-lock.json')),
  contractDigest:digestFile(resolve(root,'contracts/openapi/vnext-catalog.openapi.json')),
  migrations:migrationFiles().map(({id,sha256})=>({id,sha256})),
};
writeEvidence(resolve(runDirectory,'pending-finalization.json'),{status:'PENDING_WRAPPER_CLEANUP',gate,context});
console.log(JSON.stringify({gate:'P0-10',status:'PENDING_WRAPPER_CLEANUP',evidence:runDirectory}));
if(gate.status!=='PASS')process.exitCode=2;
