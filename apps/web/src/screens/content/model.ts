import {
  DROP_CATEGORY_LABELS,
  DROP_FORMAT_RULES,
  DROP_MIME_TYPES,
  WITHDRAWABLE_DROP_STATES,
  kindOfMime,
  scriptDropCode,
  type ContentDrop,
  type ContentDropFile,
  type ContentRequest,
  type DropCategory,
  type DropMediaKind,
  type DropMime,
  type DropState,
} from '@impera/contracts';

import { MOMENT_EMOJIS, MOMENT_LABELS } from '@/creators/scripts/model';

/*
 * Contenu, the creator's (CR-06 d, ADR 0055 § 8): what she is asked for, what she drops, where it is. Pure rules here,
 * so that the screen only lays them out and the tests read them without a browser.
 */

/** One emoji per category, as the agenda has one per kind of task (Charles, 05/11): she finds hers at a glance. */
export const CATEGORY_EMOJIS: Readonly<Record<DropCategory, string>> = {
  feed_shoot: '📸',
  feed_video: '🎬',
  script: '📜',
  mass_dm: '💌',
  reveal_story: '✨',
  instagram_story: '📱',
  instagram_reel: '🎞️',
  instagram_post: '🖼️',
  telegram_post: '📣',
};

/** What she puts in each category, in her words (ADR 0055 § 1, « Ce qu'elle y met »). */
export const CATEGORY_HINTS: Readonly<Record<DropCategory, string>> = {
  feed_shoot: 'Quelques photos sexy et de courtes vidéos d’une même séance',
  feed_video: 'Une vidéo verticale',
  script: 'Le script à tourner, étape par étape',
  mass_dm: 'Une petite photo, une petite vidéo ou un petit vocal',
  reveal_story: 'Une photo ou une vidéo verticale',
  instagram_story: 'Une photo ou une vidéo verticale',
  instagram_reel: 'Une vidéo verticale',
  instagram_post: 'Une ou plusieurs photos',
  telegram_post: 'Une vidéo ou une photo',
};

/**
 * The tiles of « Déposer », grouped by where they go (relecture Extension). A category shows only when its output
 * exists for her (ADR 0055 § 1): Reveal today; Instagram and Telegram join with their connection (PUB-01, PUB-02).
 * A script is never dropped from a tile: only from the request that names its structure.
 */
export const DROP_OUTPUTS: readonly {
  readonly name: string;
  readonly categories: readonly DropCategory[];
}[] = [{ name: 'Reveal', categories: ['feed_shoot', 'feed_video', 'reveal_story', 'mass_dm'] }];

/** The extensions a browser may give no type for (MKV often), read as the type they are (ADR 0070 § 2). */
const MIME_BY_EXTENSION: Readonly<Record<string, DropMime>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  m4v: 'video/x-m4v',
  '3gp': 'video/3gpp',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/x-m4a',
  aac: 'audio/aac',
};

const isDropMime = (type: string): type is DropMime => DROP_MIME_TYPES.some((mime) => mime === type);

/**
 * The type a file goes up as: the one her browser gives when it is in the list, otherwise the one its extension says.
 * The server reads the bytes anyway (ADR 0055 § 3): a renamed file is refused there. `null` when neither is known.
 */
export function mimeOf(file: { readonly name: string; readonly type: string }): DropMime | null {
  if (isDropMime(file.type)) return file.type;
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? null;
}

/** What the gallery picker offers for a category: its kinds, and the extensions a browser may not type. */
export function acceptOf(category: DropCategory): string {
  const { kinds } = DROP_FORMAT_RULES[category];
  const parts: string[] = [];
  if (kinds.includes('image')) parts.push('image/*', '.heic', '.heif');
  if (kinds.includes('video')) parts.push('video/*', '.mov', '.m4v', '.3gp', '.mkv', '.webm', '.avi');
  if (kinds.includes('audio')) parts.push('audio/*', '.m4a', '.mp3', '.aac');
  return parts.join(',');
}

/**
 * Her files in the order she wants them (Charles, 05/11: « une suite de médias précise »): the item at `index` moved
 * one place up (`-1`) or down (`+1`); the list unchanged at either end. The drop keeps this order, file by file.
 */
export function moved<T>(list: readonly T[], index: number, step: -1 | 1): T[] {
  const target = index + step;
  const item = list[index];
  const other = list[target];
  if (item === undefined || other === undefined) return [...list];
  const next = [...list];
  next[index] = other;
  next[target] = item;
  return next;
}

/** The same file picked twice (same name, weight and date): it goes once. */
export const sameFile = (
  a: { readonly name: string; readonly size: number; readonly lastModified: number },
  b: { readonly name: string; readonly size: number; readonly lastModified: number },
): boolean => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/** Said when a file is of no type we take, whatever its category. */
export const UNKNOWN_TYPE = 'Ce type de fichier n’est pas pris : choisis une photo, une vidéo ou un vocal';

