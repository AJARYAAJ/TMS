import { EntityManager } from 'typeorm';
import { ApiException } from '../../common/http/api-exception';
import { Membership } from '../organizations/membership.entity';
import { CustomField, FieldType } from './custom-field.entity';

export type FieldValue = string | number | boolean | string[] | null;

const URL_RE = /^https?:\/\/\S+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates and normalises a single value for a field. Select values are option ids;
 * the matching option label is also accepted (case-insensitive) so CSV imports and forms can use labels.
 */
export function normaliseValue(field: CustomField, raw: unknown): FieldValue {
  if (raw === null || raw === undefined || raw === '') return null;
  const bad = (why: string): never => {
    throw ApiException.badRequest('INVALID_FIELD_VALUE', `${field.name}: ${why}`);
  };
  const option = (v: unknown) => {
    const s = String(v).trim();
    const o = field.options.find((x) => x.id === s) ?? field.options.find((x) => x.label.toLowerCase() === s.toLowerCase());
    return o ? o.id : bad(`"${s}" is not one of ${field.options.map((x) => x.label).join(', ') || 'the options'}`);
  };
  switch (field.type) {
    case FieldType.TEXT:
      if (typeof raw !== 'string' && typeof raw !== 'number') bad('expected text');
      return String(raw).slice(0, 2000);
    case FieldType.NUMBER: {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
      if (!Number.isFinite(n)) bad('expected a number');
      return n;
    }
    case FieldType.CHECKBOX:
      if (typeof raw === 'boolean') return raw;
      if (/^(true|yes|1|y|x)$/i.test(String(raw).trim())) return true;
      if (/^(false|no|0|n)$/i.test(String(raw).trim())) return false;
      return bad('expected true or false');
    case FieldType.DATE: {
      const s = String(raw).trim().slice(0, 10);
      if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) bad('expected a date (YYYY-MM-DD)');
      return s;
    }
    case FieldType.URL: {
      const s = String(raw).trim();
      if (!URL_RE.test(s)) bad('expected an http(s) URL');
      return s.slice(0, 2000);
    }
    case FieldType.SELECT:
      return option(raw);
    case FieldType.MULTI_SELECT: {
      const list = Array.isArray(raw) ? raw : String(raw).split(/[;,]/).map((x) => x.trim()).filter(Boolean);
      const chosen = new Set(list.map(option));
      // Stored in the field's option order so display and exports are stable.
      const ids = field.options.map((o) => o.id).filter((id) => chosen.has(id));
      return ids.length ? ids : null;
    }
    case FieldType.PERSON: {
      if (typeof raw !== 'string') bad('expected a user id');
      return raw as string;
    }
    default:
      return bad('unknown field type');
  }
}

/**
 * Validates a `{ fieldId: value }` patch against the project's fields and returns the merged
 * values plus a readable change set keyed by field name (null = cleared).
 */
export async function applyFieldValues(m: EntityManager, orgId: string, projectId: string, current: Record<string, FieldValue>, patch: Record<string, unknown>) {
  const fields = await m.find(CustomField, { where: { projectId } });
  const byId = new Map(fields.map((f) => [f.id, f]));
  const next: Record<string, FieldValue> = { ...current };
  const from: Record<string, FieldValue> = {};
  const to: Record<string, FieldValue> = {};
  for (const [id, raw] of Object.entries(patch)) {
    const field = byId.get(id) ?? fields.find((f) => f.name.toLowerCase() === id.toLowerCase());
    if (!field) throw ApiException.badRequest('UNKNOWN_FIELD', `No custom field "${id}" in this project`);
    const value = normaliseValue(field, raw);
    if (field.type === FieldType.PERSON && value && !(await m.existsBy(Membership, { organizationId: orgId, userId: value as string }))) {
      throw ApiException.badRequest('INVALID_FIELD_VALUE', `${field.name}: not a member of this organization`);
    }
    const before = current[field.id] ?? null;
    if (JSON.stringify(before) === JSON.stringify(value)) continue;
    if (value === null) delete next[field.id];
    else next[field.id] = value;
    from[field.name] = before;
    to[field.name] = value;
  }
  return { values: next, changed: Object.keys(to).length ? { from, to } : null };
}
