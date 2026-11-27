import {
  alertKeywordKey,
  normalise,
  unmask,
  type AlertTrigger,
  type CustomAlert,
  type HandoffCause,
  type SystemAlertCode,
} from '@impera/contracts';

/**
 * Her alert keywords (`notifications.alert_keywords`, P4-01): read in code, never by a model, on what he wrote since
 * her last answer. A keyword matches as a whole word or phrase once both sides are normalised (« Rendez-vous »
 * matches « rendez vous »), and also once the digits inside his words are read as letters (« r0bot »). A long word
 * also matches written with a typo or in the plural (decision of 27/11/2026: a name mistyped is still her name), a
 * short one only as written, so that an ordinary word is never taken for hers (« Robot » does not match « robots »).
 * Gives the keywords that matched, as she wrote them, in her order.
 */
export function alertKeywordsIn(text: string, keywords: readonly string[]): string[] {
  const readings = [normalise(text), unmask(text)].map(spaced);
  const words = readings.map((reading) => reading.trim().split(' '));
  return keywords.filter((keyword) => {
    const term = alertKeywordKey(keyword);
    if (term === '') return false;
    if (readings.some((reading) => reading.includes(` ${term} `))) return true;
    const parts = term.split(' ');
    return words.some((list) => list.some((_, at) => parts.every((part, i) => isNear(list[at + i], part))));
  });
}

