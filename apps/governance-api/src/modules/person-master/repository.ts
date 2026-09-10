import { sql, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type { AuditEventService } from '../audit/index.js';
import type { AuthorizationModule } from '../authorization/index.js';
import {
  assertClosedObject, assertPersonPeriod, assertPersonUuid, normalizePersonFacts,
  type PersonCoreApplication, type PersonSubjectVersion,
} from './contracts.js';

export type PersonMasterModule = PersonCoreApplication;
type VersionRow = Selectable<DB['person_master.person_subject_version']>;

export function createPersonMasterModule(
  database: Transaction<DB>, context: RequestContext, audit: AuditEventService,
  authorization: AuthorizationModule, requireScope: (governanceObjectId: string, operation: 'CORE_READ' | 'CORE_WRITE') => Promise<void>,
): PersonMasterModule {
  parseLocalDateTime(context.occurredAt);
  assertPersonUuid(context.actorPrincipalId);
  if (!context.requestId.trim() || context.requestId.length > 128 || !context.correlationId.trim() || context.correlationId.length > 128) {
    throw new Error('PERSON_CONTEXT_INVALID');
  }

  async function authorize(governanceObjectId: string, write: boolean) {
    assertPersonUuid(governanceObjectId);
    await requireScope(governanceObjectId, write ? 'CORE_WRITE' : 'CORE_READ');
    await authorization.requireObjectPermission({ governanceObjectId, permissionCode: write ? 'PERSON_MASTER_CORE_WRITE' : 'PERSON_MASTER_CORE_READ' });
  }

  const module: PersonMasterModule = {
    async createPersonSubject(command) {
      assertClosedObject(command, ['governanceObjectId', 'subjectEligibility', 'facts', 'businessValidFrom', 'businessValidTo']);
      if (command.subjectEligibility !== 'CONFIRMED_HOSPITAL_PERSONNEL') throw new Error('PERSON_SUBJECT_SCOPE_INVALID');
      const facts = normalizePersonFacts(command.facts, context.occurredAt.slice(0, 10));
      assertPersonPeriod(command.businessValidFrom, command.businessValidTo);
      await authorize(command.governanceObjectId, true);
      const operationHash = canonicalSha256({ ...command, facts });
      await sql`select pg_advisory_xact_lock(hashtextextended(${`person-create:${command.governanceObjectId}:${context.requestId}`}, 0))`.execute(database);
      const existing = await database.selectFrom('person_master.person_subject').selectAll()
        .where('governance_object_id', '=', command.governanceObjectId).where('creation_request_id', '=', context.requestId).executeTakeFirst();
      if (existing) {
        const first = await database.selectFrom('person_master.person_subject_version').selectAll().where('person_id', '=', existing.person_id).where('version_no', '=', '1').executeTakeFirstOrThrow();
        if (existing.created_by !== context.actorPrincipalId || !first.operation_hash.equals(operationHash)) throw new Error('PERSON_OPERATION_CONFLICT');
        return toVersion(first);
      }
      const subject = await database.insertInto('person_master.person_subject').values({
        governance_object_id: command.governanceObjectId, creation_request_id: context.requestId, created_by: context.actorPrincipalId,
      }).returningAll().executeTakeFirstOrThrow();
      await audit.append({ governanceObjectId: command.governanceObjectId, eventType: 'PERSON_SUBJECT_CREATED', aggregateType: 'PERSON_SUBJECT',
        aggregateId: subject.person_id, payload: { personId: subject.person_id }, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
      const version = await database.insertInto('person_master.person_subject_version').values({
        person_id: subject.person_id, governance_object_id: command.governanceObjectId, version_no: '1',
        canonical_name: facts.canonicalName, birth_date: facts.birthDate, business_valid_from: command.businessValidFrom,
        business_valid_to: command.businessValidTo, created_by: context.actorPrincipalId, request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      await auditVersion(version);
      return toVersion(version);
    },
    async getPersonSubject(query) {
      assertClosedObject(query, ['governanceObjectId', 'personId']);
      assertPersonUuid(query.personId);
      await authorize(query.governanceObjectId, false);
      const subject = await database.selectFrom('person_master.person_subject').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId).where('person_id', '=', query.personId).executeTakeFirst();
      if (!subject) throw new Error('PERSON_NOT_FOUND');
      const version = await database.selectFrom('person_master.person_subject_version').selectAll().where('person_id', '=', query.personId)
        .orderBy('version_no', 'desc').executeTakeFirstOrThrow();
      await auditRead(query.governanceObjectId, query.personId, 'SUBJECT');
      return { subject: { personId: subject.person_id, governanceObjectId: subject.governance_object_id, createdAt: subject.created_at }, latestVersion: toVersion(version) };
    },
    async createPersonSubjectVersion(command) {
      assertClosedObject(command, ['governanceObjectId', 'personId', 'facts', 'businessValidFrom', 'businessValidTo']);
      assertPersonUuid(command.personId);
      const facts = normalizePersonFacts(command.facts, context.occurredAt.slice(0, 10));
      assertPersonPeriod(command.businessValidFrom, command.businessValidTo);
      await authorize(command.governanceObjectId, true);
      const subject = await database.selectFrom('person_master.person_subject').select('person_id')
        .where('governance_object_id', '=', command.governanceObjectId).where('person_id', '=', command.personId).forUpdate().executeTakeFirst();
      if (!subject) throw new Error('PERSON_NOT_FOUND');
      const operationHash = canonicalSha256({ ...command, facts });
      const repeated = await database.selectFrom('person_master.person_subject_version').selectAll()
        .where('person_id', '=', command.personId).where('request_id', '=', context.requestId).executeTakeFirst();
      if (repeated) {
        if (repeated.created_by !== context.actorPrincipalId || !repeated.operation_hash.equals(operationHash)) throw new Error('PERSON_OPERATION_CONFLICT');
        return toVersion(repeated);
      }
      const previous = await database.selectFrom('person_master.person_subject_version').select('version_no')
        .where('person_id', '=', command.personId).orderBy('version_no', 'desc').executeTakeFirstOrThrow();
      const version = await database.insertInto('person_master.person_subject_version').values({
        person_id: command.personId, governance_object_id: command.governanceObjectId,
        version_no: (BigInt(previous.version_no) + 1n).toString(), canonical_name: facts.canonicalName, birth_date: facts.birthDate,
        business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo,
        created_by: context.actorPrincipalId, request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      await auditVersion(version);
      return toVersion(version);
    },
    async getPersonSubjectVersion(query) {
      assertClosedObject(query, ['governanceObjectId', 'personId', 'personVersionId']);
      assertPersonUuid(query.personVersionId);
      await authorizeRead(query);
      const version = await database.selectFrom('person_master.person_subject_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId).where('person_id', '=', query.personId)
        .where('person_version_id', '=', query.personVersionId).executeTakeFirst();
      if (!version) throw new Error('PERSON_VERSION_NOT_FOUND');
      await auditRead(query.governanceObjectId, query.personId, 'VERSION', { personVersionId: query.personVersionId });
      return toVersion(version);
    },
    async listPersonSubjectVersions(query) {
      assertClosedObject(query, ['governanceObjectId', 'personId']);
      await authorizeRead(query);
      const versions = await database.selectFrom('person_master.person_subject_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId).where('person_id', '=', query.personId).orderBy('version_no').execute();
      await auditRead(query.governanceObjectId, query.personId, 'HISTORY');
      return versions.map(toVersion);
    },
    async findPersonSubjectAsOf(query) {
      assertClosedObject(query, ['governanceObjectId', 'personId', 'businessAt', 'recordAsOf']);
      parseLocalDateTime(query.businessAt); parseLocalDateTime(query.recordAsOf);
      await authorizeRead(query);
      const version = await database.selectFrom('person_master.person_subject_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId).where('person_id', '=', query.personId)
        .where('recorded_from', '<=', query.recordAsOf).where('business_valid_from', '<=', query.businessAt)
        .where((eb) => eb.or([eb('business_valid_to', 'is', null), eb('business_valid_to', '>', query.businessAt)]))
        .orderBy('version_no', 'desc').executeTakeFirst();
      await auditRead(query.governanceObjectId, query.personId, 'AS_OF', { businessAt: query.businessAt, recordAsOf: query.recordAsOf });
      return version ? toVersion(version) : null;
    },
  };
  return module;

  async function auditVersion(version: VersionRow) {
    await audit.append({ governanceObjectId: version.governance_object_id, eventType: 'PERSON_SUBJECT_VERSION_CREATED', aggregateType: 'PERSON_SUBJECT_VERSION',
      aggregateId: version.person_id, aggregateVersionId: version.person_version_id, payload: { personId: version.person_id, personVersionId: version.person_version_id, versionNo: version.version_no },
      afterHash: version.operation_hash, authorityScope: 'PERSON_MASTER:HOSPITAL' });
  }
  async function authorizeRead(query: { governanceObjectId: string; personId: string }) {
    assertPersonUuid(query.personId);
    await authorize(query.governanceObjectId, false);
    const exists = await database.selectFrom('person_master.person_subject').select('person_id')
      .where('governance_object_id', '=', query.governanceObjectId).where('person_id', '=', query.personId).executeTakeFirst();
    if (!exists) throw new Error('PERSON_NOT_FOUND');
  }
  async function auditRead(objectId: string, personId: string, queryKind: string, criteria: Readonly<Record<string, unknown>> = {}) {
    await audit.append({ governanceObjectId: objectId, eventType: 'PERSON_SUBJECT_READ', aggregateType: 'PERSON_SUBJECT', aggregateId: personId,
      payload: { personId, queryKind, ...criteria }, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
  }
}

function toVersion(row: VersionRow): PersonSubjectVersion {
  return { personId: row.person_id, personVersionId: row.person_version_id, versionNo: row.version_no,
    canonicalName: row.canonical_name, birthDate: row.birth_date, businessValidFrom: row.business_valid_from,
    businessValidTo: row.business_valid_to, recordedFrom: row.recorded_from };
}
