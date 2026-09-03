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
          { index: true, Component: PrototypeJourneyPage },
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
            <strong>收费与价表治理原型</strong>
            <small>医院信息科内部演示工作台</small>
          </div>
        </div>
        <nav aria-label="原型导航">
          <NavLink to="/" end>引导式旅程</NavLink>
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
