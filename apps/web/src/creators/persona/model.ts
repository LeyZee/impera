import {
  desireBandOf,
  PERSONA_BLOCK_LABELS,
  PERSONA_BLOCKS,
  KycSlotSchema,
  PERSONA_OPTIONS,
  personaCompletion,
  PersonaSchema,
  type Persona,
  type PersonaBlock,
  type PersonaCompletion,
  type KycSlot,
  type PersonaDetails,
  type PersonaSampleReplyFault,
} from '@nirvana/contracts';
import type { z } from 'zod';

import { DESIRE_BAND_LABELS } from '@/agent/desire';
import { GUARD_LABELS } from '@/agent/guards';

/**
 * Rules of the persona screen, without React: its tabs, the validation by `PersonaSchema` with French messages, the
 * one-line summaries of folded blocks and the completion of what is written.
 *
 * Eight tabs (CREA-02, accepted by Charles on 29/10): OnlyChat's six in OnlyChat's order, the five P5-01 blocks
 * gathered in one tab « Elle en détail » after « Infos en plus », each folded, and `limits` last.
 */

/** A block of the persona: one key of `Persona`, written by one tab or one folded section of « Elle en détail ». */
export type BlockId = Exclude<keyof Persona, 'meta'>;

/** The P5-01 blocks, in their order inside « Elle en détail ». */
export const IN_DEPTH_BLOCKS = [
  'lifestyle',
  'tastes',
  'intimate',
  'writing_style',
  'sample_replies',
] as const;
type InDepthBlock = (typeof IN_DEPTH_BLOCKS)[number];

export type TabId = Exclude<BlockId, InDepthBlock> | 'in_depth';

export const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'details', label: PERSONA_BLOCK_LABELS.details },
  { id: 'additional_info', label: 'Infos en plus' },
  { id: 'in_depth', label: 'Elle en détail' },
  { id: 'behavior', label: 'Comportement' },
  { id: 'strategies', label: 'Stratégies' },
  { id: 'follow_ups', label: 'Relances' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'limits', label: PERSONA_BLOCK_LABELS.limits },
];

const isInDepth = (block: string): block is InDepthBlock => IN_DEPTH_BLOCKS.some((b) => b === block);

/** The tab that shows a block: its own, or « Elle en détail » for a P5-01 block. */
export const tabOf = (block: BlockId): TabId => (isInDepth(block) ? 'in_depth' : block);

/** One problem with the draft: the field it belongs to (`strategies.kyc.max_messages`) and what to fix. */
export interface FieldIssue {
  readonly field: string;
  readonly message: string;
}

const BLOCK_IDS: readonly BlockId[] = [
  'details',
  'lifestyle',
  'tastes',
  'intimate',
  'writing_style',
  'sample_replies',
  'additional_info',
  'behavior',
  'strategies',
  'follow_ups',
  'notifications',
  'limits',
];

/** The block a field belongs to (`strategies.kyc.collect` › `strategies`), or undefined for a path out of them. */
export const blockOf = (field: string): BlockId | undefined => {
  const key = field.split('.')[0] ?? '';
  return BLOCK_IDS.find((block) => block === key);
};

/** Where the generic message would not say what to do: a field, then the kind of problem. */
const FIELD_MESSAGES: Readonly<Record<string, Partial<Record<z.core.$ZodIssue['code'], string>>>> = {
  'strategies.kyc.collect': { too_small: 'Garde au moins une info à collecter.' },
};

/** Validates a draft; an empty list means it can be saved as a new version. */
export function validate(draft: Persona): FieldIssue[] {
  const stored = withoutPlaceholders(draft);
  const result = PersonaSchema.safeParse(stored);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const field = issue.path.map(String).join('.');
    // An emptied field with a format (a date) is still to fill in, not wrongly written.
    const empty = issue.code === 'invalid_format' && valueAt(stored, issue.path) === '';
    return {
      field,
      message: empty
        ? 'À remplir'
        : (FIELD_MESSAGES[field]?.[issue.code] ?? frenchMessage(issue, unitOf(field))),
    };
  });
}

/** The value a schema issue points at, or undefined when the path leads nowhere. */
function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key];
    else if (isRecord(current) && typeof key === 'string') current = current[key];
    else return undefined;
  }
  return current;
}

