import {
  DROP_CATEGORY_LABELS,
  SCRIPT_EXPORT_MAX_BYTES,
  type ContentDrop,
  type ContentDropId,
  type CreatorContent,
  type DropCategory,
} from '@impera/contracts';

/**
 * Créatrices › Contenu (recette créatrice 1): every drop of hers but a script, as the agency reads it, the latest first
 * (her séances, stories, relances, Instagram and Telegram), each with what it holds, where it stands, its archive and
 * the gesture that says it is out (ADR 0044: put out by hand while the connector cannot). Pure, so that what the screen
 * offers is tested without it.
 */

export type OutCategory = Exclude<DropCategory, 'script'>;

/** What the team says once it put the drop out, as its button and its state say it. */
export const OUT_LABELS: Readonly<Record<OutCategory, string>> = {
  feed_shoot: 'Publié sur Reveal',
  feed_video: 'Publié sur Reveal',
  reveal_story: 'Publié sur Reveal',
  mass_dm: 'Copié dans Reveal',
  instagram_story: 'Publié sur Instagram',
  instagram_reel: 'Publié sur Instagram',
  instagram_post: 'Publié sur Instagram',
  telegram_post: 'Publié sur Telegram',
};

/** Where it goes out, as its confirmation asks it. */
export const OUT_PLACES: Readonly<Record<OutCategory, string>> = {
  feed_shoot: 'publié sur son feed Reveal',
  feed_video: 'publié sur son feed Reveal',
  reveal_story: 'publié en story sur Reveal',
  mass_dm: 'rangé dans Reveal pour ses relances',
  instagram_story: 'publié en story sur Instagram',
  instagram_reel: 'publié sur Instagram',
  instagram_post: 'publié sur Instagram',
  telegram_post: 'publié sur son canal Telegram',
};

export type DropStanding = 'checking' | 'blocked' | 'too_large' | 'to_publish' | 'out';

export interface HerDropRow {
  readonly dropId: ContentDropId;
  readonly category: OutCategory;
  /** « Feed · Séance boudoir », as her screen says it. */
  readonly label: string;
  readonly sentence: string | null;
  readonly photos: number;
  readonly videos: number;
  readonly vocals: number;
  readonly bytes: number;
  readonly sentAt: string;
  readonly standing: DropStanding;
  readonly blockedReason: string | null;
  readonly exportedAt: string | null;
  /** When her originals go at the latest: 30 days after it is said out (ADR 0044 § 2). */
  readonly originalsUntil: string | null;
}

const SETTLED: ReadonlySet<ContentDrop['state']> = new Set(['ready', 'scheduled', 'published']);
const AFTER_EXPORT_MS = 30 * 86_400_000;

const isOut = (category: DropCategory): category is OutCategory => category !== 'script';

/** Her drops but her scripts (they have their own tab), the latest first; a withdrawn one is gone. */
export function herDrops(content: CreatorContent): readonly HerDropRow[] {
  return content.drops
    .flatMap((drop) => {
      const category = drop.category;
      if (!isOut(category) || drop.state === 'withdrawn') return [];
      const kept = drop.files.filter((file) => file.state === 'kept' || file.state === 'duplicate');
      const bytes = kept.reduce((total, file) => total + file.bytes, 0);
      const standing: DropStanding =
        drop.exportedAt !== null
          ? 'out'
          : drop.state === 'blocked'
            ? 'blocked'
            : !SETTLED.has(drop.state)
              ? 'checking'
              : bytes > SCRIPT_EXPORT_MAX_BYTES
                ? 'too_large'
                : 'to_publish';
      return [
        {
          dropId: drop.id,
          category,
          label: DROP_CATEGORY_LABELS[category],
          sentence: drop.sentence,
          photos: kept.filter((file) => file.kind === 'image').length,
          videos: kept.filter((file) => file.kind === 'video').length,
          vocals: kept.filter((file) => file.kind === 'audio').length,
          bytes,
          sentAt: drop.createdAt,
          standing,
          blockedReason: drop.blockedReason,
          exportedAt: drop.exportedAt,
          originalsUntil:
            drop.exportedAt === null
              ? null
              : new Date(Date.parse(drop.exportedAt) + AFTER_EXPORT_MS).toISOString(),
        },
      ];
    })
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
}

/** « 2 à publier », « tous publiés », as the summary line counts them. */
export function summaryLine(rows: readonly HerDropRow[]): string {
  const head = rows.length === 1 ? '1 dépôt' : `${String(rows.length)} dépôts`;
  const waiting = rows.filter((row) => row.standing === 'to_publish').length;
  if (waiting > 0) return `${head} · ${String(waiting)} à publier`;
  return rows.every((row) => row.standing === 'out')
    ? `${head} · tous publiés`
    : `${head} · aucun à publier pour l’instant`;
}

/** « 2 photos · 1 vidéo · 1 vocal · 12 Mo » */
export function holdsLine(row: Pick<HerDropRow, 'photos' | 'videos' | 'vocals' | 'bytes'>): string {
  const count = (n: number, one: string, many: string) =>
    n === 0 ? [] : [n === 1 ? `1 ${one}` : `${String(n)} ${many}`];
  const parts = [
    ...count(row.photos, 'photo', 'photos'),
    ...count(row.videos, 'vidéo', 'vidéos'),
    ...count(row.vocals, 'vocal', 'vocaux'),
  ];
  const weight =
    row.bytes >= 1_000_000_000
      ? `${(row.bytes / 1_000_000_000).toFixed(1).replace('.', ',')}\u00a0Go`
      : `${String(Math.max(1, Math.round(row.bytes / 1_000_000)))}\u00a0Mo`;
  return parts.length === 0 ? 'Aucun média gardé' : [...parts, weight].join(' · ');
}
