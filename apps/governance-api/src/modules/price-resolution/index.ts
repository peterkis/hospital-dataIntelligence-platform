import { Decimal } from 'decimal.js';
import type { Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import {
  canonicalSha256,
  digestHex,
} from '../../platform/hashing/canonical-hash.js';
import type {
  EncounterType,
  PriceListModule,
  PublishedPriceCandidate,
} from '../price-list/index.js';

export const PRICE_RESOLUTION_MODULE_ID = 'price-resolution' as const;

export interface ResolutionStepEvidence {
  readonly stepNo: string;
  readonly scopeChecked: 'CAMPUS' | 'HOSPITAL';
  readonly encounterModeChecked: 'SPECIFIC' | 'GENERAL';
  readonly candidateCount: number;
  readonly decision: 'MATCHED' | 'NO_CANDIDATE' | 'CONFLICT' | 'SUSPENDED';
  readonly priceEntryId: string | null;
  readonly candidateSetHash: Buffer;
  readonly explanationCode: string;
}

export interface PriceResolutionOutcome {
  readonly priceResolutionId: string;
  readonly requestId: string;
  readonly status: 'SUCCEEDED' | 'NO_PRICE' | 'CONFLICT' | 'SUSPENDED';
  readonly priceListReleaseId: string | null;
  readonly steps: readonly ResolutionStepEvidence[];
  readonly result: null | {
    readonly priceEntryId: string;
    readonly matchedScopeLevel: 'CAMPUS' | 'HOSPITAL';
    readonly matchedEncounterMode: 'SPECIFIC' | 'GENERAL';
    readonly unitPrice: string;
    readonly quantity: string;
    readonly amountBeforeRounding: string;
    readonly finalAmount: string;
    readonly currencyCode: string;
    readonly resultHash: Buffer;
  };
}

export interface PriceResolutionModule {
  resolve(command: {
    readonly requestId: string;
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
    readonly priceListId: string;
    readonly campusId: string;
    readonly encounterType: EncounterType;
    readonly serviceOccurredAt: string;
    readonly recordAsOf: string;
    readonly quantity: string;
    readonly resolvedAt: string;
  }): Promise<PriceResolutionOutcome>;
}

export function createPriceResolutionModule(
  database: Kysely<DB>,
  priceList: PriceListModule,
): PriceResolutionModule {
  return {
    async resolve(command) {
      const normalizedQuantity = normalizeQuantity(command.quantity);
      const requestHash = canonicalSha256({
        campusId: command.campusId,
        chargeItemId: command.chargeItemId,
        chargeItemVersionId: command.chargeItemVersionId,
        encounterType: command.encounterType,
        priceListId: command.priceListId,
        quantity: normalizedQuantity,
        recordAsOf: command.recordAsOf,
        requestId: command.requestId,
        serviceOccurredAt: command.serviceOccurredAt,
      });
      const existing = await database
        .selectFrom('price_resolution.price_resolution')
        .select(['price_resolution_id', 'request_hash'])
        .where('request_id', '=', command.requestId)
        .executeTakeFirst();
      if (existing) {
        if (!existing.request_hash.equals(requestHash)) throw new Error('PRICE_RESOLUTION_IDEMPOTENCY_CONFLICT');
        return loadOutcome(database, existing.price_resolution_id, command.requestId);
      }

      const view = await priceList.getPublishedView({
        priceListId: command.priceListId,
        pricedObjectId: command.chargeItemId,
        serviceOccurredAt: command.serviceOccurredAt,
        recordAsOf: command.recordAsOf,
      });
      const evaluation = evaluateCandidates(
        view.candidates,
        command.campusId,
        command.encounterType,
        view.selectionStatus,
      );
      const inputContextHash = canonicalSha256({
        campusId: command.campusId,
        chargeItemId: command.chargeItemId,
        chargeItemVersionId: command.chargeItemVersionId,
        encounterType: command.encounterType,
        quantity: normalizedQuantity,
      });

      const resolution = await database
        .insertInto('price_resolution.price_resolution')
        .values({
          request_id: command.requestId,
          request_hash: requestHash,
          priced_object_id: command.chargeItemId,
          price_list_id: command.priceListId,
          price_list_release_id: view.priceListReleaseId,
          published_view_hash: view.publishedViewHash,
          campus_id: command.campusId,
          encounter_type: command.encounterType,
          service_occurred_at: command.serviceOccurredAt,
          record_as_of: command.recordAsOf,
          resolution_status: evaluation.status,
          resolved_at: command.resolvedAt,
          input_context_hash: inputContextHash,
        })
        .returning('price_resolution_id')
        .executeTakeFirstOrThrow();
      await database
        .insertInto('price_resolution.price_resolution_charge_item_target')
        .values({
          price_resolution_id: resolution.price_resolution_id,
          charge_item_id: command.chargeItemId,
          charge_item_version_id: command.chargeItemVersionId,
        })
        .execute();

      for (const step of evaluation.steps) {
        await database
          .insertInto('price_resolution.price_resolution_step')
          .values({
            price_resolution_id: resolution.price_resolution_id,
            step_no: step.stepNo,
            scope_checked: step.scopeChecked,
            encounter_mode_checked: step.encounterModeChecked,
            candidate_count: step.candidateCount,
            decision: step.decision,
            price_entry_id: step.priceEntryId,
            candidate_set_hash: step.candidateSetHash,
            explanation_code: step.explanationCode,
          })
          .execute();
      }

      let result: PriceResolutionOutcome['result'] = null;
      if (evaluation.match) {
        if (!view.priceListReleaseId || !view.priceListReleaseHash) {
          throw new Error('PRICE_RESOLUTION_RELEASE_EVIDENCE_MISSING');
        }
        const unitPrice = new Decimal(evaluation.match.fixedUnitPrice);
        const quantity = new Decimal(normalizedQuantity);
        const amountBeforeRounding = unitPrice.mul(quantity).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
        const finalAmount = amountBeforeRounding.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        const resultEvidence = {
          currencyCode: evaluation.match.currencyCode,
          finalAmount: finalAmount.toFixed(4),
          matchedEncounterMode: evaluation.match.encounterMode,
          matchedScopeLevel: evaluation.match.scopeLevel,
          priceEntryId: evaluation.match.priceEntryId,
          priceEntryHash: digestHex(evaluation.match.contentHash),
          priceListReleaseHash: digestHex(view.priceListReleaseHash),
          priceListReleaseId: view.priceListReleaseId,
          quantity: quantity.toFixed(6),
          unitPrice: unitPrice.toFixed(4),
          amountBeforeRounding: amountBeforeRounding.toFixed(6),
        };
        const resultHash = canonicalSha256(resultEvidence);
        await database
          .insertInto('price_resolution.price_resolution_result')
          .values({
            price_resolution_id: resolution.price_resolution_id,
            price_entry_id: evaluation.match.priceEntryId,
            price_list_release_id: view.priceListReleaseId,
            price_list_release_hash: view.priceListReleaseHash,
            price_entry_hash: evaluation.match.contentHash,
            matched_scope_level: evaluation.match.scopeLevel,
            matched_encounter_mode: evaluation.match.encounterMode,
            unit_price: resultEvidence.unitPrice,
            quantity: resultEvidence.quantity,
            amount_before_rounding: resultEvidence.amountBeforeRounding,
            final_amount: resultEvidence.finalAmount,
            currency_code: evaluation.match.currencyCode,
            result_hash: resultHash,
          })
          .execute();
        result = {
          priceEntryId: evaluation.match.priceEntryId,
          matchedScopeLevel: evaluation.match.scopeLevel,
          matchedEncounterMode: evaluation.match.encounterMode,
          unitPrice: resultEvidence.unitPrice,
          quantity: resultEvidence.quantity,
          amountBeforeRounding: resultEvidence.amountBeforeRounding,
          finalAmount: resultEvidence.finalAmount,
          currencyCode: evaluation.match.currencyCode,
          resultHash,
        };
      }

      return {
        priceResolutionId: resolution.price_resolution_id,
        requestId: command.requestId,
        status: evaluation.status,
        priceListReleaseId: view.priceListReleaseId,
        steps: evaluation.steps,
        result,
      };
    },
  };
}

function evaluateCandidates(
  candidates: readonly PublishedPriceCandidate[],
  campusId: string,
  encounterType: EncounterType,
  selectionStatus: 'SELECTED' | 'NO_RELEASE' | 'SUSPENDED',
): {
  readonly status: PriceResolutionOutcome['status'];
  readonly steps: readonly ResolutionStepEvidence[];
  readonly match: PublishedPriceCandidate | null;
} {
  if (selectionStatus === 'SUSPENDED') {
    return {
      status: 'SUSPENDED',
      match: null,
      steps: [makeStep('1', 'CAMPUS', 'SPECIFIC', [], 'SUSPENDED')],
    };
  }
  if (selectionStatus === 'NO_RELEASE') {
    return {
      status: 'NO_PRICE',
      match: null,
      steps: [makeStep('1', 'CAMPUS', 'SPECIFIC', [], 'NO_CANDIDATE')],
    };
  }

  const steps: ResolutionStepEvidence[] = [];
  const passes: readonly {
    scope: 'CAMPUS' | 'HOSPITAL';
    mode: 'SPECIFIC' | 'GENERAL';
  }[] = [
    { scope: 'CAMPUS', mode: 'SPECIFIC' },
    { scope: 'CAMPUS', mode: 'GENERAL' },
    { scope: 'HOSPITAL', mode: 'SPECIFIC' },
    { scope: 'HOSPITAL', mode: 'GENERAL' },
  ];
  for (const [index, pass] of passes.entries()) {
    const matches = candidates.filter((candidate) => {
      const scopeMatches =
        pass.scope === 'CAMPUS'
          ? candidate.scopeLevel === 'CAMPUS' && candidate.campusId === campusId
          : candidate.scopeLevel === 'HOSPITAL';
      const modeMatches =
        pass.mode === 'SPECIFIC'
          ? candidate.encounterMode === 'SPECIFIC' && candidate.encounterType === encounterType
          : candidate.encounterMode === 'GENERAL';
      return scopeMatches && modeMatches;
    });
    if (matches.length > 1) {
      steps.push(makeStep((index + 1).toString(), pass.scope, pass.mode, matches, 'CONFLICT'));
      return { status: 'CONFLICT', steps, match: null };
    }
    const match = matches[0];
    if (match) {
      steps.push(makeStep((index + 1).toString(), pass.scope, pass.mode, matches, 'MATCHED'));
      return { status: 'SUCCEEDED', steps, match };
    }
    steps.push(makeStep((index + 1).toString(), pass.scope, pass.mode, matches, 'NO_CANDIDATE'));
  }
  return { status: 'NO_PRICE', steps, match: null };
}

function makeStep(
  stepNo: string,
  scope: 'CAMPUS' | 'HOSPITAL',
  mode: 'SPECIFIC' | 'GENERAL',
  candidates: readonly PublishedPriceCandidate[],
  decision: ResolutionStepEvidence['decision'],
): ResolutionStepEvidence {
  return {
    stepNo,
    scopeChecked: scope,
    encounterModeChecked: mode,
    candidateCount: candidates.length,
    decision,
    priceEntryId: decision === 'MATCHED' ? (candidates[0]?.priceEntryId ?? null) : null,
    candidateSetHash: canonicalSha256(
      candidates.map((candidate) => ({
        contentHash: digestHex(candidate.contentHash),
        entryNo: candidate.entryNo,
        priceEntryId: candidate.priceEntryId,
      })),
    ),
    explanationCode: `PRICE_${scope}_${mode}_${decision}`,
  };
}

async function loadOutcome(
  database: Kysely<DB>,
  priceResolutionId: string,
  requestId: string,
): Promise<PriceResolutionOutcome> {
  const resolution = await database
    .selectFrom('price_resolution.price_resolution')
    .select(['resolution_status', 'price_list_release_id'])
    .where('price_resolution_id', '=', priceResolutionId)
    .executeTakeFirstOrThrow();
  const steps = await database
    .selectFrom('price_resolution.price_resolution_step')
    .select([
      'step_no as stepNo',
      'scope_checked as scopeChecked',
      'encounter_mode_checked as encounterModeChecked',
      'candidate_count as candidateCount',
      'decision',
      'price_entry_id as priceEntryId',
      'candidate_set_hash as candidateSetHash',
      'explanation_code as explanationCode',
    ])
    .where('price_resolution_id', '=', priceResolutionId)
    .orderBy('step_no', 'asc')
    .execute();
  const row = await database
    .selectFrom('price_resolution.price_resolution_result')
    .select([
      'price_entry_id as priceEntryId',
      'matched_scope_level as matchedScopeLevel',
      'matched_encounter_mode as matchedEncounterMode',
      'unit_price as unitPrice',
      'quantity',
      'amount_before_rounding as amountBeforeRounding',
      'final_amount as finalAmount',
      'currency_code as currencyCode',
      'result_hash as resultHash',
    ])
    .where('price_resolution_id', '=', priceResolutionId)
    .executeTakeFirst();
  return {
    priceResolutionId,
    requestId,
    status: resolution.resolution_status as PriceResolutionOutcome['status'],
    priceListReleaseId: resolution.price_list_release_id,
    steps: steps.map((step) => ({
      ...step,
      scopeChecked: step.scopeChecked as 'CAMPUS' | 'HOSPITAL',
      encounterModeChecked: step.encounterModeChecked as 'SPECIFIC' | 'GENERAL',
      decision: step.decision as ResolutionStepEvidence['decision'],
    })),
    result: row
      ? {
          ...row,
          matchedScopeLevel: row.matchedScopeLevel as 'CAMPUS' | 'HOSPITAL',
          matchedEncounterMode: row.matchedEncounterMode as 'SPECIFIC' | 'GENERAL',
        }
      : null,
  };
}

function normalizeQuantity(value: string): string {
  const quantity = new Decimal(value);
  if (!quantity.isFinite() || quantity.lte(0) || quantity.decimalPlaces() > 6) {
    throw new Error('PRICE_QUANTITY_INVALID');
  }
  return quantity.toFixed(6);
}
