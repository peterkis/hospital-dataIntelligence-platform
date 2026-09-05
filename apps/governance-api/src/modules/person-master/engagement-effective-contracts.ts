import type { EngagementBusinessState, EngagementBusinessStateQuery } from './engagement-lifecycle-contracts.js';
import type { EngagementCategoryCode } from './engagement-policy-contracts.js';

export interface EngagementEffectiveContext extends EngagementBusinessStateQuery {
  readonly semanticRole: 'EFFECTIVE_ENGAGEMENT_CONTEXT';
  readonly personId: string;
  readonly authorityEngagementVersionId: string;
  readonly authorityVersionNo: string;
  readonly authorityRecordedFrom: string;
  readonly authoritativeBusinessValidFrom: string;
  readonly authoritativeBusinessValidTo: string | null;
  readonly isWithinBusinessPeriod: boolean;
  readonly businessState: EngagementBusinessState;
  readonly lastApplicableLifecycleEventId: string | null;
  readonly recordVisibleLifecycleSequence: string;
  readonly classification: {
    readonly engagementTypeCode: string;
    readonly engagementCategoryCode: EngagementCategoryCode;
    readonly engagementTypeVersionId: string;
    readonly engagementTypeVersionNo: string;
    readonly classifiedAt: string;
  } | null;
}

/** Read-only internal consumption port; no transaction, write or eligibility API. */
export interface EngagementEffectiveReader {
  getEngagementEffectiveAsOf(query: EngagementBusinessStateQuery): Promise<EngagementEffectiveContext>;
}
