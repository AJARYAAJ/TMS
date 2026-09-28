import { DataSource } from 'typeorm';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { Membership } from '../organizations/membership.entity';
import { Task } from '../tasks/task.entity';
import { Integration } from './integration.entity';

/** Task keys mentioned in free text or branch names ("ecom-12-fix" → ECOM-12). */
export function extractKeys(...texts: (string | null | undefined)[]) {
  const keys = new Set<string>();
  for (const t of texts) for (const m of (t ?? '').matchAll(/\b([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})\b/g)) keys.add(`${m[1].toUpperCase()}-${m[2]}`);
  return [...keys];
}

/** Keys preceded by a closing keyword: "fixes ECOM-12", "closes #ECOM-3", "resolved OPS-1". */
export function closingKeys(text: string | null | undefined) {
  const keys = new Set<string>();
  for (const m of (text ?? '').matchAll(/\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s*:?\s+#?([A-Za-z][A-Za-z0-9]{1,9}-\d{1,7})\b/gi)) keys.add(m[1].toUpperCase());
  return [...keys];
}

export async function tasksByKeys(ds: DataSource, orgId: string, keys: string[]) {
  if (!keys.length) return [];
  return ds.getRepository(Task).createQueryBuilder('t').where('t.organization_id = :orgId AND t.key IN (:...keys)', { orgId, keys }).getMany();
}

/**
 * Integrations act as the admin who installed them, labelled with the external person
 * ("octocat via GitHub") so the activity log shows who really did it.
 */
export async function integrationPrincipal(ds: DataSource, integration: Integration, via: string): Promise<AuthPrincipal | null> {
  const m = await ds.getRepository(Membership).findOne({ where: { organizationId: integration.organizationId, userId: integration.createdById }, relations: { user: true } });
  if (!m) return null;
  return { userId: m.userId, organizationId: m.organizationId, role: Role.MEMBER, email: m.user.email, name: via };
}

export const CATEGORY_RANK: Record<string, number> = { TODO: 0, IN_PROGRESS: 1, IN_REVIEW: 2, DONE: 3 };

export function taskUrl(appUrl: string, key: string) {
  return `${appUrl}/projects/${key.split('-')[0]}/board?task=${key}`;
}

export async function touch(ds: DataSource, id: string, status: string, error: string | null = null) {
  await ds.getRepository(Integration).update({ id }, { lastStatus: status, lastError: error?.slice(0, 250) ?? null, lastActivityAt: new Date() });
}
