import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setLocale } from '@telocc/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from './lib/api.ts';
import { AppRoutes } from './routes.tsx';
import './index.css';

// ER-EMG-3 / decisions.md #1: Czech readers get the (partial) cs dictionary, with a
// per-key fallback to en — everyone else is unaffected. `navigator.language` is the
// boring browser-native signal; no server negotiation, no stored user preference.
setLocale(navigator.language?.toLowerCase().startsWith('cs') ? 'cs' : 'en');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry auth/permission/not-found responses (default TanStack Query
      // retry-with-backoff would otherwise delay the `/login` and `/onboarding`
      // redirects in route-guards.tsx by several seconds on every 401).
      retry: (failureCount, error) => {
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return false;
        return failureCount < 2;
      },
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('main.tsx: #root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
