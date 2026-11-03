import {
  scriptCardInk,
  scriptSegmentCodes,
  SCRIPT_CARD_INKS,
  type MediaSlot,
  type ScriptCardFormat,
  type ScriptColor,
  type ScriptMoment,
  type ScriptStructureVersion,
  type ScriptVariantLetter,
} from '@nirvana/contracts';

/**
 * The card of a segment (ADR 0056 § 3, ADR 0064, SC-01 lot b): what the creator reads before she shoots a stage, or
 * between two. OnlyScript's design in Nirvana's type: the script's colour as a gradient over the whole card, « ÉTAPE
 * n » and the stage's name centred, what it sells in quotes with « (GRATUIT) » or « (PAYANT) », what to shoot, the
 * series at the foot, an arch for a bridge, an arrow for a series. Drawn as an SVG, a pure function of the version,
 * the segment and the variant: the same input gives the same bytes.
 */

/** What a card says, before it is drawn. */
export interface CardContent {
  readonly kind: 'stage' | 'series' | 'bridge';
  /** « ÉTAPE 2 », « PONT 2 & 3 ». */
  readonly title: string;
  /** The stage's name, « Série A », or nothing for a bridge. */
  readonly subtitle: string;
  /** What it sells, the series' instruction, or the bridge's teaser: in quotes on the card. */
  readonly quote: string;
  /** « GRATUIT » or « PAYANT ». */
  readonly access: 'GRATUIT' | 'PAYANT';
  /** « 3 photos, 1 vidéo de 1 à 2 min »; empty when there is nothing to shoot. */
  readonly shoot: string;
  /** The slots' hints, in order (« 01 · Face caméra »). */
  readonly hints: readonly string[];
  readonly mood: string | null;
  /** A stage's series, for its foot: « Série A », « Série B ». */
  readonly series: readonly string[];
  /** « JOUR », « NUIT », « JOUR ET NUIT ». */
  readonly moment: string;
  readonly structureName: string;
  readonly color: ScriptColor;
}

const MOMENT_LABELS: Readonly<Record<ScriptMoment, string>> = {
  day: 'JOUR',
  night: 'NUIT',
  both: 'JOUR ET NUIT',
};

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
  const extra = `${optional.join(', ')} en${NBSP}option`;
  return required === '' ? extra : `${required} + ${extra}`;
}

/**
 * The content of one segment's card. `variant` names one of a stage's variants (its series card); absent, the card
 * is the stage's. `null` for a key the version does not hold, or a variant the stage does not have.
 */
export function cardContent(
  version: ScriptStructureVersion,
  key: string,
  options: { readonly variant?: ScriptVariantLetter } = {},
): CardContent | null {
  const codes = new Map(scriptSegmentCodes(version.segments).map((code) => [code.key, code.code]));
  const segment = version.segments.find((candidate) => candidate.key === key);
  if (segment === undefined) return null;
  const number = (stageKey: string): string => (codes.get(stageKey) ?? 'E?').slice(1);
  const common = { moment: MOMENT_LABELS[version.moment], structureName: version.name, color: version.color };

  if (segment.kind === 'bridge') {
    if (options.variant !== undefined) return null;
    return {
      ...common,
      kind: 'bridge',
      title: `PONT ${number(segment.from)} & ${number(segment.to)}`,
      subtitle: '',
      quote: segment.teaser,
      access: 'GRATUIT',
      shoot: shootSummary(segment.mediaSlots),
      hints: hintsOf(segment.mediaSlots),
      mood: null,
      series: [],
    };
  }
  const access = segment.access === 'free' ? 'GRATUIT' : 'PAYANT';
  if (options.variant !== undefined) {
    const variant = segment.variants.find((candidate) => candidate.letter === options.variant);
    if (variant === undefined) return null;
    return {
      ...common,
      kind: 'series',
      title: `ÉTAPE ${number(segment.key)}`,
      subtitle: `Série ${variant.letter}`,
      quote: variant.hint,
      access,
      shoot: shootSummary(segment.mediaSlots),
      hints: [],
      mood: null,
      series: [],
    };
  }
  return {
    ...common,
    kind: 'stage',
    title: `ÉTAPE ${number(segment.key)}`,
    subtitle: segment.name,
    quote: segment.intention,
    access,
    // Each series is shot in full, as OnlyScript's « 3 variantes de 3 photos + 1 vidéo chacune » said.
    shoot: `${shootSummary(segment.mediaSlots)}${segment.variants.length > 1 ? `, par${NBSP}série` : ''}`,
    hints: hintsOf(segment.mediaSlots),
    mood: segment.mood,
    series: segment.variants.map((variant) => `Série ${variant.letter}`),
  };
}

