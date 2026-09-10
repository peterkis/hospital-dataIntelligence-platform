import { sql, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type { AuditEventService, PersonAuditEventType } from '../audit/index.js';
import type { AuthorizationModule } from '../authorization/index.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import {
  validateIdentifierKey, validateIdentifierPeriod, validateIdentifierRegistration, validateIdentifierTimes,
  type IdentifierReference, type IdentifierTimes, type PersonIdentifier, type PersonIdentifierApplication,
  type PersonIdentifierVersion, type RegisterPersonIdentifier,
} from './identifier-contracts.js';

type IdentifierRow = Selectable<DB['person_master.person_identifier']>;
type VersionRow = Selectable<DB['person_master.person_identifier_version']>;
type RegistrationResult = { readonly ok: true; readonly version: PersonIdentifierVersion } |
  { readonly ok: false; readonly code: 'PERSON_IDENTIFIER_ALREADY_REGISTERED' | 'PERSON_IDENTIFIER_COLLISION' };
export interface PersonIdentifierModule extends Omit<PersonIdentifierApplication, 'registerPersonIdentifier'> {
  registerPersonIdentifier(command: RegisterPersonIdentifier): Promise<RegistrationResult>;
}

export function createPersonIdentifierModule(
  database: Transaction<DB>, context: RequestContext, audit: AuditEventService, authorization: AuthorizationModule,
  requireScope: (objectId: string, write: boolean) => Promise<void>,
): PersonIdentifierModule {
  parseLocalDateTime(context.occurredAt);
  assertPersonUuid(context.actorPrincipalId);
  for (const id of [context.requestId, context.correlationId]) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128 || /\p{Cc}/u.test(id)) throw new Error('PERSON_IDENTIFIER_CONTEXT_INVALID');
  }

  async function authorize(objectId: string, write: boolean) {
    assertPersonUuid(objectId);
    await requireScope(objectId, write);
    await authorization.requireObjectPermission({ governanceObjectId: objectId,
      permissionCode: write ? 'PERSON_MASTER_IDENTIFIER_WRITE' : 'PERSON_MASTER_IDENTIFIER_READ' });
  }
  async function requirePerson(objectId: string, personId: string) {
    assertPersonUuid(personId);
    const found = await database.selectFrom('person_master.person_subject').select('person_id')
      .where('governance_object_id', '=', objectId).where('person_id', '=', personId).executeTakeFirst();
    if (!found) throw new Error('PERSON_NOT_FOUND');
  }
  async function relationship(query: IdentifierReference, lock = false) {
    assertPersonUuid(query.personIdentifierId);
    let select = database.selectFrom('person_master.person_identifier').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId).where('person_identifier_id', '=', query.personIdentifierId);
    if (lock) select = select.forUpdate();
    const row = await select.executeTakeFirst();
    if (!row) throw new Error('PERSON_IDENTIFIER_NOT_FOUND');
    return row;
  }
  async function record(objectId: string, id: string, eventType: PersonAuditEventType,
    payload: Readonly<Record<string, unknown>>, versionId: string | null = null) {
    await audit.append({ governanceObjectId: objectId, aggregateType: 'PERSON_IDENTIFIER', aggregateId: id,
      aggregateVersionId: versionId, eventType, payload, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
  }
  async function recordVersion(row: VersionRow) {
    await record(row.governance_object_id, row.person_identifier_id, 'PERSON_IDENTIFIER_VERSION_CREATED', {
      personIdentifierId: row.person_identifier_id, personId: row.person_id, versionNo: row.version_no,
      assertionStatus: row.assertion_status,
    }, row.person_identifier_version_id);
  }
  async function effective(query: IdentifierReference & IdentifierTimes): Promise<PersonIdentifierVersion | null> {
    const row = await database.selectFrom('person_master.person_identifier_version').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId).where('person_identifier_id', '=', query.personIdentifierId)
      .where('recorded_from', '<=', query.recordAsOf).where('business_valid_from', '<=', query.businessAt)
      .where((eb) => eb.or([eb('business_valid_to', 'is', null), eb('business_valid_to', '>', query.businessAt)]))
      .orderBy('version_no', 'desc').executeTakeFirst();
    return row?.assertion_status === 'ASSERTED' ? toVersion(row) : null;
  }

  return {
    async registerPersonIdentifier(command) {
      validateIdentifierRegistration(command);
      assertPersonUuid(command.personId);
      await authorize(command.governanceObjectId, true);
      await requirePerson(command.governanceObjectId, command.personId);
      await sql`select pg_advisory_xact_lock(hashtextextended(${`person-identifier-create:${command.governanceObjectId}:${context.requestId}`}, 0))`.execute(database);
      const operationHash = canonicalSha256({ kind: 'REGISTER', businessValidFrom: command.businessValidFrom, businessValidTo: command.businessValidTo });
      const repeated = await database.selectFrom('person_master.person_identifier').selectAll()
        .where('governance_object_id', '=', command.governanceObjectId).where('creation_request_id', '=', context.requestId).executeTakeFirst();
      if (repeated) {
        const first = await database.selectFrom('person_master.person_identifier_version').selectAll()
          .where('person_identifier_id', '=', repeated.person_identifier_id).where('version_no', '=', '1').executeTakeFirstOrThrow();
        if (repeated.created_by !== context.actorPrincipalId || repeated.person_id !== command.personId ||
          repeated.identifier_system !== command.identifierSystem || repeated.identifier_value !== command.identifierValue ||
          !first.operation_hash.equals(operationHash)) throw new Error('PERSON_IDENTIFIER_OPERATION_CONFLICT');
        return { ok: true, version: toVersion(first) };
      }
      // PostgreSQL exact unique authority arbitrates independent concurrent registrations.
      const row = await database.insertInto('person_master.person_identifier').values({ person_id: command.personId,
        governance_object_id: command.governanceObjectId, identifier_system: command.identifierSystem,
        identifier_value: command.identifierValue, creation_request_id: context.requestId, created_by: context.actorPrincipalId,
      }).onConflict((conflict) => conflict.constraint('person_identifier_exact_unique').doNothing()).returningAll().executeTakeFirst();
      if (!row) {
        const existing = await database.selectFrom('person_master.person_identifier').select(['person_id', 'person_identifier_id'])
          .where('governance_object_id', '=', command.governanceObjectId).where('identifier_system', '=', command.identifierSystem)
          .where('identifier_value', '=', command.identifierValue).executeTakeFirstOrThrow();
        const code = existing.person_id === command.personId ? 'PERSON_IDENTIFIER_ALREADY_REGISTERED' : 'PERSON_IDENTIFIER_COLLISION';
        await record(command.governanceObjectId, existing.person_identifier_id, 'PERSON_IDENTIFIER_COLLISION_REJECTED', {
          personId: command.personId, personIdentifierId: existing.person_identifier_id, result: 'REJECTED', reason: code,
        });
        return { ok: false, code };
      }
      await record(command.governanceObjectId, row.person_identifier_id, 'PERSON_IDENTIFIER_REGISTERED', {
        personId: row.person_id, personIdentifierId: row.person_identifier_id,
      });
      const version = await database.insertInto('person_master.person_identifier_version').values({
        person_identifier_id: row.person_identifier_id, person_id: row.person_id, governance_object_id: row.governance_object_id,
        version_no: '1', assertion_status: 'ASSERTED', business_valid_from: command.businessValidFrom,
        business_valid_to: command.businessValidTo, created_by: context.actorPrincipalId, request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      await recordVersion(version);
      return { ok: true, version: toVersion(version) };
    },
    async createPersonIdentifierVersion(command) {
      assertClosedObject(command, ['governanceObjectId', 'personIdentifierId', 'assertionStatus', 'businessValidFrom', 'businessValidTo']);
      if (!['ASSERTED', 'RETRACTED'].includes(command.assertionStatus)) throw new Error('PERSON_IDENTIFIER_ASSERTION_INVALID');
      validateIdentifierPeriod(command);
      await authorize(command.governanceObjectId, true);
      const row = await relationship(command, true);
      const operationHash = canonicalSha256({ kind: 'VERSION', assertionStatus: command.assertionStatus,
        businessValidFrom: command.businessValidFrom, businessValidTo: command.businessValidTo });
      const repeated = await database.selectFrom('person_master.person_identifier_version').selectAll()
        .where('person_identifier_id', '=', row.person_identifier_id).where('request_id', '=', context.requestId).executeTakeFirst();
      if (repeated) {
        if (repeated.created_by !== context.actorPrincipalId || !repeated.operation_hash.equals(operationHash)) throw new Error('PERSON_IDENTIFIER_OPERATION_CONFLICT');
        return toVersion(repeated);
      }
      const previous = await database.selectFrom('person_master.person_identifier_version').select('version_no')
        .where('person_identifier_id', '=', row.person_identifier_id).orderBy('version_no', 'desc').executeTakeFirstOrThrow();
      const version = await database.insertInto('person_master.person_identifier_version').values({
        person_identifier_id: row.person_identifier_id, person_id: row.person_id, governance_object_id: row.governance_object_id,
        version_no: (BigInt(previous.version_no) + 1n).toString(), assertion_status: command.assertionStatus,
        business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo,
        created_by: context.actorPrincipalId, request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      await recordVersion(version);
      return toVersion(version);
    },
    async getPersonIdentifier(query) {
      assertClosedObject(query, ['governanceObjectId', 'personIdentifierId']);
      await authorize(query.governanceObjectId, false);
      const row = await relationship(query);
      await record(query.governanceObjectId, row.person_identifier_id, 'PERSON_IDENTIFIER_READ', { queryKind: 'RELATIONSHIP', personIdentifierId: row.person_identifier_id });
      return toIdentifier(row);
    },
    async listPersonIdentifiers(query) {
      assertClosedObject(query, ['governanceObjectId', 'personId']);
      await authorize(query.governanceObjectId, false);
      await requirePerson(query.governanceObjectId, query.personId);
      const rows = await database.selectFrom('person_master.person_identifier').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId).where('person_id', '=', query.personId).orderBy('person_identifier_id').execute();
      await record(query.governanceObjectId, query.personId, 'PERSON_IDENTIFIER_READ', { queryKind: 'PERSON_IDENTIFIERS', personId: query.personId, count: rows.length });
      return rows.map(toIdentifier);
    },
    async listPersonIdentifierVersions(query) {
      assertClosedObject(query, ['governanceObjectId', 'personIdentifierId']);
      await authorize(query.governanceObjectId, false);
      await relationship(query);
      const rows = await database.selectFrom('person_master.person_identifier_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId).where('person_identifier_id', '=', query.personIdentifierId).orderBy('version_no').execute();
      await record(query.governanceObjectId, query.personIdentifierId, 'PERSON_IDENTIFIER_READ', { queryKind: 'HISTORY', personIdentifierId: query.personIdentifierId });
      return rows.map(toVersion);
    },
    async findPersonIdentifierAsOf(query) {
      assertClosedObject(query, ['governanceObjectId', 'personIdentifierId', 'businessAt', 'recordAsOf']);
      validateIdentifierTimes(query);
      await authorize(query.governanceObjectId, false);
      await relationship(query);
      const result = await effective(query);
      await record(query.governanceObjectId, query.personIdentifierId, 'PERSON_IDENTIFIER_READ', { queryKind: 'AS_OF', result: result ? 'FOUND' : 'NOT_FOUND' });
      return result;
    },
    async findPersonByIdentifier(query) {
      assertClosedObject(query, ['governanceObjectId', 'identifierSystem', 'identifierValue', 'businessAt', 'recordAsOf']);
      validateIdentifierKey(query); validateIdentifierTimes(query);
      await authorize(query.governanceObjectId, false);
      const row = await database.selectFrom('person_master.person_identifier').select('person_identifier_id')
        .where('governance_object_id', '=', query.governanceObjectId).where('identifier_system', '=', query.identifierSystem)
        .where('identifier_value', '=', query.identifierValue).executeTakeFirst();
      const result = row ? await effective({ ...query, personIdentifierId: row.person_identifier_id }) : null;
      await record(query.governanceObjectId, row?.person_identifier_id ?? query.governanceObjectId,
        'PERSON_IDENTIFIER_LOOKUP', { queryKind: 'EXACT', result: result ? 'FOUND' : 'NOT_FOUND' });
      return result;
    },
  };
}

function toIdentifier(row: IdentifierRow): PersonIdentifier {
  return { personIdentifierId: row.person_identifier_id, personId: row.person_id, governanceObjectId: row.governance_object_id,
    identifierSystem: row.identifier_system, identifierValue: row.identifier_value, createdAt: row.created_at };
}
function toVersion(row: VersionRow): PersonIdentifierVersion {
  return { personIdentifierId: row.person_identifier_id, personId: row.person_id, governanceObjectId: row.governance_object_id,
    personIdentifierVersionId: row.person_identifier_version_id, versionNo: row.version_no,
    assertionStatus: row.assertion_status as PersonIdentifierVersion['assertionStatus'], businessValidFrom: row.business_valid_from,
    businessValidTo: row.business_valid_to, recordedFrom: row.recorded_from };
}
