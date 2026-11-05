import { startOfLocalDay, type BudgetStatus } from './budget';
import type { CallOutcome, LlmCallLog, LlmCallRecord } from './call-log';
import { findModel, MODELS, PROVIDERS, type InputKind } from './catalog';
import { apiKeyFor, type ApiKeys, type LlmConfig, type LlmRole, type ModelRef } from './config';

export type HealthState = 'ok' | 'degraded' | 'down';

export interface RoleHealth {
  readonly role: LlmRole;
  readonly state: HealthState;
  readonly active: ModelRef & { readonly label: string };
  readonly fallback?: ModelRef & { readonly label: string; readonly hasKey: boolean };
  readonly hasKey: boolean;
  /** True when the last call of the last 15 minutes was served by the fallback. */
  readonly isOnFallback: boolean;
  readonly lastSuccessAt?: Date;
  readonly lastError?: { readonly at: Date; readonly outcome: CallOutcome; readonly message?: string };
  readonly latencyP50Ms?: number;
  readonly latencyP95Ms?: number;
  readonly callsLastHour: number;
  readonly errorRateLastHour: number;
  readonly costTodayUsd: number;
}

export interface ProviderHealth {
  readonly provider: ModelRef['provider'];
  readonly label: string;
  readonly apiKeyEnv: string;
  readonly hasKey: boolean;
  readonly models: readonly {
    readonly model: string;
    readonly label: string;
    readonly inputs: readonly InputKind[];
    readonly unconfirmedInputs: readonly InputKind[];
  }[];
}

export interface HealthReport {
  readonly state: HealthState;
  readonly at: Date;
  readonly roles: readonly RoleHealth[];
  readonly providers: readonly ProviderHealth[];
  /** Since her midnight (budget time zone), in USD as journaled. */
  readonly costTodayUsd: number;
  readonly budget: BudgetStatus;
  /** The trend watch's spend against its own cap (ADR 0060 § 7): `reached` stops its jobs until midnight. */
  readonly trendWatchBudget: BudgetStatus;
}

const HOUR_MS = 3_600_000;
const FALLBACK_WINDOW_MS = 15 * 60_000;

function percentile(sorted: readonly number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function label(ref: ModelRef): string {
  return findModel(ref)?.label ?? ref.model;
}

function roleHealth(
  role: LlmRole,
  config: LlmConfig,
  credentials: ApiKeys,
  today: readonly LlmCallRecord[],
  now: Date,
): RoleHealth {
  const roleConfig = config.roles[role];
  const records = today.filter((r) => r.role === role);
  const lastHour = records.filter((r) => now.getTime() - r.at.getTime() <= HOUR_MS);
  const successes = records.filter((r) => r.outcome === 'ok');
  const failures = records.filter((r) => r.outcome !== 'ok');
  const lastSuccess = successes.at(-1);
  const lastFailure = failures.at(-1);
  const latencies = lastHour
    .filter((r) => r.outcome === 'ok')
    .map((r) => r.latencyMs)
    .sort((a, b) => a - b);
  const recent = records.filter(
    (r) => now.getTime() - r.at.getTime() <= FALLBACK_WINDOW_MS && r.outcome === 'ok',
  );
  const isOnFallback = recent.at(-1)?.isFallback ?? false;
  const hasKey = apiKeyFor(credentials, roleConfig.provider) !== undefined;
  const fallbackHasKey =
    roleConfig.fallback !== undefined && apiKeyFor(credentials, roleConfig.fallback.provider) !== undefined;
  const lastCallFailed = records.at(-1) !== undefined && records.at(-1)?.outcome !== 'ok';

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  let state: HealthState = 'ok';
  if (!hasKey && !fallbackHasKey) state = 'down';
  else if (lastCallFailed && !isOnFallback) state = 'down';
  else if (
    !hasKey ||
    isOnFallback ||
    (lastHour.length > 0 && lastHour.filter((r) => r.outcome !== 'ok').length / lastHour.length > 0.2)
  ) {
    state = 'degraded';
  }

  return {
    role,
    state,
    active: { provider: roleConfig.provider, model: roleConfig.model, label: label(roleConfig) },
    ...(roleConfig.fallback && {
      fallback: { ...roleConfig.fallback, label: label(roleConfig.fallback), hasKey: fallbackHasKey },
    }),
    hasKey,
    isOnFallback,
    ...(lastSuccess && { lastSuccessAt: lastSuccess.at }),
    ...(lastFailure && {
      lastError: {
        at: lastFailure.at,
        outcome: lastFailure.outcome,
        ...(lastFailure.errorMessage !== undefined && { message: lastFailure.errorMessage }),
      },
    }),
    ...(p50 !== undefined && { latencyP50Ms: p50 }),
    ...(p95 !== undefined && { latencyP95Ms: p95 }),
    callsLastHour: lastHour.length,
    errorRateLastHour:
      lastHour.length === 0 ? 0 : lastHour.filter((r) => r.outcome !== 'ok').length / lastHour.length,
    costTodayUsd: records.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
  };
}

/** Feeds the « Modèles IA » panel (state, cost against budget, per-role health, keys). Never exposes a key. */
export function computeHealth(
  config: LlmConfig,
  credentials: ApiKeys,
  log: LlmCallLog,
  now: Date,
  budget: BudgetStatus,
  trendWatchBudget: BudgetStatus,
): HealthReport {
  const today = log.since(startOfLocalDay(now, config.dailyBudget.timeZone));
  const roles = (['voice', 'brain', 'sense', 'judge'] as const).map((role) =>
    roleHealth(role, config, credentials, today, now),
  );
  const live = roles.filter((r) => r.role === 'voice' || r.role === 'brain');
  const state: HealthState = live.some((r) => r.state === 'down')
    ? 'down'
    : live.some((r) => r.state === 'degraded')
      ? 'degraded'
      : 'ok';
  return {
    state,
    at: now,
    roles,
    providers: PROVIDERS.map((p) => ({
      provider: p.id,
      label: p.label,
      apiKeyEnv: p.apiKeyEnv,
      hasKey: apiKeyFor(credentials, p.id) !== undefined,
      models: MODELS.filter((m) => m.provider === p.id).map((m) => ({
        model: m.model,
        label: m.label,
        inputs: m.inputs,
        unconfirmedInputs: m.unconfirmedInputs,
      })),
    })),
    costTodayUsd: today.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
    budget,
    trendWatchBudget,
  };
}
