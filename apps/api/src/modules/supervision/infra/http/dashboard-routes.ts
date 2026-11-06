import {
  CreatorIdSchema,
  CreatorsOverviewSchema,
  DashboardQuerySchema,
  DashboardSchema,
  DomainError,
  TodosAcrossCreatorsSchema,
  type CreatorId,
  type DashboardPeriod,
  type UserRole,
  UserIdSchema,
} from '@impera/contracts';
import { startOfLocalDay } from '@impera/llm';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { creatorOverview, fortnightDays } from '../../domain/creators-overview';
import {
  assembleDashboard,
  creatorQueue,
  queueAcross,
  stuckJobsOf,
  type BudgetReading,
  type CreatorQueue,
  type StuckJobsRow,
  type VoiceHealth,
} from '../../domain/dashboard';
import type {
  AutomaticView,
  CreatorOverviewView,
  DashboardReader,
  OnShiftView,
  RevealSalesView,
  TelegramView,
  UsdRateView,
  VoiceVersion,
} from '../../domain/dashboard-ports';
import { revealSalesPanel, salesDays } from '../../domain/reveal-sales';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

export interface DashboardRouteDeps {
  readonly reader: DashboardReader;
  readonly requireRole: RequireRole;
  /** The day's AI spend and cap, every creator together (the gateway's health). */
  readonly budget: () => BudgetReading;
  /** A voice model answers, main or fallback; `keyMissing` when neither has a key. */
  readonly voiceHealth: () => VoiceHealth;
  /** Stuck jobs, hers or of no creator, by task (read with the admin role: Graphile's schema); `null` when unread. */
  readonly stuckJobs: (creatorId: CreatorId) => Promise<readonly StuckJobsRow[] | null>;
  readonly voice: VoiceVersion;
  readonly automatic: AutomaticView;
  /** The last ECB rate known for the dollar (pay's), to rank the best fans in euros. */
  readonly usdRate: UsdRateView;
  /** The sales read in the platform's register (CRM-04 lot c). */
  readonly revealSales: RevealSalesView;
  /** A creator's card in the list of Créatrices: her mode, her requests, the team's names. */
  readonly overview: CreatorOverviewView;
  /** Who is on shift on her accounts now (`scheduling`), read as the system. */
  readonly onShift: OnShiftView;
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
 * `GET /v1/dashboard?creatorId=&period=`: everything the Dashboard shows for one creator, computed here. The agency's
 * screen alone: the creator reads her own Aujourd'hui (ADR 0042 § 8, CR-02), never this one.
 */
export function createDashboardRoutes(deps: DashboardRouteDeps): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/dashboard',
      {
        preValidation: deps.requireRole('owner', 'operator'),
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
        const [telegram, automatic, stuckJobs, sales] = await Promise.all([
          deps.telegram?.read(creatorId),
          deps.automatic.read(creatorId),
          deps.stuckJobs(creatorId),
          deps.revealSales.read(
            creatorId,
            UserIdSchema.parse(user.id),
            salesDays(period, now, read.facts.creator.timezone),
          ),
        ]);
        return assembleDashboard({
          creatorId,
          period,
          facts: read.facts,
          window: read.window,
          budget: deps.budget(),
          voice: deps.voiceHealth(),
          // The agency's jobs (pay, Telegram) are the owner's to see, never counted in her agent's health (PRO-10).
          jobs: stuckJobsOf(stuckJobs, user.role === 'owner'),
          telegram,
          automatic,
          revealSales: sales === undefined ? null : revealSalesPanel({ ...sales, rate: usdRate }),
        });
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
        // The creators the person follows: every one for the owner, the account's own otherwise, and those a chatter's
        // access window opens now (ADR 0025, EQ-13: he treats their queue during his shift). Never the creators where a
        // member reads only the conversations he holds: their queue is not his.
        const followed =
          user.role === 'owner'
            ? await deps.allCreatorIds()
            : [...new Set([...user.creatorIds, ...user.shiftCreatorIds])].map((id) =>
                CreatorIdSchema.parse(id),
              );
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
    app.get(
      '/dashboard/creators',
      {
        // The agency's list of Créatrices: never a creator's, never a chatter's (his creators move to
        // `routedCreatorIds`, so the account's own list is empty for him).
        preValidation: deps.requireRole('owner', 'operator'),
        schema: { response: { 200: CreatorsOverviewSchema } },
      },
      async (request) => {
        const { user } = request;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        const userId = UserIdSchema.parse(user.id);
        const listed =
          user.role === 'owner'
            ? await deps.allCreatorIds()
            : [...new Set(user.creatorIds)].map((id) => CreatorIdSchema.parse(id));
        const now = (deps.now ?? (() => new Date()))();
        const rate = listed.length === 0 ? null : await deps.usdRate.latest(userId);
        // One tenant transaction per creator (RLS), one after the other: a refresh holds one connection of the pool.
        const creators = [];
        for (const creatorId of listed) {
          const facts = await deps.overview.read(creatorId, userId);
          if (facts === undefined) continue;
          const reads = facts.scope !== 'self';
          const sales = reads
            ? await deps.revealSales.read(creatorId, userId, fortnightDays(now, facts.timezone))
            : undefined;
          const onShift = reads ? await deps.onShift(creatorId, now) : [];
          creators.push(creatorOverview({ creatorId, facts, now, sales, rate, onShift }));
        }
        return { creators };
      },
    );
    return Promise.resolve();
  };
}
