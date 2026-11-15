import {
  BANKED_OBJECTION_KINDS,
  desireBandOf,
  KycSlotSchema,
  PERSONA_SHEET,
  PERSONA_SHEET_QUESTION_COUNT,
  PersonaV2Schema,
  type PersonaCorrectionSection,
  type PersonaFollowUps,
  type PersonaMove,
  type PersonaSampleReplyFault,
  type PersonaSheetCompletion,
  type PersonaSheetSectionKey,
  type PersonaStrategies,
  type PersonaV2,
  type KycSlot,
  type ObjectionReplies,
  type SheetQuestion,
} from '@impera/contracts';
import type { z } from 'zod';

import { DESIRE_BAND_LABELS } from '@/agent/desire';
import { GUARD_LABELS } from '@/agent/guards';
import { deOf } from '@/lib/utils';

/**
 * Rules of the persona screen, without React (ADR 0079): Desirali's sheet in seven panels, then « Réglages de
 * l'agent », what the code applies. Validation by `PersonaV2Schema` with French messages, the one-line summaries of
 * folded blocks, the completion out of 59 questions, and what a file brings in.
 */

export type PanelKey = PersonaSheetSectionKey;

/** An answer of the sheet as the screen holds it while she types: a number being typed may be NaN, a date ''. */
export type Answer = string | number | readonly string[] | null;

/** The sheet being written: its panels, each a set of answers by key, checked by `PersonaV2Schema` only on save. */
export type SheetDraft = Readonly<Record<PanelKey, Readonly<Record<string, Answer>>>>;

/** The persona being written: a stored version at format 2 is one, the screen's draft may not be valid yet. */
export type Draft = Omit<PersonaV2, 'sheet'> & { readonly sheet: SheetDraft };

/** An answer as text, for a field of text: anything else (absent, null) is an empty field. */
export const answerText = (answer: Answer | undefined): string => (typeof answer === 'string' ? answer : '');

/** The sheet with one answer changed. */
export const withAnswer = (sheet: SheetDraft, panel: PanelKey, key: string, value: Answer): SheetDraft => ({
  ...sheet,
  [panel]: { ...sheet[panel], [key]: value },
});

/** Her nickname as the head shows it: what she typed, or nothing while it is a placeholder or empty. */
export const nicknameOf = (draft: Draft): string => {
  const name = answerText(draft.sheet.identity['nickname']).trim();
  return isPlaceholder(name) ? '' : name;
};

/** The two tabs of the screen: her sheet, as Desirali asks it, and the agent's settings beside it. */
export type TabId = 'sheet' | 'agent';

export const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'sheet', label: 'Sa fiche' },
  { id: 'agent', label: 'Réglages de l’agent' },
];

/** The title a panel goes by on this screen; the last one has none at Desirali, its one question names it. */
export const panelTitle = (key: PanelKey): string => {
  const section = PERSONA_SHEET.find((s) => s.key === key);
  return section?.title ?? section?.questions[0]?.label ?? key;
};

/** A question of the sheet, by its panel and its key. */
export const questionOf = (panel: PanelKey, key: string): SheetQuestion | undefined =>
  PERSONA_SHEET.find((s) => s.key === panel)?.questions.find((q) => q.key === key);

const PANEL_KEYS: readonly PanelKey[] = PERSONA_SHEET.map((s) => s.key);

/** The panel a field belongs to (`sheet.identity.nickname` › `identity`); undefined for the agent's settings. */
export const panelOf = (field: string): PanelKey | undefined => {
  const [root, key] = field.split('.');
  return root === 'sheet' ? PANEL_KEYS.find((panel) => panel === key) : undefined;
};

/** The tab that shows a field: the agent's settings, or her sheet for the rest (its number, its date). */
export const tabOfField = (field: string): TabId => (field.startsWith('agent.') ? 'agent' : 'sheet');

/**
 * Where a correction she proposed sits now: a panel of the sheet, its own or the one that took over the format-1 block
 * it names (her corrections keep their section, ADR 0079 § 6).
 */
