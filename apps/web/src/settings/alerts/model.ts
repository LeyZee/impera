import {
  alertKeywordKey,
  CUSTOM_ALERT_KEYWORDS_MAX,
  CUSTOM_ALERT_NAME_MAX,
  CUSTOM_ALERT_PHRASE_MAX,
  LOCKED_SYSTEM_ALERTS,
  ALERT_TEST_MESSAGE_MAX,
  AlertTestBodySchema,
  type AlertTestBody,
  type AlertTestResult,
  type CreatorId,
  type CustomAlertBody,
  type CustomAlertGroup,
  type SystemAlertCode,
  type SystemAlertSetting,
  type TelegramCoverage,
  type TelegramTopic,
} from '@nirvana/contracts';

/*
 * Réglages › Alertes (P4-01) in words: what an alert of her own watches, on which creators, whether it pauses the
 * agent, where it goes on Telegram, and what still keeps it from being saved. Pure functions: the page lays them
 * out. The server checks again with the contract; these say it first, on the field it belongs to.
 */

/** An alert as the owner writes it: one alert, whatever the number of creators it watches. */
export interface AlertDraft {
  readonly name: string;
  readonly phrase: string;
  readonly keywords: readonly string[];
  readonly pausesAgent: boolean;
  readonly notify: boolean;
  readonly creatorIds: readonly CreatorId[];
}

/** A new alert lets one know on Telegram and leaves the agent running: pausing is a choice she makes. */
export const EMPTY_DRAFT: AlertDraft = {
  name: '',
  phrase: '',
  keywords: [],
  pausesAgent: false,
  notify: true,
  creatorIds: [],
};

/** A new alert watches every creator: it almost always does, and she unticks those it should not (REG-18). */
export const newDraft = (creators: readonly { readonly id: CreatorId }[]): AlertDraft => ({
  ...EMPTY_DRAFT,
  creatorIds: creators.map((creator) => creator.id),
});

export const draftOf = (alert: CustomAlertGroup): AlertDraft => ({
  name: alert.name,
  phrase: alert.phrase ?? '',
  keywords: alert.keywords,
  pausesAgent: alert.pausesAgent,
  notify: alert.notify,
  creatorIds: alert.creators.map((creator) => creator.creatorId),
});

/** On while one of its creators has it on; the line's switch turns it on or off for all of them. */
export const isActive = (alert: CustomAlertGroup): boolean =>
  alert.creators.some((creator) => creator.enabled);

/**
 * The body of `POST` and `PUT`: an empty phrase is `null` (the contract refuses `''`), the words cleaned. A creator
 * kept keeps her switch; one added takes the alert's state; one left out is archived by the server.
 */
export function bodyOf(draft: AlertDraft, saved: CustomAlertGroup | null): CustomAlertBody {
  const phrase = draft.phrase.trim();
  const active = saved === null || isActive(saved);
  return {
    name: draft.name.trim(),
    phrase: phrase === '' ? null : phrase,
    keywords: cleanKeywords(draft.keywords),
    pausesAgent: draft.pausesAgent,
    notify: draft.notify,
    creators: draft.creatorIds.map((creatorId) => ({
      creatorId,
      enabled: saved?.creators.find((creator) => creator.creatorId === creatorId)?.enabled ?? active,
    })),
  };
}

/** The alert with every creator switched on or off: the line's switch. */
export const switchedBody = (alert: CustomAlertGroup, enabled: boolean): CustomAlertBody => ({
  name: alert.name,
  phrase: alert.phrase,
  keywords: alert.keywords,
  pausesAgent: alert.pausesAgent,
  notify: alert.notify,
  creators: alert.creators.map((creator) => ({ creatorId: creator.creatorId, enabled })),
});

export interface DraftIssues {
  readonly name?: string;
  readonly phrase?: string;
  /** Neither a phrase nor a keyword: said under the keywords, the last of the two. */
  readonly watch?: string;
  readonly creators?: string;
}

const atMost = (max: number): string => `${max.toLocaleString('fr-FR')} caractères au plus.`;

