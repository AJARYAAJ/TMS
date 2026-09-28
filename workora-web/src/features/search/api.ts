import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { config } from '@/config';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { SearchResults } from '@/types';

/** Debounced global search: waits for typing to pause, then issues a single request. */
export function useSearch(input: string) {
  const q = useDebouncedValue(input.trim(), config.searchDebounceMs);
  const query = useQuery({
    queryKey: qk.search(q),
    queryFn: () => api.get<SearchResults>('/search', { q, limit: 5 }),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  return { ...query, debouncedQuery: q, pending: input.trim() !== q };
}