/** Her open requests, the nearest first (« À tourner »): those a drop already answers are on their way. */
export function openRequests(requests: readonly ContentRequest[]): ContentRequest[] {
  return requests
    .filter((request) => request.state === 'open' && request.dropId === null)
    .toSorted((a, b) => a.dueOn.localeCompare(b.dueOn) || a.createdAt.localeCompare(b.createdAt));
}

/** Out of her hands: published, or a script her team copied into Reveal (SC-03 c, recette créatrice 8). */
const isOut = (drop: ContentDrop): boolean => drop.state === 'published' || drop.exportedAt !== null;

/** « En route »: what she dropped and is not out yet, newest first; a withdrawn drop leaves her screen. */
export function onTheirWay(drops: readonly ContentDrop[]): ContentDrop[] {
  return drops.filter((drop) => drop.state !== 'withdrawn' && !isOut(drop));
}

/** « Publié »: what went out, newest first: a script copied into Reveal with it, where her fans will buy it. */
export function published(drops: readonly ContentDrop[]): ContentDrop[] {
  return drops.filter((drop) => drop.state !== 'withdrawn' && isOut(drop));
}

/** « Script S014 » for her sent script, by the number its folder and cards carry; else the category's name. */
export function dropName(drop: ContentDrop): string {
  const label = DROP_CATEGORY_LABELS[drop.category];
  return drop.category === 'script' && drop.scriptNumber !== null
    ? `${label} ${scriptDropCode(drop.scriptNumber)}`
    : label;
}

/** What a drop out of her hands says: what it held, and when it went (« 4 photos · dans Reveal depuis hier »). */
export function outLine(drop: ContentDrop, today: string, zone: string): string {
  const what = contentsOf(drop.files);
  if (drop.exportedAt === null || drop.state === 'published')
    return `${what} · ${droppedOn(drop.createdAt, today, zone)}`;
  const when = droppedOn(drop.exportedAt, today, zone);
  // « Aujourd’hui », « Hier », « Lundi » read in the sentence lowercased; « 12 nov. » takes its « le ».
  const said = /^\d/u.test(when) ? `le ${when}` : when.toLowerCase();
  return `${what} · dans Reveal depuis ${said}`;
}

/** How a drop's state reads (ADR 0055 § 6). */
export const STATE_WORDS: Readonly<Record<DropState, string>> = {
  filling: 'En cours',
  uploading: 'En envoi',
  received: 'Reçu',
  ready: 'Prêt',
  scheduled: 'Programmé',
  published: 'Publié',
  blocked: 'Bloqué',
  withdrawn: 'Retiré',
};

/** The tone of a state's chip: amber only when she has something to do (relecture Extension). */
export function stateTone(drop: ContentDrop): 'warn' | 'ok' | 'calm' {
  if (drop.state === 'blocked') return 'warn';
  if (drop.state === 'ready' || drop.state === 'scheduled' || drop.state === 'published') return 'ok';
  return 'calm';
}

const KIND_COUNTS: Readonly<Record<DropMediaKind, readonly [string, string]>> = {
  image: ['photo', 'photos'],
  video: ['vidéo', 'vidéos'],
  audio: ['vocal', 'vocaux'],
};

/** « 6 photos · 2 vidéos »: what a drop holds, by kind, in the order photo, video, vocal. */
export function contentsOf(files: readonly { readonly kind: DropMediaKind }[]): string {
  const counts = new Map<DropMediaKind, number>();
  for (const file of files) counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1);
  return (['image', 'video', 'audio'] as const)
    .filter((kind) => counts.has(kind))
    .map((kind) => {
      const count = counts.get(kind) ?? 0;
      return `${String(count)} ${KIND_COUNTS[kind][count > 1 ? 1 : 0]}`;
    })
    .join(' · ');
}

/** A file's progress on this phone, while it goes up (`sends.ts`). */
export interface LiveSend {
  readonly sent: number;
  readonly total: number;
  /** Bytes a second over the last seconds; `null` until it is known. */
  readonly rate: number | null;
  /** `queued`: after the files before it. `waiting`: the network dropped, it tries again by itself. */
  readonly phase: 'queued' | 'sending' | 'waiting' | 'done' | 'failed';
}

