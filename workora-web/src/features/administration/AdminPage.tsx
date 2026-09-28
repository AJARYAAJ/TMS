import { Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Avatar, SkeletonRows, Spinner } from '@/components/ui';
import { useCan, useSession } from '@/features/auth/session.store';
import { TeamsPanel } from '@/features/teams/TeamsPage';
import { IntegrationsPanel, LabelsPanel } from './ExtraPanels';
import { ApiError, errorMessage } from '@/services/api/client';
import type { Role } from '@/types';
import { formatDate } from '@/utils/format';
import { useAddMember, useMembers, useRemoveMember, useUpdateMember } from './api';

const ROLES: Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];

/** Administration module (lazy-loaded): members, roles (RBAC) and teams. */
export default function AdminPage() {
  const [tab, setTab] = useState<'members' | 'teams' | 'labels' | 'integrations'>('members');
  const session = useSession()!;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{session.organization.name}</span>
          <h1 className="display-sm">Admin</h1>
        </div>
      </header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>
          Members & roles
        </button>
        <button role="tab" aria-selected={tab === 'teams'} className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}>
          Teams
        </button>
        <button role="tab" aria-selected={tab === 'labels'} className={tab === 'labels' ? 'active' : ''} onClick={() => setTab('labels')}>
          Labels
        </button>
        <button role="tab" aria-selected={tab === 'integrations'} className={tab === 'integrations' ? 'active' : ''} onClick={() => setTab('integrations')}>
          Integrations
        </button>
      </div>
      {tab === 'members' ? <Members /> : tab === 'teams' ? <TeamsPanel /> : tab === 'labels' ? <LabelsPanel /> : <IntegrationsPanel />}
    </div>
  );
}

function Members() {
  const { data, isLoading } = useMembers();
  const me = useSession()!;
  const isOwner = useCan('OWNER');
  const update = useUpdateMember();
  const remove = useRemoveMember();

  return (
    <div className="admin-grid">
      <section className="tile">
        <h2>Members</h2>
        {isLoading ? (
          <SkeletonRows rows={4} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.map((m) => {
                const self = m.user.id === me.user.id;
                const locked = self || (m.role === 'OWNER' && !isOwner);
                return (
                  <tr key={m.user.id}>
                    <td>
                      <span className="with-icon">
                        <Avatar user={m.user} size={24} />
                        <span>
                          {m.user.name} {self && <span className="muted small">(you)</span>}
                          <br />
                          <span className="muted small">{m.user.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <select value={m.role} disabled={locked || update.isPending} onChange={(e) => update.mutate({ userId: m.user.id, role: e.target.value as Role })} aria-label={`Role for ${m.user.name}`}>
                        {ROLES.filter((r) => isOwner || r !== 'OWNER' || m.role === 'OWNER').map((r) => (
                          <option key={r} value={r}>
                            {r.charAt(0) + r.slice(1).toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="muted small">{formatDate(m.joinedAt, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                    <td>
                      {!locked && (
                        <button className="icon-btn danger" title="Remove member" onClick={() => confirm(`Remove ${m.user.name} from the organization?`) && remove.mutate(m.user.id)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <AddMember />
    </div>
  );
}

function AddMember() {
  const add = useAddMember();
  const isOwner = useCan('OWNER');
  const [form, setForm] = useState({ email: '', role: 'MEMBER' as Role, name: '', password: '' });
  const needsDetails = add.error instanceof ApiError && add.error.code === 'USER_DETAILS_REQUIRED';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(
      { email: form.email, role: form.role, name: form.name || undefined, password: form.password || undefined },
      { onSuccess: () => setForm({ email: '', role: 'MEMBER', name: '', password: '' }) },
    );
  };
  return (
    <section className="tile">
      <h2>Add member</h2>
      <form className="form" onSubmit={submit}>
        <label>
          Email
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label>
          Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.filter((r) => isOwner || r !== 'OWNER').map((r) => (
              <option key={r} value={r}>
                {r.charAt(0) + r.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        {(needsDetails || form.name || form.password) && (
          <>
            <p className="muted small">No account exists for this email yet — create one:</p>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Temporary password
              <input type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </label>
          </>
        )}
        {add.isError && !needsDetails && <div className="form-error">{errorMessage(add.error)}</div>}
        <button className="btn btn-primary" disabled={add.isPending}>
          {add.isPending ? <Spinner /> : 'Add member'}
        </button>
      </form>
    </section>
  );
}