/** The issues of a field, its list items included (`details.hobbies.2` belongs to `details.hobbies`). */
export function issuesOf(issues: readonly FieldIssue[], field: string): FieldIssue[] {
  return issues.filter((issue) => issue.field === field || issue.field.startsWith(`${field}.`));
}

/** How many issues each tab holds, for the badges of the tab bar. */
export function issueCountByTab(issues: readonly FieldIssue[]): Record<TabId, number> {
  const counts: Record<TabId, number> = {
    details: 0,
    additional_info: 0,
    in_depth: 0,
    behavior: 0,
    strategies: 0,
    follow_ups: 0,
    notifications: 0,
    limits: 0,
  };
  for (const issue of issues) {
    const block = blockOf(issue.field);
    if (block !== undefined) counts[tabOf(block)] += 1;
  }
  return counts;
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n > 1 ? many : one}`;

/** The unit each number of the persona is typed in, as its field shows it: a bound says it too (CREA-15). */
const FIELD_UNITS: Readonly<Record<string, string>> = {
  'details.height_cm': 'cm',
  'details.weight_kg': 'kg',
  'details.shoe_size_eu': 'EU',
  'behavior.response_delay_minutes': 'min',
  'strategies.kyc.max_messages': 'messages',
  'strategies.kyc.max_duration_minutes': 'min',
  'strategies.kyc.min_hours_before_following': 'h',
  'strategies.sexualization.initiate_after_hours': 'h',
  'strategies.sexualization.min_desire_to_open': 'sur 100',
  'strategies.script_launch.cooldown_hours': 'h',
  'strategies.script_launch.min_desire': 'sur 100',
  'strategies.post_offer.delay_days': 'jours',
  'follow_ups.delays_hours': 'h',
  'follow_ups.nudges.delay_minutes': 'min',
  'follow_ups.nudges.max_per_day': 'rappels',
  'follow_ups.nudges.min_hours_after_conversation': 'h',
};

/** The unit of a field, a list item taking its list's (`follow_ups.delays_hours.2`). */
const unitOf = (field: string): string | undefined =>
  FIELD_UNITS[field] ?? FIELD_UNITS[field.replace(/\.\d+$/u, '')];

/** A bound with its unit: « 60 min », « 100 sur 100 », « 500 ». */
const bound = (n: number, unit: string | undefined): string =>
  unit === undefined ? String(n) : `${String(n)}\u00a0${unit}`;

/** Zod speaks English; the dashboard speaks French. Messages written in the schema are already French. */
function frenchMessage(issue: z.core.$ZodIssue, unit?: string): string {
  switch (issue.code) {
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string')
        return min <= 1 ? 'À remplir' : `Au moins ${plural(min, 'caractère', 'caractères')}`;
      if (issue.origin === 'array') return `Au moins ${plural(min, 'entrée', 'entrées')}`;
      return `Au moins ${bound(min, unit)}`;
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string') return `${plural(max, 'caractère', 'caractères')} au plus`;
      if (issue.origin === 'array') return `${plural(max, 'entrée', 'entrées')} au plus`;
      return `${bound(max, unit)} au plus`;
    }
    case 'invalid_type':
      return issue.expected === 'number' || issue.expected === 'int' ? 'Nombre entier attendu' : 'À remplir';
    case 'invalid_format':
      // Zod's own messages are English (« Invalid ISO date »); one written in the schema says what to type.
      return /^Invalid\b/u.test(issue.message) ? 'Format invalide' : issue.message;
    case 'invalid_value':
      return 'Choix hors liste';
    case 'custom':
    case 'invalid_element':
    case 'invalid_key':
    case 'invalid_union':
    case 'not_multiple_of':
    case 'unrecognized_keys':
      return issue.message;
  }
}

/**
 * A placeholder of the repository's example persona (`<à remplir>`, `<à remplir : …>`): shown as such, never as a
 * real value. Only those: a value she wrote between chevrons (« <Zoé> ») is hers.
 */
export function isPlaceholder(value: string): boolean {
  return /^<à remplir(?:\s*:[^>]*)?>$/u.test(value.trim());
}

/**
 * The example as a new creator's first draft (recette 28/10): nothing in it that nobody typed. Her date of birth,
 * a safety datum, starts empty and must be filled in; the metadata name her (`meta.creator` is her id) and drop the
 * example's notes. Her first name starts from her name in Nirvana, its first word, when it is known (CREA-13).
 */
export function firstDraft(example: Persona, creatorId: string, name: string | null = null): Persona {
  const first = name?.trim().split(/\s+/u)[0] ?? '';
  return {
    ...example,
    details: {
      ...example.details,
      date_of_birth: '',
      first_name: first === '' ? example.details.first_name : first,
    },
    meta: { ...example.meta, creator: creatorId, notes: null },
  };
}

/** The day it is here (YYYY-MM-DD), read when asked: a version's date and an age follow the local calendar. */
export function localDay(at: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * The persona as it is stored: a placeholder of the example is dropped from a list and emptied in a text, so that
 * the agent never reads `<à remplir>` and a required field left as such is refused.
 */
export function withoutPlaceholders(value: unknown): unknown {
  if (typeof value === 'string') return isPlaceholder(value) ? '' : value;
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item !== 'string' || !isPlaceholder(item)).map(withoutPlaceholders);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutPlaceholders(item)]));
  }
  return value;
}

function labelOf<V extends string | number>(
  options: readonly { readonly value: V; readonly label: string }[],
  value: V,
): string {
  return options.find((option) => option.value === value)?.label ?? String(value);
}

/** What a number still being typed (emptied: NaN) reads as in a summary. */
const UNSET = '…';

export const hoursLabel = (h: number): string => (Number.isFinite(h) ? `${String(h)} h` : UNSET);

export function minutesLabel(m: number): string {
  if (!Number.isFinite(m)) return UNSET;
  if (m < 60) return `${String(m)} min`;
  const rest = m % 60;
  return rest === 0
    ? `${String(m / 60)} h`
    : `${String(Math.floor(m / 60))} h ${String(rest).padStart(2, '0')}`;
}

/** « 165 cm · cheveux noirs · yeux verts · 75C », or what to do when nothing is filled in. */
export function physiqueSummary(d: PersonaDetails): string {
  const parts = [
    d.height_cm === null ? null : `${String(d.height_cm)} cm`,
    d.weight_kg === null ? null : `${String(d.weight_kg)} kg`,
    d.shoe_size_eu === null ? null : `pointure ${String(d.shoe_size_eu)}`,
    d.hair === null ? null : `cheveux ${labelOf(PERSONA_OPTIONS.hair, d.hair).toLocaleLowerCase('fr')}`,
    d.eyes === null ? null : `yeux ${labelOf(PERSONA_OPTIONS.eyes, d.eyes).toLocaleLowerCase('fr')}`,
    d.bra === null ? null : `${String(d.bra.band)}${d.bra.cup}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'Rien de renseigné' : parts.join(' · ');
}

