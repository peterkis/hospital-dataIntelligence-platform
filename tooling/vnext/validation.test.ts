import {test} from 'vitest';
import assert from 'node:assert/strict';
import {evaluateRuleSet,interpretText,segmentCoverage,evaluateCondition,checkTypedReference} from '../../apps/governance-api/src/modules/governance-catalog/validation-rules.js';
import {conditionMappings} from '../../apps/governance-api/src/modules/governance-catalog/validation-sources.generated.js';
import type {ImportContractDefinition} from '../../apps/governance-api/src/modules/governance-catalog/contract-schema.js';
import {verifyParsedPayload} from '../../apps/governance-api/src/modules/governance-catalog/parse-provenance.js';
import {parseBytes} from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import {textWorkbook} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
import {readFileSync} from 'node:fs';
const definition=(field:string):ImportContractDefinition=>({ruleVersion:'TEST_V1',templateVersion:'TEST_V1',sourceVersionId:null,fields:[{code:field,type:'text',required:'C',privacy:'RESTRICTED',condition:'MANUAL_EVIDENCE',enumValues:[]}],rules:[],references:[],codeSets:[]});
for(const mapping of conditionMappings)test(`${mapping.id}: exact source mapping and missing evidence cannot release ${mapping.dataset}.${mapping.field}`,()=>{
 const d=definition(mapping.field);d.rules=[{id:mapping.id,field:mapping.field,text:mapping.text,status:mapping.handler==='ACCOUNT_HUMAN_V1'?'MACHINE':'MANUAL_EVIDENCE',version:mapping.version}];
 for(const value of ['', mapping.field==='weight'?'0.5':'SYNTHETIC_VALUE']){
  const result=evaluateRuleSet(mapping.dataset,d,[{[mapping.field]:value}]);
  assert.equal(result.decision,'BLOCKED');
  if(mapping.handler==='MANUAL_EVIDENCE_V1')assert.deepEqual(result.evidenceRequirements.map(e=>[e.rule,e.requirementId,e.status]),[[mapping.id,mapping.requirementId,'BLOCKED_DEPENDENCY']]);
  else assert.ok(result.issues.some(i=>i.status==='UNKNOWN'));
 }
});
test('P0-05-AC-06: every scoped source is accounted for and all 119 outside sources stay outside',()=>{
 const source: Array<{id:string;scope:string;source:{dataset:string;field:string;rule:string}}>=JSON.parse(readFileSync('db/vnext/sources/contract-inputs/conditional-rule-disposition.json','utf8'));
 assert.deepEqual(conditionMappings.map(m=>[m.id,m.dataset,m.field,m.text]),source.filter(s=>s.scope==='IN_SCOPE_ORG_PER').map(s=>[s.id,s.source.dataset,s.source.field,s.source.rule]));
 assert.equal(source.filter(s=>s.scope!=='IN_SCOPE_ORG_PER').length,119);
 assert.throws(()=>evaluateRuleSet('PAT01',definition('id'),[{id:'0012'}]),/OUTSIDE_SCOPE/);
 assert.throws(()=>evaluateRuleSet('BIZ01',definition('id'),[{id:'0012'}]),/OUTSIDE_SCOPE/);
});
test('P0-05-AC-04: matching UUID cannot bypass typed target, scope, version or full period',()=>{
 const window={from:'2026-01-01T00:00:00',to:'2026-02-01T00:00:00'};
 const expected={target:'PER01.person_id',scope:'SYNTHETIC',identity:'00000000-0000-0000-0000-000000000001',version:'1',window};
 const observation={...expected,status:'OBSERVED' as const,version:'1',periods:[window]};
 assert.equal(checkTypedReference(expected,observation),'PASS');
 assert.equal(checkTypedReference(expected,{...observation,target:'ORG01.legal_entity_id'}),'FAIL');
 assert.equal(checkTypedReference(expected,{...observation,scope:'BASELINE'}),'FAIL');
 assert.equal(checkTypedReference(expected,{...observation,version:null}),'FAIL');
 assert.equal(checkTypedReference(expected,{...observation,version:'2'}),'FAIL');
 assert.equal(checkTypedReference({...expected,version:null},observation),'NOT_EVALUATED');
 assert.equal(checkTypedReference(expected,{...observation,periods:[{...window,to:'2026-01-31T23:59:59.999999'}]}),'FAIL');
 assert.equal(checkTypedReference(expected,{...observation,status:'NOT_READY'}),'NOT_EVALUATED');
});
test('PR7 R5: non-null observed versions must match the pinned reference version',()=>{
 const window={from:'2026-01-01T00:00:00',to:null};
 const expected={target:'GOV09.config_id',scope:'SYNTHETIC',identity:'PARAMETER_ID',version:'PINNED_VERSION',window};
 const observation={target:expected.target,scope:expected.scope,identity:expected.identity,status:'OBSERVED' as const,version:'OTHER_VERSION',periods:[window]};
 assert.equal(checkTypedReference(expected,observation),'FAIL');
 const d=definition('rule_ref');d.fields[0]!.type='id';d.fields[0]!.required='O';d.fields[0]!.condition='OPTIONAL';d.businessKey=['rule_ref'];
 d.references=[{field:'rule_ref',target:'GOV09.config_id',status:'DECLARED_PARAMETER',parameterVersionId:'PINNED_VERSION',parameterDigest:'a'.repeat(64)}];
 assert.ok(evaluateRuleSet('ORG20',d,[{rule_ref:'PARAMETER_ID'}],[observation],window).issues.some(i=>i.layer===4&&i.status==='FAIL'));
 assert.equal(checkTypedReference(expected,{...observation,version:'PINNED_VERSION'}),'PASS');
});
test('P0-05-AC-05: deterministic evaluations do not mutate canonical strings',()=>{
 const d=definition('legal_name');d.fields[0]!.required='R';d.fields[0]!.condition='ALWAYS';
 const rows=[{legal_name:'0012'}],before=JSON.stringify(rows);
 assert.deepEqual(evaluateRuleSet('ORG01',d,rows),evaluateRuleSet('ORG01',d,rows));assert.equal(JSON.stringify(rows),before);
});
test('PR7: identical rows are ignored as duplicates while changed same-key content conflicts',()=>{
 const d=definition('legal_entity_id');d.fields[0]!.type='id';d.fields[0]!.required='R';d.fields[0]!.condition='ALWAYS';
 d.businessKey=['legal_entity_id'];
 d.fields.push({...d.fields[0]!,code:'legal_name',type:'text'});
 const row={legal_entity_id:'0012',legal_name:'SYNTHETIC_NAME'};
 const identical=evaluateRuleSet('ORG01',d,[row,{legal_name:row.legal_name,legal_entity_id:row.legal_entity_id}]);
 assert.ok(!identical.issues.some(i=>i.status==='FAIL'));
 assert.deepEqual(identical.duplicates,[{row:2,duplicateOf:1}]);
 const conflict=evaluateRuleSet('ORG01',d,[row,{...row,legal_name:'DIFFERENT'}]);
 assert.ok(conflict.issues.some(i=>i.row===2&&i.code==='CONFLICTING_SOURCE_ID'&&i.status==='FAIL'));
 // The first invalid occurrence still fails; its duplicate cannot erase that failure.
 const invalid=evaluateRuleSet('ORG01',d,[{...row,legal_name:''},{...row,legal_name:''}]);
 assert.ok(invalid.issues.some(i=>i.row===1&&i.code==='VALUE_REQUIRED'));
});
test('PR7 R2: a CORE contract without configured business keys cannot report L3 PASS',()=>{
 const d=definition('legal_name');d.fields[0]!.required='R';d.fields[0]!.condition='ALWAYS';
 const result=evaluateRuleSet('ORG01',d,[{legal_name:'SAME'},{legal_name:'SAME'}]);
 assert.equal(result.layers.find(l=>l.layer===3)!.status,'NOT_EVALUATED');
 assert.ok(result.issues.some(i=>i.code==='BUSINESS_KEY_NOT_CONFIGURED'));
});
test('PR7 R3: a manual-evidence result includes immutable actionable source details',()=>{
 const m=conditionMappings.find(m=>m.id==='SRC-COND-001')!;const d=definition(m.field);
 d.rules=[{id:m.id,field:m.field,text:m.text,status:'MANUAL_EVIDENCE',version:m.version}];
 const result=evaluateRuleSet('ORG01',d,[{unified_credit_code:''}]);
 const details=result.evidenceRequirements[0]?.details;
 assert.equal(details?.evidenceOwner,'院办');
 assert.equal(details?.sourceText,'主体持有统一社会信用代码时必填；无法确认主体性质时不得以院区代码代替。');
 assert.equal(details?.sourceVersion,'P0_05_SOURCE_V1');
 assert.equal(details?.whenUnknown,'BLOCK');
 assert.ok(details?.requiredEvidence);
});
test('PR7 R2: composite declared keys preserve tuple boundaries and require every key value',()=>{
 const d=definition('legal_name');d.fields[0]!.required='R';d.fields[0]!.condition='ALWAYS';
 d.fields.push({...d.fields[0]!,code:'institution_code'});d.businessKey=['legal_name','institution_code'];
 const result=evaluateRuleSet('ORG01',d,[{legal_name:'A|B',institution_code:'C'},{legal_name:'A',institution_code:'B|C'},{legal_name:'A|B',institution_code:'C'}]);
 assert.deepEqual(result.duplicates,[{row:3,duplicateOf:1}]);assert.equal(result.layers.find(l=>l.layer===3)!.status,'PASS');
 const missing=evaluateRuleSet('ORG01',d,[{legal_name:'A',institution_code:''}]);
 assert.ok(missing.issues.some(i=>i.layer===3&&i.status==='UNKNOWN'&&i.code==='BUSINESS_KEY_VALUE_REQUIRED'));
});
test('parsed payload schema rejects wrong source, incomplete rows, duplicate evidence and false empty success',()=>{
 const fields=[{code:'code',type:'code'}],result=parseBytes(Buffer.from('code\n0012'),'CSV',fields);
 const expected={sourceArtifactId:'source',policy:'STRICT_V1' as const,format:'CSV',status:'PARSED'};
 const check=(r:unknown,sourceArtifactId='source')=>verifyParsedPayload(Buffer.from(JSON.stringify({sourceArtifactId,result:r})),expected,fields);
 assert.equal(check(result).rows[0]!['code'],'0012');
 for(const r of [{...result,rows:[]},{...result,cells:[]},{...result,rows:[{}]},{...result,extra:true}])assert.throws(()=>check(r),/PARSER_RESULT_REQUIRED/);
 assert.throws(()=>check(result,'wrong'),/PARSER_RESULT_REQUIRED/);
});
test('PR7 R4: parser-accepted Unicode text crosses provenance and reaches field length validation',()=>{
 const fields=[{code:'legal_name',type:'text'}];
 for(const [text,status] of [['a'.repeat(8192),'PARSED'],['a'.repeat(8193),'REJECTED'],['😀'.repeat(8192),'PARSED'],['a'.repeat(8191)+'😀','PARSED'],['e\u0301'.repeat(4096),'PARSED'],['😀'.repeat(8193),'REJECTED']] as const){
 for(const [format,bytes] of [['CSV',Buffer.from('legal_name\n'+text)],['JSON',Buffer.from(JSON.stringify([{legal_name:text}]))],['XLSX',textWorkbook([['legal_name'],[text]])]] as const){
  const result=parseBytes(bytes,format,fields,'STRICT_V2');assert.equal(result.structuralStatus,status);
  const payload=Buffer.from(JSON.stringify({sourceArtifactId:'source',result}));assert.ok(payload.length<1048576);
  const verified=verifyParsedPayload(payload,{sourceArtifactId:'source',policy:'STRICT_V2',format,status},fields);
  if(status==='REJECTED'){assert.equal(verified.issues[0]?.code,'CELL_LIMIT');assert.deepEqual(verified.rows,[]);continue;}
  const d=definition('legal_name');d.businessKey=['legal_name'];d.fields[0]!.required='R';d.fields[0]!.condition='ALWAYS';
  assert.ok(evaluateRuleSet('ORG01',d,verified.rows).issues.some(i=>i.layer===2&&i.code==='VALUE_TOO_LONG'));
 }
 }
});
test('P0-05-AC-02: unknown account kind never becomes a false condition',()=>{
 assert.equal(evaluateCondition('SRC-COND-061',{account_kind:''},['HUMAN','SERVICE']),'UNKNOWN');
 assert.equal(evaluateCondition('SRC-COND-061',{account_kind:'HUMAN'},['HUMAN','SERVICE']),true);
 assert.equal(evaluateCondition('SRC-COND-061',{account_kind:'SERVICE'},['HUMAN','SERVICE']),false);
 assert.equal(evaluateCondition('SRC-COND-061',{account_kind:'ALIEN'},['HUMAN','SERVICE']),'UNKNOWN');
});
test('text interpretation is exact and absence never becomes zero or false',()=>{
 assert.equal(interpretText('code','0012'),'0012');
 assert.equal(interpretText('integer','12'),'12');
 for(const value of ['',' 12','01','1e2','+2','1.0'])assert.throws(()=>interpretText('integer',value));
 assert.equal(interpretText('decimal','12345678901234567890.001'),'12345678901234567890.001');
 assert.throws(()=>interpretText('datetime','2026-02-30T00:00:00'));
 assert.throws(()=>interpretText('datetime','2026-01-01T00:00:00+08:00'));
});
test('source DECIMAL(18,6) is checked without rounding or binary floating point',()=>{
 const d=definition('workload_fraction');d.fields[0]!.type='decimal';d.fields[0]!.required='R';d.fields[0]!.condition='ALWAYS';
 for(const value of ['1234567890123.000001','0.0000001'])assert.ok(evaluateRuleSet('PER06',d,[{workload_fraction:value}]).issues.some(i=>i.code==='DECIMAL_PRECISION_INVALID'));
 assert.ok(!evaluateRuleSet('PER06',d,[{workload_fraction:'123456789012.000001'}]).issues.some(i=>i.status==='FAIL'));
});
test('P0-05-AC-04: typed reference denial is wired through rule evaluation',()=>{
 const d=definition('person_id');d.fields[0]!.required='R';d.fields[0]!.condition='ALWAYS';d.references=[{field:'person_id',target:'PER01.person_id',status:'BLOCKED_DEPENDENCY'}];
 const window={from:'2026-01-01T00:00:00',to:null};
 const r=evaluateRuleSet('PER17',d,[{person_id:'00000000-0000-0000-0000-000000000001'}],[{target:'ORG01.legal_entity_id',scope:'SYNTHETIC',status:'OBSERVED',identity:'00000000-0000-0000-0000-000000000001',version:'V1',periods:[window]}],window);
 assert.ok(r.issues.some(i=>i.layer===4&&i.code==='TYPED_REFERENCE_INVALID'&&i.status==='FAIL'));
});
test('P0-05-AC-01: independent discrete microsecond oracle checks complete coverage',()=>{
 const t=(n:number)=>`2026-01-01T00:00:00.${String(n).padStart(6,'0')}`;
 for(let mask=0;mask<64;mask++){
  const spans=Array.from({length:6},(_,i)=>i).filter(i=>mask&(1<<i)).map(i=>({from:t(i),to:t(i+1)}));
  const segments=segmentCoverage({from:t(0),to:t(6)},spans);
  for(let i=0;i<6;i++)assert.equal(segments.some(s=>s.covered&&s.from<=t(i)&&(s.to===null||t(i)<s.to)),Boolean(mask&(1<<i)));
 }
 assert.deepEqual(segmentCoverage({from:t(0),to:null},[{from:t(0),to:t(2)}]).map(s=>s.covered),[true,false]);
});
test('P0-06 coverage: a successful check has signed, row-scoped positive execution evidence',()=>{
 const d=definition('legal_name');d.fields[0]!.required='R';d.fields[0]!.condition='ALWAYS';d.businessKey=['legal_name'];
 const result=evaluateRuleSet('ORG01',d,[{legal_name:'SYNTHETIC_NAME'}]);
 const coverage=result.executionCoverage;assert.ok(coverage);
 assert.equal(coverage.version,'RULE_EXECUTION_V1');
 const checks=coverage.checks.filter(check=>check.rows.includes(1)&&check.field==='legal_name');
 assert.ok(checks.some(check=>check.rule==='REQUIRED'&&check.status==='PASS'));
 assert.ok(checks.some(check=>check.rule==='TYPE'&&check.status==='PASS'));
 assert.ok(checks.some(check=>check.rule==='SOURCE'&&check.status==='PASS'));
 assert.ok(checks.some(check=>check.rule==='LENGTH'&&check.status==='PASS'));
 assert.ok(coverage.checks.some(check=>check.rule==='BUSINESS_KEY'&&check.rows.includes(1)&&check.status==='PASS'));
});


