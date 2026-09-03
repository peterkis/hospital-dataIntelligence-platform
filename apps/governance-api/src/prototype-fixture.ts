export const PROTOTYPE_FIXTURE = {
  actorPrincipalId: '70000000-0000-7000-8000-000000000001',
  reviewerPrincipalId: '70000000-0000-7000-8000-000000000002',
  approverPrincipalId: '70000000-0000-7000-8000-000000000003',
  campusId: '70000000-0000-7000-8000-000000000004',
  chargeCatalogObjectId: '70000000-0000-7000-8000-000000000005',
  priceListObjectId: '70000000-0000-7000-8000-000000000006',
} as const;

export const PROTOTYPE_PRINCIPALS = [
  {
    headerCode: 'prototype-owner',
    principalCode: 'PROTOTYPE-SYNTHETIC-STEWARD',
    principalId: PROTOTYPE_FIXTURE.actorPrincipalId,
  },
  {
    headerCode: 'prototype-reviewer',
    principalCode: 'PROTOTYPE-SYNTHETIC-PROFESSIONAL-REVIEWER',
    principalId: PROTOTYPE_FIXTURE.reviewerPrincipalId,
  },
  {
    headerCode: 'prototype-final-owner',
    principalCode: 'PROTOTYPE-SYNTHETIC-OWNER-APPROVER',
    principalId: PROTOTYPE_FIXTURE.approverPrincipalId,
  },
] as const;
