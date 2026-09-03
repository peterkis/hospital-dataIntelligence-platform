import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configureBrowserApi } from './pages.js';
import { PrototypeApp } from './prototype/prototype-app.js';
import { createPrototypeApi, loadPrototypeContext } from './prototype/prototype-api.js';
import { loadPrototypeJourneyState } from './prototype/prototype-state.js';
import './styles.css';
import './prototype/prototype-styles.css';

export async function bootstrapPrototype(): Promise<void> {
  document.title = '医院数据治理平台 Demo | HDI';
  const context = await loadPrototypeContext();
  const api = createPrototypeApi(context);
  const initialState = loadPrototypeJourneyState(sessionStorage);
  api.setRole(initialState.currentRole);
  configureBrowserApi(context.csrfToken, api.fetch);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const root = document.getElementById('root');
  if (!root) throw new Error('ADMIN_ROOT_NOT_FOUND');
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <PrototypeApp api={api} context={context} initialState={initialState} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
