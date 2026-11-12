import {
  DomainError,
  type AddAiCreditEntryBody,
  type AiCreditProvider,
  type AiUsage,
} from '@impera/contracts';

import type { Clock, CreditActor, CreditAlerts, CreditLedger, UsageReader } from '../domain/ports';
import { aiUsage, countFrom, type CapReading } from '../domain/usage';

export interface UsageDeps {
  readonly reader: UsageReader;
  readonly ledger: CreditLedger;
  readonly alerts: CreditAlerts;
  readonly clock: Clock;
  /** Today against the cap, from the gateway's health (the figure that stops the agent). */
  readonly cap: () => CapReading;
  /** The cap's day and rate (`DEFAULT_LLM_CONFIG.dailyBudget`). */
  readonly timeZone: string;
  readonly usdPerEur: number;
}

/** How far ahead of the server's clock a line may be dated. */
const FUTURE_DRIFT_MS = 5 * 60_000;

/** Enough to cover the 30 days of the screen in any zone; the domain keeps its own days. */
const READ_BACK_MS = 31 * 86_400_000;

/** The day (YYYY-MM-DD) and the hour it is in `timeZone`. */
function wallClock(now: Date, timeZone: string): { readonly day: string; readonly hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return { day: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

/** `GET /v1/settings/ai-usage`: the journal summed, the ledger counted down (ADR 0091). */
export async function readUsage(deps: UsageDeps): Promise<AiUsage> {
  const now = deps.clock.now();
  const from = new Date(now.getTime() - READ_BACK_MS);
  const [rows, lastCallAt, entries] = await Promise.all([
    deps.reader.rows(from, deps.timeZone),
    deps.reader.lastCallAt(from),
    deps.ledger.list(),
  ]);
  const spent = await Promise.all(
    (['xai', 'mistral', 'google'] as const).map(async (provider: AiCreditProvider) => {
      const start = countFrom(entries.filter((e) => e.provider === provider));
      return [
        provider,
        start === null ? 0 : await deps.reader.spentSince(provider, new Date(start.at)),
      ] as const;
    }),
  );
  const { day, hour } = wallClock(now, deps.timeZone);
  const firstDay = rows.reduce<string | null>(
    (first, r) => (first === null || r.day < first ? r.day : first),
    null,
  );
  return aiUsage({
    rows,
    cap: deps.cap(),
    today: day,
    hour,
    firstDay,
    lastCallAt,
    readAt: now,
    timeZone: deps.timeZone,
    usdPerEur: deps.usdPerEur,
    entries,
    spentSinceUsd: Object.fromEntries(spent),
  });
}

/**
 * The hourly check (`ai_usage.check_credits`, ADR 0091 § 4): a card amber, red or empty publishes `ai_credits_low`
 * for its level, once per latest line of the ledger. Returns the alerts published.
 */
export async function checkCredits(deps: UsageDeps): Promise<number> {
  const usage = await readUsage(deps);
  let published = 0;
  for (const card of usage.credits) {
    if (card.state !== 'low' && card.state !== 'critical' && card.state !== 'empty') continue;
    const [latest] = card.entries;
    if (latest === undefined) continue;
    const sent = await deps.alerts.publish(
      {
        provider: card.provider,
        level: card.state,
        balanceMinor: card.balanceMinor,
        currency: card.currency,
        daysLeft: card.daysLeft,
        runsOutOn: card.runsOutOn,
        entryId: latest.id,
      },
      // A line may be dated up to 5 minutes ahead (`addCredit`): its alerts are never older than that.
      new Date(Date.parse(latest.at) - FUTURE_DRIFT_MS),
    );
    if (sent) published += 1;
  }
  return published;
}

/** `POST /v1/settings/ai-usage/credits`: a line dated more than 5 minutes ahead is refused; absent, it is now. */
export async function addCredit(
  deps: UsageDeps,
  body: AddAiCreditEntryBody,
  actor: CreditActor,
): ReturnType<CreditLedger['add']> {
  const now = deps.clock.now();
  const at = body.at === undefined ? now : new Date(body.at);
  if (at.getTime() > now.getTime() + FUTURE_DRIFT_MS)
    throw new DomainError(
      'ai_credit_in_future_unprocessable',
      'Cette saisie est datée dans le futur : mets l’heure où l’argent est arrivé.',
    );
  return deps.ledger.add({ ...body, at: at.toISOString() }, actor);
}