const hintsOf = (slots: readonly MediaSlot[]): string[] =>
  slots.flatMap((slot, index) =>
    slot.hint === null ? [] : [`${String(index + 1).padStart(2, '0')} · ${slot.hint}`],
  );

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
 * text is longer. A character count, not a measure: the widths below hold for ordinary French text; a line of capitals or digits in Geist may run a little wide (Extension's review of SC-01 b).
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
const MID = SIZE / 2;
const SERIF = "'Instrument Serif', serif";
const SANS = "'Geist', sans-serif";
/** Three hints at least when she has them: the quote, the name and what to shoot are cut first (Extension). */
const HINTS_KEPT = 3;

interface TextStyle {
  readonly size: number;
  readonly family: string;
  readonly weight?: number;
  readonly spacing?: number;
  readonly anchor?: 'start' | 'middle' | 'end';
  readonly fill?: string;
  readonly opacity?: number;
}

/** The ink a card is written in: the readable one of the two, dark if a stored colour somehow reads with neither. */
const inkOf = (color: ScriptColor): string => scriptCardInk(color) ?? SCRIPT_CARD_INKS.dark;

/**
 * The card as an SVG of 1080 × 1080 units, drawn at the format's size. Only text, gradients, rectangles and paths:
 * no image, no link, no font file named, so the rasteriser opens nothing but the SVG itself.
 */
export function cardSvg(content: CardContent, format: CardFormat): string {
  const ink = inkOf(content.color);
  const parts: string[] = [];
  const text = (x: number, y: number, value: string, style: TextStyle): void => {
    parts.push(
      `<text x="${String(x)}" y="${String(y)}" font-family="${style.family}" font-size="${String(style.size)}"` +
        ` font-weight="${String(style.weight ?? 400)}" fill="${style.fill ?? ink}"` +
        (style.opacity === undefined ? '' : ` fill-opacity="${String(style.opacity)}"`) +
        (style.spacing === undefined ? '' : ` letter-spacing="${String(style.spacing)}"`) +
        ` text-anchor="${style.anchor ?? 'middle'}">${escape(value)}</text>`,
    );
  };
  const { primary, secondary, accent } = content.color;
  parts.push(
    `<defs><linearGradient id="tone" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${primary}"/><stop offset="0.5" stop-color="${secondary}"/>` +
      `<stop offset="1" stop-color="${accent}"/></linearGradient></defs>`,
    `<rect width="${String(SIZE)}" height="${String(SIZE)}" fill="url(#tone)"/>`,
  );

  if (format === 'thumbnail') thumbnail(content, text);
  else body(content, ink, text, parts);

  const px = CARD_FORMATS[format];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(px)}" height="${String(px)}"` +
    ` viewBox="0 0 ${String(SIZE)} ${String(SIZE)}">${parts.join('')}</svg>`
  );
}

type DrawText = (x: number, y: number, value: string, style: TextStyle) => void;

/** The chatters' thumbnail: the stage, its name and what to shoot, large enough to read at 320 px. */
function thumbnail(content: CardContent, text: DrawText): void {
  let y = 300;
  text(MID, y, content.title, { size: 120, family: SANS, weight: 700, spacing: 4 });
  y += 150;
  for (const line of wrap(content.subtitle, 16, 2)) {
    text(MID, y, line, { size: 130, family: SERIF });
    y += 130;
  }
  y += 40;
  for (const line of wrap(content.shoot, 28, 3)) {
    text(MID, y, line, { size: 60, family: SANS, weight: 600 });
    y += 74;
  }
}

