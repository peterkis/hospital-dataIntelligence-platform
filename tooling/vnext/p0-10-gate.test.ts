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
      parser:{status:'PASS',positiveFormats:3,a001:{status:'PASS',cases:['CSV','JSON','XLSX'].flatMap(format=>['EMPTY_FILE','NO_DATA','EMPTY_ROW'].map(kind=>({id:`${kind}_${format}`,format,errorCode:kind})))},a004:{status:'PASS'}},
      integration:{draftExecution:{status:'PASS'},duplicateKey:{status:'PASS'},orphan:{status:'PASS'},
        oldApproval:{status:'PASS',oldDigestRejected:true,oldPublishRejected:true,historyUnchanged:true,oldExecutionRejected:true},
        sourceAcceptance:{A001:{status:'PASS',evidence:['CSV','JSON','XLSX'].flatMap(format=>['EMPTY_FILE','NO_DATA','EMPTY_ROW'].map(kind=>({id:`${kind}_${format}`,format,receive:kind==='EMPTY_FILE'?'REJECTED':'QUARANTINED',parse:kind==='EMPTY_FILE'?undefined:'REJECTED',errorCode:kind==='EMPTY_FILE'?'CLOSED_FILE_REQUIRED':kind,domainCountsStable:true})))}}},
    };
    expect(runGateM0(input).checks['P0-10-AC-02']).toBe(true);
    expect(runGateM0({...input,integration:{...input.integration,oldApproval:undefined}}).checks['P0-10-AC-02']).toBe(false);
    input.integration.sourceAcceptance.A001.evidence.pop();
    expect(runGateM0(input).checks['P0-10-AC-02']).toBe(false);
  });
  test('Q42 rejects undeclared artifacts and altered metadata even without identifier patterns', () => {
    const directory=mkdtempSync(join(tmpdir(),'p0-10-membership-'));
    try {
      cpSync(resolve('db/vnext/sources/package-v2'),directory,{recursive:true});
      expect(verifyQ42DeliveryArtifacts(directory).status).toBe('PASS');
      const extra=join(directory,'inputs/dataset-v2/unlisted-sample.json');
      writeFileSync(extra,JSON.stringify({name:'ordinary_employee_value'}));
      expect(()=>verifyQ42DeliveryArtifacts(directory)).toThrow(/Q42_UNLISTED_ARTIFACT/);
      rmSync(extra);
      writeFileSync(join(directory,'inputs/dataset-v2/models.ORG-PER.json'),JSON.stringify({name:'ordinary_employee_value'}));
      expect(()=>verifyQ42DeliveryArtifacts(directory)).toThrow(/Q42_METADATA_CHANGED/);
    } finally {rmSync(directory,{recursive:true,force:true});}
  });
  test('Q42 rejects formatted identifiers in decoded sample values without exposing them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'p0-10-q42-'));
    try {
      cpSync(resolve('db/vnext/sources/package-v2'), directory, {recursive: true});
      expect(verifyQ42DeliveryArtifacts(directory).status).toBe('PASS');
      for (const value of ['138-0013-8000', '+86 (138) 0013 8000', '１３８００１３８０００', '110101 19900101 123X', '电话138-0013-8000', '138-0013-8000张', '13800138000 13900139000', '138.0013.8000', '138/0013/8000', '138\u200b0013\u200b8000', '110101\u200b19900101\u200b123X', '138\u20600013\uFEFF8000', 'TEL13800138000', 'ID11010119900101123X', '13800138000TEL']) {
        writeFileSync(join(directory, 'q42-test.json'), JSON.stringify({sample: value}));
        expect(() => verifyQ42DeliveryArtifacts(directory)).toThrow(/Q42_SENSITIVE_VALUE/);
        try { verifyQ42DeliveryArtifacts(directory); } catch(error) { expect(String(error)).not.toContain(value); }
      }
      for(const value of ['DEMO_ORG01_01','2026-01-01','00000000-0000-0000-0000-000000000000','a'.repeat(25)+'13800138000'+'b'.repeat(28)]) {
        writeFileSync(join(directory,'q42-test.json'),JSON.stringify({sample:value}));
        expect(()=>verifyQ42DeliveryArtifacts(directory)).toThrow(/Q42_UNLISTED_ARTIFACT/);
      }
      rmSync(join(directory,'q42-test.json'));
      writeFileSync(join(directory,'q42-test.csv'),'a,b\n138,00138000');
      expect(()=>verifyQ42DeliveryArtifacts(directory)).toThrow(/Q42_UNLISTED_ARTIFACT/);
      rmSync(join(directory,'q42-test.csv'));
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
    const maker='20 pop up button (collapsed, settable) Description: 合成验证身份, Value: 编制者 · Maker, Secondary Actions: Expand';
    const reviewer='20 pop up button (collapsed, settable) Description: 合成验证身份, Value: 复核者 · Reviewer, Secondary Actions: Expand';
    const independent='21 pop up button (collapsed, settable) Description: 合成操作者, Value: 独立复核人, Secondary Actions: Expand';
    const published='48 text 已发布 · 命令已接受 · adapter NOT_READY\n173 text 草稿 · v 1 · SYNTHETIC_UI_1 2026-01-01T00:00:00 [ 2026-01-01 , 无界 )\n174 button 下载 v1 原版本 schema\n178 text 草稿 · v 2 · SYNTHETIC_UI_2 2026-01-02T00:00:00 [ 2026-01-01 , 无界 )\n179 button 下载 v2 原版本 schema\n183 text 已发布 · v 3 · SYNTHETIC_UI_3 2026-01-03T00:00:00 [ 2026-01-01 , 无界 )\n184 button 下载 v3 原版本 schema';
    const record={kind:'BROWSER_CAPTURE',candidateDigest:browser.captureTreeDigest,producerId:'synthetic-unit-test',sourceRef:'SYNTHETIC_UNIT_FIXTURE_NOT_ACCEPTANCE',observations:browser.observations,
      session:{oid:'test',requestId:'test',receipt:{path:relative(resolve('.runtime/vnext'),join(directory,'receipt.json')).replaceAll('\\','/'),sha256:createHash('sha256').update(receipt).digest('hex')}},
      captures:[
        maker+'\nORG07 已保存 · DRAFT',maker+'\nORG07 已保存 · REVIEW',reviewer+'\nORG07 已保存 · PUBLISHED',
        maker+'\nP0_FINAL_SOURCE 已保存 · DRAFT',maker+'\nP0_FINAL_SOURCE 已保存 · REVIEW',reviewer+'\nP0_FINAL_SOURCE 已保存 · PUBLISHED',
        'CORE 草稿 · 命令已接受','校验 REVIEW · UNRESOLVED_REQUIRED_CONDITION',
        independent+'\n[CONTRACT_VALIDATION_BLOCKED]',independent+'\n[CONTRACT_VALIDATION_BLOCKED]',
        '[UNKNOWN_FIELD]','[CODESET_AUTHORITY_INVALID]','校验 REVIEW · CODESET_NOT_ADOPTED',independent+'\n[CONTRACT_VALIDATION_BLOCKED]',
        '[IMMUTABLE_RULE_VERSION]\n205 button 下载 v1 原版本 schema\n210 button 下载 v2 原版本 schema',
        '校验 ACCEPT','[SELF_REVIEW_FORBIDDEN]',independent+'\n已批准 · 命令已接受',
        independent+'\n'+published,independent+'\n'+published,'B/R 有效发布\n27 text 1 当前查询契约',
        '审批绑定摘要： '+'a'.repeat(64),'已废止 · 命令已接受\n27 text 0 当前查询契约\n不执行文件导入或业务 apply',
      ].map((text,index):{text:string;at:string;action?:{command:string;sourceRef:string}}=>({text,at:new Date(Date.UTC(2026,0,1,0,0,index)).toISOString(),...(index===8||index===9?{action:{command:index===8?'APPROVE_CONTRACT':'PUBLISH_CONTRACT',sourceRef:'synthetic-tool-action-'+index}}:{})})),
      steps:{makerCheckerDataset:[0,1,2],makerCheckerSource:[3,4,5],contractCoreCandidate:[6],contractValidationAccept:[15],makerCheckerContract:[16,17,18],brEffectivePublishedRead:[20],retireImpactAndRetire:[21,22],historyAndNoDomainWriteBoundary:[14,18,19,22],'AC-01':[10,11],'AC-02':[7,8,9],'AC-03':[18,19],'AC-04':[14,18],'AC-05':[12,13]},
    };
    const capture=JSON.stringify(record);
    writeFileSync(join(directory,'capture.json'),capture);
    browser.sources=[{path:relative(resolve('.runtime/vnext'),join(directory,'capture.json')).replaceAll('\\','/'),sha256:createHash('sha256').update(capture).digest('hex')}];
    const check = (value: unknown) => runGateM0({browser: value}).evidence.browser;
    try {
    expect(check(browser)).toBe(true);
    for(const key of Object.keys(record.steps)) {
      const changed=structuredClone(record);changed.steps[key]=[changed.captures.length];
      changed.captures.push({text:'Chrome error page: connection refused',at:'2026-01-01T00:01:00.000Z'});
      const bytes=JSON.stringify(changed);writeFileSync(join(directory,'capture.json'),bytes);
      expect(check({...browser,sources:[{...browser.sources[0],sha256:createHash('sha256').update(bytes).digest('hex')}]})).toBe(false);
    }
    for(const [index,text] of [[2,'Maker ORG07 已保存 · PUBLISHED'],[15,'校验 REVIEW'],[19,published+'\n195 button 下载 v3 原版本 schema'],[22,'已废止 · 命令已接受\n27 text 1 当前查询契约'],[2,maker+'\nORG07 已保存 · PUBLISHED\n24 menu 复核者 · Reviewer'],[19,independent+'\n'+published.replace('2026-01-03T00:00:00','2026-01-04T00:00:00')]] as const) {
      const changed=structuredClone(record);changed.captures[index]!.text=text;
      const bytes=JSON.stringify(changed);writeFileSync(join(directory,'capture.json'),bytes);
      expect(check({...browser,sources:[{...browser.sources[0],sha256:createHash('sha256').update(bytes).digest('hex')}]})).toBe(false);
    }
    writeFileSync(join(directory,'capture.json'),capture);
    const duplicated=structuredClone(record);duplicated.captures[9]=structuredClone(duplicated.captures[8]!);
    const duplicatedBytes=JSON.stringify(duplicated);writeFileSync(join(directory,'capture.json'),duplicatedBytes);
    expect(check({...browser,sources:[{...browser.sources[0],sha256:createHash('sha256').update(duplicatedBytes).digest('hex')}]})).toBe(false);
    writeFileSync(join(directory,'capture.json'),capture);
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
