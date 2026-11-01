import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import { CreatorIdSchema, JOB_PAYLOADS, type JobName } from '@nirvana/contracts';
import { createDbClient, parseEncryptionKeys, type Database, type DbClient } from '@nirvana/db';
import { createPersistentCallLog, DEFAULT_LLM_CONFIG, loadPrompt, type LlmCallStore } from '@nirvana/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Task, TaskList } from 'graphile-worker';
import type { Pool } from 'pg';

import {
  createAuth,
  createAuthRoutes,
  createRequireRecentLogin,
  createRequireRole,
  type Auth,
  type RequireRole,
} from './auth';
import { publishBudgetThreshold } from './budget-events';
import { secretOrNull, type Config } from './config';
import { cronKnownSince } from './crontab';
import { assertDatabaseRoles } from './database-roles';
import { createInvitationLinkRoutes, liveInvitationLinksUnscoped } from './invitation-links';
import { createJobQueue, defineTask, type JobQueue } from './jobs';
import { createAppLlm } from './llm';
import { createDrizzleLlmCallStore } from './llm-call-store';
import type { Logger } from './logger';
import {
  createAgentModule,
  guardContextOf,
  sampleReplyFaults,
  startBubbleGuard,
  startKycSlots,
  startDraftComposer,
  startFollowUpPlan,
  type AgentModule,
} from './modules/agent';
import { createAlertsModule, type AlertsModule } from './modules/alerts';
import { startBackupsModule, type BackupsModule } from './modules/backups';
import { createConnectorsModule, type ConnectorRegistry, type ConnectorsModule } from './modules/connectors';
import {
  createConversationsModule,
  type BubbleGuard,
  type ConversationsModule,
  type DraftComposer,
} from './modules/conversations';
import { createFansModule, type FansModule } from './modules/fans';
import {
  createDrizzleDescriptionReader,
  createMediaModule,
  missingMediaBinaries,
  type MediaModule,
} from './modules/media';
import { createPayrollModule, enqueuePayRecalculation, type PayrollModule } from './modules/payroll';
import { createPersonaModule, type PersonaModule } from './modules/persona';
import { startPlaygroundModule, type PlaygroundModule } from './modules/playground';
import { startProvidersModule, type ProvidersModule } from './modules/providers';
import { createSchedulingModule, type SchedulingModule } from './modules/scheduling';
import { createSupervisionModule, type SupervisionModule } from './modules/supervision';
import { createTeamModule, type TeamModule } from './modules/team';
import { startTelegramModule, type TelegramModule } from './modules/telegram';
import { postgresRateLimitStore, purgeRateLimitCounters, RATE_LIMIT_POOL_OPTIONS } from './rate-limit-store';
import { checkReadiness, countDeadJobs, type Readiness } from './readiness';

/**
 * Jobs of the contracts that no worker task takes yet (operations.md: Graphile keeps them queued, the Dashboard counts
 * them as stuck). Every other job must have its task: `tasks` is typed on the rest, so a task forgotten for a job
 * added to `JOB_NAMES` does not compile.
 */
type JobWithoutTask = Extract<JobName, 'fans.refresh_summary' | 'media.describe'>;
type JobWithTask = Exclude<JobName, JobWithoutTask>;

/** Every business module, wired. */
interface Modules {
  readonly alerts: AlertsModule;
  readonly backups: BackupsModule;
  readonly connectors: ConnectorsModule;
  readonly conversations: ConversationsModule;
  readonly fans: FansModule;
  readonly persona: PersonaModule;
  readonly agent: AgentModule;
  readonly media: MediaModule;
  readonly supervision: SupervisionModule;
  readonly providers: ProvidersModule;
  readonly team: TeamModule;
  readonly scheduling: SchedulingModule;
  readonly payroll: PayrollModule;
  /** Null in the worker, or when its persona cannot be read: the API starts without the playground and says why. */
  readonly playground: PlaygroundModule | null;
  /** Null without CREDENTIALS_ENCRYPTION_KEYS: a bot token is never kept unsealed (ADR 0020 §5). */
  readonly telegram: TelegramModule | null;
}

