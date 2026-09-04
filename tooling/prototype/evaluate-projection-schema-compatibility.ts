import assert from 'node:assert/strict';
import type { ProjectionContractRegistration } from '../../apps/governance-api/src/modules/release-distribution/index.js';
import { canonicalJson } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';

type Inclusion = boolean | null;
type SchemaObject = Record<string, unknown>;

function object(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasReferences(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasReferences);
  return object(value) && (Object.hasOwn(value, '$ref') || Object.hasOwn(value, '$dynamicRef')
    || Object.values(value).some(hasReferences));
}

// Conservative structural proof only: identical schemas and closed objects with
// unchanged property schemas. Other keyword/type/semantic changes need review.
// No payload sampling, coercion, version-number inference or runtime negotiation.
function includedIn(source: unknown, target: unknown): Inclusion {
  if (canonicalJson(source) === canonicalJson(target)) return true;
  if (!object(source) || !object(target)) return null;
  const supported = new Set(['type', 'properties', 'required', 'additionalProperties']);
  if ([source, target].some((schema) => schema['type'] !== 'object'
    || schema['additionalProperties'] !== false || !object(schema['properties'])
    || Object.keys(schema).some((key) => !supported.has(key)))) return null;
  const sourceProperties = source['properties'];
  const targetProperties = target['properties'];
  assert.ok(object(sourceProperties) && object(targetProperties));
  const sourceRequired = source['required'] ?? [];
  const targetRequired = target['required'] ?? [];
  if (!Array.isArray(sourceRequired) || !Array.isArray(targetRequired)
    || [...sourceRequired, ...targetRequired].some((key) => typeof key !== 'string')) return null;
  if (targetRequired.some((key) => !sourceRequired.includes(key))) return false;
  let result: Inclusion = true;
  for (const [key, property] of Object.entries(sourceProperties)) {
    if (!Object.hasOwn(targetProperties, key)) return false;
    const targetProperty = targetProperties[key];
    if (!object(property) || !object(targetProperty)) return null;
    const child = includedIn(property, targetProperty);
    if (child === false) return false;
    if (child === null) result = null;
  }
  return result;
}

/** Offline proposal analysis; never authorizes replacing a published version. */
export function evaluateProjectionSchemaCompatibility(
  published: ProjectionContractRegistration,
  proposed: ProjectionContractRegistration,
) {
  assert.equal(proposed.projectionType, published.projectionType, 'PROJECTION_EVOLUTION_TYPE_MISMATCH');
  assert.notEqual(proposed.schemaVersion, published.schemaVersion, 'PROJECTION_EVOLUTION_NEW_VERSION_REQUIRED');
  // Resolution contexts are deliberately outside this offline evaluator.
  const references = hasReferences(published.schema) || hasReferences(proposed.schema);
  const backwardCompatible = references ? null : includedIn(published.schema, proposed.schema);
  const forwardCompatible = references ? null : includedIn(proposed.schema, published.schema);
  const classification = backwardCompatible === null || forwardCompatible === null ? 'REQUIRES_REVIEW'
    : backwardCompatible && forwardCompatible ? 'FULLY_COMPATIBLE'
      : backwardCompatible ? 'BACKWARD_COMPATIBLE'
        : forwardCompatible ? 'FORWARD_COMPATIBLE' : 'BREAKING';
  return { projectionType: published.projectionType,
    oldVersion: published.schemaVersion, proposedVersion: proposed.schemaVersion,
    backwardCompatible, forwardCompatible, classification };
}
