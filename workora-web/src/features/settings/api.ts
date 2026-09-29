import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { EmailPreferences } from '@/types';

export const useEmailPrefs = () => useQuery({ queryKey: qk.emailPrefs, queryFn: () => api.get<EmailPreferences>('/email/preferences') });

/** Toggles apply instantly (optimistic) and roll back if the server refuses. */
export function useUpdateEmailPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { enabled?: boolean; categories?: Record<string, boolean> }) => api.patch<EmailPreferences>('/email/preferences', patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.emailPrefs });
      const before = qc.getQueryData<EmailPreferences>(qk.emailPrefs);
      if (before) qc.setQueryData<EmailPreferences>(qk.emailPrefs, { ...before, enabled: patch.enabled ?? before.enabled, categories: { ...before.categories, ...patch.categories } });
      return { before };
    },
    onError: (e, _p, ctx) => {
      if (ctx?.before) qc.setQueryData(qk.emailPrefs, ctx.before);
      toast.error(errorMessage(e));
    },
    onSuccess: (data) => qc.setQueryData(qk.emailPrefs, data),
  });
}