/** What both entry points (API and worker) are built from. */
export interface App {
  readonly modules: Modules;
  /** Application role: RLS applies; tenant access goes through `withTenant`. */
  readonly db: DbClient;
  /** Owner role: Graphile Worker, unscoped jobs, migration status. */
  readonly adminDb: DbClient;
  readonly jobs: JobQueue;
  /** `llm_calls` for the LLM gateway's journal: one daily cap for the API and the worker, across restarts. */
  readonly llmCalls: LlmCallStore;
  /** Dashboard authentication (Better Auth); routes guard themselves with `requireRole`. */
  readonly auth: Auth;
  readonly requireRole: RequireRole;
  /** Mounted under `/v1` by the server. */
  readonly routes: readonly FastifyPluginAsyncZod[];
  /** Run by the worker. */
  readonly tasks: TaskList;
  readonly readiness: () => Promise<Readiness>;
  /**
   * The API's rate limit counters, shared by every instance through Postgres (ADR 0027), on a small pool of their
   * own with a statement timeout. The worker builds it unused: its pool opens no connection until a first request.
   */
  readonly rateLimitStore: FastifyRateLimitStoreCtor;
  /** Closes the queue and the pools; the server and the worker are stopped before. */
  shutdown(): Promise<void>;
}

/**
 * A path from the repository root, as the terminal playground reads it: `src/` in development and `dist/` once
 * built both sit two levels under it. An absolute path is kept as is.
 */
const fromRepoRoot = (path: string): string =>
  resolve(fileURLToPath(new URL('../../../', import.meta.url)), path);

/**
 * Production only: when the rate job was first scheduled, so that a currency that never got a rate is alerted too
 * (ADR 0033). Elsewhere a database without rates is the normal case, and pay gets `null`: no such alert, ever. A
 * failed read throws, never reads as « never scheduled ».
 */
export const rateJobSince = (
  config: Pick<Config, 'NODE_ENV'>,
  adminDb: Pick<Database, 'execute'>,
): (() => Promise<Date | null>) | null =>
  config.NODE_ENV === 'production' ? () => cronKnownSince(adminDb, 'payroll.fetch_exchange_rates') : null;

const POOL_OPTIONS = { connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 };

export interface AppOptions {
  /** Tests and local development plug a `FakeConnector` here; production gets the real adapters. */
  readonly connectorRegistry?: ConnectorRegistry;
  /** Tests plug a composer with fixed bubbles here; the agent's composer otherwise, on the app's gateway. */
  readonly composer?: DraftComposer;
  /** The worker serves no HTTP, so it starts no playground (its sessions live in the API's memory). */
  readonly withPlayground?: boolean;
}

