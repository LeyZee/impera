import { z } from 'zod';

import {
  AUDIT_ACTION_FAMILIES,
  AUDIT_ACTIONS,
  AUDIT_CATEGORY_PREFIXES,
  AUDIT_DEFAULT_CATEGORY,
  AuditCategorySchema,
  AuditLinkSchema,
  type AuditActionDefinition,
  type AuditCategory,
  type AuditLabelContext,
  type AuditLink,
} from './audit-actions';
import { AuditEntryIdSchema, UserIdSchema } from './ids';

/**
 * Réglages › Journal (EQ-18, ADR 0024), the owner's alone: who did what in the CRM, newest first. Each line of
 * `audit_log` becomes its sentence in French through `describeAuditEntry`; an action nobody has described, or details
 * that do not parse, show the action's name and nothing of its details.
 */

/** The categories' names on the screen and in the export. */
export const AUDIT_CATEGORY_NAMES: Readonly<Record<AuditCategory, string>> = {
  money: 'Argent',
  team: 'Équipe',
  access: 'Accès',
  agent: 'Agent',
};

/** `limit` of `GET /v1/audit`: 50 by default, 200 at most. */
export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;
/** The lines `GET /v1/audit.csv` exports at most; a wider selection is refused (`audit_export_unprocessable`). */
export const AUDIT_EXPORT_MAX = 20_000;

/** The selection, the same for the page and its export: by author, by category, by period (`from` ≤ at < `to`). */
const selection = {
  userId: UserIdSchema.optional(),
  category: AuditCategorySchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};
const ordered = (query: { readonly from?: string | undefined; readonly to?: string | undefined }): boolean =>
  query.from === undefined || query.to === undefined || Date.parse(query.from) < Date.parse(query.to);
const orderedMessage = { message: 'La fin de la période vient après son début', path: ['to'] };

/** `GET /v1/audit?userId=&category=&from=&to=&limit=&cursor=` → `AuditPageSchema`. */
export const AuditQuerySchema = z
  .strictObject({
    ...selection,
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(AUDIT_PAGE_DEFAULT),
    /** Opaque: the `nextCursor` of the page before. */
    cursor: z.string().min(1).max(256).optional(),
  })
  .refine(ordered, orderedMessage);
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

/** `GET /v1/audit.csv?userId=&category=&from=&to=`: the same selection, every line of it. */
export const AuditExportQuerySchema = z.strictObject(selection).refine(ordered, orderedMessage);
export type AuditExportQuery = z.infer<typeof AuditExportQuerySchema>;

/** Who did it: the account and, when the base still knows it, the member's or the account's name. */
export const AuditAuthorSchema = z.object({ userId: z.string().min(1), name: z.string().nullable() });

/** One line of the journal. `author` is `null` for what Impera did by itself (a job, the server). */
export const AuditEntrySchema = z.object({
  id: AuditEntryIdSchema,
  at: z.iso.datetime(),
  author: AuditAuthorSchema.nullable(),
  action: z.string(),
  category: AuditCategorySchema,
  label: z.string(),
  link: AuditLinkSchema.nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditPageSchema = z.object({
  items: z.array(AuditEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AuditPage = z.infer<typeof AuditPageSchema>;

/** The export's file: a CSV the accountant or a lawyer opens in a spreadsheet. */
export const AUDIT_CSV_MEDIA_TYPE = 'text/csv; charset=utf-8';

/**
 * The error codes of `/v1/audit` and `/v1/audit.csv`: `audit_cursor_invalid`, a cursor this server did not give;
 * `audit_export_unprocessable`, more than `AUDIT_EXPORT_MAX` lines selected (`details.max`), a shorter period asked.
 */
export const AUDIT_ERROR_CODES = ['audit_cursor_invalid', 'audit_export_unprocessable'] as const;

/** The definition of an action, by its name or its family; `undefined` for an action nobody has described. */
function definitionOf(action: string): AuditActionDefinition | undefined {
  const known = Object.hasOwn(AUDIT_ACTIONS, action) ? AUDIT_ACTIONS[action] : undefined;
  if (known !== undefined) return known;
  const family = AUDIT_ACTION_FAMILIES.find((f) => action.startsWith(f.prefix));
  return family?.definition(action.slice(family.prefix.length));
}

/** The category of any action: described, of a family, by its first word, else `team`. */
export function auditCategoryOf(action: string): AuditCategory {
  const known = definitionOf(action);
  if (known !== undefined) return known.category;
  return AUDIT_CATEGORY_PREFIXES.find((p) => action.startsWith(p.prefix))?.category ?? AUDIT_DEFAULT_CATEGORY;
}

/** What `entity` an entry's link opens, when the entry names one by its id. */
const ENTITY_LINKS: Readonly<Record<string, AuditLink['kind']>> = {
  commission_statement: 'statement',
  invoice: 'invoice',
  team_member: 'member',
  contractor_profile: 'member',
  payout_destination: 'member',
  creator: 'creator',
  shift: 'shift',
};

function entityLink(entity: string, entityId: string | null): AuditLink | null {
  const kind = Object.hasOwn(ENTITY_LINKS, entity) ? ENTITY_LINKS[entity] : undefined;
  const parsed = z.uuid().safeParse(entityId);
  return kind === undefined || !parsed.success ? null : { kind, id: parsed.data };
}

/** A line of `audit_log` as the server reads it, `details` untouched. */
export interface AuditRow {
  readonly action: string;
  readonly entity: string;
  readonly entityId: string | null;
  readonly details: unknown;
}

/** The names the server read for a page: members' records and creators, by id. */
export interface AuditNames {
  readonly members: ReadonlyMap<string, string>;
  readonly creators: ReadonlyMap<string, string>;
}

/** The fields of `details` that name a member or a creator, and the entity's own id. */
const REFERENCE_FIELDS = ['memberId', 'recipientMemberId', 'creatorId'] as const;

/** The ids a page's sentences may name: the server reads them in `team_members` and `creators` before describing. */
export function auditNameRefs(row: AuditRow): string[] {
  const refs: string[] = [];
  const add = (value: unknown) => {
    const parsed = z.uuid().safeParse(value);
    if (parsed.success) refs.push(parsed.data);
  };
  add(row.entityId);
  if (typeof row.details === 'object' && row.details !== null)
    for (const field of REFERENCE_FIELDS) add(Object.getOwnPropertyDescriptor(row.details, field)?.value);
  return refs;
}

/**
 * The category, sentence and link of one line, never an error: an unknown action, or details its schema refuses, show
 * the action as written, with the entity's link at most.
 */
export function describeAuditEntry(
  row: AuditRow,
  names: AuditNames,
): { readonly category: AuditCategory; readonly label: string; readonly link: AuditLink | null } {
  const category = auditCategoryOf(row.action);
  const fallback = { category, label: row.action, link: entityLink(row.entity, row.entityId) };
  const definition = definitionOf(row.action);
  if (definition === undefined) return fallback;
  const context: AuditLabelContext = {
    entityId: row.entityId,
    member: (id) => (id === null || id === undefined ? undefined : names.members.get(id)) ?? 'un membre',
    creator: (id) =>
      (id === null || id === undefined ? undefined : names.creators.get(id)) ?? 'une créatrice',
  };
  try {
    const described = definition.describe(row.details, context);
    if (described === null) return fallback;
    return { category, label: described.label, link: described.link ?? fallback.link };
  } catch {
    // A sentence that throws on a value its schema let through: the line still shows.
    return fallback;
  }
}