/** Words split on anything that is not a letter or a digit, with a space at each end: whole words compare. */
const spaced = (text: string): string => ` ${text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** From this length a word of hers also matches in the plural (« s », « x »). */
const KEYWORD_PLURAL_FROM = 6;
/** From this length, one letter wrong, missing, added or swapped; from the next, two. */
const KEYWORD_ONE_TYPO_FROM = 7;
const KEYWORD_TWO_TYPOS_FROM = 11;

/**
 * His word read as one word of hers: as written, in the plural, or with the typos its length allows. A word with a
 * digit (a postcode, a number) only as written; a typo never on the first letter, the one people get right, and never
 * a final « e » alone (the masculine of a first name is someone else).
 */
function isNear(word: string | undefined, part: string): boolean {
  if (word === undefined) return false;
  if (word === part) return true;
  if (part.length < KEYWORD_PLURAL_FROM || /\p{N}/u.test(part)) return false;
  const singular = /[sx]$/.test(word) ? word.slice(0, -1) : null;
  if (singular === part) return true;
  const allowed = part.length >= KEYWORD_TWO_TYPOS_FROM ? 2 : part.length >= KEYWORD_ONE_TYPO_FROM ? 1 : 0;
  if (allowed === 0) return false;
  // A final « e » more or less is another word, not a typo: « Valentin » is not « Valentine », nor « Martine » « Martin ».
  if (
    word === `${part}e` ||
    `${word}e` === part ||
    singular === `${part}e` ||
    (singular !== null && `${singular}e` === part)
  )
    return false;
  return [word, singular].some(
    (candidate) =>
      candidate !== null &&
      candidate.startsWith(part.charAt(0)) &&
      typos(candidate, part, allowed) <= allowed,
  );
}

/**
 * Letters wrong, missing, added or swapped side by side between two words (optimal string alignment), counted up to
 * `max` + 1: past it, the exact count does not matter.
 */
function typos(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    const row = rows[i] ?? [];
    const above = rows[i - 1] ?? [];
    let best = Number.POSITIVE_INFINITY;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min((above[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (above[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, (rows[i - 2]?.[j - 2] ?? 0) + 1);
      row[j] = value;
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
  }
  return rows[a.length]?.[b.length] ?? max + 1;
}

/** What her alerts are for one message of his: her own that are on, and the system's that are on for her. */
export interface AlertSettings {
  readonly custom: readonly Pick<CustomAlert, 'id' | 'phrase' | 'keywords' | 'pausesAgent' | 'notify'>[];
  readonly systemOn: ReadonlySet<SystemAlertCode>;
}

/** An alert that went off: what the journal names, and whether it hands him to a human, with which cause. */
export interface FiredAlert {
  readonly trigger: AlertTrigger;
  /** The cause of the handoff when it pauses the agent; absent, it only lets a human know. */
  readonly pauses?: HandoffCause;
  /** Rung to the team when it only lets a human know: her alert's `notify` as it is now, always for the system's. */
  readonly notify: boolean;
}

/** A notice of an alert that went off without pausing the agent (`alert_triggered`). */
export interface AlertNotice {
  readonly trigger: AlertTrigger;
  readonly notify: boolean;
}

/**
 * The alerts read in code, before any model (P4-01): a word of her persona always pauses (cause `keyword`); a word of
 * one of her own alerts pauses when she checked it (cause `keyword` too), otherwise only lets a human know. The
 * trigger names the word as she declared it, never what he wrote.
 */
export function keywordAlerts(
  text: string,
  personaKeywords: readonly string[],
  settings: AlertSettings,
): FiredAlert[] {
  const fired: FiredAlert[] = [];
  const [persona] = alertKeywordsIn(text, personaKeywords);
  if (persona !== undefined)
    fired.push({
      trigger: { alert: { kind: 'system', code: 'keyword' }, matchedBy: 'keyword', keyword: persona },
      pauses: 'keyword',
      notify: true,
    });
  for (const alert of settings.custom) {
    const [keyword] = alertKeywordsIn(text, alert.keywords);
    if (keyword === undefined) continue;
    fired.push({
      trigger: { alert: { kind: 'custom', id: alert.id }, matchedBy: 'keyword', keyword },
      ...(alert.pausesAgent && { pauses: 'keyword' }),
      notify: alert.notify,
    });
  }
  return fired;
}

/** One of her alerts as the brain reads it: the short id it answers with, beside the alert it stands for. */
export interface PhraseAlert {
  readonly brainId: string;
  readonly alert: Pick<CustomAlert, 'id' | 'pausesAgent' | 'notify'> & { readonly phrase: string };
}

/**
 * Her alerts written as a phrase, for the brain, at most `max` and in her order; one already set off by a word is
 * not asked again.
 */
export function phraseAlerts(
  settings: AlertSettings,
  fired: readonly FiredAlert[],
  brainId: (index: number) => string,
  max: number,
): PhraseAlert[] {
  const done = new Set(fired.flatMap((f) => (f.trigger.alert.kind === 'custom' ? [f.trigger.alert.id] : [])));
  return settings.custom
    .flatMap(({ id, phrase, pausesAgent, notify }) =>
      phrase === null || done.has(id) ? [] : [{ id, phrase, pausesAgent, notify }],
    )
    .slice(0, max)
    .map((alert, index) => ({ brainId: brainId(index), alert }));
}

/**
 * The alerts read from the brain's brief (P4-01). Her phrases: only the ids the code gave count, the brain decides
 * nothing else (cause `custom_alert` when she checked « met en pause »). A service asked for lets a human know, who
 * may sell it. A doubt on who she is pauses the agent only while a chatter is on shift; otherwise she answers in
 * character (ADR 0021) and a human is let know.
 */
export function briefAlerts(
  brief: { readonly intent: string; readonly alertsSeen?: readonly string[] | undefined },
  asked: readonly PhraseAlert[],
  systemOn: ReadonlySet<SystemAlertCode>,
  chatterOnShift: boolean,
): FiredAlert[] {
  const seen = new Set(brief.alertsSeen ?? []);
  const fired = asked
    .filter((phrase) => seen.has(phrase.brainId))
    .map(({ alert }): FiredAlert => ({
      trigger: { alert: { kind: 'custom', id: alert.id }, matchedBy: 'model' },
      ...(alert.pausesAgent && { pauses: 'custom_alert' }),
      notify: alert.notify,
    }));
  if (brief.intent === 'asks_for_service' && systemOn.has('service_request'))
    fired.push({
      trigger: { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'model' },
      notify: true,
    });
  if (brief.intent === 'asks_if_bot' && systemOn.has('identity_doubt'))
    fired.push({
      trigger: { alert: { kind: 'system', code: 'identity_doubt' }, matchedBy: 'model' },
      ...(chatterOnShift && { pauses: 'identity_doubt' }),
      notify: true,
    });
  return fired;
}

/**
 * What the alerts of one message come to: the first that pauses the agent hands him over with its trigger, every
 * other is a notice of its own (`alert_triggered`). One alert is never both, so the team hears of it once.
 */
export function settleAlerts(fired: readonly FiredAlert[]): {
  readonly pause: { readonly trigger: AlertTrigger; readonly cause: HandoffCause } | null;
  readonly notices: readonly AlertNotice[];
} {
  const first = fired.find((f) => f.pauses !== undefined);
  return {
    pause: first?.pauses === undefined ? null : { trigger: first.trigger, cause: first.pauses },
    notices: fired.filter((f) => f !== first).map(noticeOf),
  };
}

/** An alert as a notice: what `alert_triggered` carries. */
export const noticeOf = ({ trigger, notify }: FiredAlert): AlertNotice => ({ trigger, notify });