/** What keeps the draft from being saved, field by field; empty when it can be. */
export function draftIssues(draft: AlertDraft): DraftIssues {
  const name = draft.name.trim();
  const phrase = draft.phrase.trim();
  const keywords = cleanKeywords(draft.keywords);
  return {
    ...(name === ''
      ? { name: 'Donne-lui un nom.' }
      : name.length > CUSTOM_ALERT_NAME_MAX
        ? { name: atMost(CUSTOM_ALERT_NAME_MAX) }
        : {}),
    ...(phrase.length > CUSTOM_ALERT_PHRASE_MAX ? { phrase: atMost(CUSTOM_ALERT_PHRASE_MAX) } : {}),
    ...(phrase === '' && keywords.length === 0
      ? { watch: 'Une phrase, des mots-clés, ou les deux : sinon elle ne surveille rien.' }
      : keywords.length > CUSTOM_ALERT_KEYWORDS_MAX
        ? { watch: `${String(CUSTOM_ALERT_KEYWORDS_MAX)} mots-clés au plus.` }
        : {}),
    ...(draft.creatorIds.length === 0 ? { creators: 'Choisis au moins une créatrice.' } : {}),
  };
}

/** The issues as the fields read them (`Field path="name"`), in the order of the form. */
export const issueList = (issues: DraftIssues): { field: string; message: string }[] =>
  (['name', 'phrase', 'watch', 'creators'] as const).flatMap((field) => {
    const message = issues[field];
    return message === undefined ? [] : [{ field, message }];
  });

export const canSave = (draft: AlertDraft): boolean => Object.keys(draftIssues(draft)).length === 0;

/** Something to save: the draft differs from what the server holds (a new alert always does). */
export function hasChanges(draft: AlertDraft, saved: CustomAlertGroup | null): boolean {
  if (saved === null) return true;
  const before = draftOf(saved);
  const same = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  return (
    draft.name.trim() !== before.name ||
    draft.phrase.trim() !== before.phrase ||
    !same(cleanKeywords(draft.keywords), before.keywords) ||
    draft.pausesAgent !== before.pausesAgent ||
    draft.notify !== before.notify ||
    !same([...draft.creatorIds].sort(), [...before.creatorIds].sort())
  );
}

/** « Toutes les créatrices », « Nora », « Nora et Léa », « Nora, Léa et 2 autres ». */
export function creatorsLine(
  creatorIds: readonly string[],
  creators: readonly { readonly id: string; readonly displayName: string }[],
): string {
  const chosen = creators.filter((creator) => creatorIds.includes(creator.id));
  if (chosen.length === 0) return 'Aucune créatrice';
  if (chosen.length === creators.length && creators.length > 1) return 'Toutes les créatrices';
  const names = chosen.map((creator) => creator.displayName);
  const [first = '', second = ''] = names;
  if (names.length === 1) return first;
  if (names.length === 2) return `${first} et ${second}`;
  const rest = names.length - 2;
  return `${first}, ${second} et ${rest === 1 ? '1 autre' : `${String(rest)} autres`}`;
}

/** What a trigger does to the conversation, said the same way on the line and in the editor. */
export const pauseLine = (pausesAgent: boolean): string =>
  pausesAgent
    ? 'Met l’agent en pause sur ce fan et passe la main à un humain'
    : 'Prévient sans mettre l’agent en pause';

/**
 * The keywords as the owner typed them, trimmed, each once as the agent reads it (`alertKeywordKey`: case, accents
 * and punctuation aside), and none the agent could never match (« !!! »).
 */
export function cleanKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of keywords) {
    const word = raw.trim();
    const key = alertKeywordKey(word);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    kept.push(word);
  }
  return kept;
}

/** The alerts the code raises itself (P4-01), as the page says them; their codes are the contract's. */
export const SYSTEM_ALERTS: Readonly<
  Record<SystemAlertCode, { readonly title: string; readonly what: string }>
> = {
  keyword: {
    title: 'Mots-clés de la persona',
    what: 'Un fan écrit un des mots-clés de sa persona : l’agent se met en pause et un humain est prévenu.',
  },
  service_request: {
    title: 'Demande de service',
    what: 'Un fan demande un contenu sur mesure, un appel, une cam ou un vocal : un humain est prévenu pour le vendre, sans pause.',
  },
  identity_doubt: {
    title: 'Le fan demande si c’est un bot',
    what: 'Un fan demande s’il parle à un bot : la main passe à un humain s’il y en a un en poste.',
  },
};

