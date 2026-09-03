import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import {
  AppLayout,
  ChargeItemDraftPage,
  configureBrowserApi,
  GovernanceOperationsPage,
  OverviewPage,
  PriceListDraftPage,
  VerticalSlicePage,
} from './pages.js';
import './styles.css';

export async function bootstrapFormal(): Promise<void> {
  const sessionResponse = await fetch('/auth/session', {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  if (sessionResponse.status === 401) {
    window.location.assign(`/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
    await new Promise<never>(() => undefined);
  }
  if (!sessionResponse.ok) throw new Error('BROWSER_SESSION_BOOTSTRAP_FAILED');
  const session = (await sessionResponse.json()) as { readonly csrfToken?: unknown };
  if (typeof session.csrfToken !== 'string') throw new Error('BROWSER_CSRF_TOKEN_MISSING');
  configureBrowserApi(session.csrfToken);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const router = createBrowserRouter(
    [
      {
        path: '/',
        Component: AppLayout,
        children: [
          { index: true, Component: OverviewPage },
          { path: 'vertical-slice', Component: VerticalSlicePage },
          { path: 'charge-items', Component: ChargeItemDraftPage },
          { path: 'price-lists', Component: PriceListDraftPage },
          { path: 'operations', Component: GovernanceOperationsPage },
        ],
      },
    ],
    { basename: '/admin' },
  );
  const root = document.getElementById('root');
  if (!root) throw new Error('ADMIN_ROOT_NOT_FOUND');

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
