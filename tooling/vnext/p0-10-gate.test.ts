import { describe, expect, test } from "vitest";
import { cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import {textWorkbook} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {contractSources} from './contract-sources.mjs';
import {
  runGateM0,
  verifyPackageCoverage,
  workingTreeDigest,
  P0_10_REVIEW_BASE,
  verifyQ42DeliveryArtifacts,
} from "./p0-10-gate.mjs";

describe("P0-10 M0 synthetic gate", () => {
  test('required execution evidence includes formats, security, fresh, upgrade and parser negatives',()=>{
    const input={integration:{fresh:'PASS',upgrade:'PASS',codegen:'PASS',formats:['CSV','JSON','XLSX'].map(format=>({format,receive:'QUARANTINED',parse:'PARSED',validation:'BLOCKED',replay:'SAME_RESULT',inputSnapshot:'PRESERVED'})),concurrencyAndPermission:{concurrency:['CSV','JSON','XLSX'],permission:'ACCESS_DENIED',ordinaryProjection:'NO_RAW_VALUE'}},
      parser:{a004:{status:'PASS',unknownAndMissingFields:true,wrongSheet:true,activeContent:true,locationEvidence:true},demoReports:[{dataset:'ORG01',format:'CSV',status:'PARSED',rows:1},{dataset:'ORG04',format:'JSON',status:'PARSED',rows:1},{dataset:'PER01',format:'XLSX',status:'PARSED',rows:1}]}};
    expect(runGateM0(input).evidence.scenarios).toBe(true);
    for(const key of ['formats','concurrencyAndPermission','fresh','upgrade','codegen']){
      const changed=structuredClone(input);delete changed.integration[key];
      expect(runGateM0(changed).evidence.scenarios).toBe(false);
    }
    for(const key of ['unknownAndMissingFields','wrongSheet','activeContent','locationEvidence']){
      const changed=structuredClone(input);changed.parser.a004[key]=false;
      expect(runGateM0(changed).evidence.scenarios).toBe(false);
    }
  });
  test('contract explanation cannot be inferred from the registered count alone', () => {
    const evidence = contractSources().drafts.map(source=>({dataset:source.dataset,status:'PASS',profile:'FULL',approval:'DRAFT',adapterReadiness:'NOT_READY',fields:source.definition.fields.length}));
    expect(runGateM0({integration:{registeredContracts:53}}).evidence.contracts).toBe(false);
    expect(runGateM0({integration:{contractExplanation:{status:'PASS',otherContracts:50,evidence}}}).evidence.contracts).toBe(true);
    evidence.pop();
    expect(runGateM0({integration:{contractExplanation:{status:'PASS',otherContracts:50,evidence}}}).evidence.contracts).toBe(false);
  });
  test('AC02 cannot accept A001 PASS without all nine independently observed cases', () => {
    const input = {
      packageCoverage:{approvalNegative:true},
      parser:{status:'PASS',positiveFormats:3,a001:{status:'PASS'},a004:{status:'PASS'}},
      integration:{draftExecution:{status:'PASS'},duplicateKey:{status:'PASS'},orphan:{status:'PASS'},
        oldApproval:{status:'PASS',oldDigestRejected:true,oldPublishRejected:true,historyUnchanged:true,oldExecutionRejected:true},
        sourceAcceptance:{A001:{status:'PASS',evidence:['CSV','JSON','XLSX'].flatMap(format=>['EMPTY_FILE','NO_DATA','EMPTY_ROW'].map(kind=>({id:`${kind}_${format}`,format,receive:kind==='EMPTY_FILE'?'REJECTED':'QUARANTINED',parse:kind==='EMPTY_FILE'?undefined:'REJECTED',domainCountsStable:true})))}}},
    };
    expect(runGateM0(input).checks['P0-10-AC-02']).toBe(true);
    expect(runGateM0({...input,integration:{...input.integration,oldApproval:undefined}}).checks['P0-10-AC-02']).toBe(false);
    input.integration.sourceAcceptance.A001.evidence.pop();
    expect(runGateM0(input).checks['P0-10-AC-02']).toBe(false);
  });
  test('Q42 rejects formatted identifiers in decoded sample values without exposing them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'p0-10-q42-'));
    try {
      cpSync(resolve('db/vnext/sources/package-v2'), directory, {recursive: true});
      expect(verifyQ42DeliveryArtifacts(directory).status).toBe('PASS');
      for (const value of ['138-0013-8000', '+86 (138) 0013 8000', '１３８００１３８０００', '110101 19900101 123X', '电话138-0013-8000', '138-0013-8000张', '13800138000 13900139000']) {
        writeFileSync(join(directory, 'q42-test.json'), JSON.stringify({sample: value}));
        expect(() => verifyQ42DeliveryArtifacts(directory)).toThrow(/Q42_SENSITIVE_VALUE/);
        try { verifyQ42DeliveryArtifacts(directory); } catch(error) { expect(String(error)).not.toContain(value); }
      }
      rmSync(join(directory,'q42-test.json'));
      writeFileSync(join(directory,'q42-test.csv'),'a,b\n138,00138000');
      expect(verifyQ42DeliveryArtifacts(directory).status).toBe('PASS');
      writeFileSync(join(directory,'q42-test.xlsx'),textWorkbook([['sample'],['138-0013-8000']]));
      expect(()=>verifyQ42DeliveryArtifacts(directory)).toThrow(/Q42_SENSITIVE_VALUE/);
      writeFileSync(join(directory,'q42-test.xlsx'),Buffer.from('invalid workbook'));
      expect(()=>verifyQ42DeliveryArtifacts(directory)).toThrow(/Q42_ARTIFACT_INVALID/);
    } finally { rmSync(directory, {recursive: true, force: true}); }
  });
  test("requires every named browser flow even when all supplied values are true", () => {
    const browser = {
      status: 'PASS', task: 'P0-10', scope: 'SYNTHETIC', syntheticOnly: true,
      p0_02: 'PASS', p0_02_real_browser: 'PASS', p0_02_transport: 'PASS',
      p0_02_business_acceptance: 'PASS_SYNTHETIC_BROWSER_CONTROL_PLANE', p0_02_real_data: 'NOT_RUN',
      p0_02_acceptance: {
        'AC-01': 'PASS_UNKNOWN_FIELD_AND_CODESET_AUTHORITY_INVALID_REJECTED',
        'AC-02': 'PASS_UNRESOLVED_CONDITION_APPROVAL_AND_PUBLISH_BLOCKED',
        'AC-03': 'PASS_RULE_VERSION_PUBLISH_REPLAY_NO_NEW_HISTORY_EVENT',
        'AC-04': 'PASS_IMMUTABLE_RULE_VERSION_AND_HISTORY_RETAINED',
        'AC-05': 'PASS_CANDIDATE_CODESET_APPROVAL_BLOCKED',
      },
      captureBaseCommit: P0_10_REVIEW_BASE, captureTreeDigest: workingTreeDigest(),
      method: 'Chrome', observations: Array(8).fill('Observed synthetic action'),
      sources: [] as {path:string;sha256:string}[],
      requiredFlow: { makerCheckerDataset: true, makerCheckerSource: true, contractCoreCandidate: true,
        contractValidationAccept: true, makerCheckerContract: true, brEffectivePublishedRead: true,
        retireImpactAndRetire: true, historyAndNoDomainWriteBoundary: true },
    };
    const directory=mkdtempSync(resolve('.runtime/vnext/p0-10-test-'));
    const receipt=JSON.stringify({purpose:'TEMPORARY_VALIDATION',oid:'test',requestId:'test'});
    writeFileSync(join(directory,'receipt.json'),receipt);
    const capture=JSON.stringify({kind:'BROWSER_CAPTURE',candidateDigest:browser.captureTreeDigest,producerId:'synthetic-unit-test',observations:browser.observations,
      session:{oid:'test',requestId:'test',receipt:{path:relative(resolve('.runtime/vnext'),join(directory,'receipt.json')).replaceAll('\\','/'),sha256:createHash('sha256').update(receipt).digest('hex')}},
      captures:[{text:'SYNTHETIC_UNIT_FIXTURE_NOT_ACCEPTANCE'}],steps:Object.fromEntries([...Object.keys(browser.requiredFlow),'AC-01','AC-02','AC-03','AC-04','AC-05'].map(key=>[key,[0]]))});
    writeFileSync(join(directory,'capture.json'),capture);
    browser.sources=[{path:relative(resolve('.runtime/vnext'),join(directory,'capture.json')).replaceAll('\\','/'),sha256:createHash('sha256').update(capture).digest('hex')}];
    const check = (value: unknown) => runGateM0({browser: value}).evidence.browser;
    try {
    expect(check(browser)).toBe(true);
    expect(check({...browser,method:{}})).toBe(false);
    expect(check({...browser, requiredFlow: {}})).toBe(false);
    for (const key of Object.keys(browser.requiredFlow)) {
      const missing = {...browser.requiredFlow}; delete missing[key];
      expect(check({...browser, requiredFlow: missing})).toBe(false);
      for (const value of [false, 'true', 1, null]) {
        expect(check({...browser, requiredFlow: {...browser.requiredFlow, [key]: value}})).toBe(false);
      }
    }
    expect(check({...browser,sources:[]})).toBe(false);
    } finally {rmSync(directory,{recursive:true,force:true});}
  });
  test("keeps the package complete while leaving field ownership outside P0-10", () => {
    const result = verifyPackageCoverage();

    expect(result.status).toBe("PASS");
    expect(result.syntheticOnly).toBe(true);
    expect(result.counts).toEqual({
      datasets: 53,
      fields: 866,
      conditions: 196,
      inScopeConditions: 77,
    });
    expect(result.domainImplementationOwners).toBe(0);
    expect(result.demos).toEqual([
      { dataset: "ORG01", fieldCount: 19, format: "CSV", execution: "PARSER_REPORT_ONLY" },
      { dataset: "ORG04", fieldCount: 18, format: "JSON", execution: "PARSER_REPORT_ONLY" },
      { dataset: "PER01", fieldCount: 18, format: "XLSX", execution: "PARSER_REPORT_ONLY" },
    ]);
  });


  test("cannot report M0 complete without browser and current-tree review evidence", () => {
    const result = runGateM0({
      packageCoverage: { status: "PASS", syntheticOnly: true },
      parser: { status: "PASS", positiveFormats: 3, syntheticOnly: true },
      integration: {
        status: "PASS",
        noDomainWrites: true,
        domainCountsStable: true,
        domainCounts: { fresh: {}, legacy: {} },
        restartRecovery: true,
        restartEvidence: { status: "PASS", receiptBound: true, recovered: true },
      },
      browser: { status: "PARTIAL" },
      review: { status: "NOT_RUN" },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.checks["P0-10-AC-01"]).toBe(true);
    expect(result.checks["P0-10-AC-03"]).toBe(false);
    expect(result.evidence.browser).toBe(false);
    expect(result.evidence.review).toBe(false);
    expect(result.blockers).toContain("P0-10-AC-05");
  });
});