const styleOf = (style: string): string =>
  style === 'custom' ? 'Personnalisé' : style === 'normal' ? 'Normal' : 'Par défaut';

/** The line each strategy shows while folded: its style, then the numbers the policy enforces. */
export function strategySummaries(s: Persona['strategies']): Record<keyof Persona['strategies'], string> {
  return {
    kyc: `${styleOf(s.kyc.style)} · ${Number.isFinite(s.kyc.max_messages) ? String(s.kyc.max_messages) : UNSET} messages, ${minutesLabel(s.kyc.max_duration_minutes)} au plus · le suit s’il chauffe après ${hoursLabel(s.kyc.min_hours_before_following)}${
      s.kyc.collect === undefined
        ? ''
        : ` · ${String(s.kyc.collect.length)} ligne${s.kyc.collect.length > 1 ? 's' : ''} du canevas sur ${String(KycSlotSchema.options.length)}`
    }`,
    sexualization: `${styleOf(s.sexualization.style)} · ouvre après ${hoursLabel(s.sexualization.initiate_after_hours)}`,
    script_launch: `${styleOf(s.script_launch.style)} · au moins ${hoursLabel(s.script_launch.cooldown_hours)} entre deux scripts`,
    post_offer: `${styleOf(s.post_offer.style)} · relance après ${plural(s.post_offer.delay_days, 'jour', 'jours')}`,
  };
}

