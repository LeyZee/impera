import type {
  DescriptionReviewReason,
  DropDescriptionsReview,
  DropMediaReview,
  MediaDescriptionId,
  ScriptStageAccess,
} from '@impera/contracts';

/**
 * Créatrices › Scripts, the review of a sent script (SC-04 lot c3, ADR 0030 § 3, ADR 0083 § 7): its steps in the
 * script's order, each with its media and the description each is shown with, what « Tout valider » validates, and
 * where the script stands. Pure, so that what the screen offers is tested without it.
 */

/** Why a description waits for a human, as the agency reads it; `flagged` is an alert, the others a doubt. */
export const REASON_LABELS: Readonly<Record<DescriptionReviewReason, string>> = {
  back_reference: 'Renvoie à un autre média',
  not_alone: 'Quelqu’un d’autre apparaît',
  unsure: 'L’IA n’est pas sûre',
  flagged: 'Alerte de sécurité',
};

export const KIND_LABELS: Readonly<Record<DropMediaReview['kind'], string>> = {
  image: 'Photo',
  video: 'Vidéo',
  audio: 'Note vocale',
};

export interface ReviewStep {
  readonly key: string;
  /** « E2A », as her cards say. */
  readonly code: string;
  readonly name: string;
  /** Offered or paid, as its card says: an offered step shows « Offert », never a price to fix. */
  readonly access: ScriptStageAccess;
  readonly media: readonly DropMediaReview[];
  /** What « Tout valider » validates: each description still open with nothing holding it back. */
  readonly batch: readonly MediaDescriptionId[];
  /** Open descriptions that wait for a human, each validated alone. */
  readonly alone: number;
  /** A photo or a video with no description yet. */
  readonly undescribed: number;
}

/** A medium the vision describes: an audio note never is (ADR 0083 § 1). */
export const describable = (media: DropMediaReview): boolean => media.kind !== 'audio';

/** Her script's steps in its order, each with its media; a file of no step (a slot the version lost) is left out. */
export function reviewSteps(review: DropDescriptionsReview): readonly ReviewStep[] {
  const byFile = new Map(review.media.map((media) => [media.fileId, media]));
  return review.steps.map((step) => {
    const media = step.fileIds.flatMap((id) => {
      const one = byFile.get(id);
      return one === undefined ? [] : [one];
    });
    const open = media.flatMap((one) => {
      const description = one.description;
      return description?.validatedAt === null ? [description] : [];
    });
    return {
      key: step.step,
      code: step.code,
      name: step.name,
      access: step.access,
      media,
      batch: open.filter((description) => description.reviewReasons.length === 0).map((d) => d.id),
      alone: open.filter((description) => description.reviewReasons.length > 0).length,
      undescribed: media.filter((one) => describable(one) && one.description === null).length,
    };
  });
}

export interface ReviewStanding {
  /** Descriptions still to validate, the ones waiting for a human included. */
  readonly open: number;
  readonly undescribed: number;
  /** Every photo and video described and validated, and the synthesis of now validated. */
  readonly done: boolean;
}

export function reviewStanding(review: DropDescriptionsReview): ReviewStanding {
  const seen = review.media.filter(describable);
  const open = seen.filter((one) => one.description !== null && one.description.validatedAt === null).length;
  const undescribed = seen.filter((one) => one.description === null).length;
  const summaryDone =
    review.summary !== null && review.summary.current && review.summary.validatedAt !== null;
  return { open, undescribed, done: open === 0 && undescribed === 0 && summaryDone };
}

/** « 2 descriptions à valider », « Synthèse à valider », « Tout est validé »: one line on where the script stands. */
export function standingLine(review: DropDescriptionsReview): string {
  const { open, undescribed, done } = reviewStanding(review);
  if (done) return 'Tout est validé';
  if (undescribed > 0)
    return undescribed === 1
      ? '1 média attend sa description'
      : `${String(undescribed)} médias attendent leur description`;
  if (open > 0) return open === 1 ? '1 description à valider' : `${String(open)} descriptions à valider`;
  if (!review.summary?.current) return 'La synthèse s’écrit';
  return 'Synthèse à valider';
}
