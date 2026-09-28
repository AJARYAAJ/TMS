import { Plus, Trash2, Users, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Avatar, EmptyState, SkeletonRows } from '@/components/ui';
import { useTeamMutations, useTeams } from '@/features/administration/api';
import { useCan } from '@/features/auth/session.store';
import { useUsers } from '@/features/projects/api';

export function TeamsPanel() {
  const { data: teams, isLoading } = useTeams();
  const { data: users } = useUsers();
  const canAdmin = useCan('ADMIN');
  const m = useTeamMutations();
  const [name, setName] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) m.create.mutate({ name: name.trim() }, { onSuccess: () => setName('') });
  };

  return (
    <>
      {canAdmin && (
        <form className="inline-form" onSubmit={submit} style={{ marginBottom: 16 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New team name" aria-label="New team name" />
          <button className="btn btn-primary btn-sm" disabled={m.create.isPending}>
            <Plus size={14} /> Create team
          </button>
        </form>
      )}
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : !teams?.length ? (
        <EmptyState icon={<Users size={28} />} title="No teams yet">
          Teams group people who work together.
        </EmptyState>
      ) : (
        <div className="project-grid">
          {teams.map((t) => (
            <div key={t.id} className="tile">
              <div className="card-header">
                <h2>{t.name}</h2>
                {canAdmin && (
                  <button className="icon-btn danger" title="Delete team" onClick={() => confirm(`Delete team ${t.name}?`) && m.remove.mutate(t.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {t.description && <p className="muted small">{t.description}</p>}
              <ul className="member-list">
                {t.members.map((u) => (
                  <li key={u.id}>
                    <Avatar user={u} size={22} /> {u.name}
                    {canAdmin && (
                      <button className="icon-btn ml-auto" title="Remove from team" onClick={() => m.removeMember.mutate({ teamId: t.id, userId: u.id })}>
                        <X size={12} />
                      </button>
                    )}
                  </li>
                ))}
                {!t.members.length && <li className="muted small">No members</li>}
              </ul>
              {canAdmin && (
                <select value="" onChange={(e) => e.target.value && m.addMember.mutate({ teamId: t.id, userId: e.target.value })} aria-label={`Add member to ${t.name}`}>
                  <option value="">Add member…</option>
                  {users
                    ?.filter((u) => !t.members.some((x) => x.id === u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function TeamsPage() {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">People</span>
          <h1 className="display-sm">Teams</h1>
        </div>
      </header>
      <TeamsPanel />
    </div>
  );
}