export function followUpsSummary(f: Persona['follow_ups']): string {
  if (!f.enabled) return 'Désactivées';
  if (f.delays_hours.length === 0) return 'Aucun délai';
  return `${f.delays_hours.map(hoursLabel).join(', ')} après son dernier message`;
}

export function nudgesSummary(n: Persona['follow_ups']['nudges']): string {
  return n.enabled
    ? `${plural(n.max_per_day, 'rappel', 'rappels')} par jour au plus, ${minutesLabel(n.delay_minutes)} après`
    : 'Désactivés';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The fields a draft changed, as paths (`strategies.kyc.max_messages`); a list counts as one field. */
export function changedFields(saved: unknown, draft: unknown, path = ''): string[] {
  if (isRecord(saved) && isRecord(draft)) {
    const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
    return [...keys].flatMap((key) =>
      changedFields(saved[key], draft[key], path === '' ? key : `${path}.${key}`),
    );
  }
  return JSON.stringify(saved) === JSON.stringify(draft) ? [] : [path];
}

/** Whether a field, or anything under it, changed. */
export function hasChange(changed: readonly string[], field: string): boolean {
  return changed.some((path) => path === field || path.startsWith(`${field}.`));
}

type Options<V> = readonly { readonly value: V; readonly label: string }[];

const folded = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr');

/** The options whose label holds what was typed, accents and case aside (« neer » finds Néerlandais). */
export const matchOptions = <V>(options: Options<V>, text: string): Options<V> =>
  options.filter((option) => folded(option.label).includes(folded(text.trim())));

/** Picks or unpicks one option; picks keep the list's order, so the same choice always reads the same way. */
export const togglePick = <V>(options: Options<V>, values: readonly V[], value: V): V[] =>
  values.includes(value)
    ? values.filter((v) => v !== value)
    : options.map((o) => o.value).filter((v) => v === value || values.includes(v));

/** The same pick for a list whose order means something (`strategies.kyc.collect`): a new pick goes last. */
export const appendPick = <V>(values: readonly V[], value: V): V[] =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

/**
 * Under a desire threshold of the persona, in plain words (CREA-10): « À partir de 45 : dès qu'il devient joueur. »,
 * never « bande joueur », which only makes sense to who knows the bands. An empty field takes the default and says it.
 */
export function desireHint(value: number | undefined, fallback: number): string {
  const shown = value ?? fallback;
  const band = desireBandOf(shown);
  const when =
    band === 'neutral' ? 'même s’il reste neutre' : `dès qu’il devient ${DESIRE_BAND_LABELS[band]}`;
  const line = `À partir de ${String(shown)} : ${when}.`;
  return value === undefined ? `Par défaut : ${String(fallback)}. ${line}` : line;
}

/** The time it is in a zone, « 22 h 25 », or nothing for a zone the browser does not know. */
export const localTime = (zone: string, at: Date = new Date()): string => {
  try {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
      .format(at)
      .replace(':', ' h ');
  } catch {
    return '';
  }
};

const semver = (version: string): [number, number, number] => {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return [major, minor, patch];
};

/** The number of the next version: one patch above the highest taken (« 0.1.3 » after 0.1.2 and 0.0.9). */
export function nextVersion(taken: readonly string[]): string {
  const [major, minor, patch] = taken
    .map(semver)
    .reduce<[number, number, number]>(
      (top, v) => ((v[0] - top[0] || v[1] - top[1] || v[2] - top[2]) > 0 ? v : top),
      [0, 0, 0],
    );
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

const real = (list: readonly string[]): string[] => list.filter((entry) => !isPlaceholder(entry));

/**
 * How complete the draft is (`personaCompletion`), read without the placeholders of the example: « <à remplir> » in
 * a list is not something she wrote, nor is a sample reply still empty.
 */
export function draftCompletion(draft: Persona): PersonaCompletion {
  const { details, limits } = draft;
  // A reply added but not yet written is not one: the server would refuse it.
  const written = draft.sample_replies?.filter((reply) => reply.reply.trim() !== '') ?? [];
  return personaCompletion({
    ...draft,
    sample_replies: repliesOrNone(written),
    details: { ...details, hobbies: real(details.hobbies), personality: real(details.personality) },
    limits: {
      never_do: real(limits.never_do),
      never_show: real(limits.never_show),
      never_say: real(limits.never_say),
      disgusts: real(limits.disgusts),
    },
  });
}

const isCompletionBlock = (block: string): block is PersonaBlock => PERSONA_BLOCKS.some((b) => b === block);

/**
 * The gauge never says complete while a field waits to be fixed (CREA-14): the block that holds it counts as still
 * to complete, and the percent stays under 100.
 */
export function withIssues(completion: PersonaCompletion, issues: readonly FieldIssue[]): PersonaCompletion {
  const flagged = new Set<PersonaBlock>();
  for (const issue of issues) {
    const block = blockOf(issue.field);
    if (block !== undefined && isCompletionBlock(block)) flagged.add(block);
  }
  const added = [...flagged].filter((block) => !completion.missing.some((m) => m.block === block));
  if (added.length === 0) return completion;
  const missing = PERSONA_BLOCKS.filter(
    (block) => added.includes(block) || completion.missing.some((m) => m.block === block),
  ).map((block) => ({ block, label: PERSONA_BLOCK_LABELS[block] }));
  return { percent: Math.min(completion.percent, 99), missing };
}

const blank = (value: string | null): boolean => value === null || value.trim() === '';

/** A block whose every field is empty is not written: the version keeps it absent, as before P5-01. */
export function lifestyleOrNone(block: NonNullable<Persona['lifestyle']>): Persona['lifestyle'] {
  return blank(block.occupation) && blank(block.area) && blank(block.routine) && blank(block.goals)
    ? undefined
    : block;
}

export function tastesOrNone(block: NonNullable<Persona['tastes']>): Persona['tastes'] {
  return block.likes.length === 0 && block.dislikes.length === 0 ? undefined : block;
}

export function intimateOrNone(block: NonNullable<Persona['intimate']>): Persona['intimate'] {
  return block.turn_ons.length === 0 && block.fantasies.length === 0 && blank(block.sexting_style)
    ? undefined
    : block;
}

export const repliesOrNone = (list: NonNullable<Persona['sample_replies']>): Persona['sample_replies'] =>
  list.length === 0 ? undefined : list;

/** An emoji as two lists compare it: without the variation selector some keyboards add (« ❤ » and « ❤️ »). */
export const emojiKey = (entry: string): string => entry.replace(/\uFE0F/gu, '');

/**
 * What the server refused at saving (422 `persona_sample_reply_unprocessable`), on the reply it refused: one line per
 * reply, every guard it trips named, as the agent's own refusals say them.
 */
export function refusedReplyIssues(faults: readonly PersonaSampleReplyFault[]): FieldIssue[] {
  const byReply = new Map<number, string[]>();
  for (const { index, code } of faults) {
    const labels = byReply.get(index) ?? [];
    if (!labels.includes(GUARD_LABELS[code])) labels.push(GUARD_LABELS[code]);
    byReply.set(index, labels);
  }
  return [...byReply]
    .sort(([a], [b]) => a - b)
    .map(([index, labels]) => ({
      field: `sample_replies.${String(index)}.reply`,
      message: `L’agent ne l’enverrait pas : ${labels.join(', ')}.`,
    }));
}

/**
 * The canvas lines she collects, in her order: the brain and « À apprendre » follow it. Only every line in the
 * canvas's own order is « all » and leaves `collect` absent, as the schema reads it; any other order is kept.
 */
export const collectOrAll = (slots: KycSlot[]): KycSlot[] | undefined =>
  slots.length === KycSlotSchema.options.length && slots.every((slot, i) => slot === KycSlotSchema.options[i])
    ? undefined
    : slots;

/** What the server refused at the last save (422), with the replies as they were then. */
export interface RefusedReplies {
  readonly issues: readonly FieldIssue[];
  readonly replies: readonly string[];
}

export const NOTHING_REFUSED: RefusedReplies = { issues: [], replies: [] };

/** The refusals that still hold: a refused reply keeps its line until its own text changes, whatever else is edited. */
export function stillRefused(refused: RefusedReplies, draft: Persona): FieldIssue[] {
  return refused.issues.filter((issue) => {
    const index = Number(issue.field.split('.')[1]);
    const reply = draft.sample_replies?.[index]?.reply;
    return reply !== undefined && reply === refused.replies[index];
  });
}
