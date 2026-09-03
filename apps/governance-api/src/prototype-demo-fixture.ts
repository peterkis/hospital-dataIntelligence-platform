export const PROTOTYPE_DEMO_AUDIT_TARGET = 100;

export const PROTOTYPE_DEMO = {
  namespace: 'PV004-DEMO',
  organization: {
    organizationId: '40000000-0000-7000-8000-000000000400',
    displayName: 'HDI Demo Hospital',
  },
  campuses: [
    {
      campusId: '40000000-0000-7000-8000-000000000421',
      campusCode: 'PV004-DEMO-HEADQUARTERS',
      displayName: '总部院区',
    },
    {
      campusId: '40000000-0000-7000-8000-000000000422',
      campusCode: 'PV004-DEMO-HIGH-TECH',
      displayName: '高新院区',
    },
  ],
  chargeCatalog: {
    governanceObjectId: '40000000-0000-7000-8000-000000000401',
    objectCode: 'PV004-DEMO-CHARGE-CATALOG',
    displayName: '演示收费项目目录',
    catalogCode: 'PV004-DEMO-CHARGE-CATALOG',
  },
  chargeItems: [
    {
      internalCode: 'PV004-DEMO-CHARGE-001',
      formalName: 'CT平扫检查费',
      serviceDefinition: '合成演示用 CT 平扫检查服务收费定义',
      billingUnitCode: 'TIMES',
      chargingMethodCode: 'COUNT',
      businessValidFrom: '2026-09-01T00:00:00',
      times: ['2026-09-03T09:00:00', '2026-09-03T09:01:00', '2026-09-03T09:02:00', '2026-09-03T09:03:00', '2026-09-03T09:04:00'],
    },
    {
      internalCode: 'PV004-DEMO-CHARGE-002',
      formalName: 'MRI增强检查费',
      serviceDefinition: '合成演示用 MRI 增强检查服务收费定义',
      billingUnitCode: 'TIMES',
      chargingMethodCode: 'COUNT',
      businessValidFrom: '2026-09-01T00:00:00',
      times: ['2026-09-03T09:10:00', '2026-09-03T09:11:00', '2026-09-03T09:12:00', '2026-09-03T09:13:00', '2026-09-03T09:14:00'],
    },
    {
      internalCode: 'PV004-DEMO-CHARGE-003',
      formalName: '专家门诊诊查费',
      serviceDefinition: '合成演示用专家门诊诊查服务收费定义',
      billingUnitCode: 'TIMES',
      chargingMethodCode: 'COUNT',
      businessValidFrom: '2026-09-01T00:00:00',
      times: ['2026-09-03T09:20:00', '2026-09-03T09:21:00', '2026-09-03T09:22:00', '2026-09-03T09:23:00', '2026-09-03T09:24:00'],
    },
    {
      internalCode: 'PV004-DEMO-CHARGE-004',
      formalName: '护理等级服务费',
      serviceDefinition: '合成演示用护理等级服务收费定义',
      billingUnitCode: 'DAY',
      chargingMethodCode: 'COUNT',
      businessValidFrom: '2026-09-01T00:00:00',
      times: ['2026-09-03T09:30:00', '2026-09-03T09:31:00', '2026-09-03T09:32:00', '2026-09-03T09:33:00', '2026-09-03T09:34:00'],
    },
    {
      internalCode: 'PV004-DEMO-CHARGE-005',
      formalName: '床位费',
      serviceDefinition: '合成演示用床位服务收费定义',
      billingUnitCode: 'DAY',
      chargingMethodCode: 'COUNT',
      businessValidFrom: '2026-09-01T00:00:00',
      times: ['2026-09-03T09:40:00', '2026-09-03T09:41:00', '2026-09-03T09:42:00', '2026-09-03T09:43:00', '2026-09-03T09:44:00'],
    },
  ],
  priceLists: [
    {
      governanceObjectId: '40000000-0000-7000-8000-000000000411',
      objectCode: 'PV004-DEMO-PRICE-OUTPATIENT',
      priceListCode: 'PV004-DEMO-PRICE-OUTPATIENT',
      displayName: '门诊价格表',
      chargeItemIndex: 0,
      campusId: null,
      scopeLevel: 'HOSPITAL' as const,
      encounterMode: 'GENERAL' as const,
      encounterType: null,
      fixedUnitPrice: '12.34',
      businessValidFrom: '2026-09-01T00:00:00',
      times: ['2026-09-03T10:00:00', '2026-09-03T10:01:00', '2026-09-03T10:02:00', '2026-09-03T10:03:00'],
    },
    {
      governanceObjectId: '40000000-0000-7000-8000-000000000412',
      objectCode: 'PV004-DEMO-PRICE-INPATIENT',
      priceListCode: 'PV004-DEMO-PRICE-INPATIENT',
      displayName: '住院价格表',
      chargeItemIndex: 1,
      campusId: '40000000-0000-7000-8000-000000000422',
      scopeLevel: 'CAMPUS' as const,
      encounterMode: 'SPECIFIC' as const,
      encounterType: 'INPATIENT' as const,
      fixedUnitPrice: '560.00',
      businessValidFrom: '2026-09-02T00:00:00',
      times: ['2026-09-03T10:10:00', '2026-09-03T10:11:00', '2026-09-03T10:12:00', '2026-09-03T10:13:00', '2026-09-03T10:14:00'],
    },
    {
      governanceObjectId: '40000000-0000-7000-8000-000000000413',
      objectCode: 'PV004-DEMO-PRICE-INSURANCE',
      priceListCode: 'PV004-DEMO-PRICE-INSURANCE',
      displayName: '医保价格表',
      chargeItemIndex: 2,
      campusId: '40000000-0000-7000-8000-000000000421',
      scopeLevel: 'CAMPUS' as const,
      encounterMode: 'SPECIFIC' as const,
      encounterType: 'OUTPATIENT' as const,
      fixedUnitPrice: '35.00',
      businessValidFrom: '2026-09-03T00:00:00',
      times: ['2026-09-03T10:20:00', '2026-09-03T10:21:00', '2026-09-03T10:22:00', '2026-09-03T10:23:00', '2026-09-03T10:24:00'],
    },
  ],
  resolution: {
    requestId: 'PV004-DEMO-PRICE-EXPLANATION',
    occurredAt: '2026-09-03T10:40:00',
    serviceOccurredAt: '2026-09-03T10:39:00',
    recordAsOf: '2026-09-03T10:03:00',
    quantity: '2',
    encounterType: 'OUTPATIENT' as const,
  },
} as const;

export const PROTOTYPE_DEMO_GOVERNANCE_OBJECT_IDS = [
  PROTOTYPE_DEMO.chargeCatalog.governanceObjectId,
  ...PROTOTYPE_DEMO.priceLists.map((priceList) => priceList.governanceObjectId),
] as const;

export function assertSyntheticPrototypeDemoFixture(): void {
  const serialized = JSON.stringify(PROTOTYPE_DEMO);
  if (
    PROTOTYPE_DEMO.organization.displayName !== 'HDI Demo Hospital' ||
    !serialized.includes('PV004-DEMO') ||
    serialized.includes('某某市人民医院') ||
    serialized.includes('真实患者')
  ) {
    throw new Error('PROTOTYPE_DEMO_SYNTHETIC_BOUNDARY_VIOLATION');
  }
}
