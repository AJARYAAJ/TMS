import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { ApiError } from '@/services/api/client';

/**
 * Server-state cache. Cached data renders instantly; stale data is revalidated in the
 * background (stale-while-revalidate) and the UI updates when fresh data arrives.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