/** Why a system alert has no switch: her persona's words are taken out there, never switched off here. */
const LOCKED_LINE = 'Ne se coupe pas ici : un mot se retire dans sa persona.';

export const isLocked = (code: SystemAlertCode): boolean => LOCKED_SYSTEM_ALERTS.includes(code);

/** A system alert's switch for one creator; on unless switched off (a creator the server has no row for is on). */
export const systemEnabled = (setting: SystemAlertSetting, creatorId: CreatorId): boolean =>
  setting.creators.find((creator) => creator.creatorId === creatorId)?.enabled ?? true;

/** « Active pour toutes », « Active pour Nora et Léa », « Coupée pour toutes ». */
export function systemLine(
  setting: SystemAlertSetting,
  creators: readonly { readonly id: CreatorId; readonly displayName: string }[],
): string {
  if (isLocked(setting.code)) return LOCKED_LINE;
  const on = creators.filter((creator) => systemEnabled(setting, creator.id));
  if (creators.length === 1) return on.length === 1 ? 'Active' : 'Coupée';
  if (on.length === creators.length) return 'Active pour toutes';
  if (on.length === 0) return 'Coupée pour toutes';
  return `Active pour ${creatorsLine(
    on.map((creator) => creator.id),
    creators,
  )}`;
}

/** What « Tester » costs: a phrase is read by the brain (one model call), keywords alone by the code. */
export const testCostLine = (draft: Pick<AlertDraft, 'phrase'>): string =>
  draft.phrase.trim() === ''
    ? 'Les mots-clés se testent sans IA.'
    : 'La phrase se teste par l’IA : un appel au modèle, compté dans le budget du jour.';

/**
 * The creator whose active persona reads the phrase (recette M13): the one she picked, while it is still among the
 * alert's creators, otherwise the first of them; `null` while the alert has none.
 */
export const testCreatorOf = (
  draft: Pick<AlertDraft, 'creatorIds'>,
  picked: CreatorId | null,
): CreatorId | null =>
  picked !== null && draft.creatorIds.includes(picked) ? picked : (draft.creatorIds[0] ?? null);

/**
 * What « Tester » sends: the alert as written now, on her example message, for the creator `testCreatorOf` names,
 * read by the contract's own schema; `null` while there is nothing the route would take (no creator, no phrase and
 * no word, no message, a phrase or message past its limit, a word too long or with no letter nor digit, too many
 * words).
 */
export function testBodyOf(
  draft: Pick<AlertDraft, 'phrase' | 'keywords' | 'creatorIds'>,
  message: string,
  picked: CreatorId | null = null,
): AlertTestBody | null {
  const phrase = draft.phrase.trim();
  const body = AlertTestBodySchema.safeParse({
    creatorId: testCreatorOf(draft, picked),
    alert: { phrase: phrase === '' ? null : phrase, keywords: cleanKeywords(draft.keywords) },
    message,
  });
  return body.success ? body.data : null;
}

/**
 * Why « Tester » waits once a message is written: a message past its limit (the field already stops there), nothing
 * to look for yet, no creator to read her persona, or an alert the route would refuse (one word too many, said above
 * under the keywords).
 */
export function testHint(
  draft: Pick<AlertDraft, 'phrase' | 'keywords' | 'creatorIds'>,
  message: string,
): string | null {
  if (message.trim() === '' || testBodyOf(draft, message) !== null) return null;
  if (message.trim().length > ALERT_TEST_MESSAGE_MAX)
    return `Ce message est trop long pour un essai : ${atMost(ALERT_TEST_MESSAGE_MAX)}`;
  if (draft.phrase.trim() === '' && cleanKeywords(draft.keywords).length === 0)
    return 'Écris une phrase ou un mot-clé à tester.';
  return draft.creatorIds.length === 0
    ? 'Choisis une créatrice au-dessus pour tester.'
    : 'Corrige l’alerte au-dessus pour la tester.';
}

/**
 * Whether an answer was for this very test: the same creator, the same phrase, the same words in the same order,
 * the same message.
 */
