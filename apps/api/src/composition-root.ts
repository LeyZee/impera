import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import { JOB_PAYLOADS } from '@nirvana/contracts';
import { createDbClient, type Database, type DbClient } from '@nirvana/db';
import { createPersistentCallLog, DEFAULT_LLM_CONFIG, type LlmCallStore } from '@nirvana/llm';
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
import type { Config } from './config';
import { cronKnownSince } from './crontab';
import { assertDatabaseRoles } from './database-roles';
import { createInvitationLinkRoutes } from './invitation-links';
import { createJobQueue, defineTask, type JobQueue } from './jobs';
import { createAppLlm } from './llm';
import { createDrizzleLlmCallStore } from './llm-call-store';
import type { Logger } from './logger';
import type { AgentModule } from './modules/agent';
import type { AlertsModule } from './modules/alerts';
import type { BackupsModule } from './modules/backups';
import type { ConnectorRegistry, ConnectorsModule, SalesFeedRegistry } from './modules/connectors';
import type { ConversationsModule, DraftComposer } from './modules/conversations';
import type { FansModule } from './modules/fans';
import type { MediaModule } from './modules/media';
import type { NotificationsModule } from './modules/notifications';
import type { PayrollModule } from './modules/payroll';
import type { PersonaModule } from './modules/persona';
import type { PlaygroundModule } from './modules/playground';
import type { ProvidersModule } from './modules/providers';
import type { SchedulingModule } from './modules/scheduling';
import type { SupervisionModule } from './modules/supervision';
import type { TeamModule } from './modules/team';
import type { TelegramModule } from './modules/telegram';
import { createPwnedPasswordsCheck, type PasswordBreachCheck } from './password-breaches';
import { postgresRateLimitStore, purgeRateLimitCounters, RATE_LIMIT_POOL_OPTIONS } from './rate-limit-store';
import { checkReadiness, type Readiness } from './readiness';
import { createSecuritySettingsRoutes } from './security-settings';
import { wireAgent } from './wiring/agent';
import { wireAlerts } from './wiring/alerts';
import { wireBackups } from './wiring/backups';
import { wireConnectors } from './wiring/connectors';
import { wireConversations } from './wiring/conversations';
import { wireFans } from './wiring/fans';
import { wireMedia } from './wiring/media';
import { wireNotifications } from './wiring/notifications';
import { wirePayroll, type InvoiceBuckets } from './wiring/payroll';
import { wirePersona } from './wiring/persona';
import { wirePlayground } from './wiring/playground';
import { wireProviders } from './wiring/providers';
import { wireScheduling } from './wiring/scheduling';
import type { JobWithTask, Shared } from './wiring/shared';
import { wireSupervision } from './wiring/supervision';
import { wireTeam } from './wiring/team';
import { wireTelegram } from './wiring/telegram';

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
  readonly notifications: NotificationsModule;
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
  /** Whether a password is known from a data breach (ADR 0046 § 4): checked wherever a password is chosen. */
  readonly passwordBreaches: PasswordBreachCheck;
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
 * The fonts of the invoices' PDFs, beside their renderer: `src/` in development and `dist/` once built both sit one
 * level under `apps/api`, and the image copies the folder to the same place (Dockerfile).
 */