/** The card's body at 1080: OnlyScript's centred column, between the top band and the foot. */
function body(content: CardContent, ink: string, text: DrawText, parts: string[]): void {
  // The top band: the moment on the left, the structure's name on the right, small.
  text(96, 120, content.moment, {
    size: 28,
    family: SANS,
    weight: 600,
    spacing: 5,
    anchor: 'start',
    opacity: 0.85,
  });
  text(SIZE - 96, 120, wrap(content.structureName, 30, 1)[0] ?? '', {
    size: 26,
    family: SANS,
    anchor: 'end',
    opacity: 0.75,
  });

  // The foot: a box per series, an arch for a bridge, an arrow for a series card, or nothing.
  const foot =
    content.kind === 'bridge'
      ? 'arch'
      : content.kind === 'series'
        ? 'arrow'
        : content.series.length > 0
          ? 'boxes'
          : 'none';
  const top = 170;
  const footTop = { arch: 850, arrow: 820, boxes: 890, none: 1010 }[foot];
  const avail = footTop - top - 30;
  const mood = content.mood === null ? null : (wrap(content.mood, 40, 1)[0] ?? '');
  const moodHeight = mood === null ? 0 : 70;
  const wanted = content.hints.length <= HINTS_KEPT ? content.hints.length : HINTS_KEPT + 1;
  const last = { subtitle: 1, quote: 1, shoot: 1 };
  const layouts = [
    { subtitle: 2, quote: 3, shoot: 2 },
    { subtitle: 2, quote: 2, shoot: 2 },
    { subtitle: 1, quote: 2, shoot: 2 },
    { subtitle: 1, quote: 1, shoot: 2 },
    last,
  ];
  const plan = (layout: { subtitle: number; quote: number; shoot: number }) => {
    const subtitle = content.subtitle === '' ? [] : wrap(content.subtitle, 20, layout.subtitle);
    const quoteText = `« ${content.quote} »${content.kind === 'series' ? '' : ` (${content.access})`}`;
    const quote = content.quote === '' ? [] : wrap(quoteText, 40, layout.quote);
    const shoot = content.shoot === '' ? [] : wrap(content.shoot, 40, layout.shoot);
    // Baselines from the top of « ÉTAPE n »: its capitals are 84 high.
    let height = 84 + subtitle.length * 108;
    if (quote.length > 0) height += 30 + quote.length * 54;
    if (shoot.length > 0) height += 30 + shoot.length * 54;
    const room =
      content.hints.length === 0 ? 0 : Math.max(0, Math.floor((avail - height - 60 - moodHeight) / 44) + 1);
    return { subtitle, quote, shoot, height, room };
  };
  const chosen = layouts.map(plan).find((candidate) => candidate.room >= wanted) ?? plan(last);
  // Never « + N » alone: the last line of room says how many more there are, under one hint at least.
  const fits = content.hints.length <= chosen.room;
  const shown = fits ? content.hints : content.hints.slice(0, Math.max(1, chosen.room - 1));
  const more = content.hints.length - shown.length;
  const hintLines = shown.length + (more > 0 ? 1 : 0);
  const total = chosen.height + (hintLines === 0 ? 0 : 16 + hintLines * 44) + moodHeight + 16;
  let y = top + Math.max(0, (avail - total) / 2) + 84;

  text(MID, y, content.title, { size: 116, family: SANS, weight: 700, spacing: 6 });
  for (const line of chosen.subtitle) {
    y += 108;
    text(MID, y, line, { size: 104, family: SERIF });
  }
  if (chosen.quote.length > 0) y += 30;
  for (const line of chosen.quote) {
    y += 54;
    text(MID, y, line, { size: 40, family: SANS, opacity: 0.92 });
  }
  if (chosen.shoot.length > 0) y += 30;
  for (const line of chosen.shoot) {
    y += 54;
    text(MID, y, line, { size: 42, family: SANS, weight: 700 });
  }
  if (hintLines > 0) y += 16;
  for (const hint of shown) {
    y += 44;
    text(MID, y, wrap(hint, 50, 1)[0] ?? '', { size: 32, family: SANS, opacity: 0.9 });
  }
  if (more > 0) {
    y += 44;
    text(MID, y, `+${NBSP}${plural(more, 'indication', 'indications')}`, {
      size: 30,
      family: SANS,
      opacity: 0.75,
    });
  }
  if (mood !== null) text(MID, y + moodHeight, mood, { size: 46, family: SERIF });

  if (foot === 'boxes') {
    // OnlyScript's boxes: light, with dark text, whatever the colour.
    const count = content.series.length;
    const gap = 36;
    const width = Math.min(300, (SIZE - 2 * 96 - gap * (count - 1)) / count);
    const left = MID - (count * width + gap * (count - 1)) / 2;
    content.series.forEach((label, index) => {
      const x = left + index * (width + gap);
      parts.push(
        `<rect x="${String(x)}" y="920" width="${String(width)}" height="100" rx="22" fill="#ffffff" fill-opacity="0.9"/>`,
      );
      text(x + width / 2, 984, label, { size: 36, family: SANS, weight: 600, fill: SCRIPT_CARD_INKS.dark });
    });
  } else if (foot === 'arch')
    parts.push(
      `<path d="M 290 990 A 250 120 0 0 1 790 990" fill="none" stroke="${ink}" stroke-opacity="0.85"` +
        ` stroke-width="18" stroke-linecap="round"/>`,
    );
  else if (foot === 'arrow')
    parts.push(
      `<path d="M 380 900 H 600 V 850 L 720 935 L 600 1020 V 970 H 380 Z" fill="${ink}" fill-opacity="0.9"/>`,
    );
}
