import {
  DRAFT_CORRECTION_REASONS,
  DRAFT_CORRECTIONS_MAX,
  RejectReasonSchema,
  type DraftCorrection,
  type DraftCorrectionReason,
  type DraftCorrectionsView,
} from '@impera/contracts';

/**
 * Entraîner › Corrections (trou béant 12, recette du 21/11): a refused or retouched draft as the journal keeps it,
 * read into the screen's line. Pure: the reader gives the rows, newest first.
 */
export interface DraftCorrectionRow {
  readonly draftId: DraftCorrection['draftId'];
  readonly conversationId: DraftCorrection['conversationId'];
  readonly fanDisplayName: string;
  readonly at: Date;
  readonly kind: DraftCorrection['kind'];
  /** What the agent wrote. */
  readonly before: readonly string[];
  /** What left instead, for a retouch (`draft_edited.editedBubbles`). */
  readonly edited: readonly string[] | null;
  /** The reason typed in the Suivi (`draft_rejected.reason`), if any. */
  readonly writtenReason: string | null;
  /** The live rating written from the copilot panel (`calibration_ratings.verdict`), opaque until read here. */
  readonly rating: unknown;
}

/** The copilot panel's rating, as `rateLive` keeps it: a closed reason and maybe a note. */
function ratingOf(rating: unknown): { reason: DraftCorrectionReason; note: string | null } | null {
  if (typeof rating !== 'object' || rating === null) return null;
  const reason = RejectReasonSchema.safeParse('reason' in rating ? rating.reason : undefined);
  if (!reason.success) return null;
  const note = 'note' in rating && typeof rating.note === 'string' && rating.note !== '' ? rating.note : null;
  return { reason: reason.data, note };
}

/** Why: a retouch is `edited`; a refusal takes the panel's closed reason, else the one written, else none. */
export function draftCorrectionOf(row: DraftCorrectionRow): DraftCorrection {
  const line = {
    draftId: row.draftId,
    conversationId: row.conversationId,
    fanDisplayName: row.fanDisplayName,
    at: row.at.toISOString(),
    kind: row.kind,
    before: [...row.before],
  };
  if (row.kind === 'edited')
    return { ...line, reason: 'edited', note: null, after: row.edited === null ? null : [...row.edited] };
  const rated = ratingOf(row.rating);
  if (rated !== null)
    return { ...line, reason: rated.reason, note: rated.note ?? row.writtenReason, after: null };
  return {
    ...line,
    reason: row.writtenReason === null ? 'none' : 'written',
    note: row.writtenReason,
    after: null,
  };
}

/** The screen's view: the lines, newest first, and how many of each reason, in the list's order. */
export function draftCorrectionsView(
  creatorId: DraftCorrectionsView['creatorId'],
  since: Date,
  rows: readonly DraftCorrectionRow[],
): DraftCorrectionsView {
  const items = rows.slice(0, DRAFT_CORRECTIONS_MAX).map(draftCorrectionOf);
  const counted = new Map<DraftCorrectionReason, number>();
  for (const item of items) counted.set(item.reason, (counted.get(item.reason) ?? 0) + 1);
  return {
    creatorId,
    since: since.toISOString(),
    truncated: rows.length > DRAFT_CORRECTIONS_MAX,
    counts: DRAFT_CORRECTION_REASONS.flatMap((reason) => {
      const count = counted.get(reason);
      return count === undefined ? [] : [{ reason, count }];
    }),
    items,
  };
}
