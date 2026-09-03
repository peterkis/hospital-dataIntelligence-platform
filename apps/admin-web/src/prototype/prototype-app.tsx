import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, createBrowserRouter, RouterProvider } from 'react-router';
import {
  ChargeItemDraftPage,
  GovernanceOperationsPage,
  OverviewPage,
  PriceListDraftPage,
  VerticalSlicePage,
} from '../pages.js';
import type { PrototypeApi, PrototypeContext } from './prototype-api.js';
import { PrototypeBanner, RoleSwitcher } from './prototype-components.js';
import { PrototypeJourneyPage } from './prototype-journey-page.js';
import {
  DashboardPage,
  DomainExplorerPage,
  GovernanceFlowRail,
} from './prototype-demo-pages.js';
import {
  createInitialJourneyState,
  resetPrototypeJourney,
  savePrototypeJourneyState,
  type PrototypeJourneyState,
  type PrototypeRoleCode,
} from './prototype-state.js';

interface PrototypeRuntime {
  readonly api: PrototypeApi;
  readonly context: PrototypeContext;
  readonly state: PrototypeJourneyState;
  setState(updater: (state: PrototypeJourneyState) => PrototypeJourneyState): void;
  switchRole(role: PrototypeRoleCode): void;
  restart(): void;
}

const RuntimeContext = createContext<PrototypeRuntime | null>(null);

export function PrototypeApp({
  api,
  context,
  initialState,
}: {
  readonly api: PrototypeApi;
  readonly context: PrototypeContext;
  readonly initialState: PrototypeJourneyState;
}) {
  const [state, setState] = useState(initialState);
  const router = useMemo(() => createBrowserRouter(
    [
      {
        path: '/',
        Component: PrototypeLayout,
        children: [
          { index: true, Component: DashboardPage },
          { path: 'domains', Component: DomainExplorerPage },
          { path: 'journey', Component: PrototypeJourneyWithFlow },
          { path: 'advanced/overview', Component: OverviewPage },
          { path: 'advanced/vertical-slice', Component: PrototypeVerticalSlicePage },
          { path: 'advanced/charge-items', Component: ChargeItemDraftPage },
          { path: 'advanced/price-lists', Component: PriceListDraftPage },
          { path: 'advanced/operations', Component: GovernanceOperationsPage },
        ],
      },
    ],
    { basename: '/admin' },
  ), []);

  useEffect(() => {
    savePrototypeJourneyState(sessionStorage, state);
  }, [state]);

  const runtime = useMemo<PrototypeRuntime>(() => ({
    api,
    context,
    state,
    setState,
    switchRole(role) {
      api.setRole(role);
      setState((current) => ({ ...current, currentRole: role }));
    },
    restart() {
      resetPrototypeJourney(sessionStorage);
      api.setRole(null);
      setState(createInitialJourneyState());
    },
  }), [api, context, state]);

  return (
    <RuntimeContext.Provider value={runtime}>
      <RouterProvider router={router} />
    </RuntimeContext.Provider>
  );
}

export function usePrototypeRuntime(): PrototypeRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('PROTOTYPE_RUNTIME_MISSING');
  return runtime;
}

function PrototypeLayout() {
  const runtime = usePrototypeRuntime();
  return (
    <div className="prototype-shell">
      <PrototypeBanner />
      <header className="prototype-header">
        <div className="prototype-brand">
          <span className="prototype-brand-mark">HDI</span>
          <div>
            <strong>医院数据治理平台 Demo</strong>
            <small>HDI Demo Hospital · Synthetic Prototype</small>
          </div>
        </div>
        <nav aria-label="原型导航">
          <NavLink to="/" end>治理驾驶舱</NavLink>
          <NavLink to="/domains">主题域</NavLink>
          <NavLink to="/journey">治理流程</NavLink>
          <NavLink to="/advanced/overview">概览</NavLink>
          <NavLink to="/advanced/charge-items">收费项目</NavLink>
          <NavLink to="/advanced/price-lists">价表</NavLink>
          <NavLink to="/advanced/operations">治理操作</NavLink>
          <NavLink to="/advanced/vertical-slice">纵向切片</NavLink>
        </nav>
        <RoleSwitcher currentRole={runtime.state.currentRole} onChange={runtime.switchRole} />
      </header>
      <main className="prototype-content"><Outlet /></main>
    </div>
  );
}

function PrototypeVerticalSlicePage() {
  return <VerticalSlicePage routePrefix="/advanced" />;
}

function PrototypeJourneyWithFlow() {
  return <div className="governance-process-layout"><GovernanceFlowRail /><PrototypeJourneyPage /></div>;
}
