import {
  DROP_CATEGORY_LABELS,
  SCRIPT_EXPORT_MAX_BYTES,
  type DropCategory,
  type DropMediaKind,
} from '@impera/contracts';

import { extensionOf } from './script-export';

/**
 * The archive of any drop of hers but a script (recette créatrice 1): its media in her order, and a sheet with her word
 * and each medium's validated description, for the team that puts it out by hand while the connector cannot (ADR 0044:
 * published by hand). Pure: the store gives the files, the route streams the bytes. A script has its own archive, its
 * folder and its cards (`script-export.ts`).
 */

/** A live kept file of her drop, as the store reads it, in her order. */
export interface DropExportFile {
  readonly kind: DropMediaKind;
  /** The kept medium's type (a converted video is `video/mp4`), not the one her phone declared. */
  readonly mime: string;
  readonly bytes: number;
  readonly storageKey: string;
  /** Its validated description, for the sheet; `null` while none is (an audio note never has one). */
  readonly description: string | null;
  /**
   * Sold by one of her scripts (`mediaInScript`): never offered (ADR 0145 § 2, « un média de script n'est jamais
   * gratuit »), so left out of the archive, and the sheet says so.
   */
  readonly inScript: boolean;
  /** A video's or a vocal's length, when it was read; `null` for a photo or when unknown. */
  readonly durationMs: number | null;
  /**
   * 1 for the file she first sent at its place; 2, 3… for each one sent in place of a medium asked again (« À refaire »)
   * or refused: its name then says `-v2`, `-v3`.
   */
  readonly version: number;
}

/** A drop of hers as its archive reads it. */
export interface SentDrop {
  readonly category: Exclude<DropCategory, 'script'>;
  readonly createdAt: Date;
  /** Her time zone: the day of the folder is hers. */
  readonly timezone: string;
  /**
   * Its rank among her drops of that category on that day of hers, from 1, the oldest first, withdrawn ones counted:
   * two drops of a day never share a folder, and a name never changes.
   */
  readonly dayRank: number;
  /** Her word on the drop, as she wrote it; `null` when she wrote none. */
  readonly sentence: string | null;
  readonly files: readonly DropExportFile[];
}

export interface DropExportPlan {
  readonly folder: string;
  readonly sheetPath: string;
  readonly sheet: string;
  readonly entries: readonly { readonly path: string; readonly storageKey: string }[];
}

/** A folder's name by category: plain ASCII, as a ZIP and every system read it. */
const FOLDERS: Readonly<Record<SentDrop['category'], string>> = {
  feed_shoot: 'feed-seance',
  feed_video: 'feed-video',
  mass_dm: 'relance',
  reveal_story: 'story-reveal',
  instagram_story: 'story-insta',
  instagram_reel: 'reel-insta',
  instagram_post: 'photo-insta',
  telegram_post: 'telegram',
  whale_gift: 'cadeau-baleine',
  voice_beep: 'vocal-bip',
  voice_real: 'vocal-reelle',
  sale_video: 'video-a-vendre',
};

const KIND_NAMES: Readonly<Record<DropMediaKind, string>> = {
  image: 'photo',
  video: 'video',
  audio: 'vocal',
};

/** Where each category goes out, as the sheet says it. */
const OUTPUTS: Readonly<Record<SentDrop['category'], string>> = {
  feed_shoot: 'À publier sur son feed Reveal, en une seule publication, dans cet ordre.',
  feed_video: 'À publier sur son feed Reveal.',
  mass_dm: 'À ranger dans Reveal pour ses relances, dans cet ordre.',
  reveal_story: 'À publier en story sur Reveal, dans cet ordre.',
  instagram_story: 'À publier en story sur Instagram, dans cet ordre.',
  instagram_reel: 'À publier en Reel sur Instagram.',
  instagram_post: 'À publier sur Instagram, dans cet ordre.',
  telegram_post: 'À publier sur son canal Telegram, dans cet ordre.',
  whale_gift: 'À ranger dans Reveal, dossier des cadeaux : offert à un gros fan, jamais revendu.',
  voice_beep:
    'À ranger dans Reveal, dossier des vocaux de l’IA : envoyé à un fan qui la croit un robot, jamais vendu.',
  voice_real:
    'À ranger dans Reveal, dossier des vocaux de l’IA : la preuve qu’elle est bien réelle, jamais vendue.',
  sale_video:
    'À ranger dans Reveal, dossier des vidéos à vendre : vendue au prix de la grille, jamais offerte.',
};

