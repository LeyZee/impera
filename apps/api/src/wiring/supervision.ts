import type { CreatorId } from '@impera/contracts';
import type { RoleHealth } from '@impera/llm';

import type { AppLlm } from '../llm';
import { salesFeedTotals } from '../modules/connectors';
import type { ConversationsModule } from '../modules/conversations';
import type { PayrollModule } from '../modules/payroll';
import type { SchedulingModule } from '../modules/scheduling';
import { createSupervisionModule, type SupervisionModule } from '../modules/supervision';
import type { TelegramModule } from '../modules/telegram';
import { readStuckJobs } from '../readiness';

import type { WiredAgent } from './agent';
import type { Routes, Shared } from './shared';

export interface WiredSupervision {
  readonly module: SupervisionModule;
  readonly routes: readonly Routes[];
}

export function wireSupervision(
  shared: Shared,
  deps: {
    readonly llm: AppLlm;
    readonly activeVoice: WiredAgent['activeVoice'];
    readonly allCreatorIds: () => Promise<readonly CreatorId[]>;
    readonly conversations: ConversationsModule;
    readonly payroll: PayrollModule;
    readonly scheduling: SchedulingModule;
    readonly telegram: TelegramModule | null;
    /** Every job a worker task takes: a dead one is counted on the Dashboard. */
    readonly jobNames: () => readonly string[];
  },
): WiredSupervision {
  const { db, adminDb, requireRole } = shared;
  const { llm, conversations, payroll, telegram } = deps;
  const module = createSupervisionModule({
    db,
    requireRole,
    budget: () => llm.gateway.health().budget,
    voiceHealth: () => voiceHealthOf(llm.gateway.health().roles.find((r) => r.role === 'voice')),
    voice: deps.activeVoice,
    stuckJobs: (creatorId) => readStuckJobs(adminDb, creatorId, deps.jobNames()),
    allCreatorIds: deps.allCreatorIds,
    // The one sum of the register (CRM-04 lot a): the sales panel reads it, never sums again.
    salesTotalsOf: salesFeedTotals.totalsOf,
    // Who is on shift on her now, for her card in the list of Créatrices: the planning's own read, without the margin.
    onShift: (creatorId, at) => deps.scheduling.onShift(creatorId, at),
    automatic: { read: (creatorId) => conversations.automaticLock(creatorId) },
    // The best fans in euros: dollars at pay's last ECB rate known (ADR 0033), read as whoever reads the Dashboard.
    usdRate: {
      latest: async (userId) => {
        const rate = await payroll.latestRate(userId, 'USD');
        return rate === null ? null : { day: rate.day, rateMicros: rate.rateMicros };
      },
    },
    ...(telegram !== null && {
      telegram: {
        read: async (creatorId) => {
          const [night, { coverage }] = await Promise.all([
            telegram.nightCounts(creatorId),
            telegram.overview(),
          ]);
          return {
            alertsTonight: night.urgent + night.important,
            urgentReachable: coverage.find((c) => c.creatorId === creatorId)?.urgentReachable ?? false,
          };
        },
      },
    }),
  });
  return { module, routes: [module.routes] };
}

/**
 * The voice as the Dashboard says it. On its fallback (Mistral writes while Grok's key is refused) or after a few failed
 * calls it still answers: only `down` stops it, as Réglages › Modèles IA says (recette AGT 06/11).
 */
export function voiceHealthOf(voice: RoleHealth | undefined): { ok: boolean; keyMissing: boolean } {
  return {
    ok: voice !== undefined && voice.state !== 'down',
    keyMissing: voice === undefined || (!voice.hasKey && voice.fallback?.hasKey !== true),
  };
}
