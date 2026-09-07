import { sql, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import type { AuditEventService } from '../audit/index.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import { assignmentPeriodCovered } from './assignment-contracts.js';
import { temporalKey } from './engagement-rule-segments.js';
import { ASSIGNMENT_MODES, ASSIGNMENT_PURPOSES, type AssignmentSemanticTermVersion,
  type AssignmentSemanticsApplication, type RegisterAssignmentSemanticTerm, type AppendAssignmentSemanticTermVersion,
} from './assignment-semantics-contracts.js';

type Row = Selectable<DB['person_master.assignment_semantic_term_version']>;
type DefinitionApplication = Pick<AssignmentSemanticsApplication, 'registerAssignmentSemanticTerm' | 'appendAssignmentSemanticTermVersion'
  | 'getAssignmentSemanticTermVersion' | 'findAssignmentSemanticTermAsOf'>;
export function assignmentTermResult(row: Row): AssignmentSemanticTermVersion {
  const code = [...ASSIGNMENT_PURPOSES,...ASSIGNMENT_MODES].find(c => c===row.code);
  if (!code || (row.dimension!=='PURPOSE' && row.dimension!=='MODE') ||
    (row.definition_state!=='ENABLED' && row.definition_state!=='RETIRED')) throw new Error('ASSIGNMENT_TERM_INVALID');
  return { governanceObjectId: row.governance_object_id, termId: row.term_id, termVersionId: row.term_version_id,
    dimension: row.dimension, code, label: row.label, definitionState: row.definition_state,
    businessValidFrom: row.business_valid_from, businessValidTo: row.business_valid_to, versionNo: row.version_no,
    recordedFrom: row.recorded_from, supersedesTermVersionId: row.supersedes_term_version_id };
}
export function validateAssignmentTermIdentity(dimension: string, code: string): void {
  if (dimension!=='PURPOSE' && dimension!=='MODE') throw new Error('ASSIGNMENT_TERM_WRONG_DIMENSION');
  if (dimension==='PURPOSE' && !ASSIGNMENT_PURPOSES.some(c=>c===code))
    throw new Error(ASSIGNMENT_MODES.some(c=>c===code) ? 'ASSIGNMENT_TERM_WRONG_DIMENSION' : 'ASSIGNMENT_UNKNOWN_PURPOSE');
  if (dimension==='MODE' && !ASSIGNMENT_MODES.some(c=>c===code))
    throw new Error(ASSIGNMENT_PURPOSES.some(c=>c===code) ? 'ASSIGNMENT_TERM_WRONG_DIMENSION' : 'ASSIGNMENT_MODE_NOT_SUPPORTED_IN_SLICE');
}
export function createAssignmentSemanticDefinitionModule(database: Transaction<DB>, context: RequestContext,
  audit: AuditEventService, authorize: (scope: string, operation: 'DEFINITION_READ' | 'DEFINITION_WRITE')=>Promise<void>): DefinitionApplication {
  async function exact(governanceObjectId: string, termVersionId: string) {
    const row = await database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
      .where('governance_object_id','=',governanceObjectId).where('term_version_id','=',termVersionId).executeTakeFirst();
    if (!row) throw new Error('ASSIGNMENT_TERM_NOT_FOUND');
    return assignmentTermResult(row);
  }
  async function mutation(command: RegisterAssignmentSemanticTerm | AppendAssignmentSemanticTermVersion, append: boolean) {
    const revision=append && 'termId' in command ? command : null;
    const registration=!append && 'dimension' in command ? command : null;
    if (!revision && !registration) throw new Error('ASSIGNMENT_TERM_INPUT_INVALID');
    assertClosedObject(command, ['governanceObjectId','label','definitionState','businessValidFrom','businessValidTo',
      ...(append ? ['termId','expectedCurrentVersionId','reasonCode'] : ['dimension','code'])]);
    assertPersonUuid(command.governanceObjectId);
    if (typeof command.label!=='string' || !command.label.trim() || command.label.length>160 || /\p{Cc}/u.test(command.label) ||
      !['ENABLED','RETIRED'].includes(command.definitionState)) throw new Error('ASSIGNMENT_TERM_INPUT_INVALID');
    assignmentPeriodCovered(command.businessValidFrom, command.businessValidTo, command.businessValidFrom, command.businessValidTo);
    if (revision) {
      assertPersonUuid(revision.termId); assertPersonUuid(revision.expectedCurrentVersionId);
      if (!['LABEL_CORRECTION','APPLICABILITY_CORRECTION','RETIREMENT'].includes(revision.reasonCode)) throw new Error('ASSIGNMENT_TERM_INPUT_INVALID');
    } else validateAssignmentTermIdentity(registration!.dimension,registration!.code);
    await authorize(command.governanceObjectId,'DEFINITION_WRITE');
    const hash = canonicalSha256({ command: { ...command, businessValidFrom: temporalKey(command.businessValidFrom),
      businessValidTo: command.businessValidTo===null ? null : temporalKey(command.businessValidTo) },
      operation: append ? 'APPEND_TERM' : 'REGISTER_TERM', actor: context.actorPrincipalId });
    await sql`select pg_advisory_xact_lock(hashtextextended(${`ASSIGNMENT_TERM_REQUEST:${command.governanceObjectId}:${context.requestId}`},0))`.execute(database);
    const repeated = await database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
      .where('governance_object_id','=',command.governanceObjectId).where('request_id','=',context.requestId).executeTakeFirst();
    if (repeated) {
      if (!repeated.operation_hash.equals(hash)) throw new Error('ASSIGNMENT_TERM_OPERATION_CONFLICT');
      return assignmentTermResult(repeated);
    }
    let term: Selectable<DB['person_master.assignment_semantic_term']>;
    let prior: Row | undefined;
    if (revision) {
      const found = await database.selectFrom('person_master.assignment_semantic_term').selectAll()
        .where('governance_object_id','=',command.governanceObjectId).where('term_id','=',revision.termId).forUpdate().executeTakeFirst();
      if (!found) throw new Error('ASSIGNMENT_TERM_NOT_FOUND');
      term=found;
      prior = await database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
        .where('term_id','=',term.term_id).orderBy('version_no','desc').limit(1).executeTakeFirstOrThrow();
      if (prior.term_version_id!==revision.expectedCurrentVersionId) throw new Error('ASSIGNMENT_TERM_STALE_VERSION');
    } else {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`ASSIGNMENT_TERM_CODE:${command.governanceObjectId}:${registration!.dimension}:${registration!.code}`},0))`.execute(database);
      const found = await database.selectFrom('person_master.assignment_semantic_term').select('term_id')
        .where('governance_object_id','=',command.governanceObjectId).where('dimension','=',registration!.dimension).where('code','=',registration!.code).executeTakeFirst();
      if (found) throw new Error('ASSIGNMENT_TERM_ALREADY_REGISTERED');
      term = await database.insertInto('person_master.assignment_semantic_term').values({ governance_object_id: command.governanceObjectId,
        dimension: registration!.dimension, code: registration!.code, created_by: context.actorPrincipalId, creation_request_id: context.requestId }).returningAll().executeTakeFirstOrThrow();
    }
    const row = await database.insertInto('person_master.assignment_semantic_term_version').values({
      term_id: term.term_id, governance_object_id: term.governance_object_id, dimension: term.dimension, code: term.code,
      version_no: String(BigInt(prior?.version_no??'0')+1n), supersedes_term_version_id: prior?.term_version_id??null,
      label: command.label, definition_state: command.definitionState, business_valid_from: command.businessValidFrom,
      business_valid_to: command.businessValidTo, reason_code: revision?.reasonCode??null,
      recorded_from: sql`platform.local_now()`, created_by: context.actorPrincipalId, request_id: context.requestId, operation_hash: hash,
    }).returningAll().executeTakeFirstOrThrow();
    await audit.append({ governanceObjectId: command.governanceObjectId, aggregateType: 'ASSIGNMENT_SEMANTIC_TERM', aggregateId: term.term_id,
      aggregateVersionId: row.term_version_id, eventType: 'ASSIGNMENT_SEMANTIC_TERM_VERSION_CREATED',
      payload: { dimension: term.dimension, code: term.code, versionNo: row.version_no, definitionState: row.definition_state },
      afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
    return assignmentTermResult(row);
  }
  return {
    registerAssignmentSemanticTerm: command=>mutation(command,false),
    appendAssignmentSemanticTermVersion: command=>mutation(command,true),
    async getAssignmentSemanticTermVersion(query) {
      assertClosedObject(query,['governanceObjectId','termVersionId']); assertPersonUuid(query.governanceObjectId); assertPersonUuid(query.termVersionId);
      await authorize(query.governanceObjectId,'DEFINITION_READ'); return exact(query.governanceObjectId,query.termVersionId);
    },
    async findAssignmentSemanticTermAsOf(query) {
      assertClosedObject(query,['governanceObjectId','dimension','code','recordAsOf']); assertPersonUuid(query.governanceObjectId);
      validateAssignmentTermIdentity(query.dimension,query.code); temporalKey(query.recordAsOf);
      await authorize(query.governanceObjectId,'DEFINITION_READ');
      const row = await database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
        .where('governance_object_id','=',query.governanceObjectId).where('dimension','=',query.dimension).where('code','=',query.code)
        .where('recorded_from','<=',query.recordAsOf).orderBy('version_no','desc').limit(1).executeTakeFirst();
      return row ? assignmentTermResult(row) : null;
    },
  };
}
