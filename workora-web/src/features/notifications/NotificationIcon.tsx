import {
  AlarmClock,
  ArrowRightLeft,
  AtSign,
  Bell,
  Bot,
  CalendarClock,
  ClipboardList,
  GitPullRequest,
  MessageSquare,
  PencilLine,
  Rocket,
  ShieldCheck,
  Target,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Avatar } from '@/components/ui';
import type { Notification } from '@/types';

const ICONS: Record<string, [LucideIcon, string]> = {
  assigned: [UserPlus, 'Assignment'],
  mentioned: [AtSign, 'Mention'],
  comments: [MessageSquare, 'Comment'],
  status: [ArrowRightLeft, 'Status change'],
  changes: [PencilLine, 'Change'],
  dueSoon: [CalendarClock, 'Due soon'],
  overdue: [AlarmClock, 'Overdue'],
  development: [GitPullRequest, 'GitHub'],
  forms: [ClipboardList, 'Form response'],
  goals: [Target, 'Goal'],
  sprints: [Rocket, 'Sprint'],
  automation: [Bot, 'Automation'],
  workspace: [Users, 'Workspace'],
  security: [ShieldCheck, 'Security'],
};

/** The actor's avatar with a small badge for the kind of notification. */
export function NotificationAvatar({ n, size = 30 }: { n: Notification; size?: number }) {
  const [Icon, label] = ICONS[n.category ?? ''] ?? [Bell, 'Notification'];
  return (
    <span className="note-avatar" style={{ width: size, height: size }}>
      {n.actor ? (
        <Avatar user={{ id: n.actor.id, name: n.actor.name }} size={size} />
      ) : (
        <span className="note-system" aria-hidden>
          <Icon size={Math.round(size * 0.5)} />
        </span>
      )}
      <span className={`note-kind k-${n.category ?? 'other'}`} title={label} aria-label={label} role="img">
        <Icon size={10} />
      </span>
    </span>
  );
}
