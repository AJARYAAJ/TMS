import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wand2, X, Zap } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/session.store';
import { useProjectContext } from '@/features/projects/ProjectLayout';
import { useUsers } from '@/features/projects/api';
import { useLabels } from '@/features/tasks/api';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import { Automation, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from '@/types';
import { PRIORITY_LABEL, STATUS_LABEL, timeAgo, TYPE_LABEL } from '@/utils/format';

type Action = Automation['actions'][number];

const TRIGGERS: Record<string, string> = {
  TASK_CREATED: 'a task is created',
  STATUS_CHANGED: 'status changes',
  PRIORITY_CHANGED: 'priority changes',
  ASSIGNED: 'a task is assigned',
  COMMENT_ADDED: 'someone comments',
  TASK_OVERDUE: 'a task becomes overdue',
};

const ACTIONS: Record<string, string> = {
  SET_STATUS: 'Set status',
  SET_PRIORITY: 'Set priority',
  ASSIGN: 'Assign to',
  ASSIGN_REPORTER: 'Assign to reporter',
  UNASSIGN: 'Unassign',
  ADD_LABEL: 'Add label',
  MOVE_TO_ACTIVE_SPRINT: 'Move to active sprint',
  MOVE_TO_BACKLOG: 'Move to backlog',
  ADD_COMMENT: 'Add comment',
  NOTIFY: 'Notify',
};

const RECIPES: { name: string; trigger: Automation['trigger']; conditions?: Automation['conditions']; actions: Action[] }[] = [
  { name: 'Celebrate finished work', trigger: { event: 'STATUS_CHANGED', to: 'DONE' }, actions: [{ type: 'ADD_COMMENT', body: 'Shipped ✅ {task.key}' }] },
  { name: 'Urgent → notify watchers', trigger: { event: 'PRIORITY_CHANGED', to: 'URGENT' }, actions: [{ type: 'NOTIFY', target: 'WATCHERS', message: '🔥 {task.key} is now urgent' }, { type: 'MOVE_TO_ACTIVE_SPRINT' }] },
  { name: 'Overdue → escalate', trigger: { event: 'TASK_OVERDUE' }, actions: [{ type: 'SET_PRIORITY', priority: 'HIGH' }, { type: 'NOTIFY', target: 'REPORTER', message: '{task.key} slipped past its due date' }] },
  { name: 'Work started → into sprint', trigger: { event: 'STATUS_CHANGED', to: 'IN_PROGRESS' }, actions: [{ type: 'MOVE_TO_ACTIVE_SPRINT' }] },
];

export default function AutomationsView() {
  const project = useProjectContext();
  const qc = useQueryClient();
  const isAdmin = useCan('ADMIN');
  const { data, isLoading } = useQuery({ queryKey: qk.automations(project.id), queryFn: () => api.get<Automation[]>(`/projects/${project.id}/automations`) });
  const refresh = () => qc.invalidateQueries({ queryKey: qk.automations(project.id) });
  const create = useMutation({
    mutationFn: (b: Omit<Automation, 'id' | 'projectId' | 'runCount' | 'lastRunAt' | 'enabled' | 'conditions'> & { conditions?: Automation['conditions'] }) =>
      api.post<Automation>(`/projects/${project.id}/automations`, b),
    onSuccess: (a) => {
      refresh();
      toast.success(`Automation “${a.name}” is live`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({ mutationFn: ({ id, ...b }: { id: string; enabled: boolean }) => api.patch(`/automations/${id}`, b), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/automations/${id}`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const [building, setBuilding] = useState(false);

  return (
    <div className="page">
      <div className="automation-intro tile tile-ink">
        <Zap size={22} />
        <div>
          <h2>Let Workora do the busywork</h2>
          <p>Rules run on the event stream in real time: when something happens in {project.name}, they update tasks, post comments or notify people.</p>
        </div>
        {isAdmin && (
          <button className="btn btn-volt ml-auto" onClick={() => setBuilding(true)}>
            <Plus size={15} /> New rule
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="recipes">
          {RECIPES.map((r) => (
            <button key={r.name} className="recipe" onClick={() => create.mutate(r)} disabled={create.isPending}>
              <Wand2 size={14} /> {r.name}
            </button>
          ))}
        </div>
      )}

      {building && <RuleBuilder onCancel={() => setBuilding(false)} onSave={(r) => create.mutate(r, { onSuccess: () => setBuilding(false) })} />}

      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : !data?.length ? (
        <EmptyState title="No automations yet">Pick a recipe above or build your own rule.</EmptyState>
      ) : (
        <div className="rules">
          {data.map((a) => (
            <article key={a.id} className={`tile rule${a.enabled ? '' : ' off'}`}>
              <div className="rule-head">
                <h3>{a.name}</h3>
                <span className="muted small">
                  ran {a.runCount}× {a.lastRunAt && `· last ${timeAgo(a.lastRunAt)}`}
                </span>
                {isAdmin && (
                  <>
                    <label className="switch ml-auto" title={a.enabled ? 'Enabled' : 'Disabled'}>
                      <input type="checkbox" checked={a.enabled} onChange={(e) => update.mutate({ id: a.id, enabled: e.target.checked })} aria-label={`Enable ${a.name}`} />
                      <span />
                    </label>
                    <button className="icon-btn danger" aria-label={`Delete ${a.name}`} onClick={() => confirm(`Delete “${a.name}”?`) && remove.mutate(a.id)}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
              <RuleSentence rule={a} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function RuleSentence({ rule }: { rule: Pick<Automation, 'trigger' | 'conditions' | 'actions'> }) {
  const { data: users } = useUsers();
  const { data: labels } = useLabels();
  const t = rule.trigger;
  const describe = (a: Action) => {
    switch (a.type) {
      case 'SET_STATUS':
        return `set status to ${STATUS_LABEL[a.status as keyof typeof STATUS_LABEL] ?? a.status}`;
      case 'SET_PRIORITY':
        return `set priority to ${PRIORITY_LABEL[a.priority as keyof typeof PRIORITY_LABEL] ?? a.priority}`;
      case 'ASSIGN':
        return `assign to ${users?.find((u) => u.id === a.userId)?.name ?? 'someone'}`;
      case 'ADD_LABEL':
        return `add label ${labels?.find((l) => l.id === a.labelId)?.name ?? ''}`;
      case 'ADD_COMMENT':
        return `comment “${a.body}”`;
      case 'NOTIFY':
        return `notify ${a.target === 'USER' ? users?.find((u) => u.id === a.userId)?.name : String(a.target).toLowerCase()}: “${a.message}”`;
      default:
        return ACTIONS[a.type]?.toLowerCase() ?? a.type;
    }
  };
  return (
    <p className="rule-sentence">
      <span className="kw">When</span> {TRIGGERS[t.event] ?? t.event}
      {t.from && <> from <b>{STATUS_LABEL[t.from as keyof typeof STATUS_LABEL]}</b></>}
      {t.to && (
        <>
          {' '}
          to <b>{STATUS_LABEL[t.to as keyof typeof STATUS_LABEL] ?? PRIORITY_LABEL[t.to as keyof typeof PRIORITY_LABEL] ?? t.to}</b>
        </>
      )}
      {(rule.conditions?.type || rule.conditions?.priority || rule.conditions?.labelId) && (
        <>
          {' '}
          <span className="kw">if</span> {rule.conditions.type && <>type is <b>{TYPE_LABEL[rule.conditions.type as keyof typeof TYPE_LABEL]}</b> </>}
          {rule.conditions.priority && <>priority is <b>{PRIORITY_LABEL[rule.conditions.priority as keyof typeof PRIORITY_LABEL]}</b> </>}
          {rule.conditions.labelId && <>labelled <b>{labels?.find((l) => l.id === rule.conditions.labelId)?.name}</b></>}
        </>
      )}{' '}
      <span className="kw">then</span> {rule.actions.map(describe).join(', then ')}.
    </p>
  );
}

function RuleBuilder({ onCancel, onSave }: { onCancel: () => void; onSave: (r: { name: string; trigger: Automation['trigger']; conditions: Automation['conditions']; actions: Action[] }) => void }) {
  const { data: users } = useUsers();
  const { data: labels } = useLabels();
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<Automation['trigger']>({ event: 'STATUS_CHANGED', to: 'DONE' });
  const [conditions, setConditions] = useState<Automation['conditions']>({});
  const [actions, setActions] = useState<Action[]>([{ type: 'ADD_COMMENT', body: 'Nice work on {task.key}!' }]);
  const setAction = (i: number, a: Action) => setActions(actions.map((x, j) => (j === i ? a : x)));
  const defaults: Record<string, Action> = {
    SET_STATUS: { type: 'SET_STATUS', status: 'IN_PROGRESS' },
    SET_PRIORITY: { type: 'SET_PRIORITY', priority: 'HIGH' },
    ASSIGN: { type: 'ASSIGN', userId: users?.[0]?.id },
    ADD_LABEL: { type: 'ADD_LABEL', labelId: labels?.[0]?.id },
    ADD_COMMENT: { type: 'ADD_COMMENT', body: '' },
    NOTIFY: { type: 'NOTIFY', target: 'ASSIGNEE', message: '{task.key} needs attention' },
  };

  return (
    <section className="tile builder">
      <input className="builder-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this rule" aria-label="Rule name" autoFocus />
      <div className="builder-row">
        <span className="kw">When</span>
        <select value={trigger.event} onChange={(e) => setTrigger({ event: e.target.value })} aria-label="Trigger">
          {Object.entries(TRIGGERS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {trigger.event === 'STATUS_CHANGED' && (
          <select value={trigger.to ?? ''} onChange={(e) => setTrigger({ ...trigger, to: e.target.value || undefined })} aria-label="To status">
            <option value="">to any status</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                to {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        {trigger.event === 'PRIORITY_CHANGED' && (
          <select value={trigger.to ?? ''} onChange={(e) => setTrigger({ ...trigger, to: e.target.value || undefined })} aria-label="To priority">
            <option value="">to any priority</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                to {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="builder-row">
        <span className="kw">If</span>
        <select value={conditions.type ?? ''} onChange={(e) => setConditions({ ...conditions, type: e.target.value || undefined })} aria-label="Type condition">
          <option value="">any type</option>
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              type is {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select value={conditions.priority ?? ''} onChange={(e) => setConditions({ ...conditions, priority: e.target.value || undefined })} aria-label="Priority condition">
          <option value="">any priority</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              priority is {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <select value={conditions.labelId ?? ''} onChange={(e) => setConditions({ ...conditions, labelId: e.target.value || undefined })} aria-label="Label condition">
          <option value="">any label</option>
          {labels?.map((l) => (
            <option key={l.id} value={l.id}>
              labelled {l.name}
            </option>
          ))}
        </select>
      </div>
      {actions.map((a, i) => (
        <div key={i} className="builder-row">
          <span className="kw">{i ? 'and' : 'Then'}</span>
          <select value={a.type} onChange={(e) => setAction(i, defaults[e.target.value] ?? { type: e.target.value })} aria-label="Action">
            {Object.entries(ACTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {a.type === 'SET_STATUS' && (
            <select value={a.status} onChange={(e) => setAction(i, { ...a, status: e.target.value })} aria-label="Status">
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          )}
          {a.type === 'SET_PRIORITY' && (
            <select value={a.priority} onChange={(e) => setAction(i, { ...a, priority: e.target.value })} aria-label="Priority">
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          )}
          {(a.type === 'ASSIGN' || (a.type === 'NOTIFY' && a.target === 'USER')) && (
            <select value={a.userId ?? ''} onChange={(e) => setAction(i, { ...a, userId: e.target.value })} aria-label="Person">
              {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          {a.type === 'ADD_LABEL' && (
            <select value={a.labelId ?? ''} onChange={(e) => setAction(i, { ...a, labelId: e.target.value })} aria-label="Label">
              {labels?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {a.type === 'NOTIFY' && (
            <>
              <select value={a.target} onChange={(e) => setAction(i, { ...a, target: e.target.value, userId: e.target.value === 'USER' ? users?.[0]?.id : undefined })} aria-label="Recipient">
                <option value="ASSIGNEE">assignee</option>
                <option value="REPORTER">reporter</option>
                <option value="WATCHERS">watchers</option>
                <option value="USER">a person…</option>
              </select>
              <input value={a.message} onChange={(e) => setAction(i, { ...a, message: e.target.value })} placeholder="Message" aria-label="Message" />
            </>
          )}
          {a.type === 'ADD_COMMENT' && <input value={a.body} onChange={(e) => setAction(i, { ...a, body: e.target.value })} placeholder="Comment — {task.key} and {task.title} work" aria-label="Comment" />}
          {actions.length > 1 && (
            <button className="icon-btn" onClick={() => setActions(actions.filter((_, j) => j !== i))} aria-label="Remove action">
              <X size={13} />
            </button>
          )}
        </div>
      ))}
      <div className="builder-footer">
        <button className="btn btn-soft btn-sm" onClick={() => setActions([...actions, { type: 'SET_PRIORITY', priority: 'HIGH' }])} disabled={actions.length >= 10}>
          <Plus size={13} /> Add action
        </button>
        <RuleSentence rule={{ trigger, conditions, actions }} />
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-volt btn-sm" onClick={() => onSave({ name: name.trim() || 'Untitled rule', trigger, conditions, actions })}>
          Save rule
        </button>
      </div>
    </section>
  );
}
