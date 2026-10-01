import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { CustomField, FieldType } from '@/types';

export const useFields = (projectId: string | undefined) =>
  useQuery({ queryKey: qk.fields(projectId ?? ''), queryFn: () => api.get<CustomField[]>(`/projects/${projectId}/fields`), enabled: !!projectId, staleTime: 60_000 });

export interface FieldInput {
  name?: string;
  type?: FieldType;
  options?: { id?: string; label: string; color?: string }[];
  required?: boolean;
  showInList?: boolean;
  position?: number;
}

/** Field definitions change rarely; every mutation returns the project's full field list. */
export function useFieldMutations(projectId: string) {
  const qc = useQueryClient();
  const set = (fields: CustomField[]) => qc.setQueryData(qk.fields(projectId), fields);
  const onError = (e: unknown) => toast.error(errorMessage(e));
  const refreshTasks = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  return {
    create: useMutation({ mutationFn: (f: FieldInput) => api.post<CustomField[]>(`/projects/${projectId}/fields`, f), onSuccess: set, onError }),
    update: useMutation({
      mutationFn: ({ id, ...f }: FieldInput & { id: string }) => api.patch<CustomField[]>(`/fields/${id}`, f),
      onSuccess: (d) => {
        set(d);
        refreshTasks();
      },
      onError,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete<CustomField[]>(`/fields/${id}`),
      onSuccess: (d) => {
        set(d);
        refreshTasks();
      },
      onError,
    }),
  };
}

export const FIELD_TYPES: { type: FieldType; label: string; hint: string }[] = [
  { type: 'TEXT', label: 'Text', hint: 'Short text, e.g. customer name' },
  { type: 'NUMBER', label: 'Number', hint: 'Revenue, effort, score…' },
  { type: 'SELECT', label: 'Dropdown', hint: 'One option from a list' },
  { type: 'MULTI_SELECT', label: 'Tags', hint: 'Several options from a list' },
  { type: 'DATE', label: 'Date', hint: 'Go-live, renewal…' },
  { type: 'CHECKBOX', label: 'Checkbox', hint: 'Yes / no' },
  { type: 'URL', label: 'Link', hint: 'Spec, design, ticket…' },
  { type: 'PERSON', label: 'Person', hint: 'Reviewer, owner…' },
];
