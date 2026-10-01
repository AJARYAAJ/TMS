import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@/app/ui.store';
import { Ring } from '@/components/ui';
import { useCan } from '@/features/auth/session.store';
import { useFields } from '@/features/fields/api';
import { useProjects, useUsers } from '@/features/projects/api';
import { api } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Integration } from '@/types';

interface Step {
  id: string;
  label: string;
  done: boolean;
  go: () => void;
}

/** Home tile: a short, self-checking tour of the features that make Workora click. */
export function GetStarted() {
  const navigate = useNavigate();
  const { onboardingHidden, onboardingDone, hideOnboarding, setCommandPalette, setCreateProject } = useUiStore();
  const isAdmin = useCan('ADMIN');
  const { data: projects } = useProjects();
  const { data: users } = useUsers();
  const first = projects?.find((p) => p.status === 'ACTIVE');
  const { data: fields } = useFields(first?.id);
  const { data: integrations } = useQuery({ queryKey: qk.integrations, queryFn: () => api.get<Integration[]>('/integrations'), enabled: isAdmin && !onboardingHidden });
  if (onboardingHidden || !projects) return null;
  const did = (id: string) => onboardingDone.includes(id);
  const p = (sub: string) => () => navigate(first ? `/projects/${first.key}/${sub}` : '/projects');

  const steps: Step[] = [
    { id: 'project', label: 'Create a project', done: projects.length > 0, go: () => setCreateProject(true) },
    { id: 'task', label: 'Add your first task', done: projects.some((x) => x.taskCount > 0), go: p('list') },
    { id: 'board', label: 'Drag a card across the board', done: did('board'), go: p('board') },
    { id: 'team', label: 'Invite a teammate', done: (users?.length ?? 0) > 1, go: () => navigate(isAdmin ? '/admin' : '/teams') },
    { id: 'fields', label: 'Add a custom field', done: (fields?.length ?? 0) > 0, go: p('fields') },
    { id: 'palette', label: 'Open the command palette (Ctrl/⌘ K)', done: did('palette'), go: () => setCommandPalette(true) },
    { id: 'email', label: 'Choose your email notifications', done: did('email'), go: () => navigate('/settings') },
    ...(isAdmin ? [{ id: 'integrations', label: 'Connect Slack or GitHub', done: (integrations?.length ?? 0) > 0, go: () => navigate('/admin?tab=integrations') }] : []),
    { id: 'explore', label: 'Explore everything else', done: did('explore'), go: () => navigate('/explore') },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  return (
    <section className="tile span-2 get-started" aria-label="Get started">
      <div className="tile-head">
        <h2>Get started</h2>
        <button className="icon-btn" aria-label="Hide checklist" title="Hide (you can always use Explore)" onClick={() => hideOnboarding(true)}>
          <X size={14} />
        </button>
      </div>
      <div className="gs-body">
        <Ring value={(done / steps.length) * 100} size={70} label={`${done}/${steps.length}`} />
        <ol className="gs-steps">
          {steps.map((s) => (
            <li key={s.id} className={s.done ? 'done' : ''}>
              <button onClick={s.go} disabled={s.done}>
                <span className="gs-check">{s.done && <Check size={12} />}</span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