export const sameTest = (a: AlertTestBody, b: AlertTestBody): boolean =>
  a.creatorId === b.creatorId &&
  a.message === b.message &&
  a.alert.phrase === b.alert.phrase &&
  a.alert.keywords.length === b.alert.keywords.length &&
  a.alert.keywords.every((word, index) => word === b.alert.keywords[index]);

/** The answer of « Tester » in her words: whether it would ring, then why, word by word and for the phrase. */
export interface TestVerdict {
  readonly rings: boolean;
  readonly headline: string;
  readonly lines: readonly string[];
  /** Why the phrase could not be read, as the server says it: in amber, never in red. */
  readonly warning: string | null;
}

const quoted = (words: readonly string[]): string => words.map((word) => `« ${word} »`).join(', ');

export function testVerdict(sent: AlertTestBody, result: AlertTestResult, pausesAgent: boolean): TestVerdict {
  const rings = result.keywords.length > 0 || result.phraseMatched === true;
  const lines: string[] = [];
  if (sent.alert.keywords.length > 0) {
    lines.push(
      result.keywords.length === 0
        ? 'Aucun de ses mots-clés n’est dans ce message.'
        : `${result.keywords.length === 1 ? 'Mot-clé trouvé' : 'Mots-clés trouvés'} : ${quoted(result.keywords)}.`,
    );
  }
  if (result.phraseMatched === true) lines.push('L’IA reconnaît la situation de la phrase.');
  if (result.phraseMatched === false) lines.push('L’IA ne reconnaît pas la situation de la phrase.');
  const unread = sent.alert.phrase !== null && result.phraseMatched === null;
  const headline = rings
    ? pausesAgent
      ? 'Elle sonnerait, et mettrait l’agent en pause pour ce fan.'
      : 'Elle sonnerait.'
    : unread
      ? 'La phrase n’a pas pu être lue.'
      : 'Elle ne sonnerait pas.';
  return { rings, headline, lines, warning: unread ? (result.reason ?? 'Réessaie dans un instant.') : null };
}

/**
 * The routing of Réglages › Telegram as this page reads it: who has no group for which topic, `'off'` when the
 * server runs without Telegram, `'none'` while no group gets anything yet. The last two are said once, in the head
 * of the page, never on every line.
 */
export type TelegramRouting = TelegramCoverage | 'off' | 'none';

/** One sentence for the head when Telegram carries nothing; `null` when it routes something, or is not known. */
export function telegramHeadLine(routing: TelegramRouting | null): string | null {
  if (routing === 'off')
    return 'Telegram n’est pas branché sur ce serveur : les alertes restent dans l’historique du Suivi.';
  if (routing === 'none')
    return 'Aucun groupe Telegram ne reçoit encore rien : les alertes restent dans l’historique du Suivi.';
  return null;
}

/** Where an alert goes on Telegram, read from the routing of Réglages › Telegram (never set here). */
export type TelegramLine =
  | { readonly kind: 'silent'; readonly text: string }
  | { readonly kind: 'sent'; readonly text: string }
  | { readonly kind: 'missing'; readonly text: string; readonly topic: TelegramTopic };

/**
 * `routing`: `null` while it is not known, and then the line says nothing rather than guess; `'off'` and `'none'`
 * are said by the head. `topicLabel`: the topic's name, as Réglages › Telegram says it.
 */
export function telegramLine(input: {
  readonly notify: boolean;
  readonly topic: TelegramTopic;
  readonly topicLabel: string;
  readonly creatorIds: readonly CreatorId[];
  readonly routing: TelegramRouting | null;
}): TelegramLine | null {
  if (!input.notify) return { kind: 'silent', text: 'Gardée dans l’historique, sans Telegram' };
  const { routing } = input;
  if (routing === null || routing === 'off' || routing === 'none') return null;
  const without = routing.filter(
    (line) => input.creatorIds.includes(line.creatorId) && line.topicsWithoutGroup.includes(input.topic),
  );
  if (without.length === 0) return { kind: 'sent', text: `Part sur Telegram, dans « ${input.topicLabel} »` };
  const names = without.map((line) => line.displayName);
  const who =
    names.length === 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1] ?? ''}`;
  return {
    kind: 'missing',
    text: `Aucun groupe Telegram ne reçoit « ${input.topicLabel} » pour ${who}`,
    topic: input.topic,
  };
}
