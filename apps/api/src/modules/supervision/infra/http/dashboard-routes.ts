import {
  CreatorIdSchema,
  DashboardQuerySchema,
  DashboardSchema,
  DomainError,
  TodosAcrossCreatorsSchema,
  type CreatorId,
  type DashboardPeriod,
  type UserRole,
  UserIdSchema,
} from '@nirvana/contracts';
import { startOfLocalDay } from '@nirvana/llm';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  assembleDashboard,
  creatorQueue,
  queueAcross,
  type BudgetReading,
  type CreatorQueue,
  type VoiceHealth,
} from '../../domain/dashboard';
import type {
  AutomaticView,
  DashboardReader,
  TelegramView,
  UsdRateView,
  VoiceVersion,
} from '../../domain/dashboard-ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

export interface DashboardRouteDeps {
  readonly reader: DashboardReader;
  readonly requireRole: RequireRole;
  /** The day's AI spend and cap, every creator together (the gateway's health). */
  readonly budget: () => BudgetReading;
  /** A voice model answers, main or fallback; `keyMissing` when neither has a key. */
  readonly voiceHealth: () => VoiceHealth;
  /** Jobs the worker gave up on, hers or of no creator (read with the admin role: Graphile's schema). */
  readonly deadJobs: (creatorId: CreatorId) => Promise<number | null>;
  readonly voice: VoiceVersion;
  readonly automatic: AutomaticView;
  /** The last ECB rate known for the dollar (pay's), to rank the best fans in euros. */
  readonly usdRate: UsdRateView;
  /** Absent when Telegram is off (no encryption key): both Telegram fields are null. */
  readonly telegram?: TelegramView;
  /** Every creator, for the owner's « À traiter » across creators (`persona` module, by the composition root). */
  readonly allCreatorIds: () => Promise<readonly CreatorId[]>;
  readonly now?: () => Date;
}

const DAY_MS = 86_400_000;

function periodStart(period: DashboardPeriod, now: Date, dayStart: Date): Date {
  if (period === 'day') return dayStart;
  return new Date(now.getTime() - (period === 'week' ? 7 : 30) * DAY_MS);
}

/**
 * `GET /v1/dashboard?creatorId=&period=`: everything the Dashboard shows for one creator, computed here. Read by the
 * creator herself, it leaves out « À traiter » and her best fans (ADR 0023).
 */
export function createDashboardRoutes(deps: DashboardRouteDeps): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/dashboard',
      {
        preValidation: deps.requireRole('owner', 'operator', 'creator'),
        schema: { querystring: DashboardQuerySchema, response: { 200: DashboardSchema } },
      },
      async (request) => {
        const { creatorId, period } = request.query;
        const { user } = request;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        if (user.role !== 'owner' && !user.creatorIds.includes(creatorId)) {
          throw new DomainError('creator_forbidden', 'Créatrice hors de ton périmètre');
        }
        const now = (deps.now ?? (() => new Date()))();
        const usdRate = await deps.usdRate.latest(UserIdSchema.parse(user.id));
        const read = await deps.reader.read(
          creatorId,
          (timezone) => {
            // Her day: midnight in her time zone (`creators.timezone`).
            const dayStart = startOfLocalDay(now, timezone);
            return { now, dayStart, periodStart: periodStart(period, now, dayStart), voice: deps.voice };
          },
          usdRate,
        );
        if (read === undefined) throw new DomainError('creator_not_found', 'Créatrice introuvable');
        const [telegram, automatic, deadJobs] = await Promise.all([
          deps.telegram?.read(creatorId),
          deps.automatic.read(creatorId),
          deps.deadJobs(creatorId),
        ]);
        const dashboard = assembleDashboard({
          creatorId,
          period,
          facts: read.facts,
          window: read.window,
          budget: deps.budget(),
          voice: deps.voiceHealth(),
          deadJobs,
          telegram,
          automatic,
        });
        // ADR 0023: a creator never sees a conversation nor a fan, nor the agency's figures (the day's AI spend of
        // every creator, the jobs of no creator). Her Dashboard keeps her own aggregates only.
        if (user.role !== 'creator') return dashboard;
        return {
          ...dashboard,
          todos: [],
          fans: [],
          usdSales: { seen: false, rate: null },
          budget: { ...dashboard.budget, spentToday: null },
          jobs: { dead: null },
        };
      },
    );

    app.get(
      '/dashboard/todos',
      {
        // A creator never sees a conversation nor a fan (ADR 0023): « À traiter » is the owner's and the chatters'.
        preValidation: deps.requireRole('owner', 'operator'),
        schema: { response: { 200: TodosAcrossCreatorsSchema } },
      },
      async (request) => {
        const { user } = request;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        // The creators the person follows: every one for the owner, the account's own otherwise. Never the creators
        // where a member reads only the conversations routed to him: their queue is not his.
        const followed =
          user.role === 'owner'
            ? await deps.allCreatorIds()
            : user.creatorIds.map((id) => CreatorIdSchema.parse(id));
        const now = (deps.now ?? (() => new Date()))();
        // One tenant transaction per creator (RLS): nothing of a creator outside the list is ever read. One after the
        // other, so a refresh holds one connection of the pool, not one per creator.
        const queues: CreatorQueue[] = [];
        for (const creatorId of followed) {
          const found = await deps.reader.read(
            creatorId,
            (timezone) => {
              const dayStart = startOfLocalDay(now, timezone);
              return { now, dayStart, periodStart: dayStart, voice: deps.voice };
            },
            // The queue counts no sale: no rate to read.
            null,
          );
          if (found !== undefined) queues.push(creatorQueue(creatorId, found.facts, now));
        }
        return queueAcross(queues);
      },
    );
    return Promise.resolve();
  };
}
