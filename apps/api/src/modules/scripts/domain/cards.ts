import {
  scriptSegmentCodes,
  type MediaSlot,
  type ScriptCardFormat,
  type ScriptCardTheme,
  type ScriptMoment,
  type ScriptSegment,
  type ScriptStructureVersion,
  type ScriptVariantLetter,
} from '@nirvana/contracts';

/**
 * The card of a segment (ADR 0056 § 3, SC-01 lot b): what the creator reads before she shoots a stage, or between
 * two. Drawn here as an SVG, a pure function of the version, the segment, the variant and the theme: the same input
 * gives the same bytes. The palette is the design system's (`tokens.css`, a test holds them equal); the type is
 * Nirvana's (Instrument Serif for the title, Geist for the rest). Flat, no glass: it is a file in a folder too.
 */

export type CardTheme = ScriptCardTheme;

/** The theme a card takes when none is asked: the structure's moment, and « les deux » is Nuit. */
export const defaultCardTheme = (moment: ScriptMoment): CardTheme => (moment === 'day' ? 'day' : 'night');

/** Light for Jour, dark for Nuit (Extension's review of ADR 0056). */
export const CARD_PALETTES: Readonly<
  Record<
    CardTheme,
    {
      readonly background: string;
      readonly surface: string;
      readonly ink: string;
      readonly muted: string;
      readonly accent: string;
      readonly accentInk: string;
      readonly hairline: string;
    }
  >
> = {
  // tokens.css, `:root` (Nuit): --nv-void, --nv-surface-raised, --nv-ink, --nv-ink-muted, --nv-neon, --nv-neon-ink.
  night: {
    background: '#060508',
    surface: '#17131a',
    ink: '#f8f3f4',
    muted: '#bfb4b9',
    accent: '#ff2a4d',
    accentInk: '#ff8fa0',
    hairline: '#2a2329',
  },
  // tokens.css, light theme (Jour): the same tokens.
  day: {
    background: '#f6f1f3',
    surface: '#ffffff',
    ink: '#1b1016',
    muted: '#5e5157',
    accent: '#cc0029',
    accentInk: '#b0002a',
    hairline: '#e2d8dc',
  },
};

/** What a card says, before it is drawn. */
export interface CardContent {
  /** « Étape 2 », « Étape 2 · Variante A », « Pont · Étape 1 → Étape 2 ». */
  readonly kicker: string;
  /** « Jour » or « Nuit ». */
  readonly moment: string;
  /** The stage's name, or the bridge's teaser. */
  readonly title: string;
  /** « 3 photos, 1 vidéo de 1 à 2 min »; empty for a bridge. */
  readonly shoot: string;
  /** What it sells, the variant's difference, or the two stages a bridge joins. */
  readonly lines: readonly string[];
  /** The slots' hints, in order (« 01 · Face caméra »). */
  readonly hints: readonly string[];
  readonly mood: string | null;
  readonly structureName: string;
}

/** A no-break space: a number stays with its unit when a line is cut (Geist has no narrow one). */
const NBSP = '\u00a0';

const plural = (count: number, one: string, many: string): string =>
  `${String(count)}${NBSP}${count > 1 ? many : one}`;

/** « 30 s », « 1 min », « 1 min 30 », each kept on one line. */
export function duration(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}${NBSP}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0
    ? `${String(minutes)}${NBSP}min`
    : `${String(minutes)}${NBSP}min${NBSP}${String(rest).padStart(2, '0')}`;
}

/** « de 1 à 2 min », « de 45 s à 1 min 30 », « de 2 min » when both are the same. */
function span(min: number, max: number): string {
  if (min === max) return `de ${duration(min)}`;
  if (min % 60 === 0 && max % 60 === 0 && min >= 60) return `de ${String(min / 60)}${NBSP}à ${duration(max)}`;
  return `de ${duration(min)} à ${duration(max)}`;
}

const slotPhrase = (
  slot: MediaSlot,
): { readonly key: string; readonly one: string; readonly many: string } => {
  switch (slot.kind) {
    case 'image':
      return { key: 'image', one: 'photo', many: 'photos' };
    case 'video': {
      const length = span(slot.minSeconds, slot.maxSeconds);
      return { key: `video:${length}`, one: `vidéo ${length}`, many: `vidéos ${length}` };
    }
    case 'audio': {
      const length = `de ${duration(slot.maxSeconds)} max`;
      return { key: `audio:${length}`, one: `vocal ${length}`, many: `vocaux ${length}` };
    }
  }
};