/** Wires every business module by hand (no DI container, coding.md). Called once by each entry point. */
export async function createApp(config: Config, logger: Logger, options: AppOptions = {}): Promise<App> {
  const db = createDbClient(config.DATABASE_URL, POOL_OPTIONS);
  const adminDb = createDbClient(config.DATABASE_ADMIN_URL, { ...POOL_OPTIONS, max: 5 });
  const rateLimitDb = createDbClient(config.DATABASE_URL, RATE_LIMIT_POOL_OPTIONS);
  // A client losing its connection must not crash the process; the next query reconnects.
  for (const [role, pool] of [
    ['app', db.pool],
    ['admin', adminDb.pool],
    ['rate_limit', rateLimitDb.pool],
  ] satisfies [string, Pool][]) {
    const onError = (error: Error): void => {
      logger.warn({ err: error, role }, 'database client error');
    };
    pool.on('error', onError);
    pool.on('connect', (client) => client.on('error', onError));
  }
  // A role that silences RLS (or skips it) must stop the process, not answer empty lists.
  try {
    await assertDatabaseRoles(db.db, adminDb.db);
  } catch (error) {
    await Promise.all([db.close(), adminDb.close(), rateLimitDb.close()]);
    throw error;
  }
  const jobs = await createJobQueue(adminDb.pool);
  const auth = createAuth(config, db.db, logger);
  const requireRole = createRequireRole(auth, db.db);

  const fans = createFansModule({ db: db.db, adminDb: adminDb.db });
  const sessionKeys = secretOrNull(config.SESSION_ENCRYPTION_KEYS);
  const connectors = createConnectorsModule({
    db: db.db,
    adminDb: adminDb.db,
    // Called by the jobs only, once `conversations` exists below (the two modules need each other's port).
    ingest: (input) => conversations.ingestMessage(input),
    // Reveal's adapter arrives with phase 1 (ADR 0008); until then no account is polled.
    registry: options.connectorRegistry ?? {},
    sessionKeys: sessionKeys === null ? null : parseEncryptionKeys(sessionKeys, 'SESSION_ENCRYPTION_KEYS'),
    deviceToken: secretOrNull(config.EXTENSION_DEVICE_TOKEN),
  });
  const providers = await startProvidersModule({
    adminDb: adminDb.db,
    // The `.env.example` placeholder counts as unset: keys stay in memory instead of crashing the start.
    encryptionKeys: secretOrNull(config.CREDENTIALS_ENCRYPTION_KEYS) ?? undefined,
    environmentKeys:
      config.NODE_ENV === 'production'
        ? null
        : {
            xai: config.LLM_XAI_API_KEY,
            google: config.LLM_GOOGLE_API_KEY,
            elevenlabs: config.SPEECH_ELEVENLABS_API_KEY,
            mistral: config.LLM_MISTRAL_API_KEY,
            venice: config.LLM_VENICE_API_KEY,
          },
    onLoadError: (error) => {
      logger.warn({ err: error }, 'AI service keys not loaded');
    },
  });
  // Before Telegram and the composer: Telegram names her alerts, the agent checks his messages against them (P4-01).
  const alerts = createAlertsModule({ db: db.db, requireRole });
  const credentialKeys = secretOrNull(config.CREDENTIALS_ENCRYPTION_KEYS);
  const telegram =
    credentialKeys === null
      ? null
      : await startTelegramModule({
          adminDb: adminDb.db,
          encryptionKeys: credentialKeys,
          webOrigin: config.WEB_ORIGIN,
          onUncovered: (event) => {
            logger.error({ eventId: event.id }, 'urgent alert reaches no Telegram group');
          },
          onUnreadableTokens: (bots) => {
            logger.error({ bots }, 'Telegram bot tokens unreadable with CREDENTIALS_ENCRYPTION_KEYS');
          },
          alertNames: {
            ofCreator: async (creatorId) =>
              new Map([...(await alerts.store.names(creatorId))].map(([id, alert]) => [id, alert.name])),
          },
        });
  if (telegram === null) logger.warn('Telegram notifications off: CREDENTIALS_ENCRYPTION_KEYS is not set');
  // A fan's video needs ffmpeg and ffprobe: said at start-up, not on the first video.
  const mediaMissing = await missingMediaBinaries();
  if (mediaMissing.length > 0) {
    logger.warn({ missing: mediaMissing }, 'ffmpeg missing: fan videos and voice notes cannot be read');
  }
  const llmCalls = createDrizzleLlmCallStore(adminDb.db);
  // The day's calls of both processes, reloaded every 30 s: one daily cap for the API and the worker.
  const llmLog = await createPersistentCallLog(llmCalls, {
    timeZone: DEFAULT_LLM_CONFIG.dailyBudget.timeZone,
    refreshEveryMs: 30_000,
    onError: (error) => {
      logger.warn({ err: error }, 'llm_calls not written or not reloaded');
    },
  });
  const llm = createAppLlm({
    log: llmLog,
    credentials: providers.apiKeySource,
    reportRefusedKey: (provider, kind) => providers.reportRefusedKey(provider, kind),
    publishBudget: (crossing) => publishBudgetThreshold(adminDb.db, crossing),
    logger,
  });
  const personaPath = fromRepoRoot(config.PLAYGROUND_PERSONA_PATH ?? 'personas/demo/v0.2.0.yaml');
  const trainingDir = fromRepoRoot(config.NIRVANA_TRAINING_DIR ?? '.scratch/training');
  const persona = createPersonaModule({
    db: db.db,
    requireRole,
    recentLogin: createRequireRecentLogin(auth),
    // An example the voice imitates never teaches what a hard guard blocks (P5-01).
    sampleReplyFaults,
  });
  // Her active persona version, the one the owner activates in Créatrices › Persona: the agent writes with it, and
  // « Tester » an alert reads her phrase with it (ADR 0010, 0022; recette G4, M13). Read at each call, under RLS.
  const activePersona = (creatorId: string) => persona.versions.active(CreatorIdSchema.parse(creatorId));
  const team = createTeamModule({
    db: db.db,
    adminDb: adminDb.db,
    creators: {
      existing: async (ids) => new Set((await persona.creators.list(ids)).map((creator) => creator.id)),
    },
    // The links' table is read through `withAdmin` only (EQ-10): the module gets this function, never the table.
    invitationLinks: { live: (memberIds) => liveInvitationLinksUnscoped(adminDb.db, memberIds) },
    enqueuePayRecalculation,
  });
  const scheduling = createSchedulingModule({
    db: db.db,
    adminDb: adminDb.db,
    creators: { list: () => persona.creators.list('all') },
    // Pay owns `payroll.recalculate`: a validated report enqueues it through pay's own function (EQ-04).
    enqueuePayRecalculation,
  });
  // Pay reads the planning's reports and the team's rates in its own transaction, through their `index.ts` (EQ-04).
  const payroll = createPayrollModule({
    db: db.db,
    adminDb: adminDb.db,
    reads: {
      validatedReportsUnscoped: scheduling.pay.validatedReportsUnscoped,
      validatedReportsScoped: scheduling.pay.validatedReportsScoped,
      reportsAwaitingReviewScoped: scheduling.pay.reportsAwaitingReviewScoped,
      agencyTimeZone: scheduling.pay.agencyTimeZone,
      members: team.pay.members,
      creatorIds: async () => (await persona.creators.list('all')).map((creator) => creator.id),
    },
    rateJobSince: rateJobSince(config, adminDb.db),
  });
  const playground =
    options.withPlayground === false
      ? null
      : await startPlaygroundModule({
          ...llm.deps,
          gateway: llm.gateway,
          // The ratings belong to the only creator there is; with several, the screen will have to choose.
          creatorId: async () => {
            const creators = await persona.creators.list('all');
            return creators.length === 1 ? (creators[0]?.id ?? null) : null;
          },
          personaPath,
          trainingDir,
          activePersona,
        }).catch((error: unknown) => {
          logger.warn({ err: error }, 'playground not started: persona unreadable');
          return null;
        });
  // Each draft is written with her active persona version, read at each message; without one, a human answers
  // (`persona_inactive`). No file is read on this path: the fictional demo never writes to real fans unless an owner
  // activates it as her version (ADR 0010, 0022).
  const composer =
    options.composer ??
    startDraftComposer({
      gateway: llm.gateway,
      activePersona,
      fans,
      onDroppedNotes: (event) => {
        logger.warn(event, 'fan notes shaped like an order kept out of the prompt');
      },
      // His declared age could not be saved: the next answer stays careful, the miss is counted here (P3-09).
      onLimitsNotSaved: (event) => {
        logger.warn(event, 'fan limit not saved');
      },
      // Her alerts that are on, and the system's on for her (P4-01).
      alertsOf: async (creatorId) => {
        const id = CreatorIdSchema.parse(creatorId);
        const [custom, systemOn] = await Promise.all([alerts.store.activeFor(id), alerts.store.systemOn(id)]);
        return { custom, systemOn };
      },
      // A doubt on who she is goes to a chatter on shift now, without the margin (P4-01).
      chatterOnShift: async (creatorId, at) =>
        (await scheduling.onShift(CreatorIdSchema.parse(creatorId), at)).length > 0,
      // Her clock is the creator's (`creators.timezone`); Paris when the row cannot be read.
      timeZoneOf: async (creatorId) => {
        const [creator] = await persona.creators.list([CreatorIdSchema.parse(creatorId)]);
        return creator?.timezone ?? DEFAULT_LLM_CONFIG.dailyBudget.timeZone;
      },
    });
  // Her follow-up delays only beside the agent's own composer, the one that writes what `conversation.follow_up`
  // asks for (P3-10): a composer plugged by a test would answer his last message again.
  const followUps = options.composer !== undefined ? undefined : startFollowUpPlan({ activePersona });
  // Every approval passes the hard guards again (revue 09, G5), her active persona's limits included, read before
  // each approval (recette 28/10, G4). Without an active version nothing is approved: fail closed.
  const agentGuard = startBubbleGuard({ activePersona });
  // The canvas lines her active persona collects, for « À apprendre » in the Suivi (P5-01); every line without one.
  const kycSlotsOf = startKycSlots({ activePersona });
  // Read against what she already sent him (P3-13); an approved draft never carries a media.
  const guard: BubbleGuard = {
    forCreator: async (creatorId) => {
      const hers = await agentGuard.forCreator(creatorId);
      return hers === null
        ? null
        : { check: (bubbles, { history }) => hers.check(bubbles, guardContextOf(history)) };
    },
  };
  // The voice version the server writes with now, the one Automatique is proved on (ADR 0019): defined here only.
  const activeVoice = {
    voicePrompt: loadPrompt('voice').header.version,
    voiceModel: DEFAULT_LLM_CONFIG.roles.voice.model,
  };
  const conversations = createConversationsModule({
    db: db.db,
    fans,
    sender: connectors.outboundSender,
    requireRole,
    recentLogin: createRequireRecentLogin(auth),
    voice: activeVoice,
    guard,
    composer,
    ...(followUps !== undefined && { followUps }),
    replyHours: {
      of: async (creatorId) => {
        const view = await persona.creators.agentHours(creatorId);
        if (view?.invalidStored === true)
          logger.warn({ creatorId }, 'agent hours: stored setting unreadable, defaults used');
        return view === null ? null : { hours: view.hours, timeZone: view.timeZone };
      },
    },
    alertNames: { ofCreator: (creatorId) => alerts.store.names(creatorId) },
    mediaDescriptions: createDrizzleDescriptionReader(db.db),
  });
  const modules: Modules = {
    alerts,
    backups: startBackupsModule({
      db: db.db,
      adminDb: adminDb.db,
    }),
    connectors,
    conversations,
    fans,
    persona,
    team,
    scheduling,
    payroll,
    agent: createAgentModule(),
    media: createMediaModule(),
    supervision: createSupervisionModule({
      db: db.db,
      requireRole,
      budget: () => llm.gateway.health().budget,
      voiceHealth: () => {
        const voice = llm.gateway.health().roles.find((r) => r.role === 'voice');
        return {
          ok: voice?.state === 'ok',
          keyMissing: voice === undefined || (!voice.hasKey && voice.fallback?.hasKey !== true),
        };
      },
      voice: activeVoice,
      deadJobs: (creatorId) => countDeadJobs(adminDb.db, creatorId, Object.keys(tasks)),
      allCreatorIds: async () => (await persona.creators.list('all')).map((creator) => creator.id),
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
    }),
    providers,
    playground,
    telegram,
  };

  /** A Telegram job when the module is off: nothing to do, said once per run. */
  const withTelegram =
    (run: (module: TelegramModule) => Promise<unknown>) =>
    async (_payload: unknown, context: { readonly logger: Logger }): Promise<void> => {
      if (modules.telegram === null) {
        context.logger.info('telegram: off, nothing to do');
        return;
      }
      await run(modules.telegram);
    };

  const tasks: Record<JobWithTask, Task> = {
    'conversation.respond': defineTask(
      'conversation.respond',
      JOB_PAYLOADS['conversation.respond'],
      logger,
      (payload, context) => modules.conversations.jobs.respond(payload, context.logger),
    ),
    'conversation.send': defineTask(
      'conversation.send',
      JOB_PAYLOADS['conversation.send'],
      logger,
      (payload, context) => modules.conversations.jobs.send(payload, context.logger, context.attempt),
    ),
    'conversation.follow_up': defineTask(
      'conversation.follow_up',
      JOB_PAYLOADS['conversation.follow_up'],
      logger,
      (payload, context) => modules.conversations.jobs.followUp(payload, context.logger),
    ),
    'conversation.record_facts': defineTask(
      'conversation.record_facts',
      JOB_PAYLOADS['conversation.record_facts'],
      logger,
      (payload, context) => modules.conversations.jobs.recordFacts(payload, context.logger),
    ),
    'conversation.reopen': defineTask(
      'conversation.reopen',
      JOB_PAYLOADS['conversation.reopen'],
      logger,
      (payload, context) => modules.conversations.jobs.reopen(payload, context.logger),
    ),
    'connector.dispatch': defineTask(
      'connector.dispatch',
      JOB_PAYLOADS['connector.dispatch'],
      logger,
      (_payload, context) => modules.connectors.jobs.dispatch(context.logger),
    ),
    'connector.poll': defineTask(
      'connector.poll',
      JOB_PAYLOADS['connector.poll'],
      logger,
      (payload, context) => modules.connectors.jobs.poll(payload, context.logger),
    ),
    'connector.reconcile': defineTask(
      'connector.reconcile',
      JOB_PAYLOADS['connector.reconcile'],
      logger,
      (payload, context) => modules.connectors.jobs.reconcile(payload, context.logger),
    ),
    'providers.check_credentials': defineTask(
      'providers.check_credentials',
      JOB_PAYLOADS['providers.check_credentials'],
      logger,
      async (_payload, { logger: jobLogger }) => {
        const statuses = await modules.providers.reverifyAll();
        jobLogger.info(
          { states: statuses.map((s) => `${s.provider}:${s.state}`) },
          'AI service keys checked',
        );
      },
    ),
    'telegram.scan': defineTask(
      'telegram.scan',
      JOB_PAYLOADS['telegram.scan'],
      logger,
      withTelegram((module) => module.jobs.scan()),
    ),
    'telegram.flush_chat': defineTask(
      'telegram.flush_chat',
      JOB_PAYLOADS['telegram.flush_chat'],
      logger,
      (payload, context) => withTelegram((module) => module.jobs.flushChat(payload.chatId))(payload, context),
    ),
    'telegram.dispatch_polls': defineTask(
      'telegram.dispatch_polls',
      JOB_PAYLOADS['telegram.dispatch_polls'],
      logger,
      withTelegram((module) => module.jobs.dispatchPolls()),
    ),
    'telegram.poll_updates': defineTask(
      'telegram.poll_updates',
      JOB_PAYLOADS['telegram.poll_updates'],
      logger,
      (payload, context) =>
        withTelegram((module) => module.jobs.pollUpdates(payload.botId, payload.waitSeconds))(
          payload,
          context,
        ),
    ),
    'telegram.morning_digest': defineTask(
      'telegram.morning_digest',
      JOB_PAYLOADS['telegram.morning_digest'],
      logger,
      withTelegram((module) => module.jobs.morningDigest()),
    ),
    'fans.purge_facts': defineTask(
      'fans.purge_facts',
      JOB_PAYLOADS['fans.purge_facts'],
      logger,
      async (_payload, context) => {
        context.logger.info(
          { removed: await modules.fans.jobs.purgeFacts() },
          'fans: facts past retention dropped',
        );
      },
    ),
    'backups.check': defineTask(
      'backups.check',
      JOB_PAYLOADS['backups.check'],
      logger,
      async (_payload, context) => {
        const outcome = await modules.backups.jobs.check();
        if (outcome === 'alerted')
          context.logger.warn('backups: no export succeeded for 26 hours, owner alerted');
      },
    ),
    'scheduling.make_shifts': defineTask(
      'scheduling.make_shifts',
      JOB_PAYLOADS['scheduling.make_shifts'],
      logger,
      async (_payload, context) => {
        context.logger.info(
          { made: await modules.scheduling.jobs.makeShifts(context.logger) },
          'scheduling: template shifts made',
        );
      },
    ),
    'scheduling.lapse_swaps': defineTask(
      'scheduling.lapse_swaps',
      JOB_PAYLOADS['scheduling.lapse_swaps'],
      logger,
      async (_payload, context) => {
        context.logger.info(
          { lapsed: await modules.scheduling.jobs.lapseSwaps() },
          'scheduling: swap proposals lapsed',
        );
      },
    ),
    'team.apply_roles': defineTask(
      'team.apply_roles',
      JOB_PAYLOADS['team.apply_roles'],
      logger,
      async (_payload, context) => {
        context.logger.info(
          { applied: await modules.team.jobs.applyRoles() },
          'team: roles of the day applied',
        );
      },
    ),
    'payroll.recalculate': defineTask(
      'payroll.recalculate',
      JOB_PAYLOADS['payroll.recalculate'],
      logger,
      async (payload, context) => {
        context.logger.info(
          { outcomes: await modules.payroll.jobs.recalculate(payload.period, context.logger) },
          'payroll: drafts computed',
        );
      },
    ),
    'payroll.recalculate_open': defineTask(
      'payroll.recalculate_open',
      JOB_PAYLOADS['payroll.recalculate_open'],
      logger,
      async (_payload, context) => {
        context.logger.info(
          { outcomes: await modules.payroll.jobs.recalculateOpen(context.logger) },
          'payroll: open periods computed',
        );
      },
    ),
    'payroll.fetch_exchange_rates': defineTask(
      'payroll.fetch_exchange_rates',
      JOB_PAYLOADS['payroll.fetch_exchange_rates'],
      logger,
      async (_payload, context) => {
        context.logger.info(
          { outcome: await modules.payroll.jobs.fetchExchangeRates(context.logger) },
          'payroll: exchange rates read',
        );
      },
    ),
    'payroll.issue_invoices': defineTask(
      'payroll.issue_invoices',
      JOB_PAYLOADS['payroll.issue_invoices'],
      logger,
      async (payload, context) => {
        const outcome = await modules.payroll.jobs.issueInvoices(payload.statementId, context.logger);
        context.logger.info(
          outcome.kind === 'planned'
            ? {
                statementId: payload.statementId,
                issued: outcome.issued,
                notIssued: outcome.notIssued.length,
              }
            : { statementId: payload.statementId, outcome: outcome.kind },
          'payroll: invoices issued',
        );
      },
    ),
    'rate_limit.purge': defineTask(
      'rate_limit.purge',
      JOB_PAYLOADS['rate_limit.purge'],
      logger,
      async (_payload, context) => {
        context.logger.info(
          { removed: await purgeRateLimitCounters(db.db) },
          'rate limit: ended windows dropped',
        );
      },
    ),
    'telegram.purge': defineTask(
      'telegram.purge',
      JOB_PAYLOADS['telegram.purge'],
      logger,
      withTelegram((module) => module.jobs.purge()),
    ),
  };

  return {
    modules,
    db,
    adminDb,
    jobs,
    llmCalls,
    auth,
    requireRole,
    routes: [
      createAuthRoutes(auth, db.db, config, requireRole),
      createInvitationLinkRoutes({
        auth,
        db: db.db,
        adminDb: adminDb.db,
        config,
        requireRole,
        recentLogin: createRequireRecentLogin(auth),
      }),
      modules.conversations.routes,
      modules.persona.routes,
      modules.alerts.routes,
      modules.fans.routes(requireRole, kycSlotsOf),
      modules.team.routes(requireRole),
      modules.scheduling.routes(requireRole),
      modules.payroll.routes(requireRole),
      modules.backups.routes({ guard: requireRole('owner'), recentLogin: createRequireRecentLogin(auth) }),
      modules.providers.routes({ guard: requireRole('owner'), recentLogin: createRequireRecentLogin(auth) }),
      modules.connectors.routes,
      modules.supervision.routes,
      ...(playground === null ? [] : [playground.routes({ guard: requireRole('owner') })]),
      ...(telegram === null
        ? []
        : [telegram.routes({ guard: requireRole('owner'), recentLogin: createRequireRecentLogin(auth) })]),
    ],
    tasks,
    readiness: () => checkReadiness(db.db, adminDb.db),
    rateLimitStore: postgresRateLimitStore({ db: rateLimitDb.db, logger }),
    async shutdown() {
      modules.providers.stop();
      llmLog.stop();
      await jobs.close();
      await Promise.all([db.close(), adminDb.close(), rateLimitDb.close()]);
    },
  };
}
