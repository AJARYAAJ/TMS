import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Eye, FileText, PenLine, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Avatar, EmptyState, SkeletonRows, Spinner } from '@/components/ui';
import { useCan, useSession } from '@/features/auth/session.store';
import { useProjects } from '@/features/projects/api';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { api, ApiError } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Document } from '@/types';
import { renderMarkdown } from '@/utils/markdown';
import { timeAgo } from '@/utils/format';
import { useCreateDocument, useDeleteDocument, useDocument, useDocuments, useSaveDocument } from './api';

const ICONS = ['📄', '🚀', '💳', '📘', '🧭', '🧪', '🗺️', '📐', '💡', '✅'];

/** Docs & wiki. Mounted at /docs (all docs) and as a project tab. */
export default function DocsPage() {
  const { projectKey } = useParams();
  const [params, setParams] = useSearchParams();
  const selected = params.get('doc');
  const { data: docs, isLoading } = useDocuments(projectKey);
  const { data: projects } = useProjects();
  const create = useCreateDocument();
  const canEdit = useCan('MEMBER');
  const select = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('doc', id);
      else n.delete('doc');
      return n;
    });

  useEffect(() => {
    if (!selected && docs?.length) select(docs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, selected]);

  const projectName = (id: string | null) => (id ? projects?.find((p) => p.id === id)?.name : 'Workspace');

  return (
    <div className={`page ${projectKey ? '' : 'page-wide'}`}>
      {!projectKey && (
        <header className="page-head">
          <div>
            <span className="eyebrow">Knowledge</span>
            <h1 className="display-sm">Docs</h1>
          </div>
        </header>
      )}
      <div className="docs-layout">
        <aside className="docs-list tile">
          {canEdit && (
            <button
              className="btn btn-volt btn-block"
              disabled={create.isPending}
              onClick={() => create.mutate({ title: 'Untitled', projectId: projectKey, content: '' }, { onSuccess: (d) => select(d.id) })}
            >
              <Plus size={15} /> New doc
            </button>
          )}
          {isLoading ? (
            <SkeletonRows rows={4} />
          ) : !docs?.length ? (
            <p className="muted small" style={{ padding: 8 }}>
              No docs yet.
            </p>
          ) : (
            <ul>
              {docs.map((d) => (
                <li key={d.id}>
                  <button className={`doc-link${d.id === selected ? ' active' : ''}`} onClick={() => select(d.id)}>
                    <span className="doc-icon">{d.icon}</span>
                    <span className="doc-link-text">
                      <span className="ellipsis">{d.title}</span>
                      <span className="muted small ellipsis">
                        {!projectKey && `${projectName(d.projectId)} · `}
                        {timeAgo(d.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="doc-pane">
          {selected ? (
            <DocEditor key={selected} id={selected} canEdit={canEdit} onDeleted={() => select(null)} />
          ) : (
            <EmptyState icon={<FileText size={32} />} title="Pick or create a doc">
              Specs, meeting notes, runbooks — written in markdown, linked to tasks with keys like ECOM-12.
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

function DocEditor({ id, canEdit, onDeleted }: { id: string; canEdit: boolean; onDeleted: () => void }) {
  const { data: doc, isLoading } = useDocument(id);
  const save = useSaveDocument();
  const del = useDeleteDocument();
  const qc = useQueryClient();
  const me = useSession()!.user;
  const isAdmin = useCan('ADMIN');
  const openTask = useOpenTask();
  const [mode, setMode] = useState<'write' | 'read'>('read');
  const [draft, setDraft] = useState<{ title: string; content: string; icon: string } | null>(null);
  const [state, setState] = useState<SaveState>('saved');
  const version = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (doc && (!draft || state === 'saved')) {
      setDraft({ title: doc.title, content: doc.content, icon: doc.icon });
      version.current = doc.version;
      if (!doc.content && canEdit) setMode('write');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const persist = (next: { title: string; content: string; icon: string }) => {
    setState('saving');
    save.mutate(
      { id, version: version.current, ...next },
      {
        onSuccess: (d) => {
          version.current = d.version;
          setState((s) => (s === 'saving' ? 'saved' : s));
        },
        onError: (e) => setState(e instanceof ApiError && e.code === 'DOCUMENT_CONFLICT' ? 'conflict' : 'error'),
      },
    );
  };

  // Autosave 800ms after the last keystroke.
  const change = (patch: Partial<{ title: string; content: string; icon: string }>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(next), 800);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const html = useMemo(() => renderMarkdown(draft?.content ?? ''), [draft?.content]);

  if (isLoading || !doc || !draft) return <SkeletonRows rows={6} />;
  const canDelete = canEdit && (doc.author.id === me.id || isAdmin);

  return (
    <article className="doc tile">
      <header className="doc-toolbar">
        <div className="seg">
          <button className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')}>
            <Eye size={14} /> Read
          </button>
          {canEdit && (
            <button className={mode === 'write' ? 'active' : ''} onClick={() => setMode('write')}>
              <PenLine size={14} /> Write
            </button>
          )}
        </div>
        <span className={`save-state ss-${state}`} aria-live="polite">
          {state === 'saving' && (
            <>
              <Spinner size={10} /> Saving…
            </>
          )}
          {state === 'saved' && 'Saved'}
          {state === 'dirty' && 'Editing…'}
          {state === 'error' && "Couldn't save — retrying on next edit"}
        </span>
        <span className="muted small ml-auto">
          <Avatar user={doc.updatedBy} size={18} /> {doc.updatedBy.name} · {timeAgo(doc.updatedAt)} · v{doc.version}
        </span>
        {canDelete && (
          <button className="icon-btn danger" aria-label="Delete doc" onClick={() => confirm(`Delete “${doc.title}”?`) && del.mutate(id, { onSuccess: onDeleted })}>
            <Trash2 size={15} />
          </button>
        )}
      </header>
      {state === 'conflict' && (
        <div className="banner banner-warn">
          <AlertTriangle size={16} />
          Someone else saved a newer version while you were editing.
          <button
            className="btn btn-soft btn-sm"
            onClick={async () => {
              setState('saved');
              await qc.invalidateQueries({ queryKey: qk.document(id) });
            }}
          >
            Load theirs
          </button>
          <button
            className="btn btn-ink btn-sm"
            onClick={async () => {
              // Overwrite: rebase onto the latest version number, then save our draft.
              const latest = await api.get<Document>(`/documents/${id}`);
              version.current = latest.version;
              persist(draft);
            }}
          >
            Keep mine
          </button>
        </div>
      )}
      <div className="doc-title-row">
        <select className="doc-icon-select" value={draft.icon} disabled={!canEdit} onChange={(e) => change({ icon: e.target.value })} aria-label="Icon">
          {[...new Set([draft.icon, ...ICONS])].map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
        <input className="doc-title" value={draft.title} disabled={!canEdit} onChange={(e) => change({ title: e.target.value })} aria-label="Document title" />
      </div>
      {mode === 'write' && canEdit ? (
        <textarea
          className="doc-source"
          value={draft.content}
          onChange={(e) => change({ content: e.target.value })}
          placeholder={'# Heading\n\nWrite in markdown. **bold**, *italic*, `code`, - lists, - [ ] checklists, > quotes, and task keys like ECOM-12.'}
          aria-label="Document content"
        />
      ) : (
        <div
          className="md"
          dangerouslySetInnerHTML={{ __html: html || '<p class="muted">Empty doc.</p>' }}
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest('a.md-task') as HTMLAnchorElement | null;
            if (a) {
              e.preventDefault();
              openTask(a.dataset.task!);
            }
          }}
        />
      )}
    </article>
  );
}
