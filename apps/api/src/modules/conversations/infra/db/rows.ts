import {
  ActorSchema,
  ConversationIdSchema,
  ConversationModeSchema,
  ConversationStateSchema,
  CreatorIdSchema,
  DesireBandSchema,
  DraftIdSchema,
  DomainError,
  DraftStatusSchema,
  EventBodySchema,
  FactCategorySchema,
  FactKindSchema,
  FanIdSchema,
  MessageIdSchema,
  PlatformAccountIdSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { sql, type schema } from '@nirvana/db';
import { z } from 'zod';

import type { Conversation, Draft, DraftFact, StoredEvent } from '../../domain/ports';

/** Rows read back from Postgres are validated like any other boundary (CLAUDE.md rule 6). */

export function toConversation(row: typeof schema.conversations.$inferSelect): Conversation {
  return {
    id: ConversationIdSchema.parse(row.id),
    creatorId: CreatorIdSchema.parse(row.creatorId),
    platformAccountId: PlatformAccountIdSchema.parse(row.platformAccountId),
    fanId: FanIdSchema.parse(row.fanId),
    platformConversationId: row.platformConversationId,
    state: ConversationStateSchema.parse(row.state),
    mode: ConversationModeSchema.parse(row.mode),
    lastInboundAt: row.lastInboundAt,
    lastOutboundAt: row.lastOutboundAt,
    unreadCount: row.unreadCount,
    routedToUserId: row.routedToUserId === null ? null : UserIdSchema.parse(row.routedToUserId),
    desireScore: row.desireScore,
    desireBand: row.desireBand === null ? null : DesireBandSchema.parse(row.desireBand),
    desireAt: row.desireAt,
  };
}

/** What `drafts.brief` holds today: the facts the brief proposed (P3-02). */
const StoredBriefSchema = z.object({
  factsProposed: z.array(
    z.object({
      category: FactCategorySchema,
      key: z.string().min(1),
      value: z.string().min(1),
      kind: FactKindSchema,
      confidence: z.number().min(0).max(1),
      sourceMessageId: MessageIdSchema.nullable(),
      observedAt: z.iso.datetime(),
    }),
  ),
});

export function toStoredBrief(facts: readonly DraftFact[]): z.input<typeof StoredBriefSchema> {
  return { factsProposed: facts.map((fact) => ({ ...fact, observedAt: fact.observedAt.toISOString() })) };
}

/**
 * A brief that does not read back gives no facts rather than an error: facts are what she remembers, never a
 * reason to block an approval.
 */
function readFacts(brief: unknown): DraftFact[] {
  if (brief === null) return [];
  const parsed = StoredBriefSchema.safeParse(brief);
  if (!parsed.success) return [];
  return parsed.data.factsProposed.map((fact) => ({ ...fact, observedAt: new Date(fact.observedAt) }));
}

export function toDraft(row: typeof schema.drafts.$inferSelect): Draft {
  return {
    id: DraftIdSchema.parse(row.id),
    conversationId: ConversationIdSchema.parse(row.conversationId),
    status: DraftStatusSchema.parse(row.status),
    bubbles: row.bubbles,
    finalBubbles: row.finalBubbles,
    createdAt: row.createdAt,
    facts: readFacts(row.brief),
  };
}

const PayloadObjectSchema = z.record(z.string(), z.unknown());

/** The holds the engine wrote as a handoff's `reason` before it had `detail`: their first code opens the line. */
const ENGINE_HOLD_CODES = [
  'guard_blocked',
  'handoff',
  'budget_reached',
  'llm_unavailable',
  'waited_no_reply',
];

/** « guard_blocked : meeting_promise » → its codes; a sentence a human wrote → `null`. */
function engineCodes(reason: string): string[] | null {
  const codes = reason.split(' : ');
  // An old reason was cut at 500 characters, maybe right after a « : »: no empty code (`detail` refuses one).
  return ENGINE_HOLD_CODES.includes(codes[0] ?? '') ? codes.filter((code) => code !== '').slice(0, 20) : null;
}

/**
 * Payload shapes the journal still holds from before a contract change, brought to the current shape on read (ADR
 * 0007, « Évolution des payloads »): the journal is never rewritten. A field the current shape requires and an old
 * row lacks gets the value the old writer meant; what the row holds always wins.
 */
function upcast(row: typeof schema.conversationEvents.$inferSelect): unknown {
  const payload = PayloadObjectSchema.safeParse(row.payload);
  if (!payload.success) return row.payload;
  switch (row.type) {
    // Before #54: { userId?, reason?, mode? }, no cause (alerts rank an unknown cause as `other`). Before the
    // handoff detail: the engine's codes joined in `reason` (« llm_unavailable : no voice key »), moved to `detail`.
    case 'handoff_requested': {
      const { reason, ...rest } = payload.data;
      const codes = typeof reason === 'string' && !('detail' in rest) ? engineCodes(reason) : null;
      return codes === null
        ? { conversationId: row.conversationId, cause: 'other', ...payload.data }
        : { conversationId: row.conversationId, cause: 'other', ...rest, detail: codes };
    }
    // Before #60 (takeover_started) and R-G4 (the others): without the conversation it belongs to.
    case 'takeover_started':
    case 'takeover_ended':
    case 'send_attempted':
    case 'send_failed':
    case 'send_verified':
      return { conversationId: row.conversationId, ...payload.data };
    default:
      return row.payload;
  }
}

export function toStoredEvent(row: typeof schema.conversationEvents.$inferSelect): StoredEvent {
  return {
    seq: row.seq,
    body: EventBodySchema.parse({ type: row.type, payload: upcast(row) }),
    actor: ActorSchema.parse(row.actor),
    at: row.createdAt,
  };
}

/**
 * Opaque cursors (api.md § Pagination): base64url of the sort key of the last item returned. The instant keeps
 * Postgres's microseconds: cut to a JS `Date`'s milliseconds, the next page skipped the rows of the same millisecond
 * that sort after it.
 */
const KeyCursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

/** A timestamptz column as the exact ISO instant, microseconds included (a `Date` keeps only milliseconds). */
export function cursorInstant(
  column: typeof schema.conversations.updatedAt | typeof schema.messages.platformCreatedAt,
): ReturnType<typeof sql<string>> {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}

/** `at` stays the ISO text the cursor carries, for Postgres to read back at full precision. */
export function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (cursor === undefined) return null;
  const parsed = KeyCursorSchema.safeParse(safeJson(Buffer.from(cursor, 'base64url').toString()));
  if (!parsed.success) throw new CursorInvalid();
  return { at: parsed.data[0], id: parsed.data[1] };
}

export function decodeSeqCursor(cursor: string | undefined): number | null {
  if (cursor === undefined) return null;
  const parsed = z.coerce.number().int().min(1).safeParse(cursor);
  if (!parsed.success) throw new CursorInvalid();
  return parsed.data;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

class CursorInvalid extends DomainError {
  constructor() {
    super('cursor_invalid', 'Curseur de pagination invalide');
  }
}
