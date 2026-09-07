import type { EngagementEffectiveContext } from './engagement-effective-contracts.js';
import type { EngagementBusinessState } from './engagement-lifecycle-contracts.js';

export interface EngagementEffectivePeriodQuery {
  readonly governanceObjectId: string;
  readonly engagementId: string;
  readonly requestedFrom: string;
  readonly requestedTo: string | null;
  readonly recordAsOf: string;
}
export interface EngagementStateSegment {
  readonly from: string;
  readonly to: string | null;
  readonly businessState: EngagementBusinessState;
  readonly lastApplicableLifecycleEventId: string | null;
  readonly lifecycleSequence: string;
}
export interface EngagementEffectivePeriodContext extends EngagementEffectivePeriodQuery {
  readonly semanticRole: 'EFFECTIVE_ENGAGEMENT_PERIOD_CONTEXT';
  readonly personId: string;
  readonly authorityEngagementVersionId: string;
  readonly authorityVersionNo: string;
  readonly authorityRecordedFrom: string;
  readonly authoritativeBusinessValidFrom: string;
  readonly authoritativeBusinessValidTo: string | null;
  readonly recordVisibleLifecycleSequence: string;
  readonly classification: EngagementEffectiveContext['classification'];
  readonly stateSegments: readonly EngagementStateSegment[];
}
export interface EngagementEffectivePeriodReader {
  getEngagementEffectivePeriodAsOf(query: EngagementEffectivePeriodQuery): Promise<EngagementEffectivePeriodContext>;
}