/**
 * What to shoot, in one line, the same kinds gathered in the order they first come: « 3 photos, 1 vidéo de 1 à
 * 2 min ». The optional ones follow: « + 1 photo en option ».
 */
export function shootSummary(slots: readonly MediaSlot[]): string {
  const sum = (optional: boolean): string[] => {
    const groups = new Map<string, { one: string; many: string; count: number }>();
    for (const slot of slots) {
      if (slot.optional !== optional) continue;
      const phrase = slotPhrase(slot);
      const group = groups.get(phrase.key);
      if (group === undefined) groups.set(phrase.key, { one: phrase.one, many: phrase.many, count: 1 });
      else group.count += 1;
    }
    return [...groups.values()].map((group) => plural(group.count, group.one, group.many));
  };
  const required = sum(false).join(', ');
  const optional = sum(true);
  if (optional.length === 0) return required;
  const extra = `${optional.join(', ')} en option`;
  return required === '' ? extra : `${required} + ${extra}`;
}

/**
 * The content of one segment's card. `variant` names one of a stage's variants (its own card); absent, the card is
 * the stage's. `null` for a key the version does not hold, or a variant the stage does not have.
 */
export function cardContent(
  version: ScriptStructureVersion,
  key: string,
  options: { readonly variant?: ScriptVariantLetter; readonly theme: CardTheme },
): CardContent | null {
  const codes = new Map(scriptSegmentCodes(version.segments).map((code) => [code.key, code.code]));
  const stages = new Map<string, Extract<ScriptSegment, { kind: 'stage' }>>();
  for (const segment of version.segments) if (segment.kind === 'stage') stages.set(segment.key, segment);
  const segment = version.segments.find((candidate) => candidate.key === key);
  if (segment === undefined) return null;
  const moment = options.theme === 'day' ? 'Jour' : 'Nuit';
  const number = (stageKey: string): string => (codes.get(stageKey) ?? 'E?').slice(1);

  if (segment.kind === 'bridge') {
    if (options.variant !== undefined) return null;
    const from = stages.get(segment.from);
    const to = stages.get(segment.to);
    return {
      kicker: `Pont · Étape ${number(segment.from)} → Étape ${number(segment.to)}`,
      moment,
      title: segment.teaser,
      shoot: '',
      lines: from === undefined || to === undefined ? [] : [`Entre « ${from.name} » et « ${to.name} »`],
      hints: [],
      mood: null,
      structureName: version.name,
    };
  }
  const variant =
    options.variant === undefined
      ? undefined
      : segment.variants.find((candidate) => candidate.letter === options.variant);
  if (options.variant !== undefined && variant === undefined) return null;
  return {
    kicker: `Étape ${number(segment.key)}${variant === undefined ? '' : ` · Variante ${variant.letter}`}`,
    moment,
    title: segment.name,
    shoot: shootSummary(segment.mediaSlots),
    lines: variant === undefined ? [segment.intention] : [segment.intention, variant.hint],
    hints: segment.mediaSlots.flatMap((slot, index) =>
      slot.hint === null ? [] : [`${String(index + 1).padStart(2, '0')} · ${slot.hint}`],
    ),
    mood: segment.mood,
    structureName: version.name,
  };
}

/** The sizes a card is drawn in: one design, three sizes (ADR 0056 § 3). */
const CARD_FORMATS: Readonly<Record<ScriptCardFormat, number>> = {
  /** The card in the app, scaled by the screen. */
  card: 1080,
  /** The PNG put in the folder, in front of its stage's media. */
  folder: 1080,
  /** The chatters' thumbnail. */
  thumbnail: 320,
};
export type CardFormat = ScriptCardFormat;

const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/**
 * Words cut into lines of `width` characters at most, `lines` lines at most, the last one ending in « … » when the
 * text is longer. A character count, not a measure: the widths below are set for the widest letters of each face.
 */
export function wrap(text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  // Cut on plain spaces only: a no-break space holds its two words together.
  for (const word of text.split(/[ \t\n\r]+/u).filter((piece) => piece !== '')) {
    const piece = word.length > width ? `${word.slice(0, width - 1)}…` : word;
    const last = out.at(-1);
    if (last !== undefined && `${last} ${piece}`.length <= width) out[out.length - 1] = `${last} ${piece}`;
    else out.push(piece);
  }
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  const end = kept[lines - 1] ?? '';
  kept[lines - 1] = `${end.length >= width ? end.slice(0, width - 1) : end}…`;
  return kept;
}

