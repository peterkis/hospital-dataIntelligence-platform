import { describe, expect, it } from 'vitest';
import { DepartmentContractError } from '../../modules/department-master/index.js';
import { mapHttpError } from './map-http-error.js';

describe('HTTP error mapping', () => {
  it('maps a department status conflict before the generic invalid-request rule', () => {
    expect(mapHttpError(new DepartmentContractError('DEPARTMENT_STATUS_INVALID'))).toEqual({
      statusCode: 409,
      code: 'DEPARTMENT_STATUS_INVALID',
    });
  });

  it.each([
    ['DEPARTMENT_NOT_FOUND', 404],
    ['DEPARTMENT_VERSION_NOT_FOUND', 404],
    ['DEPARTMENT_PERMISSION_DENIED', 403],
    ['DEPARTMENT_APPROVAL_REQUIRED', 409],
    ['DEPARTMENT_CONTENT_CHANGED', 409],
    ['DEPARTMENT_EVOLUTION_RELATION_REQUIRED', 409],
  ] as const)('maps the exact department contract error %s to %s', (code, statusCode) => {
    expect(mapHttpError(new DepartmentContractError(code))).toEqual({ statusCode, code });
  });

  it('maps Fastify request validation failures to the stable request schema error', () => {
    const error = Object.assign(new Error('body/governanceObjectId must match format'), {
      validation: [{ keyword: 'format' }],
    });

    expect(mapHttpError(error)).toEqual({
      statusCode: 400,
      code: 'REQUEST_SCHEMA_INVALID',
    });
  });

  it.each([
    'PHASE_01_RUNTIME_NOT_CONFIGURED',
    'AUTHENTICATION_RUNTIME_NOT_CONFIGURED',
    'DEPARTMENT_RUNTIME_NOT_CONFIGURED',
  ])('maps an unavailable configured runtime to 503: %s', (code) => {
    expect(mapHttpError(new Error(code))).toEqual({ statusCode: 503, code });
  });

  it('preserves the prototype missing-principal mapping', () => {
    expect(mapHttpError(new Error('PROTOTYPE_PRINCIPAL_UNAUTHENTICATED'))).toEqual({
      statusCode: 401,
      code: 'PROTOTYPE_PRINCIPAL_UNAUTHENTICATED',
    });
  });

  it('preserves the prototype CSRF mapping', () => {
    expect(mapHttpError(new Error('PROTOTYPE_CSRF_FORBIDDEN'))).toEqual({
      statusCode: 403,
      code: 'PROTOTYPE_CSRF_FORBIDDEN',
    });
  });

  it.each([
    ['SERVICE_TOKEN_UNAUTHENTICATED', 401, 'SERVICE_TOKEN_UNAUTHENTICATED'],
    ['EXTERNAL_IDENTITY_UNBOUND', 401, 'EXTERNAL_IDENTITY_UNBOUND'],
    ['OBJECT_PERMISSION_FORBIDDEN', 403, 'OBJECT_PERMISSION_FORBIDDEN'],
    ['PRICE_LIST_APPROVAL_WORKFLOW_REQUIRED', 409, 'PRICE_LIST_APPROVAL_WORKFLOW_REQUIRED'],
    ['APPROVAL_STAGE_ORDER_CONFLICT', 409, 'APPROVAL_STAGE_ORDER_CONFLICT'],
    ['CHARGE_ITEM_NOT_FOUND', 404, 'CHARGE_ITEM_NOT_FOUND'],
    ['CONSUMER_EVENT_NOT_AVAILABLE', 404, 'CONSUMER_EVENT_NOT_AVAILABLE'],
    ['PRICE_LIST_RELEASE_CONFLICT', 409, 'PRICE_LIST_RELEASE_CONFLICT'],
    ['CONSUMER_CHECKPOINT_GAP', 409, 'CONSUMER_CHECKPOINT_GAP'],
    ['CHARGE_ITEM_DRAFT_IMMUTABLE', 409, 'CHARGE_ITEM_DRAFT_IMMUTABLE'],
    ['PRICE_ENTRY_SCOPE_INVALID', 400, 'PRICE_ENTRY_SCOPE_INVALID'],
    ['PRICE_LIST_GOVERNANCE_OBJECT_MISMATCH', 400, 'PRICE_LIST_GOVERNANCE_OBJECT_MISMATCH'],
    ['PRICE_LIST_ENTRIES_REQUIRED', 400, 'PRICE_LIST_ENTRIES_REQUIRED'],
  ] as const)(
    'preserves the exact public mapping for %s',
    (message, statusCode, code) => {
      expect(mapHttpError(new Error(message))).toEqual({ statusCode, code });
    },
  );

  it.each([
    [
      '23P01',
      'conflicting key violates exclusion constraint "private_price_period"',
      409,
      'EXCLUSION_CONSTRAINT_CONFLICT',
    ],
    [
      '23514',
      'new row violates check constraint "private_price_amount_check"',
      400,
      'CHECK_CONSTRAINT_INVALID',
    ],
  ] as const)(
    'sanitizes the raw database message for SQLSTATE %s',
    (databaseCode, message, statusCode, code) => {
      const error = Object.assign(new Error(message), {
        code: databaseCode,
        constraint: 'private_constraint_name',
        table: 'private_table_name',
        schema: 'private_schema_name',
        detail: 'private row contents',
      });

      expect(mapHttpError(error)).toEqual({ statusCode, code });
    },
  );

  it('does not recover a public-looking message from an unrecognized SQLSTATE', () => {
    const error = Object.assign(new Error('CHARGE_ITEM_NOT_FOUND'), {
      code: '42P01',
      table: 'private_table_name',
    });

    expect(mapHttpError(error)).toEqual({ statusCode: 500, code: 'INTERNAL_ERROR' });
  });

  it.each([
    'INTERNAL_PASSWORD_REQUIRED',
    'PRIVATE_RELATION_NOT_FOUND',
    'SECRET_STATE_CONFLICT',
    'HIDDEN_ROW_INVALID',
    'AUDIT_CURSOR_GAP',
    'PUBLISHED_SECRET_IMMUTABLE',
    'INTERNAL_ACTION_FORBIDDEN',
    'INTERNAL_PRINCIPAL_UNAUTHENTICATED',
    'toString',
  ])('sanitizes an unknown uppercase public-looking message: %s', (message) => {
    expect(mapHttpError(new Error(message))).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it.each([
    ['23505', 'duplicate key value', 409, 'UNIQUE_CONSTRAINT_CONFLICT'],
    ['23P01', 'PRICE_PERIOD_EXCLUSION_CONFLICT', 409, 'PRICE_PERIOD_EXCLUSION_CONFLICT'],
    ['55000', 'object not in prerequisite state', 409, 'IMMUTABLE_RECORD_CONFLICT'],
    ['23514', 'PRICE_ENTRY_CHECK_INVALID', 400, 'PRICE_ENTRY_CHECK_INVALID'],
  ] as const)(
    'preserves the database-code mapping for SQLSTATE %s',
    (databaseCode, message, statusCode, code) => {
      const error = Object.assign(new Error(message), { code: databaseCode });

      expect(mapHttpError(error)).toEqual({ statusCode, code });
    },
  );

  it.each([
    new Error('password=not-for-clients table=private_record'),
    { message: 'DEPARTMENT_NOT_FOUND' },
    'DEPARTMENT_NOT_FOUND',
  ])('sanitizes an unknown internal failure', (error) => {
    expect(mapHttpError(error)).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });
});
