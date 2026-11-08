import {
  IdeaDropCategorySchema,
  REEL_DROP_CATEGORY,
  type IdeaDropCategory,
  type ReelBrief,
} from '@impera/contracts';
import type {
  ContentIdeaCorrection,
  ContentIdeaOfDay,
  ContentIdeaState,
  TrendFormat,
  TrendMetrics,
  TrendSignalSource,
} from '@impera/contracts';

import { reelBriefOf, reelDraftOf, reelProblems, type ReelDraft } from '@/creators/reel/model';

/*
 * « Idées du jour » (VEI-02): pure rules, so that the screen only lays them out and the tests read them without a
 * browser.
 */

/**
 * The categories an idea can be corrected to: those of its contract, never « Script ». A script always comes from one
 * of the agency's structures with its frozen version (ADR 0056 § 1-2), and the contract refuses it for an idea.
 */
export const CORRECTABLE_CATEGORIES: readonly IdeaDropCategory[] = IdeaDropCategorySchema.options;

/** Where an idea stands, as the agency reads it; she never sees this page. */
export const IDEA_STATE_LABELS: Readonly<Record<ContentIdeaState, string>> = {
  proposed: 'À décider',
  validated: 'Validée',
  refused: 'Refusée',
  suggested: 'Dans son agenda',
  declined: 'Refusée par elle',
  deposited: 'Tournée',
};

/** The tone of its pastille: amber waits for the agency, neutral is settled, green went through. */
export const IDEA_STATE_TONES: Readonly<Record<ContentIdeaState, 'warn' | 'ok' | 'muted'>> = {
  proposed: 'warn',
  validated: 'ok',
  suggested: 'ok',
  deposited: 'ok',
  refused: 'muted',
  declined: 'muted',
};

/** Where the trend an idea cites comes from (ADR 0060 § 2). */
export const SIGNAL_SOURCE_LABELS: Readonly<Record<TrendSignalSource, string>> = {
  creator_stats: 'Ses statistiques',
  grok_search: 'Recherche du matin',
  reference_account: 'Compte de référence',
  agency_link: 'Lien collé par l’agence',
  creator_link: 'Lien collé par elle',
  passive_capture: 'Vu pendant une veille',
};

export const FORMAT_LABELS: Readonly<Record<TrendFormat, string>> = {
  reel: 'Reel',
  photo: 'Photo',
  carousel: 'Carrousel',
  story: 'Story',
};

const COUNT = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

/** « 12,3 k vues · 840 j’aime · 31 commentaires »: only what the page gave; `null` when it gave nothing. */
export function metricsLine(metrics: TrendMetrics | null): string | null {
  if (metrics === null) return null;
  const parts: string[] = [];
  if (metrics.views !== null) parts.push(`${COUNT.format(metrics.views)} vues`);
  if (metrics.likes !== null) parts.push(`${COUNT.format(metrics.likes)} j’aime`);
  if (metrics.comments !== null)
    parts.push(`${COUNT.format(metrics.comments)} commentaire${metrics.comments > 1 ? 's' : ''}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** « 20 min », « 1 h 30 »: her shooting time. */
export function shootLength(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const rest = minutes % 60;
  return rest === 0
    ? `${String(minutes / 60)} h`
    : `${String(Math.floor(minutes / 60))} h ${String(rest).padStart(2, '0')}`;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** « 06/11/2026 », in the reader's time. */
export function slashDay(iso: string): string {
  const at = new Date(iso);
  return `${two(at.getDate())}/${two(at.getMonth() + 1)}/${String(at.getFullYear())}`;
}

/** What the form holds while an idea is corrected; the minutes as typed. */
export interface IdeaDraft {
  readonly title: string;
  readonly category: ContentIdeaOfDay['category'];
  readonly toShoot: string;
  readonly reason: string;
  readonly shootMinutes: string;
  /** Its reel sheet (ADR 0082 § 3), shown and sent only while the idea is a Reel Insta. */
  readonly reel: ReelDraft;
}

export const draftOf = (idea: ContentIdeaOfDay): IdeaDraft => ({
  title: idea.title,
  category: idea.category,
  toShoot: idea.toShoot,
  reason: idea.reason,
  shootMinutes: String(idea.shootMinutes),
  reel: reelDraftOf(idea.reelBrief),
});

/** The reel sheet the draft sends: its own for a Reel Insta, none for any other category. */
const reelOf = (draft: IdeaDraft): ReelBrief | null =>
  draft.category === REEL_DROP_CATEGORY ? reelBriefOf(draft.reel) : null;

/** Why the draft cannot be sent as it is, field by field; empty when it can. */
export function draftProblems(draft: IdeaDraft): Partial<Record<keyof IdeaDraft, string>> {
  const problems: Partial<Record<keyof IdeaDraft, string>> = {};
  const title = draft.title.trim();
  if (title === '') problems.title = 'Donne-lui un titre.';
  else if (title.length > 80) problems.title = '80 caractères au plus : c’est le titre de son agenda.';
  if (draft.toShoot.trim() === '') problems.toShoot = 'Dis ce qu’elle tourne.';
  else if (draft.toShoot.trim().length > 600) problems.toShoot = '600 caractères au plus.';
  if (draft.reason.trim() === '') problems.reason = 'Une phrase sur pourquoi.';
  else if (draft.reason.trim().length > 200) problems.reason = '200 caractères au plus.';
  const minutes = Number(draft.shootMinutes.trim());
  if (!/^\d{1,3}$/u.test(draft.shootMinutes.trim()) || minutes < 1 || minutes > 600)
    problems.shootMinutes = 'Entre 1 et 600 minutes.';
  // Said under the reel sheet's own fields (`ReelBriefFields`); here it only holds the sending back.
  if (draft.category === REEL_DROP_CATEGORY && reelProblems(draft.reel).length > 0) problems.reel = 'reel';
  return problems;
}

/** Only what changed, as the server takes it; `null` when nothing did (validated as it is). */
export function correctionOf(idea: ContentIdeaOfDay, draft: IdeaDraft): ContentIdeaCorrection | null {
  const correction: {
    title?: string;
    category?: ContentIdeaOfDay['category'];
    toShoot?: string;
    reason?: string;
    shootMinutes?: number;
    reelBrief?: ReelBrief | null;
  } = {};
  const title = draft.title.trim();
  const toShoot = draft.toShoot.trim();
  const reason = draft.reason.trim();
  const minutes = Number(draft.shootMinutes.trim());
  if (title !== idea.title) correction.title = title;
  if (draft.category !== idea.category) correction.category = draft.category;
  if (toShoot !== idea.toShoot) correction.toShoot = toShoot;
  if (reason !== idea.reason) correction.reason = reason;
  if (minutes !== idea.shootMinutes) correction.shootMinutes = minutes;
  const reel = reelOf(draft);
  if (JSON.stringify(reel) !== JSON.stringify(idea.reelBrief)) correction.reelBrief = reel;
  return Object.keys(correction).length === 0 ? null : correction;
}
