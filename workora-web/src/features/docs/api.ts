import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Document, DocumentSummary } from '@/types';

export const useDocuments = (projectId?: string) =>
  useQuery({ queryKey: qk.documents(projectId), queryFn: () => api.get<DocumentSummary[]>('/documents', projectId ? { projectId } : undefined) });

export const useDocument = (id: string | null) =>
  useQuery({ queryKey: qk.document(id ?? ''), queryFn: () => api.get<Document>(`/documents/${id}`), enabled: !!id, staleTime: 0 });

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { title: string; projectId?: string; icon?: string; content?: string }) => api.post<Document>('/documents', b),
    onSuccess: (d) => {
      qc.setQueryData(qk.document(d.id), d);
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useSaveDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: { id: string; version: number; title?: string; content?: string; icon?: string }) => api.patch<Document>(`/documents/${id}`, b),
    onSuccess: (d) => {
      qc.setQueryData(qk.document(d.id), d);
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}