export function panelOfCorrection(section: PersonaCorrectionSection): PanelKey {
  switch (section) {
    case 'details':
      return 'identity';
    case 'tastes':
      return 'preferences';
    case 'intimate':
      return 'intimacy';
    case 'writing_style':
      return 'conversation';
    case 'limits':
      return 'boundaries';
    case 'lifestyle':
    case 'identity':
    case 'preferences':
    case 'conversation':
    case 'relationships':
    case 'intimacy':
    case 'boundaries':
      return section;
  }
}

/** One problem with the draft: the field it belongs to (`sheet.identity.nickname`) and what to fix. */
export interface FieldIssue {
  readonly field: string;
  readonly message: string;
}

/** Where the generic message would not say what to do: a field, then the kind of problem. */
const FIELD_MESSAGES: Readonly<Record<string, Partial<Record<z.core.$ZodIssue['code'], string>>>> = {
  'agent.strategies.kyc.collect': { too_small: 'Garde au moins une info à collecter.' },
  'sheet.identity.spoken_languages': { too_small: 'Choisis au moins une langue.' },
};

/** Validates a draft; an empty list means it can be saved as a new version. */
export function validate(draft: Draft): FieldIssue[] {
  return schemaIssues(withoutPlaceholders(draft));
}

/** What a schema refuses in a value, in French: a draft as stored, or a file being imported. */
export function schemaIssues(stored: unknown, schema: z.ZodType = PersonaV2Schema): FieldIssue[] {
  const result = schema.safeParse(stored);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const field = issue.path.map(String).join('.');
    // An emptied field with a format (a date) is still to fill in, not wrongly written.
    const empty = issue.code === 'invalid_format' && valueAt(stored, issue.path) === '';
    return {
      field,
      message: empty ? 'À remplir' : (FIELD_MESSAGES[field]?.[issue.code] ?? frenchMessage(issue, field)),
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

/** The issues of a field, its list items included (`agent.behavior.pet_names.2` belongs to `agent.behavior.pet_names`). */
export function issuesOf(issues: readonly FieldIssue[], field: string): FieldIssue[] {
  return issues.filter((issue) => issue.field === field || issue.field.startsWith(`${field}.`));
}

/** How many issues each tab holds, for the counts of the tab bar. */
export function issueCountByTab(issues: readonly FieldIssue[]): Record<TabId, number> {
  const counts: Record<TabId, number> = { sheet: 0, agent: 0 };
  for (const issue of issues) counts[tabOfField(issue.field)] += 1;
  return counts;
}

/** How many issues each panel holds, for the count on its title. */
export function issueCountByPanel(issues: readonly FieldIssue[]): Partial<Record<PanelKey, number>> {
  const counts: Partial<Record<PanelKey, number>> = {};
  for (const issue of issues) {
    const panel = panelOf(issue.field);
    if (panel !== undefined) counts[panel] = (counts[panel] ?? 0) + 1;
  }
  return counts;
}

/**
 * Issues under `agent.` without it: the agent's settings are drawn by the blocks of format 1 (`strategies.kyc…`), whose
 * schemas did not change, so their fields read their issues and changes where they always did.
 */
export const scoped = (issues: readonly FieldIssue[], prefix: string): FieldIssue[] =>
  issues
    .filter((issue) => issue.field.startsWith(`${prefix}.`))
    .map((issue) => ({ ...issue, field: issue.field.slice(prefix.length + 1) }));

/** The same for the paths of what changed. */
export const scopedPaths = (paths: readonly string[], prefix: string): string[] =>
  paths.filter((path) => path.startsWith(`${prefix}.`)).map((path) => path.slice(prefix.length + 1));

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n > 1 ? many : one}`;

/** The unit each number is typed in, as its field shows it: a bound says it too (CREA-15). */
const FIELD_UNITS: Readonly<Record<string, string>> = {
  'sheet.identity.height_m': 'm',
  'sheet.identity.weight_kg': 'kg',
  'agent.behavior.response_delay_minutes': 'min',
  'agent.strategies.kyc.max_messages': 'messages',
  'agent.strategies.kyc.max_duration_minutes': 'min',
  'agent.strategies.kyc.min_hours_before_following': 'h',
  'agent.strategies.sexualization.initiate_after_hours': 'h',
  'agent.strategies.sexualization.min_desire_to_open': 'sur 100',
  'agent.strategies.script_launch.cooldown_hours': 'h',
  'agent.strategies.script_launch.min_desire': 'sur 100',
  'agent.strategies.post_offer.delay_days': 'jours',
  'agent.follow_ups.delays_hours': 'h',
  'agent.follow_ups.nudges.delay_minutes': 'min',
  'agent.follow_ups.nudges.max_per_day': 'rappels',
  'agent.follow_ups.nudges.min_hours_after_conversation': 'h',
};

/** The numbers of the sheet that take decimals: a wrong value there asks for a number, not a whole one. */
const DECIMALS: ReadonlySet<string> = new Set(['sheet.identity.height_m', 'sheet.identity.weight_kg']);

/** The unit of a field, a list item taking its list's (`agent.follow_ups.delays_hours.2`). */
const unitOf = (field: string): string | undefined =>
  FIELD_UNITS[field] ?? FIELD_UNITS[field.replace(/\.\d+$/u, '')];

/** A bound with its unit, written the French way: « 60 min », « 1,3 m », « 500 ». */
const bound = (n: number, unit: string | undefined): string => {
  const shown = n.toLocaleString('fr-FR');
  return unit === undefined ? shown : `${shown}\u00a0${unit}`;
};

/** Zod speaks English; the dashboard speaks French. Messages written in the schema are already French. */
function frenchMessage(issue: z.core.$ZodIssue, field: string): string {
  const unit = unitOf(field);
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
      if (issue.expected === 'number' || issue.expected === 'int')
        return DECIMALS.has(field) ? 'Nombre attendu' : 'Nombre entier attendu';
      return 'À remplir';
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
 * The example as a new creator's first draft (recette 28/10): nothing in it that nobody typed. Her date of birth, a
 * safety datum, starts empty and must be filled in; the metadata name her (`meta.creator` is her id), drop the
 * example's notes and its number. Her nickname starts from her name in Impera, its first word, when it is known (CREA-13).
 */
export function firstDraft(example: PersonaV2, creatorId: string, name: string | null = null): Draft {
  const first = name?.trim().split(/\s+/u)[0] ?? '';
  const { identity } = example.sheet;
  return {
    ...example,
    sheet: {
      ...example.sheet,
      identity: { ...identity, birth_date: '', nickname: first === '' ? identity.nickname : first },
    },
    // The example's number is not hers: her first save is 0.0.1.
    meta: { ...example.meta, creator: creatorId, notes: null, version: '0.0.0' },
  };
}

/** The day it is here (YYYY-MM-DD), read when asked: a version's date and an age follow the local calendar. */
export function localDay(at: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * The persona as it is stored: a placeholder of the example is dropped from a list and emptied in a text, an answer of
 * the sheet left empty is null, so that the agent never reads `<à remplir>` and a required field left as such is
 * refused.
 */
export function withoutPlaceholders(value: unknown): unknown {
  if (typeof value === 'string') return isPlaceholder(value) ? '' : value;
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item !== 'string' || !isPlaceholder(item)).map(withoutPlaceholders);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === 'sheet' && isRecord(item) ? sheetAnswers(item) : withoutPlaceholders(item),
      ]),
    );
  }
  return value;
}

/** The sheet's free answers: a placeholder or an empty text is no answer (null), never an empty string. */
function sheetAnswers(sheet: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(sheet).map(([panel, answers]) => [
      panel,
      isRecord(answers)
        ? Object.fromEntries(
            Object.entries(answers).map(([key, answer]) => [
              key,
              // The date and the nickname are required: emptied, they stay '' and are refused as « À remplir ».
              typeof answer === 'string' &&
              key !== 'birth_date' &&
              key !== 'nickname' &&
              (answer.trim() === '' || isPlaceholder(answer))
                ? null
                : withoutPlaceholders(answer),
            ]),
          )
        : answers,
    ]),
  );
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

const styleOf = (style: string): string =>
  style === 'custom' ? 'Personnalisé' : style === 'normal' ? 'Normal' : 'Par défaut';

/** The line each strategy shows while folded: its style, then the numbers the policy enforces. */
export function strategySummaries(s: PersonaStrategies): Record<keyof PersonaStrategies, string> {
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

export function followUpsSummary(f: PersonaFollowUps): string {
  if (!f.enabled) return 'Désactivées';
  if (f.delays_hours.length === 0) return 'Aucun délai';
  return `${f.delays_hours.map(hoursLabel).join(', ')} après son dernier message`;
}

export function nudgesSummary(n: PersonaFollowUps['nudges']): string {
  return n.enabled
    ? `${plural(n.max_per_day, 'rappel', 'rappels')} par jour au plus, ${minutesLabel(n.delay_minutes)} après`
    : 'Désactivés';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The fields a draft changed, as paths (`agent.strategies.kyc.max_messages`); a list counts as one field. */
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
 * Under a desire threshold, in plain words (CREA-10): « À partir de 45 : dès qu'il devient joueur. », never « bande
 * joueur », which only makes sense to who knows the bands. An empty field takes the default and says it.
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

/** Compares two version numbers: below zero when `a` comes first. */
const compareVersions = (a: [number, number, number], b: [number, number, number]): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The number of the next version: one patch above the highest taken (« 0.1.3 » after 0.1.2 and 0.0.9). */
export function nextVersion(taken: readonly string[]): string {
  const [major, minor, patch] = taken
    .map(semver)
    .reduce<[number, number, number]>((top, v) => (compareVersions(v, top) > 0 ? v : top), [0, 0, 0]);
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

/**
 * The number a save gives the draft. An imported draft keeps the number its file carries (« 1.0.0 », the one its
 * authors know it by) when it comes after every stored version; otherwise, as for any edit, one patch above the
 * highest, the draft's own included.
 */
export function versionOnSave(draftVersion: string, stored: readonly string[], imported: boolean): string {
  const own = semver(draftVersion);
  if (imported && stored.every((version) => compareVersions(own, semver(version)) > 0)) return draftVersion;
  return nextVersion([...stored, draftVersion]);
}

/** Where a field sits, in words: its panel, « Réglages de l’agent », or the head of the file. */
function placeOf(field: string): string {
  const panel = panelOf(field);
  if (panel !== undefined) return `« ${panelTitle(panel)} »`;
  return field.startsWith('agent.') ? '« Réglages de l’agent »' : 'l’en-tête du fichier';
}

/**
 * Why a file is not imported, said in the head: how many problems, then the first, at its place on the screen and in
 * the file (the YAML keys are the schema's path, `sheet.identity.birth_date`), so that it can be fixed there. A file
 * at format 1 is checked against format 1, whose blocks the screen no longer shows: only its key is given.
 */
export function fileRefusal(issues: readonly FieldIssue[], format: 1 | 2 = 2): string {
  const first = issues[0];
  if (first === undefined) return UNREADABLE_FILE;
  const where = format === 2 ? `dans ${placeOf(first.field)} ` : '';
  const count = issues.length > 1 ? `${String(issues.length)} problèmes ; le premier` : 'un problème';
  return `Ce fichier ne passe pas la vérification de la persona : ${count}, ${where}(${first.field}) : ${first.message}. Rien n’a changé.`;
}

/** Said when a file is not a persona at all: not YAML, not text, or far too big. */
export const UNREADABLE_FILE =
  'Ce fichier ne se lit pas comme une persona : il faut le fichier YAML de sa fiche. Rien n’a changé.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const sameName = (a: string, b: string): boolean =>
  a.trim().normalize('NFC').toLocaleLowerCase('fr') === b.trim().normalize('NFC').toLocaleLowerCase('fr');

/**
 * The question to ask before a file replaces her draft, when it reads as another creator's (recette 05/11, PRO-27):
 * another nickname than hers, or another creator of Impera named in `meta.creator`. `null`: the file is hers. A file
 * written by hand names any slug (`demo`, `lea`): only an Impera id that is not hers counts against it.
 */
export function foreignFileQuestion(file: PersonaV2, current: Draft, creatorId: string): string | null {
  const theirs = file.sheet.identity.nickname;
  const hers = nicknameOf(current);
  const otherName = hers !== '' && !sameName(theirs, hers);
  const { creator } = file.meta;
  const otherCreator = UUID.test(creator) && creator !== creatorId;
  if (!otherName && !otherCreator) return null;
  const whose = UUID.test(creator) ? theirs : `${theirs} (${creator})`;
  return `Ce fichier est celui ${deOf(whose)} : l’importer sur la fiche ${deOf(hers)} ?`;
}

/** A persona read from a file, made hers: the creator it names is the one whose screen imports it. */
export function importedDraft(persona: PersonaV2, creatorId: string): PersonaV2 {
  return { ...persona, meta: { ...persona.meta, creator: creatorId } };
}

/** Whether an answer of the sheet is given: a placeholder, an empty text or a number being typed is not. */
function given(value: Answer | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim() !== '' && !isPlaceholder(value);
  return value.length > 0;
}

/**
 * How complete the draft's sheet is (ADR 0079 § 6): the questions answered, out of 59, read without the placeholders
 * of the example. The time zone is always answered: it is hers, from Impera. Never a condition to save or activate.
 */
export function draftCompletion(draft: Draft): PersonaSheetCompletion {
  let count = 0;
  const missing: { section: PanelKey; left: number }[] = [];
  for (const section of PERSONA_SHEET) {
    const answers = draft.sheet[section.key];
    const done = section.questions.filter((q) => q.key === 'timezone' || given(answers[q.key])).length;
    count += done;
    if (done < section.questions.length)
      missing.push({ section: section.key, left: section.questions.length - done });
  }
  return {
    answered: count,
    total: PERSONA_SHEET_QUESTION_COUNT,
    percent: Math.round((count / PERSONA_SHEET_QUESTION_COUNT) * 100),
    missing,
  };
}

/**
 * The gauge never says complete while a field waits to be fixed (CREA-14): the panel that holds it counts as still to
 * complete, and the percent stays under 100.
 */
export function withIssues(
  completion: PersonaSheetCompletion,
  issues: readonly FieldIssue[],
): PersonaSheetCompletion {
  const flagged = new Set(issues.map((issue) => panelOf(issue.field)).filter((p) => p !== undefined));
  const added = [...flagged].filter((panel) => !completion.missing.some((m) => m.section === panel));
  if (added.length === 0) return completion;
  const missing = PANEL_KEYS.flatMap((panel) => {
    const known = completion.missing.find((m) => m.section === panel);
    if (known !== undefined) return [known];
    return added.includes(panel) ? [{ section: panel, left: 1 }] : [];
  });
  return { ...completion, percent: Math.min(completion.percent, 99), missing };
}

/** A move of the conversion in her words: what it was, and the question that holds it now. */
export function moveLabel(move: PersonaMove): string {
  const question = questionOf(move.to.section, move.to.key)?.label ?? move.to.key;
  return `${move.from}\u00a0: dans «\u00a0${panelTitle(move.to.section)}\u00a0› ${question}\u00a0»`;
}

/** An emoji as two lists compare it: without the variation selector some keyboards add (« ❤ » and « ❤️ »). */
export const emojiKey = (entry: string): string => entry.replace(/️/gu, '');

/** Where the server's refusals of « Réponses typiques » are said. */
export const TYPICAL_RESPONSES = 'sheet.conversation.typical_responses';

/**
 * What the server refused at saving (422 `persona_sample_reply_unprocessable`), on « Réponses typiques »: each line it
 * refused, counted from 1 as she reads them, with every guard it trips named as the agent's own refusals say them.
 * None when a line it names is not in `text` as sent (the server splits it on line breaks): that refusal does not
 * read, and the save is said to have failed.
 */
export function refusedLineIssues(
  faults: readonly PersonaSampleReplyFault[],
  text: string | null,
): FieldIssue[] {
  const onLines = faults.filter((fault) => fault.objection === undefined);
  const sent = (text ?? '').split('\n').length;
  if (onLines.some(({ index }) => index >= sent)) return [];
  const byLine = new Map<number, string[]>();
  for (const { index, code } of onLines) {
    const labels = byLine.get(index) ?? [];
    if (!labels.includes(GUARD_LABELS[code])) labels.push(GUARD_LABELS[code]);
    byLine.set(index, labels);
  }
  if (byLine.size === 0) return [];
  const lines = [...byLine]
    .sort(([a], [b]) => a - b)
    .map(([index, labels]) => `ligne ${String(index + 1)} (${labels.join(', ')})`);
  return [
    {
      field: TYPICAL_RESPONSES,
      message: `L’agent ne les enverrait pas : ${lines.join(' ; ')}. Corrige ou retire ${byLine.size > 1 ? 'ces lignes' : 'cette ligne'}.`,
    },
  ];
}

/**
 * What the server refused at saving in her objection bank (ADR 0090 § B): each reply, counted from 1 in its kind, with
 * the guards it trips. None when a reply it names is not in the bank as sent: that refusal does not read.
 */
export function refusedReplyIssues(
  faults: readonly PersonaSampleReplyFault[],
  bank: ObjectionReplies,
): FieldIssue[] {
  const onReplies = faults.flatMap((fault) =>
    fault.objection === undefined ? [] : [{ ...fault, objection: fault.objection }],
  );
  if (onReplies.some(({ objection, index }) => index >= (bank[objection]?.length ?? 0))) return [];
  return BANKED_OBJECTION_KINDS.flatMap((kind) => {
    const byReply = new Map<number, string[]>();
    for (const { index, code } of onReplies.filter((fault) => fault.objection === kind)) {
      const labels = byReply.get(index) ?? [];
      if (!labels.includes(GUARD_LABELS[code])) labels.push(GUARD_LABELS[code]);
      byReply.set(index, labels);
    }
    if (byReply.size === 0) return [];
    const replies = [...byReply]
      .sort(([a], [b]) => a - b)
      .map(([index, labels]) => `réplique ${String(index + 1)} (${labels.join(', ')})`);
    return [
      {
        field: `agent.objection_replies.${kind}`,
        message: `L’agent ne les dirait pas : ${replies.join(' ; ')}. Corrige ou retire ${byReply.size > 1 ? 'ces répliques' : 'cette réplique'}.`,
      },
    ];
  });
}

/**
 * The canvas lines she collects, in her order: the brain and « À apprendre » follow it. Only every line in the
 * canvas's own order is « all » and leaves `collect` absent, as the schema reads it; any other order is kept.
 */
export const collectOrAll = (slots: KycSlot[]): KycSlot[] | undefined =>
  slots.length === KycSlotSchema.options.length && slots.every((slot, i) => slot === KycSlotSchema.options[i])
    ? undefined
    : slots;

/** What the server refused at the last save (422), with « Réponses typiques » as it was then. */
export interface RefusedLines {
  readonly issues: readonly FieldIssue[];
  readonly text: string | null;
  /** Her objection replies refused, held until her bank changes (ADR 0090 § B). */
  readonly replies?: { readonly issues: readonly FieldIssue[]; readonly bank: string };
}

export const NOTHING_REFUSED: RefusedLines = { issues: [], text: null };

/** The refusal holds until « Réponses typiques » changes, whatever else is edited. */
export function stillRefused(refused: RefusedLines, draft: Draft): FieldIssue[] {
  const lines =
    refused.issues.length > 0 && draft.sheet.conversation['typical_responses'] === refused.text
      ? [...refused.issues]
      : [];
  const { replies } = refused;
  return replies?.bank === JSON.stringify(draft.agent.objection_replies)
    ? [...lines, ...replies.issues]
    : lines;
}
