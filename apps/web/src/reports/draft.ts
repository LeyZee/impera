import { ShiftReportIdSchema } from '@impera/contracts';
import { z } from 'zod';

import type { ReportDraft } from './reopen';

/*
 * The report a member is typing, kept on this device so that a reload loses nothing (recette 16/11, CHT-29): one per
 * shift and kind (a report, a correction), under `impera.report-draft.`, forgotten once sent, after two days, and at
 * sign-out with the rest of the device (`forgetDevice`). A draft typed on a report the server has changed since is not
 * taken back. A browser that refuses its storage keeps nothing, and the panel works as before.
 */

/** The prefix `forgetDevice` drops (`pwa/device.ts` keeps the same). */
export const REPORT_DRAFT_PREFIX = 'impera.report-draft.';

const KEPT_MS = 2 * 86_400_000;
const TEXT_MAX = 4000;

/** What the draft was typed on: a new report or correction (`null`), or a report at its version. */
export interface DraftBasis {
  readonly reportId: string | null;
  readonly version: number | null;
}

const KeptSchema = z.object({
  at: z.number().int().nonnegative(),
  basis: z.object({ reportId: z.string().nullable(), version: z.number().int().nullable() }),
  draft: z.object({
    id: ShiftReportIdSchema,
    correcting: z.boolean(),
    amount: z.string().max(TEXT_MAX),
    comment: z.string().max(TEXT_MAX),
    incidentOn: z.boolean(),
    incident: z.string().max(TEXT_MAX),
    explanation: z.string().max(TEXT_MAX).optional(),
  }),
});

const keyOf = (shiftId: string, correcting: boolean): string =>
  `${REPORT_DRAFT_PREFIX}${shiftId}.${correcting ? 'correction' : 'report'}`;

/** The draft kept for this shift and kind, typed on `basis`, or `null`. */
export function keptDraft(
  shiftId: string,
  correcting: boolean,
  basis: DraftBasis,
  now: number = Date.now(),
): ReportDraft | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(keyOf(shiftId, correcting));
  } catch {
    return null;
  }
  if (raw === null) return null;
  let kept: z.infer<typeof KeptSchema>;
  try {
    const result = KeptSchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;
    kept = result.data;
  } catch {
    return null;
  }
  if (
    now - kept.at > KEPT_MS ||
    kept.basis.reportId !== basis.reportId ||
    kept.basis.version !== basis.version ||
    kept.draft.correcting !== correcting
  ) {
    dropDraft(shiftId, correcting);
    return null;
  }
  const { explanation, ...draft } = kept.draft;
  return explanation === undefined ? draft : { ...draft, explanation };
}

/** Keeps what the member typed, on `basis`. */
export function keepDraft(
  shiftId: string,
  draft: ReportDraft,
  basis: DraftBasis,
  now: number = Date.now(),
): void {
  try {
    localStorage.setItem(keyOf(shiftId, draft.correcting), JSON.stringify({ at: now, basis, draft }));
  } catch {
    // Refused or full: the panel keeps it for as long as it stays open.
  }
}

/** Forgets the draft of this shift and kind: sent, or back to what the server holds. */
export function dropDraft(shiftId: string, correcting: boolean): void {
  try {
    localStorage.removeItem(keyOf(shiftId, correcting));
  } catch {
    // Storage blocked: nothing was kept either.
  }
}
