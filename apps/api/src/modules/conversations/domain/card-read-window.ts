/**
 * Which of his messages one read of his card gets (ADR 0085 § 7, amendement du 21/11). Pure: the reader gives every
 * message of the conversation that has a text, in the platform's order, oldest first, without their texts.
 *
 * How far his card is read is the ingestion time of the last of his messages read (`conversations.card_read_through`).
 * So a read takes his messages not read yet in the order they came in, oldest first, as many as fit, and never one
 * that came in after one it leaves: everything up to `through` is then read, nothing read is skipped, and what is left
 * is the next read's. History caught up after the live messages came in later, so it is read after them, once.
 */
export interface CardReadRow<Id> {
  readonly id: Id;
  readonly fromFan: boolean;
  /** When Impera stored it (`messages.created_at`): the order the reading follows. */
  readonly ingestedAt: Date;
}

export interface CardReadWindow<Id> {
  /** The messages the read gets, in the platform's order. */
  readonly ids: readonly Id[];
  /** Among them, his messages this read reads (and marks read). */
  readonly newIds: ReadonlySet<Id>;
  /** The ingestion time of the last of them: what `markRead` keeps. */
  readonly through: Date;
  /** His messages still not read after this one: another read follows at once. */
  readonly left: number;
}

/** Compared to the millisecond, as `card_read_through` is kept. */
const ms = (date: Date): number => Math.floor(date.getTime());

export function cardReadWindow<Id>(
  rows: readonly CardReadRow<Id>[],
  readThrough: Date | null,
  limits: { readonly window: number; readonly context: number },
): CardReadWindow<Id> | null {
  const unread = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.fromFan && (readThrough === null || ms(row.ingestedAt) > ms(readThrough)))
    .sort((a, b) => ms(a.row.ingestedAt) - ms(b.row.ingestedAt) || a.index - b.index);
  if (unread.length === 0) return null;

  // The longest run of the oldest come in whose span, with its context, fits, never cutting through one millisecond.
  for (let taken = Math.min(unread.length, limits.window); taken >= 1; taken -= 1) {
    const next = unread[taken];
    const last = unread[taken - 1];
    if (last === undefined) continue;
    if (next !== undefined && ms(next.row.ingestedAt) === ms(last.row.ingestedAt)) continue;
    const chosen = unread.slice(0, taken);
    const first = Math.min(...chosen.map(({ index }) => index));
    const end = Math.max(...chosen.map(({ index }) => index));
    // The few messages before his first come with it, so the read knows what he answers.
    const before = Math.min(limits.context, first);
    if (end - first + 1 + before > limits.window) continue;
    return {
      ids: rows.slice(first - before, end + 1).map((row) => row.id),
      newIds: new Set(chosen.map(({ row }) => row.id)),
      through: last.row.ingestedAt,
      left: unread.length - taken,
    };
  }

  // Only when one millisecond holds more of his messages than fit: they go alone, without what lies between.
  const head = unread[0];
  if (head === undefined) return null;
  const tied = unread.filter(({ row }) => ms(row.ingestedAt) === ms(head.row.ingestedAt));
  const ordered = [...tied].sort((a, b) => a.index - b.index);
  return {
    ids: ordered.map(({ row }) => row.id),
    newIds: new Set(ordered.map(({ row }) => row.id)),
    through: head.row.ingestedAt,
    left: unread.length - tied.length,
  };
}

/** Where a weekly re-read stopped: the last message of the batch it read, in the platform's order. */
export interface CardRereadCursor<Id> {
  readonly id: Id;
}

export interface CardRereadWindow<Id> {
  readonly ids: readonly Id[];
  /** His messages in the batch: all are read again, whatever was read before. */
  readonly newIds: ReadonlySet<Id>;
  /** Where the next batch starts after; null when the conversation is read to its end. */
  readonly next: CardRereadCursor<Id> | null;
}

/**
 * The weekly re-read (ADR 0085 § 7, amendement du 21/11): the conversation read again from its start, a batch at a
 * time in the platform's order, with the `context` messages before the batch. Null when nothing of his is left after
 * the cursor. A cursor whose message is gone starts again from the start.
 */
export function cardRereadWindow<Id>(
  rows: readonly CardReadRow<Id>[],
  after: CardRereadCursor<Id> | null,
  limits: { readonly window: number; readonly context: number },
): CardRereadWindow<Id> | null {
  const found = after === null ? -1 : rows.findIndex((row) => row.id === after.id);
  const start = found + 1;
  if (!rows.slice(start).some((row) => row.fromFan)) return null;
  const before = Math.min(limits.context, start);
  const batch = rows.slice(start, start + limits.window - before);
  const last = batch.at(-1);
  if (last === undefined) return null;
  const end = start + batch.length;
  return {
    ids: rows.slice(start - before, end).map((row) => row.id),
    newIds: new Set(batch.filter((row) => row.fromFan).map((row) => row.id)),
    next: rows.slice(end).some((row) => row.fromFan) ? { id: last.id } : null,
  };
}

/**
 * How many reads it takes to read what is unread of his, chained as `fans.read_card` chains them: the first pass's
 * count of AI calls for a conversation, computed without any call.
 */
export function cardReadBatches<Id>(
  rows: readonly CardReadRow<Id>[],
  readThrough: Date | null,
  limits: { readonly window: number; readonly context: number },
): number {
  let through = readThrough;
  let batches = 0;
  for (;;) {
    const window = cardReadWindow(rows, through, limits);
    if (window === null) return batches;
    batches += 1;
    through = window.through;
    if (window.left === 0) return batches;
  }
}

/**
 * The reading of his card as it ran before the full reading (`FAN_CARD_FULL_READ=off`): the conversation's last
 * `window` messages, his not read yet new, `through` the newest of them. What lies before the window is marked read
 * with it; nothing is chained (`left` is 0).
 */
export function cardReadLatestWindow<Id>(
  rows: readonly CardReadRow<Id>[],
  readThrough: Date | null,
  limits: { readonly window: number },
): CardReadWindow<Id> | null {
  const last = rows.slice(-limits.window);
  const fresh = last.filter(
    (row) => row.fromFan && (readThrough === null || row.ingestedAt.getTime() > readThrough.getTime()),
  );
  if (fresh.length === 0) return null;
  return {
    ids: last.map((row) => row.id),
    newIds: new Set(fresh.map((row) => row.id)),
    through: new Date(Math.max(...fresh.map((row) => row.ingestedAt.getTime()))),
    left: 0,
  };
}

/** What the full reading switch turns on (ADR 0085 § 7, amendement du 21/11). */
export interface CardReadPlan {
  /** `oldest`: his oldest unread first (`cardReadWindow`); `latest`: the last messages only (`cardReadLatestWindow`). */
  readonly window: 'oldest' | 'latest';
  /** A read that leaves some of his unread chains the next at once. */
  readonly chain: boolean;
  /** Caught-up history queues a read. */
  readonly readsCaughtUp: boolean;
  /** The Monday re-read runs. */
  readonly weekly: boolean;
}

export function cardReadPlan(fullRead: boolean): CardReadPlan {
  return fullRead
    ? { window: 'oldest', chain: true, readsCaughtUp: true, weekly: true }
    : { window: 'latest', chain: false, readsCaughtUp: false, weekly: false };
}