/** « 2 min », « 40 s », « 1 h 05 »: how long a send has left. */
export function remainingOf(seconds: number): string {
  if (seconds < 60) return `${String(Math.max(1, Math.round(seconds / 5) * 5))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * When a script asked of her is shot, as its request fixed (SC-03, « ok alternance »): on her card, before she begins,
 * as the agency reads it in Créatrices › Scripts (recette MED-05). `null` (a script asked before) says nothing.
 */
export function shotMomentOf(request: ContentRequest): string | null {
  if (request.category !== 'script' || request.moment === null) return null;
  return `${MOMENT_EMOJIS[request.moment]} ${MOMENT_LABELS[request.moment]}`;
}

/** Whether her card offers « Retirer »: a state she may still withdraw, never a script copied into Reveal (MED-08). */
export function mayWithdrawHere(drop: ContentDrop): boolean {
  return WITHDRAWABLE_DROP_STATES.has(drop.state) && drop.exportedAt === null;
}

/**
 * The files of a settled drop (ready or blocked) that were refused, in their order: each keeps its line and its
 * reason on her card (recette MED-03). A replaced file is out of the drop and never shown.
 */
export function refusedOf(drop: ContentDrop): ContentDropFile[] {
  if (drop.state !== 'ready' && drop.state !== 'blocked') return [];
  return drop.files.filter((file) => file.state === 'refused');
}

/** What a file's line says, from its state on the server and, while it goes up here, its progress. */
export function fileLine(file: ContentDropFile, live: LiveSend | undefined): string {
  if (file.state === 'awaiting') {
    if (live === undefined || live.phase === 'failed') return 'Envoi interrompu';
    if (live.phase === 'queued') return 'En attente';
    if (live.phase === 'waiting') return 'Réseau coupé : ça reprend tout seul';
    if (live.phase === 'done') return 'Envoyé';
    const percent = live.total === 0 ? 0 : Math.floor((100 * live.sent) / live.total);
    const left = live.rate === null || live.rate <= 0 ? null : (live.total - live.sent) / live.rate;
    return left === null ? `${String(percent)} %` : `${String(percent)} % · encore ${remainingOf(left)}`;
  }
  // Received: its bytes are whole, the cleaning (or the conversion of a heavy video) runs. She has nothing to do.
  if (file.state === 'received') return 'En préparation';
  if (file.state === 'kept') return 'Bien reçu';
  if (file.state === 'duplicate') return 'Déjà dans ta médiathèque';
  return file.refusal ?? 'Refusé';
}

/** Above this, the sheet asks her to keep the screen on, on Wi-Fi if she can (ADR 0070 § 5). */
export const HEAVY_BYTES = 1_000_000_000;

/** « 1,2 Go », « 340 Mo »: a weight as she reads it. */
export function weightOf(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1).replace('.', ',')} Go`;
  if (bytes >= 999_500) return `${String(Math.round(bytes / 1_000_000))} Mo`;
  // Under a megabyte, in Ko: a photo of 9 Ko is not « 1 Mo », an empty file is not either (recette MED-02).
  if (bytes === 0) return '0 Ko';
  return `${String(Math.max(1, Math.round(bytes / 1000)))} Ko`;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
const MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
] as const;

/** Days from `today` to `day`, both `YYYY-MM-DD` (her own days, never instants). */
const daysBetween = (today: string, day: string): number =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

/** « Pour aujourd’hui », « Pour demain », « Pour jeudi », « Pour le 12 nov. », « En retard depuis lundi ». */
/** « le 3 nov. », with its year when it is not this year's (recette MED-10: « le 1 janv. » said no year). */
export function namedDay(day: string, today: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const named = `le ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''}`;
  return day.slice(0, 4) === today.slice(0, 4) ? named : `${named} ${day.slice(0, 4)}`;
}

export function dueOf(dueOn: string, today: string): { readonly text: string; readonly late: boolean } {
  const days = daysBetween(today, dueOn);
  const date = new Date(`${dueOn}T00:00:00Z`);
  const weekday = WEEKDAYS[date.getUTCDay()] ?? '';
  const named = namedDay(dueOn, today);
  if (days < 0) return { text: `En retard depuis ${days >= -6 ? weekday : named}`, late: true };
  if (days === 0) return { text: 'Pour aujourd’hui', late: false };
  if (days === 1) return { text: 'Pour demain', late: false };
  if (days <= 6) return { text: `Pour ${weekday}`, late: false };
  return { text: `Pour ${named}`, late: false };
}

/** « Aujourd’hui », « Hier », « Lundi », « 12 nov. »: when she dropped it, in her own time. */
export function droppedOn(createdAt: string, today: string, zone: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(createdAt));
  const days = daysBetween(day, today);
  if (days <= 0) return 'Aujourd’hui';
  if (days === 1) return 'Hier';
  const date = new Date(`${day}T00:00:00Z`);
  if (days <= 6) {
    const weekday = WEEKDAYS[date.getUTCDay()] ?? '';
    return weekday.charAt(0).toUpperCase() + weekday.slice(1);
  }
  return `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''}`;
}

/** A category's name, with its emoji. */
export const categoryName = (category: DropCategory): string =>
  `${CATEGORY_EMOJIS[category]} ${DROP_CATEGORY_LABELS[category]}`;

/** The kind of a type, re-exported for the sheet. */
export { kindOfMime };