/** Whether her drop's media fit in one archive (a ZIP without ZIP64). */
export const dropFitsInOneArchive = (files: readonly DropExportFile[]): boolean =>
  files.reduce((total, file) => total + file.bytes, 0) <= SCRIPT_EXPORT_MAX_BYTES;

/** « 2026-11-11 », the day of the drop in her time zone. */
function dayOf(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(at);
  const part = (type: string) => parts.find((one) => one.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** « 11 novembre 2026 », as the sheet says it. */
const longDay = (at: Date, timezone: string): string =>
  new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(at);

/** « -38s » after a video's or a vocal's name, when its length is known. */
const lengthOf = (file: DropExportFile): string =>
  file.kind === 'image' || file.durationMs === null
    ? ''
    : `-${String(Math.max(1, Math.round(file.durationMs / 1000)))}s`;

/**
 * Her drop's folder (Charles, 26/11): `feed-seance-2026-11-11-2/`, the sheet first (`00-fiche.txt`), then each medium
 * named in full, so a file taken out of its folder still says where it comes from: `feed-seance-2026-11-11-2-01-photo.jpg`,
 * `feed-seance-2026-11-11-2-02-video-38s.mp4`, `-v2` for a medium sent again… in her order. Never her name, an account nor
 * a place. A medium waiting for its description says so in the sheet, never a guessed one. A
 * medium one of her scripts sells is never in it: the sheet counts those left out, so the team knows why.
 */
export function dropExportPlan(drop: SentDrop): DropExportPlan {
  const folder = `${FOLDERS[drop.category]}-${dayOf(drop.createdAt, drop.timezone)}-${String(drop.dayRank)}`;
  const kept = drop.files.filter((file) => !file.inScript);
  const left = drop.files.length - kept.length;
  const named = kept.map((file, index) => ({
    file,
    name: `${folder}-${String(index + 1).padStart(2, '0')}-${KIND_NAMES[file.kind]}${lengthOf(file)}${file.version > 1 ? `-v${String(file.version)}` : ''}.${extensionOf(file.mime)}`,
  }));
  const lines = [
    `${DROP_CATEGORY_LABELS[drop.category]} du ${longDay(drop.createdAt, drop.timezone)}`,
    ...(drop.sentence === null ? [] : [`Son mot : ${drop.sentence.replace(/\s+/gu, ' ').trim()}`]),
    '',
    OUTPUTS[drop.category],
    '',
    ...(left === 0
      ? []
      : [
          left === 1
            ? 'Un média est laissé de côté : il est vendu dans un de ses scripts, il ne part jamais offert.'
            : `${String(left)} médias sont laissés de côté : ils sont vendus dans ses scripts, ils ne partent jamais offerts.`,
          '',
        ]),
  ];
  for (const { file, name } of named) {
    lines.push(name);
    if (file.kind === 'audio') lines.push('   Note vocale : à écouter.');
    else if (file.description === null) lines.push('   Description à valider dans le CRM.');
    else lines.push(`   ${file.description.replace(/\s+/gu, ' ').trim()}`);
  }
  return {
    folder,
    sheetPath: `${folder}/00-fiche.txt`,
    sheet: `${lines.join('\n').trimEnd()}\n`,
    entries: named.map(({ file, name }) => ({ path: `${folder}/${name}`, storageKey: file.storageKey })),
  };
}
