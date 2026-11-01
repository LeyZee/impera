import {
  alertKeywordKey,
  normalise,
  unmask,
  type AlertTrigger,
  type CustomAlert,
  type HandoffCause,
  type SystemAlertCode,
} from '@nirvana/contracts';

/**
 * Her alert keywords (`notifications.alert_keywords`, P4-01): read in code, never by a model, on what he wrote since
 * her last answer. A keyword matches as a whole word or phrase once both sides are normalised (« Rendez-vous »
 * matches « rendez vous », « RDV » does not match « rdvs »), and also once the digits inside his words are read as
 * letters (« r0bot »). Gives the keywords that matched, as she wrote them, in her order.
 */
export function alertKeywordsIn(text: string, keywords: readonly string[]): string[] {
  const readings = [normalise(text), unmask(text)].map(spaced);
  return keywords.filter((keyword) => {
    const term = alertKeywordKey(keyword);
    return term !== '' && readings.some((reading) => reading.includes(` ${term} `));
  });
}

/** Words split on anything that is not a letter or a digit, with a space at each end: whole words compare. */
const spaced = (text: string): string => ` ${text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

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
  /** Sent to Telegram when it only lets a human know: her alert's `notify` as it is now, always for the system's. */
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