test('PR8 known finite conditions record positive coverage without clearing remaining blockers',()=>{
 const m=conditionMappings.find(mapping=>mapping.id==='SRC-COND-061')!;
 const d=definition(m.field);d.fields.push({code:'account_kind',type:'code',required:'R',privacy:'INTERNAL',condition:'ALWAYS',enumValues:['HUMAN','SERVICE']});
 d.rules=[{id:m.id,field:m.field,text:m.text,status:'MACHINE',version:m.version}];
 d.codeSets=[{field:'account_kind',codeSystem:'TEST',version:'V1',status:'SYNTHETIC_ADOPTED',codes:['HUMAN','SERVICE'],validFrom:'2026-01-01T00:00:00',validTo:null,sourceVersionId:'00000000-0000-0000-0000-000000000001'}];
 for(const kind of ['HUMAN','SERVICE']){
  const result=evaluateRuleSet('PER17',d,[{account_kind:kind,[m.field]:''}]);
  assert.ok(result.executionCoverage?.checks.some(c=>c.rule===m.id&&c.field===m.field&&c.status==='PASS'&&c.rows.includes(1)));
  assert.notEqual(result.decision,'PASS');
  if(kind==='HUMAN')assert.ok(result.issues.some(i=>i.rule==='REQUIRED'&&i.status==='FAIL'));
  for(const rule of ['TYPE','SOURCE','LENGTH'])assert.equal(result.executionCoverage?.checks.some(c=>c.rule===rule&&c.field===m.field&&c.status==='PASS'),kind==='SERVICE');
 }
});

