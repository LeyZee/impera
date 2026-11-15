import { AI_BUDGET_UNPROCESSABLE, DomainError, type AiBudget, type PutAiBudgetBody } from '@impera/contracts';

import { capsProblem, effectiveCaps, type CapDefaults, type StoredCaps } from '../domain/budget';
import type { BudgetActor, BudgetStore } from '../domain/ports';

import type { CapsCache } from './caps-cache';

/** The gateway's reading of the day (`health()` in packages/llm), in euros. */
export interface SpendReading {
  readonly spentEur: number;
  readonly alertAtEur: number;
  readonly state: AiBudget['state'];
}

export interface BudgetDeps {
  readonly store: BudgetStore;
  readonly cache: CapsCache;
  readonly defaults: CapDefaults;
  /** The day's spend against the cap in force, and the trend watch's own. */
  readonly spend: () => { readonly all: SpendReading; readonly trendWatch: SpendReading };
}

/** Euros to cents for the screen, rounded up: a spend is never told smaller than it is. */
const cents = (eur: number): number => Math.ceil(Math.round(eur * 10_000) / 100);

function budgetOf(deps: BudgetDeps, stored: StoredCaps): AiBudget {
  const caps = effectiveCaps(stored, deps.defaults);
  const { all, trendWatch } = deps.spend();
  return {
    ...caps,
    defaults: deps.defaults,
    isCustom: { dailyCap: stored.dailyCapMinor !== null, trendWatchCap: stored.trendWatchCapMinor !== null },
    alertAtMinor: Math.round(all.alertAtEur * 100),
    spentTodayMinor: cents(all.spentEur),
    trendWatchSpentTodayMinor: cents(trendWatch.spentEur),
    state: all.state,
    updatedAt: stored.updatedAt?.toISOString() ?? null,
  };
}

/** `GET /v1/settings/ai-budget`: read from the database, so the screen never shows a stale copy. */
export async function readBudget(deps: BudgetDeps): Promise<AiBudget> {
  const stored = await deps.store.read();
  deps.cache.set(stored);
  return budgetOf(deps, stored);
}

/**
 * `PUT /v1/settings/ai-budget`: applies at once in this process, within a minute in the other. A budget lowered under
 * the day's spend stops the agent at its next call; the answer says so (`state: 'reached'`).
 */
export async function writeBudget(
  deps: BudgetDeps,
  body: PutAiBudgetBody,
  actor: BudgetActor,
): Promise<AiBudget> {
  const problem = capsProblem(body, deps.defaults);
  if (problem !== null) throw new DomainError(AI_BUDGET_UNPROCESSABLE, problem);
  const stored = await deps.store.write(body, actor);
  deps.cache.set(stored);
  return budgetOf(deps, stored);
}