const INVOICE_FONTS_DIR = fileURLToPath(new URL('../src/modules/payroll/infra/fonts/', import.meta.url));

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
  /** Tests plug FakeReveal's CRM API here; Reveal's own (`api.reveal.me`) otherwise. */
  readonly salesFeeds?: SalesFeedRegistry;
  /** Tests plug a composer with fixed bubbles here; the agent's composer otherwise, on the app's gateway. */
  readonly composer?: DraftComposer;
  /** The worker serves no HTTP, so it starts no playground (its sessions live in the API's memory). */
  readonly withPlayground?: boolean;
  /** Tests plug the invoices' two buckets here, to read what the jobs wrote; the configuration's otherwise. */
  readonly invoiceBuckets?: InvoiceBuckets;
  /**
   * Tests set pay's clock here, to issue a document whose delay to answer is already over (EQ-06 lot 6); the system's
   * otherwise. The database keeps its own: every step of an acceptance is checked on `now()`.
   */
  readonly payrollClock?: () => Date;
  /**
   * Tests set the team's clock here, to make a member leave on a day already past and read his closing fortnight
   * (EQ-14); the system's otherwise. A departure is the day it is said: nothing else ever back-dates one.
   */
  readonly teamClock?: () => Date;
  /** Tests plug a check here that never leaves the machine; the Pwned Passwords range API otherwise. */
  readonly passwordBreaches?: PasswordBreachCheck;
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
  const passwordBreaches = options.passwordBreaches ?? createPwnedPasswordsCheck();
  const shared: Shared = {
    config,
    logger,
    db: db.db,
    adminDb: adminDb.db,
    requireRole,
    recentLogin: createRequireRecentLogin(auth, db.db),
  };

  // Each module is built by its own `wiring/` file (ADR 0047 § 3); this file keeps the order and what they share.
  const fans = wireFans(shared);
  const connectors = wireConnectors(shared, {
    ingest: (input) => conversations.module.ingestMessage(input),
    registry: options.connectorRegistry ?? {},
    ...(options.salesFeeds !== undefined && { salesFeeds: options.salesFeeds }),
  });
  const providers = await wireProviders(shared);
  const alerts = wireAlerts(shared);
  const telegram = await wireTelegram(shared, { alerts: alerts.module });
  const media = await wireMedia(shared);
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
    credentials: providers.module.apiKeySource,
    reportRefusedKey: (provider, kind) => providers.module.reportRefusedKey(provider, kind),
    publishBudget: (crossing) => publishBudgetThreshold(adminDb.db, crossing),
    logger,
  });
  const persona = wirePersona(shared);
  const team = wireTeam(shared, {
    persona: persona.module,
    ...(options.teamClock !== undefined && { now: options.teamClock }),
  });
  const scheduling = wireScheduling(shared, { persona: persona.module });
  const payroll = wirePayroll(shared, {
    persona: persona.module,
    scheduling: scheduling.module,
    team: team.module,
    rateJobSince: rateJobSince(config, adminDb.db),
    invoiceFontsDir: INVOICE_FONTS_DIR,
    ...(options.invoiceBuckets !== undefined && { invoiceBuckets: options.invoiceBuckets }),
    ...(options.payrollClock !== undefined && { now: options.payrollClock }),
  });
  const playground = await wirePlayground(shared, {
    llm,
    persona: persona.module,
    activePersona: persona.activePersona,
    personaPath: fromRepoRoot(config.PLAYGROUND_PERSONA_PATH ?? 'personas/demo/v0.2.0.yaml'),
    trainingDir: fromRepoRoot(config.NIRVANA_TRAINING_DIR ?? '.scratch/training'),
    enabled: options.withPlayground !== false,
  });
  const agent = wireAgent(shared, {
    llm,
    activePersona: persona.activePersona,
    persona: persona.module,
    fans: fans.module,
    alerts: alerts.module,
    scheduling: scheduling.module,
    ...(options.composer !== undefined && { composer: options.composer }),
  });
  const conversations = wireConversations(shared, {
    fans: fans.module,
    connectors: connectors.module,
    persona: persona.module,
    alerts: alerts.module,
    agent,
    media,
  });
  const backups = wireBackups(shared);
  const notifications = wireNotifications(shared);
  const supervision = wireSupervision(shared, {
    llm,
    activeVoice: agent.activeVoice,
    allCreatorIds: persona.allCreatorIds,
    conversations: conversations.module,
    payroll: payroll.module,
    telegram: telegram.module,
    jobNames: () => Object.keys(tasks),
  });

  const modules: Modules = {
    alerts: alerts.module,
    backups: backups.module,
    connectors: connectors.module,
    conversations: conversations.module,
    fans: fans.module,
    persona: persona.module,
    team: team.module,
    scheduling: scheduling.module,
    payroll: payroll.module,
    agent: agent.module,
    media: media.module,
    notifications: notifications.module,
    supervision: supervision.module,
    providers: providers.module,
    playground: playground.module,
    telegram: telegram.module,
  };

  // Each job has exactly one task, registered by the wiring of the module named in it (ADR 0047 § 3).
  const tasks: Record<JobWithTask, Task> = {
    ...conversations.tasks,
    ...connectors.tasks,
    ...providers.tasks,
    ...telegram.tasks,
    ...fans.tasks,
    ...backups.tasks,
    ...scheduling.tasks,
    ...team.tasks,
    ...payroll.tasks,
    ...notifications.tasks,
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
  };

  return {
    modules,
    db,
    adminDb,
    jobs,
    llmCalls,
    auth,
    passwordBreaches,
    requireRole,
    routes: [
      createAuthRoutes(auth, db.db, adminDb.db, config, requireRole, logger),
      createInvitationLinkRoutes({
        auth,
        db: db.db,
        adminDb: adminDb.db,
        config,
        requireRole,
        recentLogin: shared.recentLogin,
        passwordBreaches,
      }),
      createSecuritySettingsRoutes({
        auth,
        db: db.db,
        adminDb: adminDb.db,
        requireRole,
        requireRecentLogin: shared.recentLogin,
      }),
      ...conversations.routes,
      ...persona.routes,
      ...alerts.routes,
      fans.routes(agent.kycSlotsOf),
      ...team.routes,
      ...scheduling.routes,
      ...payroll.routes,
      ...backups.routes,
      ...providers.routes,
      ...connectors.routes,
      ...supervision.routes,
      ...playground.routes,
      ...telegram.routes,
      ...notifications.routes,
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