test('PR8 valid absence covers applicable value constraints and optional references',()=>{
 for(const [dataset,field,type,rule] of [['PER06','workload_fraction','decimal','DECIMAL'],['ORG20','weight','decimal','WEIGHT_RANGE'],['ORG01','legal_name','text','ENUM']] as const){
  const d=definition(field);d.fields[0]!.type=type;d.fields[0]!.required='O';d.fields[0]!.condition='OPTIONAL';d.fields[0]!.enumValues=rule==='ENUM'?['VALUE']:[];
  const result=evaluateRuleSet(dataset,d,[{[field]:''}]);
  assert.ok(result.executionCoverage?.checks.some(c=>c.rule===rule&&c.status==='PASS'&&c.code==='VALID_ABSENCE'));
 }
 const d=definition('rule_ref');d.fields[0]!.required='O';d.fields[0]!.condition='OPTIONAL';d.references=[{field:'rule_ref',target:'GOV09.config_id',status:'BLOCKED_DEPENDENCY'}];
 for(const row of [{rule_ref:''},{}]){
  const result=evaluateRuleSet('ORG20',d,[row]);
  assert.equal(result.executionCoverage?.checks.some(c=>c.rule==='REFERENCE'&&c.status==='PASS'),'rule_ref' in row);
  assert.notEqual(result.decision,'PASS');
 }
});

test('PR8 only known valid absence records positive field coverage',()=>{
 for(const required of ['O','R','C'] as const){
  const d=definition('legal_name');d.fields[0]!.required=required;d.fields[0]!.condition=required==='O'?'OPTIONAL':required==='R'?'ALWAYS':'UNRESOLVED';
  for(const row of [{legal_name:''},{}]){
   const result=evaluateRuleSet('ORG01',d,[row]);
   for(const rule of ['TYPE','SOURCE','LENGTH'])assert.equal(result.executionCoverage?.checks.some(c=>c.rule===rule&&c.status==='PASS'),required==='O'&&'legal_name' in row);
   assert.notEqual(result.decision,'PASS');
  }
 }
 const d=definition('UNKNOWN_FIELD');d.fields[0]!.required='O';d.fields[0]!.condition='OPTIONAL';
 const missing=evaluateRuleSet('ORG01',d,[{UNKNOWN_FIELD:''}]);
 assert.ok(!missing.executionCoverage?.checks.some(c=>['SOURCE','LENGTH'].includes(c.rule)&&c.status==='PASS'));
});