const SIZE = 1080;
const PAD = 96;
const SERIF = "'Instrument Serif', serif";
const SANS = "'Geist', sans-serif";

/**
 * The card as an SVG of 1080 × 1080 units, drawn at the format's size. Only text, rectangles and lines: no image, no
 * link, no font file named, so the rasteriser opens nothing but the SVG itself.
 */
export function cardSvg(content: CardContent, theme: CardTheme, format: CardFormat): string {
  const p = CARD_PALETTES[theme];
  const px = CARD_FORMATS[format];
  const parts: string[] = [];
  const text = (
    x: number,
    y: number,
    value: string,
    style: { size: number; family: string; fill: string; weight?: number; spacing?: number; anchor?: 'end' },
  ) =>
    parts.push(
      `<text x="${String(x)}" y="${String(y)}" font-family="${style.family}" font-size="${String(style.size)}"` +
        ` font-weight="${String(style.weight ?? 400)}" fill="${style.fill}"` +
        (style.spacing === undefined ? '' : ` letter-spacing="${String(style.spacing)}"`) +
        (style.anchor === undefined ? '' : ` text-anchor="${style.anchor}"`) +
        `>${escape(value)}</text>`,
    );

  parts.push(`<rect width="${String(SIZE)}" height="${String(SIZE)}" fill="${p.background}"/>`);
  parts.push(
    `<rect x="48" y="48" width="${String(SIZE - 96)}" height="${String(SIZE - 96)}" rx="40" fill="${p.surface}"/>`,
  );
  parts.push(`<rect x="${String(PAD)}" y="128" width="64" height="6" rx="3" fill="${p.accent}"/>`);
  text(PAD, 196, content.kicker.toLocaleUpperCase('fr'), {
    size: 30,
    family: SANS,
    fill: p.accentInk,
    weight: 600,
    spacing: 4,
  });
  text(SIZE - PAD, 196, content.moment.toLocaleUpperCase('fr'), {
    size: 26,
    family: SANS,
    fill: p.muted,
    weight: 500,
    spacing: 4,
    anchor: 'end',
  });

  let y = 330;
  for (const line of wrap(content.title, 20, content.shoot === '' ? 3 : 2)) {
    text(PAD, y, line, { size: 112, family: SERIF, fill: p.ink });
    y += 112;
  }
  y += 8;
  if (content.shoot !== '') {
    for (const line of wrap(content.shoot, 46, 2)) {
      text(PAD, y, line, { size: 40, family: SANS, fill: p.accentInk, weight: 600 });
      y += 52;
    }
    y += 12;
  }
  for (const sentence of content.lines) {
    for (const line of wrap(sentence, 54, 2)) {
      text(PAD, y, line, { size: 34, family: SANS, fill: p.muted });
      y += 46;
    }
    y += 6;
  }
  if (content.hints.length > 0) {
    y += 18;
    parts.push(
      `<line x1="${String(PAD)}" y1="${String(y)}" x2="${String(SIZE - PAD)}" y2="${String(y)}" stroke="${p.hairline}" stroke-width="2"/>`,
    );
    y += 58;
    const bottom = content.mood === null ? 960 : 900;
    const room = Math.max(1, Math.floor((bottom - y) / 46) + 1);
    const shown = content.hints.length > room ? content.hints.slice(0, Math.max(0, room - 1)) : content.hints;
    for (const hint of shown) {
      text(PAD, y, wrap(hint, 52, 1)[0] ?? '', { size: 32, family: SANS, fill: p.ink });
      y += 46;
    }
    if (shown.length < content.hints.length)
      text(PAD, y, `+ ${String(content.hints.length - shown.length)}`, {
        size: 32,
        family: SANS,
        fill: p.muted,
      });
  }
  if (content.mood !== null)
    text(PAD, 950, wrap(content.mood, 40, 1)[0] ?? '', { size: 44, family: SERIF, fill: p.ink });
  text(SIZE - PAD, 1004, wrap(content.structureName, 28, 1)[0] ?? '', {
    size: 24,
    family: SANS,
    fill: p.muted,
    anchor: 'end',
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(px)}" height="${String(px)}"` +
    ` viewBox="0 0 ${String(SIZE)} ${String(SIZE)}">${parts.join('')}</svg>`
  );
}
