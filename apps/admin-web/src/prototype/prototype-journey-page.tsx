import { useState } from 'react';
import { usePrototypeRuntime } from './prototype-app.js';
import {
  loadPrototypeContext,
  prototypeErrorPresentation,
  requireApiData,
} from './prototype-api.js';
import {
  ErrorNotice,
  LoadingButton,
  LocalTime,
  RequiredRole,
  ROLE_LABELS,
  StepCard,
  TechnicalDetails,
  WorkflowTimeline,
} from './prototype-components.js';
import {
  nextJourneyStep,
  buildResolutionTimes,
  roleCanPerform,
  type AuditEventState,
  type ChargeItemJourneyState,
  type JourneyStep,
  type PriceListJourneyState,
  type PrototypeJourneyState,
  type ResolutionJourneyState,
  type WorkflowActionState,
  type WorkflowState,
} from './prototype-state.js';

const OWNER = 'prototype-owner' as const;
const REVIEWER = 'prototype-reviewer' as const;
const FINAL_OWNER = 'prototype-final-owner' as const;

export function PrototypeJourneyPage() {
  const runtime = usePrototypeRuntime();
  const { api, context, state } = runtime;
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<{ readonly title: string; readonly detail: string } | null>(null);

  const run = (action: string, operation: () => Promise<void>) => {
    if (busyAction) return;
    setBusyAction(action);
    setError(null);
    void operation()
      .catch((failure: unknown) => setError(prototypeErrorPresentation(failure)))
      .finally(() => setBusyAction(null));
  };

  const update = (patch: Partial<PrototypeJourneyState>, completedStep?: JourneyStep) => {
    runtime.setState((current) => ({
      ...current,
      ...patch,
      ...(completedStep === current.currentStep
        ? { currentStep: nextJourneyStep(completedStep) }
        : {}),
    }));
  };

  const createChargeItem = async () => {
    const data = requireApiData(await api.client.POST('/v1/phase-01/charge-item-drafts', {
      params: { header: { 'x-csrf-token': context.csrfToken } },
      body: {
        governanceObjectId: context.fixture.chargeCatalogObjectId,
        internalCode: state.syntheticCode,
        formalName: '原型门诊诊查费',
        serviceDefinition: '用于数据治理原型验证的合成收费项目',
        billingUnitCode: 'TIMES',
        chargingMethodCode: 'COUNT',
        businessValidFrom: context.currentLocalDateTime,
        businessValidTo: null,
      },
    }));
    update({ chargeItem: chargeItemState(data) }, 1);
  };

  const submitChargeItem = async () => {
    const charge = requireChargeItem(state);
    const latestContext = await loadPrototypeContext();
    const request = requireApiData(await api.client.POST('/v1/phase-01/change-requests', {
      params: { header: { 'x-csrf-token': context.csrfToken } },
      body: {
        governanceObjectId: context.fixture.chargeCatalogObjectId,
        entityType: 'CHARGE_ITEM_VERSION',
        stableEntityId: charge.chargeItemId,
        entityVersionId: charge.chargeItemVersionId,
        changeKind: 'INITIAL_PUBLICATION',
        riskClassification: 'NORMAL',
        submittedContentDigest: charge.contentDigest,
        changeReason: '原型收费项目首次发布',
        campusId: null,
        frozenEvidence: { demonstration: 'PV-003-SYNTHETIC' },
      },
    }));
    update({
      chargeWorkflow: workflowState(request, [], latestContext.currentLocalDateTime),
    }, 2);
  };

  const reviewChargeItem = async () => {
    const charge = requireChargeItem(state);
    const workflow = requireWorkflow(state.chargeWorkflow);
    const result = requireApiData(await api.client.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: { 'x-csrf-token': context.csrfToken },
        path: { changeRequestId: workflow.changeRequestId },
      },
      body: {
        stageType: 'PROFESSIONAL_REVIEW',
        actionResult: 'APPROVED',
        reason: '专业审核确认合成收费项目内容',
        seenContentDigest: charge.contentDigest,
        campusId: null,
      },
    }));
    const latestContext = await loadPrototypeContext();
    update({
      chargeWorkflow: workflowAfterAction(
        workflow,
        result,
        'PROFESSIONAL_REVIEW',
        '专业审核确认合成收费项目内容',
        latestContext.currentLocalDateTime,
        REVIEWER,
      ),
    }, 3);
  };

  const publishChargeItem = async () => {
    const charge = requireChargeItem(state);
    const workflow = requireWorkflow(state.chargeWorkflow);
    const result = requireApiData(await api.client.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: { 'x-csrf-token': context.csrfToken },
        path: { changeRequestId: workflow.changeRequestId },
      },
      body: {
        stageType: 'OWNER_FINAL_APPROVAL',
        actionResult: 'APPROVED',
        reason: '终审负责人批准合成收费项目发布',
        seenContentDigest: charge.contentDigest,
        campusId: null,
      },
    }));
    const latestContext = await loadPrototypeContext();
    update({
      chargeWorkflow: workflowAfterAction(
        workflow,
        result,
        'OWNER_FINAL_APPROVAL',
        '终审负责人批准合成收费项目发布',
        latestContext.currentLocalDateTime,
        FINAL_OWNER,
      ),
    });
  };

  const readPublishedChargeItem = async () => {
    const charge = requireChargeItem(state);
    const published = requireApiData(await api.client.GET(
      '/v1/phase-01/charge-items/{chargeItemId}/versions/{chargeItemVersionId}',
      {
        params: {
          path: {
            chargeItemId: charge.chargeItemId,
            chargeItemVersionId: charge.chargeItemVersionId,
          },
          query: { governanceObjectId: context.fixture.chargeCatalogObjectId },
        },
      },
    ));
    update({ chargeItem: chargeItemState(published) }, 4);
  };

  const createPriceList = async () => {
    const charge = requirePublishedChargeItem(state);
    const latestContext = await loadPrototypeContext();
    const data = requireApiData(await api.client.POST('/v1/phase-01/price-list-drafts', {
      params: { header: { 'x-csrf-token': context.csrfToken } },
      body: {
        governanceObjectId: context.fixture.priceListObjectId,
        priceListCode: 'PROTOTYPE-SYNTHETIC-PRICE-LIST',
        displayName: '原型院内默认价表',
        currencyCode: 'CNY',
        businessValidFrom: latestContext.currentLocalDateTime,
        businessValidTo: null,
        entries: [{
          chargeItemId: charge.chargeItemId,
          chargeItemVersionId: charge.chargeItemVersionId,
          scopeLevel: 'HOSPITAL',
          campusId: null,
          encounterMode: 'GENERAL',
          encounterType: null,
          fixedUnitPrice: '12.34',
          billingUnitCode: 'TIMES',
          businessValidFrom: latestContext.currentLocalDateTime,
          businessValidTo: null,
          zeroPriceReason: null,
        }],
      },
    }));
    update({ priceList: priceListState(data) }, 5);
  };

  const submitPriceList = async () => {
    const priceList = requirePriceList(state);
    const latestContext = await loadPrototypeContext();
    const request = requireApiData(await api.client.POST('/v1/phase-01/change-requests', {
      params: { header: { 'x-csrf-token': context.csrfToken } },
      body: {
        governanceObjectId: context.fixture.priceListObjectId,
        entityType: 'PRICE_LIST_RELEASE',
        stableEntityId: priceList.priceListId,
        entityVersionId: priceList.priceListReleaseId,
        changeKind: 'INITIAL_PUBLICATION',
        riskClassification: 'HIGH',
        submittedContentDigest: priceList.contentDigest,
        changeReason: '原型院内默认价表首次发布',
        campusId: null,
        frozenEvidence: { demonstration: 'PV-003-SYNTHETIC' },
      },
    }));
    update({
      priceWorkflow: workflowState(request, [], latestContext.currentLocalDateTime),
    });
  };

  const reviewPriceList = async () => {
    const priceList = requirePriceList(state);
    const workflow = requireWorkflow(state.priceWorkflow);
    const result = requireApiData(await api.client.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: { 'x-csrf-token': context.csrfToken },
        path: { changeRequestId: workflow.changeRequestId },
      },
      body: {
        stageType: 'PROFESSIONAL_REVIEW',
        actionResult: 'APPROVED',
        reason: '专业审核确认价表范围和金额',
        seenContentDigest: priceList.contentDigest,
        campusId: null,
      },
    }));
    const latestContext = await loadPrototypeContext();
    update({
      priceWorkflow: workflowAfterAction(
        workflow,
        result,
        'PROFESSIONAL_REVIEW',
        '专业审核确认价表范围和金额',
        latestContext.currentLocalDateTime,
        REVIEWER,
      ),
    });
  };

  const publishPriceList = async () => {
    const priceList = requirePriceList(state);
    const workflow = requireWorkflow(state.priceWorkflow);
    const result = requireApiData(await api.client.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: { 'x-csrf-token': context.csrfToken },
        path: { changeRequestId: workflow.changeRequestId },
      },
      body: {
        stageType: 'OWNER_FINAL_APPROVAL',
        actionResult: 'APPROVED',
        reason: '终审负责人批准合成价表发布',
        seenContentDigest: priceList.contentDigest,
        campusId: null,
      },
    }));
    const latestContext = await loadPrototypeContext();
    update({
      priceWorkflow: workflowAfterAction(
        workflow,
        result,
        'OWNER_FINAL_APPROVAL',
        '终审负责人批准合成价表发布',
        latestContext.currentLocalDateTime,
        FINAL_OWNER,
      ),
    });
  };

  const readPublishedPriceList = async () => {
    const priceList = requirePriceList(state);
    const published = requireApiData(await api.client.GET(
      '/v1/phase-01/price-lists/{priceListId}/releases/{priceListReleaseId}',
      {
        params: {
          path: {
            priceListId: priceList.priceListId,
            priceListReleaseId: priceList.priceListReleaseId,
          },
          query: { governanceObjectId: context.fixture.priceListObjectId },
        },
      },
    ));
    update({ priceList: priceListState(published) }, 6);
  };

  const resolvePrice = async () => {
    const charge = requirePublishedChargeItem(state);
    const priceList = requirePublishedPriceList(state);
    const resolutionTimes = buildResolutionTimes(priceList);
    const data = requireApiData(await api.client.POST('/v1/phase-01/price-resolutions', {
      params: { header: { 'x-csrf-token': context.csrfToken } },
      body: {
        governanceObjectId: context.fixture.priceListObjectId,
        requestId: `PV003-RESOLUTION-${state.syntheticCode}`,
        chargeItemId: charge.chargeItemId,
        chargeItemVersionId: charge.chargeItemVersionId,
        priceListId: priceList.priceListId,
        campusId: context.fixture.campusId,
        encounterType: 'OUTPATIENT',
        serviceOccurredAt: resolutionTimes.serviceOccurredAt,
        recordAsOf: resolutionTimes.recordAsOf,
        quantity: '2',
      },
    }));
    const resolution: ResolutionJourneyState = {
      priceResolutionId: data.priceResolutionId,
      status: data.status,
      quantity: '2',
      unitPrice: '12.34',
      finalAmount: data.finalAmount,
      currencyCode: data.currencyCode,
      serviceOccurredAt: resolutionTimes.serviceOccurredAt,
      recordAsOf: resolutionTimes.recordAsOf,
      resultDigest: data.resultDigest,
      steps: data.steps.map((step) => ({
        stepNo: step.stepNo,
        scopeChecked: step.scopeChecked,
        encounterModeChecked: step.encounterModeChecked,
        candidateCount: step.candidateCount,
        decision: step.decision,
        explanationCode: step.explanationCode,
      })),
    };
    update({ resolution }, 7);
  };

  const loadHistoryAndAudit = async () => {
    const charge = requirePublishedChargeItem(state);
    const priceList = requirePublishedPriceList(state);
    const chargeWorkflow = requireWorkflow(state.chargeWorkflow);
    const priceWorkflow = requireWorkflow(state.priceWorkflow);
    const [
      historyResult,
      chargeAuditResult,
      priceAuditResult,
      resolutionAuditResult,
      refreshedCharge,
      refreshedPrice,
    ] = await Promise.all([
      api.client.GET('/v1/phase-01/charge-items/{chargeItemId}/versions', {
        params: {
          path: { chargeItemId: charge.chargeItemId },
          query: { governanceObjectId: context.fixture.chargeCatalogObjectId },
        },
      }),
      api.client.GET('/v1/phase-01/audit-events', {
        params: {
          query: {
            governanceObjectId: context.fixture.chargeCatalogObjectId,
            stableEntityId: charge.chargeItemId,
            limit: 50,
          },
        },
      }),
      api.client.GET('/v1/phase-01/audit-events', {
        params: {
          query: {
            governanceObjectId: context.fixture.priceListObjectId,
            stableEntityId: priceList.priceListId,
            entityVersionId: priceList.priceListReleaseId,
            limit: 50,
          },
        },
      }),
      api.client.GET('/v1/phase-01/audit-events', {
        params: {
          query: {
            governanceObjectId: context.fixture.priceListObjectId,
            stableEntityId: charge.chargeItemId,
            action: 'RESOLVED',
            limit: 10,
          },
        },
      }),
      readWorkflow(chargeWorkflow.changeRequestId),
      readWorkflow(priceWorkflow.changeRequestId),
    ]);
    const history = requireApiData(historyResult).versions.map(chargeItemState);
    const auditEvents = [
      ...requireApiData(chargeAuditResult).events,
      ...requireApiData(priceAuditResult).events,
      ...requireApiData(resolutionAuditResult).events,
    ].map<AuditEventState>((event) => ({
      auditEventId: event.auditEventId,
      auditSequence: event.auditSequence,
      action: event.action,
      entityType: event.entityType,
      occurredAt: event.occurredAt,
      actorPrincipalId: event.actorPrincipalId,
    }));
    update({
      chargeHistory: history,
      auditEvents,
      chargeWorkflow: { ...refreshedCharge, submittedAt: chargeWorkflow.submittedAt },
      priceWorkflow: { ...refreshedPrice, submittedAt: priceWorkflow.submittedAt },
      priceList,
    });
  };

  const readWorkflow = async (changeRequestId: string): Promise<WorkflowState> => {
    const detail = requireApiData(await api.client.GET('/v1/phase-01/change-requests/{changeRequestId}', {
      params: { path: { changeRequestId } },
    }));
    return workflowState(detail.request, detail.actions, '');
  };

  const status = (step: JourneyStep): 'complete' | 'current' | 'locked' => {
    if (step === 8 && state.auditEvents) return 'complete';
    if (state.currentStep > step) return 'complete';
    return state.currentStep === step ? 'current' : 'locked';
  };
  const hasChargeFinal = state.chargeWorkflow?.actions.some(
    (action) => action.stageType === 'OWNER_FINAL_APPROVAL',
  ) ?? false;
  const hasPriceReview = state.priceWorkflow?.actions.some((action) => action.stageType === 'PROFESSIONAL_REVIEW') ?? false;
  const hasPriceFinal = state.priceWorkflow?.actions.some((action) => action.stageType === 'OWNER_FINAL_APPROVAL') ?? false;

  return (
    <section className="journey-page">
      <header className="journey-hero">
        <div>
          <span className="prototype-kicker">PV-003 · GUIDED GOVERNANCE</span>
          <h1>收费项目与价表治理演示</h1>
          <p>按业务角色完成八步闭环。技术标识由系统自动衔接，无需复制 UUID 或摘要。</p>
        </div>
        <div className="journey-progress" aria-label={`当前步骤 ${state.currentStep}，共 8 步`}>
          <strong>{state.auditEvents ? 8 : state.currentStep}<small>/ 8</small></strong>
          <span>当前进度</span>
        </div>
      </header>
      <div className="journey-toolbar">
        <div><span>本次合成业务代码</span><strong>{state.syntheticCode}</strong></div>
        <button type="button" onClick={runtime.restart}>重新开始演示</button>
      </div>
      <ErrorNotice error={error} />

      <div className="journey-list">
        <StepCard number={1} title="创建收费项目草稿" summary="系统预填合成业务内容，并建立稳定身份与首个版本。" status={status(1)}>
          <div className="data-grid">
            <Datum label="收费项目代码" value={state.syntheticCode} />
            <Datum label="正式名称" value="原型门诊诊查费" />
            <Datum label="计价单位 / 计费方式" value="TIMES / COUNT" />
            <Datum label="业务生效时间" value={<LocalTime value={context.currentLocalDateTime} />} />
          </div>
          {state.chargeItem ? <ChargeSummary charge={state.chargeItem} /> : null}
          {state.currentStep === 1 ? <RequiredRole currentRole={state.currentRole} requiredRole={OWNER} onSwitch={runtime.switchRole} /> : null}
          <LoadingButton
            busy={busyAction === 'create-charge'}
            disabled={state.currentStep !== 1 || !roleCanPerform(state.currentRole, OWNER)}
            onClick={() => run('create-charge', createChargeItem)}
          >创建收费项目草稿</LoadingButton>
        </StepCard>

        <StepCard number={2} title="提交收费项目变更" summary="自动带入草稿稳定身份、版本和内容摘要，冻结待审批内容。" status={status(2)}>
          {state.chargeWorkflow ? <WorkflowSummary workflow={state.chargeWorkflow} nextRole="专业审核员" /> : <p className="empty-state">等待收费项目草稿。</p>}
          {state.currentStep === 2 ? <RequiredRole currentRole={state.currentRole} requiredRole={OWNER} onSwitch={runtime.switchRole} /> : null}
          <LoadingButton
            busy={busyAction === 'submit-charge'}
            disabled={state.currentStep !== 2 || !roleCanPerform(state.currentRole, OWNER)}
            onClick={() => run('submit-charge', submitChargeItem)}
          >提交收费项目变更</LoadingButton>
        </StepCard>

        <StepCard number={3} title="专业审核" summary="专业审核员核对冻结摘要，数据维护员不能代为审批。" status={status(3)}>
          {state.chargeWorkflow ? <WorkflowTimeline actions={state.chargeWorkflow.actions} /> : null}
          {state.currentStep === 3 ? <RequiredRole currentRole={state.currentRole} requiredRole={REVIEWER} onSwitch={runtime.switchRole} /> : null}
          <LoadingButton
            busy={busyAction === 'review-charge'}
            disabled={state.currentStep !== 3 || !roleCanPerform(state.currentRole, REVIEWER)}
            onClick={() => run('review-charge', reviewChargeItem)}
          >确认专业审核</LoadingButton>
        </StepCard>

        <StepCard number={4} title="终审并发布收费项目" summary="终审负责人完成最终批准，平台在同一治理流程中自动发布。" status={status(4)}>
          {state.chargeItem?.governanceStatus === 'PUBLISHED'
            ? <PublishedCharge charge={state.chargeItem} />
            : hasChargeFinal
              ? <p className="empty-state">终审与发布事务已完成，请由数据维护员读取发布结果。</p>
              : <p className="empty-state">等待终审发布。</p>}
          {state.currentStep === 4 && !hasChargeFinal ? (
            <>
              <RequiredRole currentRole={state.currentRole} requiredRole={FINAL_OWNER} onSwitch={runtime.switchRole} />
              <LoadingButton
                busy={busyAction === 'publish-charge'}
                disabled={!roleCanPerform(state.currentRole, FINAL_OWNER)}
                onClick={() => run('publish-charge', publishChargeItem)}
              >终审并发布收费项目</LoadingButton>
            </>
          ) : state.currentStep === 4 && state.chargeItem?.governanceStatus !== 'PUBLISHED' ? (
            <>
              <RequiredRole currentRole={state.currentRole} requiredRole={OWNER} onSwitch={runtime.switchRole} />
              <LoadingButton
                busy={busyAction === 'read-charge'}
                disabled={!roleCanPerform(state.currentRole, OWNER)}
                onClick={() => run('read-charge', readPublishedChargeItem)}
              >读取收费项目发布结果</LoadingButton>
            </>
          ) : null}
        </StepCard>

        <StepCard number={5} title="创建价表草稿" summary="自动引用已发布收费项目版本，建立 12.34 CNY 的全院通用价格。" status={status(5)}>
          <div className="data-grid">
            <Datum label="价表名称" value="原型院内默认价表" />
            <Datum label="单价 × 数量" value="12.34 × 2" />
            <Datum label="范围 / 场景" value="全院 / 通用" />
            <Datum label="币种" value="CNY" />
          </div>
          {state.priceList ? <PriceListSummary priceList={state.priceList} /> : null}
          {state.currentStep === 5 ? <RequiredRole currentRole={state.currentRole} requiredRole={OWNER} onSwitch={runtime.switchRole} /> : null}
          <LoadingButton
            busy={busyAction === 'create-price'}
            disabled={state.currentStep !== 5 || !roleCanPerform(state.currentRole, OWNER)}
            onClick={() => run('create-price', createPriceList)}
          >创建价表草稿</LoadingButton>
        </StepCard>

        <StepCard number={6} title="价表提交、专业审核和终审发布" summary="三种身份依次完成高风险价表审批，不允许跨角色代办。" status={status(6)}>
          <div className="substage-grid">
            <Substage number="6A" label="数据维护员提交" done={Boolean(state.priceWorkflow)} />
            <Substage number="6B" label="专业审核员审核" done={hasPriceReview} />
            <Substage number="6C" label="终审负责人发布" done={hasPriceFinal} />
          </div>
          {state.priceWorkflow ? <WorkflowTimeline actions={state.priceWorkflow.actions} /> : null}
          {state.priceList?.governanceStatus === 'PUBLISHED' ? (
            <PriceListSummary priceList={state.priceList} />
          ) : state.currentStep !== 6 ? null : !state.priceWorkflow ? (
            <>
              <RequiredRole currentRole={state.currentRole} requiredRole={OWNER} onSwitch={runtime.switchRole} />
              <LoadingButton busy={busyAction === 'submit-price'} disabled={state.currentStep !== 6 || state.currentRole !== OWNER} onClick={() => run('submit-price', submitPriceList)}>提交价表变更</LoadingButton>
            </>
          ) : !hasPriceReview ? (
            <>
              <RequiredRole currentRole={state.currentRole} requiredRole={REVIEWER} onSwitch={runtime.switchRole} />
              <LoadingButton busy={busyAction === 'review-price'} disabled={state.currentStep !== 6 || state.currentRole !== REVIEWER} onClick={() => run('review-price', reviewPriceList)}>确认价表专业审核</LoadingButton>
            </>
          ) : !hasPriceFinal ? (
            <>
              <RequiredRole currentRole={state.currentRole} requiredRole={FINAL_OWNER} onSwitch={runtime.switchRole} />
              <LoadingButton busy={busyAction === 'publish-price'} disabled={state.currentStep !== 6 || state.currentRole !== FINAL_OWNER} onClick={() => run('publish-price', publishPriceList)}>终审并发布价表</LoadingButton>
            </>
          ) : state.priceList?.governanceStatus !== 'PUBLISHED' ? (
            <>
              <p className="empty-state">终审与发布事务已完成，请由数据维护员读取价表发布结果。</p>
              <RequiredRole currentRole={state.currentRole} requiredRole={OWNER} onSwitch={runtime.switchRole} />
              <LoadingButton busy={busyAction === 'read-price'} disabled={state.currentRole !== OWNER} onClick={() => run('read-price', readPublishedPriceList)}>读取价表发布结果</LoadingButton>
            </>
          ) : null}
        </StepCard>

        <StepCard number={7} title="价格解析" summary="以价表发布返回的 recordedFrom 重放记录视点，执行固定四级匹配。" status={status(7)}>
          {state.resolution ? <ResolutionSummary resolution={state.resolution} /> : <ResolutionPath />}
          {state.currentStep === 7 ? <RequiredRole currentRole={state.currentRole} requiredRole={OWNER} onSwitch={runtime.switchRole} /> : null}
          <LoadingButton
            busy={busyAction === 'resolve-price'}
            disabled={state.currentStep !== 7 || !roleCanPerform(state.currentRole, OWNER)}
            onClick={() => run('resolve-price', resolvePrice)}
          >解析 2 次服务价格</LoadingButton>
        </StepCard>

        <StepCard number={8} title="历史与审计" summary="汇总不可变版本、审批时间线、价格解析证据与流内审计序号。" status={status(8)}>
          {state.auditEvents ? <HistoryAudit state={state} /> : <p className="empty-state">读取服务端权威历史与审计证据。</p>}
          {state.currentStep === 8 && !state.auditEvents ? <RequiredRole currentRole={state.currentRole} requiredRole={OWNER} onSwitch={runtime.switchRole} /> : null}
          <LoadingButton
            busy={busyAction === 'history-audit'}
            disabled={state.currentStep !== 8 || !roleCanPerform(state.currentRole, OWNER)}
            onClick={() => run('history-audit', loadHistoryAndAudit)}
          >读取历史与审计</LoadingButton>
        </StepCard>
      </div>
    </section>
  );
}

