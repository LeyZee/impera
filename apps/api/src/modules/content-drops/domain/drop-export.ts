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
}

/** A drop of hers as its archive reads it. */
export interface SentDrop {
  readonly category: Exclude<DropCategory, 'script'>;
  readonly createdAt: Date;
  /** Her time zone: the day of the folder is hers. */
  readonly timezone: string;
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

/**
 * Her drop's folder: `feed-seance-2026-11-11/`, the sheet first (`00-fiche.txt`), then each medium as `01-photo.jpg`,
 * `02-video.mp4`… in her order. A medium waiting for its description says so in the sheet, never a guessed one.
 */
export function dropExportPlan(drop: SentDrop): DropExportPlan {
  const folder = `${FOLDERS[drop.category]}-${dayOf(drop.createdAt, drop.timezone)}`;
  const named = drop.files.map((file, index) => ({
    file,
    name: `${String(index + 1).padStart(2, '0')}-${KIND_NAMES[file.kind]}.${extensionOf(file.mime)}`,
  }));
  const lines = [
    `${DROP_CATEGORY_LABELS[drop.category]} du ${longDay(drop.createdAt, drop.timezone)}`,
    ...(drop.sentence === null ? [] : [`Son mot : ${drop.sentence.replace(/\s+/gu, ' ').trim()}`]),
    '',
    OUTPUTS[drop.category],
    '',
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