function Datum({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
  return <div className="datum"><span>{label}</span><strong>{value}</strong></div>;
}

function ChargeSummary({ charge }: { readonly charge: ChargeItemJourneyState }) {
  return (
    <div className="result-card">
      <span className="result-state">状态：{charge.governanceStatus}</span>
      <h3>{charge.formalName}</h3>
      <div className="data-grid compact">
        <Datum label="版本号" value={charge.versionNo} />
        <Datum label="内容摘要" value={`${charge.contentDigest.slice(0, 12)}…`} />
      </div>
      <TechnicalDetails><code>{charge.chargeItemId}</code><code>{charge.chargeItemVersionId}</code><code>{charge.contentDigest}</code></TechnicalDetails>
    </div>
  );
}

function WorkflowSummary({ workflow, nextRole }: { readonly workflow: WorkflowState; readonly nextRole: string }) {
  return (
    <div className="result-card">
      <span className="result-state">变更请求：{workflow.requestStatus}</span>
      <div className="data-grid compact">
        <Datum label="当前审批阶段" value="专业复核" />
        <Datum label="提交人" value="数据维护员" />
        <Datum label="提交时间" value={<LocalTime value={workflow.submittedAt} />} />
        <Datum label="下一所需角色" value={nextRole} />
      </div>
      <TechnicalDetails><code>{workflow.changeRequestId}</code><code>{workflow.submittedBy}</code></TechnicalDetails>
    </div>
  );
}

function PublishedCharge({ charge }: { readonly charge: ChargeItemJourneyState }) {
  return (
    <div className="published-card">
      <span>已发布</span><strong>PUBLISHED</strong>
      <div className="data-grid compact">
        <Datum label="发布版本" value={charge.versionNo} />
        <Datum label="平台记录时间" value={<LocalTime value={charge.recordedFrom} />} />
        <Datum label="业务生效时间" value={<LocalTime value={charge.businessValidFrom} />} />
      </div>
      <TechnicalDetails><code>releaseId: {charge.releaseId}</code></TechnicalDetails>
    </div>
  );
}

function PriceListSummary({ priceList }: { readonly priceList: PriceListJourneyState }) {
  return (
    <div className="result-card">
      <span className="result-state">价表状态：{priceList.governanceStatus}</span>
      <h3>{priceList.displayName}</h3>
      <div className="data-grid compact">
        <Datum label="版本号" value={priceList.releaseNo} />
        <Datum label="条目数" value={String(priceList.entryCount)} />
        <Datum label="内容摘要" value={`${priceList.contentDigest.slice(0, 12)}…`} />
        <Datum label="平台记录时间" value={<LocalTime value={priceList.recordedFrom} />} />
      </div>
      <TechnicalDetails><code>{priceList.priceListId}</code><code>{priceList.priceListReleaseId}</code><code>{priceList.contentDigest}</code></TechnicalDetails>
    </div>
  );
}

const PATH_LEVELS = [
  ['CAMPUS', 'SPECIFIC', '院区专用'],
  ['CAMPUS', 'GENERAL', '院区通用'],
  ['HOSPITAL', 'SPECIFIC', '全院专用'],
  ['HOSPITAL', 'GENERAL', '全院通用'],
] as const;

function ResolutionPath({ resolution }: { readonly resolution?: ResolutionJourneyState }) {
  return (
    <ol className="resolution-path">
      {PATH_LEVELS.map(([scope, mode, label], index) => {
        const evidence = resolution?.steps.find((step) => step.scopeChecked === scope && step.encounterModeChecked === mode);
        const matched = evidence?.decision === 'MATCHED';
        return (
          <li className={matched ? 'matched' : ''} key={label}>
            <span>{index + 1}</span>
            <div><strong>{label}</strong><small>{matched ? '实际命中层级' : evidence ? `结果：${evidence.decision}` : '按顺序检查'}</small></div>
          </li>
        );
      })}
    </ol>
  );
}

function ResolutionSummary({ resolution }: { readonly resolution: ResolutionJourneyState }) {
  return (
    <div className="resolution-result">
      <div><span>解析结果</span><strong>{resolution.finalAmount} {resolution.currencyCode}</strong><small>{resolution.quantity} × {resolution.unitPrice} = {resolution.finalAmount}</small></div>
      <ResolutionPath resolution={resolution} />
      <div className="data-grid compact">
        <Datum label="服务发生时间" value={<LocalTime value={resolution.serviceOccurredAt} />} />
        <Datum label="记录视点" value={<LocalTime value={resolution.recordAsOf} />} />
      </div>
      <TechnicalDetails><code>{resolution.priceResolutionId}</code><code>{resolution.resultDigest}</code></TechnicalDetails>
    </div>
  );
}

function Substage({ number, label, done }: { readonly number: string; readonly label: string; readonly done: boolean }) {
  return <div className={done ? 'substage done' : 'substage'}><span>{done ? '✓' : number}</span><strong>{label}</strong><small>{done ? '已完成' : '待处理'}</small></div>;
}

function HistoryAudit({ state }: { readonly state: PrototypeJourneyState }) {
  return (
    <div className="history-audit">
      <section>
        <h3>收费项目版本历史</h3>
        <ul>{state.chargeHistory?.map((version) => <li key={version.chargeItemVersionId}><strong>版本 {version.versionNo}</strong><span>{version.governanceStatus}</span><LocalTime value={version.recordedFrom} /></li>)}</ul>
      </section>
      <section>
        <h3>审批时间线</h3>
        <WorkflowTimeline actions={[...(state.chargeWorkflow?.actions ?? []), ...(state.priceWorkflow?.actions ?? [])]} />
      </section>
      <section>
        <h3>价表与价格解析</h3>
        <p>{state.priceList?.governanceStatus} · 版本 {state.priceList?.releaseNo} · {state.priceList?.entryCount} 条目</p>
        <p>{state.resolution?.finalAmount} {state.resolution?.currencyCode}</p>
      </section>
      <section>
        <h3>审计事件</h3>
        <ol className="audit-list">{state.auditEvents?.map((event) => <li key={event.auditEventId}><span>序号 {event.auditSequence}</span><strong>{event.action}</strong><LocalTime value={event.occurredAt} /><TechnicalDetails><code>{event.auditEventId}</code><code>{event.actorPrincipalId}</code></TechnicalDetails></li>)}</ol>
      </section>
    </div>
  );
}

function chargeItemState(data: {
  readonly chargeItemId: string;
  readonly chargeItemVersionId: string;
  readonly internalCode: string;
  readonly formalName: string;
  readonly versionNo: string;
  readonly governanceStatus: string;
  readonly businessValidFrom: string;
  readonly contentDigest: string;
  readonly releaseId: string | null;
  readonly recordedFrom: string;
}): ChargeItemJourneyState {
  return { ...data };
}

function priceListState(data: {
  readonly priceListId: string;
  readonly priceListReleaseId: string;
  readonly displayName: string;
  readonly releaseNo: string;
  readonly governanceStatus: string;
  readonly businessValidFrom: string;
  readonly contentDigest: string;
  readonly governanceReleaseId: string | null;
  readonly recordedFrom: string;
  readonly entries: readonly unknown[];
}): PriceListJourneyState {
  return {
    priceListId: data.priceListId,
    priceListReleaseId: data.priceListReleaseId,
    displayName: data.displayName,
    releaseNo: data.releaseNo,
    governanceStatus: data.governanceStatus,
    businessValidFrom: data.businessValidFrom,
    contentDigest: data.contentDigest,
    governanceReleaseId: data.governanceReleaseId,
    recordedFrom: data.recordedFrom,
    entryCount: data.entries.length,
  };
}

function workflowState(
  request: {
    readonly changeRequestId: string;
    readonly requestStatus: string;
    readonly nextActionSequence: string;
    readonly submittedBy: string;
  },
  actions: readonly WorkflowActionState[],
  submittedAt: string,
): WorkflowState {
  return {
    changeRequestId: request.changeRequestId,
    requestStatus: request.requestStatus,
    nextActionSequence: request.nextActionSequence,
    submittedBy: request.submittedBy,
    submittedAt,
    actions: actions.map((action) => ({
      actionResult: action.actionResult,
      actionSequence: action.actionSequence,
      actorPrincipalId: action.actorPrincipalId,
      occurredAt: action.occurredAt,
      reason: action.reason,
      stageType: action.stageType,
    })),
  };
}

function workflowAfterAction(
  workflow: WorkflowState,
  request: {
    readonly requestStatus: string;
    readonly nextActionSequence: string;
  },
  stageType: string,
  reason: string,
  occurredAt: string,
  actorRole: string,
): WorkflowState {
  return {
    ...workflow,
    requestStatus: request.requestStatus,
    nextActionSequence: request.nextActionSequence,
    actions: [...workflow.actions, {
      actionResult: 'APPROVED',
      actionSequence: workflow.nextActionSequence,
      actorPrincipalId: actorRole,
      occurredAt,
      reason,
      stageType,
    }],
  };
}

function requireChargeItem(state: PrototypeJourneyState): ChargeItemJourneyState {
  if (!state.chargeItem) throw new Error('PROTOTYPE_CHARGE_ITEM_STATE_MISSING');
  return state.chargeItem;
}

function requirePublishedChargeItem(state: PrototypeJourneyState): ChargeItemJourneyState {
  const charge = requireChargeItem(state);
  if (charge.governanceStatus !== 'PUBLISHED' || !charge.releaseId) {
    throw new Error('PROTOTYPE_CHARGE_ITEM_NOT_PUBLISHED');
  }
  return charge;
}

function requirePriceList(state: PrototypeJourneyState): PriceListJourneyState {
  if (!state.priceList) throw new Error('PROTOTYPE_PRICE_LIST_STATE_MISSING');
  return state.priceList;
}

function requirePublishedPriceList(state: PrototypeJourneyState): PriceListJourneyState {
  const priceList = requirePriceList(state);
  if (priceList.governanceStatus !== 'PUBLISHED' || !priceList.governanceReleaseId) {
    throw new Error('PROTOTYPE_PRICE_LIST_NOT_PUBLISHED');
  }
  return priceList;
}

function requireWorkflow(workflow: WorkflowState | undefined): WorkflowState {
  if (!workflow) throw new Error('PROTOTYPE_WORKFLOW_STATE_MISSING');
  return workflow;
}
