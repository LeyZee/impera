import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import { JOB_PAYLOADS } from '@impera/contracts';
import { createDbClient, type Database, type DbClient } from '@impera/db';
import { createPersistentCallLog, DEFAULT_LLM_CONFIG, type LlmCallStore, type LlmGateway } from '@impera/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Task, TaskList } from 'graphile-worker';
import type { Pool } from 'pg';

import {
  createAuth,
  createAuthRoutes,
  createRequireRecentLogin,
  createRequireRole,
  currentUserById,
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
import type { AccountingModule } from './modules/accounting';
import type { AgentModule } from './modules/agent';
import type { AlertsModule } from './modules/alerts';
import type { BackupsModule } from './modules/backups';
import type {
  AvatarPorts,
  ConnectorRegistry,
  ConnectorsModule,
  SalesFeedRegistry,
} from './modules/connectors';
import type { DropStorage } from './modules/content-drops';
import type { ContractorsModule } from './modules/contractors';
import type { ConversationsModule, DraftComposer } from './modules/conversations';
import type { CreatorTasksModule } from './modules/creator-tasks';
import type { FansModule } from './modules/fans';
import { invoiceReadsForContractors, invoiceRequeue, type InvoicingModule } from './modules/invoicing';
import type { MediaModule } from './modules/media';
import type { NotificationsModule } from './modules/notifications';
import { payReadsForContractors, type PayrollModule } from './modules/payroll';
import type { PersonaModule } from './modules/persona';
import type { PlaygroundModule } from './modules/playground';
import type { ProvidersModule } from './modules/providers';
import { createShiftAccessReader, type SchedulingModule } from './modules/scheduling';
import type { ScriptsModule } from './modules/scripts';
import type { SupervisionModule } from './modules/supervision';
import type { TeamModule } from './modules/team';
import type { TelegramModule } from './modules/telegram';
import type { TrendsModule } from './modules/trends';
import { createPwnedPasswordsCheck, type PasswordBreachCheck } from './password-breaches';
import { createPasswordResetRoutes } from './password-reset';
import { postgresRateLimitStore, purgeRateLimitCounters, RATE_LIMIT_POOL_OPTIONS } from './rate-limit-store';
import { checkReadiness, type Readiness } from './readiness';
import { installSandboxGuard, sandboxOf, sdkBaseUrlsOf } from './sandbox';
import { createSecuritySettingsRoutes } from './security-settings';
import { wireAccounting } from './wiring/accounting';
import { wireAgent } from './wiring/agent';
import { wireAlerts } from './wiring/alerts';
import { wireBackups } from './wiring/backups';
import { wireConnectors } from './wiring/connectors';
import { wireContentDrops } from './wiring/content-drops';
import { wireContractors, type InvoiceBuckets } from './wiring/contractors';
import { wireConversations } from './wiring/conversations';
import { wireCreatorArchive } from './wiring/creator-archive';
import { wireCreatorTasks } from './wiring/creator-tasks';
import { wireFans } from './wiring/fans';
import { wireInvoicing } from './wiring/invoicing';
import { wireMedia } from './wiring/media';
import { wireNotifications } from './wiring/notifications';
import { wirePayroll } from './wiring/payroll';
import { wirePersona } from './wiring/persona';
import { wirePlayground } from './wiring/playground';
import { wireProviders } from './wiring/providers';
import { wireScheduling } from './wiring/scheduling';
import { wireScripts } from './wiring/scripts';
import type { JobWithTask, Shared } from './wiring/shared';
import { wireSupervision } from './wiring/supervision';
import { wireTeam } from './wiring/team';
import { wireTelegram } from './wiring/telegram';
import { wireTrends } from './wiring/trends';

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
  readonly creatorTasks: CreatorTasksModule;
  readonly supervision: SupervisionModule;
  readonly providers: ProvidersModule;
  readonly team: TeamModule;
  readonly scheduling: SchedulingModule;
  readonly scripts: ScriptsModule;
  readonly trends: TrendsModule;
  readonly contractors: ContractorsModule;
  readonly payroll: PayrollModule;
  readonly invoicing: InvoicingModule;
  readonly accounting: AccountingModule;
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
const INVOICE_FONTS_DIR = fileURLToPath(new URL('../src/modules/invoicing/infra/fonts/', import.meta.url));
/** The fonts of the script cards (SC-01 lot b), laid out like the invoices' ones. */
const CARD_FONTS_DIR = fileURLToPath(new URL('../src/modules/scripts/infra/fonts/', import.meta.url));

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
  /** Tests plug a vision with a fixed description here, for a marked post's captures; the app's gateway otherwise. */
  readonly trendVision?: Pick<LlmGateway, 'describeTrendCaptures'>;
  /** Tests plug a voice with a fixed post here, for her channel's posts (ADR 0080 § 5); the app's gateway otherwise. */
  readonly channelVoice?: Pick<LlmGateway, 'channelPost'>;
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
   * Tests set the team's clock here, to make a member leave on a day already past and read the fortnight of his
   * departure (EQ-14); the system's otherwise. A departure is the day it is said: nothing else ever back-dates one.
   */
  readonly teamClock?: () => Date;
  /**
   * Tests set the connectors' clock here, to make an unreachable register last a quarter of an hour (Telegram P3-12);
   * the system's otherwise.
   */
  readonly connectorsClock?: () => Date;
  /**
   * Tests set the clock of a chatter's access window here, to open or close it without waiting for his shift (ADR 0025,
   * EQ-13); the system's otherwise.
   */
  readonly accessClock?: () => Date;
  /**
   * Tests plug the photo copy's fetch and store here (CRM-07 a2b): FakeReveal's addresses are invented and MinIO is not
   * started for it; the platform's image server and the media bucket otherwise.
   */
  readonly creatorAvatars?: Pick<AvatarPorts, 'fetch' | 'store'>;
  /**
   * Tests plug her content's storage here, to read a script's archive without an object store (SC-03 c); the media
   * bucket otherwise.
   */
  readonly dropStorage?: DropStorage;
  /** Tests plug a check here that never leaves the machine; the Pwned Passwords range API otherwise. */
  readonly passwordBreaches?: PasswordBreachCheck;
}

/** Wires every business module by hand (no DI container, coding.md). Called once by each entry point. */
/**
 * The check of known-breached passwords (ADR 0046 § 4), or, with `PASSWORD_BREACH_CHECK=off` outside production (config
 * refuses it there), none: every password passes, said once in amber at start (recette MOT-14).
 */
export function breachCheckOf(config: Config, logger: Logger): PasswordBreachCheck {
  // ADR 0075: the sandbox reaches nothing outside this machine, the breach list included; left on, every password
  // set in the recette would fail as « the check does not answer ».
  if (sandboxOf(config) !== null) {
    logger.warn('password breach check is off in the recette sandbox (ADR 0075)');
    return () => Promise.resolve(false);
  }
  if (config.PASSWORD_BREACH_CHECK === 'on') return createPwnedPasswordsCheck();
  logger.warn('password breach check is off: development only (PASSWORD_BREACH_CHECK)');
  return () => Promise.resolve(false);
}

export async function createApp(config: Config, logger: Logger, options: AppOptions = {}): Promise<App> {
  // ADR 0075: in the recette sandbox, the guard goes on `fetch` before any module captures it.
  const sandbox = sandboxOf(config);
  if (sandbox !== null) installSandboxGuard(sandbox, logger);
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
  // A chatter's shift opens his creators for its length (ADR 0025, EQ-13), read at each of his requests.
  const shiftCreators = createShiftAccessReader(db.db, {
    logger,
    ...(options.accessClock !== undefined && { now: options.accessClock }),
  });
  const requireRole = createRequireRole(auth, db.db, shiftCreators);
  const passwordBreaches = options.passwordBreaches ?? breachCheckOf(config, logger);
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
    // The member made by `team`, the account linked by this module's own write, in one transaction (ADR 0076 § 3).
    invite: (actor, input) =>
      team.module.invites(connectors.module.invitationChatterLinks).fromPlatform(actor, input),
    registry: options.connectorRegistry ?? {},
    ...(options.salesFeeds !== undefined && { salesFeeds: options.salesFeeds }),
    ...(options.connectorsClock !== undefined && { now: options.connectorsClock }),
    ...(options.creatorAvatars !== undefined && { avatars: options.creatorAvatars }),
  });
  const providers = await wireProviders(shared);
  const alerts = wireAlerts(shared);
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
    ...(sandbox !== null && { baseUrls: sdkBaseUrlsOf(sandbox) }),
  });
  const persona = wirePersona(shared);
  const telegram = await wireTelegram(shared, {
    alerts: alerts.module,
    channelWriter: { gateway: options.channelVoice ?? llm.gateway, activePersona: persona.activePersona },
  });
  const team = wireTeam(shared, {
    persona: persona.module,
    connectors: connectors.module,
    ...(options.teamClock !== undefined && { now: options.teamClock }),
  });
  // Before the planning: her calendar link's feed reads her agenda (CR-05 lot c2).
  const notifications = wireNotifications(shared);
  const creatorTasks = wireCreatorTasks(shared, { notifications: notifications.module });
  const scheduling = wireScheduling(shared, {
    persona: persona.module,
    creatorTasks: creatorTasks.module,
    notifications: notifications.module,
  });
  // Late bound: her script drop reads the library's frozen versions, and the library asks her scripts through her content.
  const contentDrops = wireContentDrops(shared, {
    scriptVersions: {
      frozen: (versionId) => scripts.module.frozenVersion(versionId),
      card: (versionId, segmentKey, variant, moment) =>
        scripts.module.frozenCard(versionId, segmentKey, variant, moment),
      folderCard: (versionId, segmentKey, variant, moment) =>
        scripts.module.frozenFolderCard(versionId, segmentKey, variant, moment),
      freeze: (structureId, userId) => scripts.module.freezeForRequest(structureId, userId),
    },
    ...(options.dropStorage !== undefined && { storage: options.dropStorage }),
  });
  const scripts = wireScripts(shared, {
    persona: persona.module,
    contentDrops: contentDrops.module,
    cardFontsDir: CARD_FONTS_DIR,
  });
  const contractors = wireContractors(shared, {
    scheduling: scheduling.module,
    requeue: invoiceRequeue,
    invoices: invoiceReadsForContractors,
    pay: payReadsForContractors,
    ...(options.invoiceBuckets !== undefined && { invoiceBuckets: options.invoiceBuckets }),
    ...(options.payrollClock !== undefined && { now: options.payrollClock }),
  });
  const payroll = wirePayroll(shared, {
    persona: persona.module,
    scheduling: scheduling.module,
    team: team.module,
    rateJobSince: rateJobSince(config, adminDb.db),
    ...(options.payrollClock !== undefined && { now: options.payrollClock }),
  });
  const invoicing = wireInvoicing(shared, {
    scheduling: scheduling.module,
    payroll: payroll.module,
    invoiceFontsDir: INVOICE_FONTS_DIR,
    invoiceBuckets: contractors.buckets,
    ...(options.payrollClock !== undefined && { now: options.payrollClock }),
  });
  const accounting = wireAccounting(shared, { scheduling: scheduling.module, invoicing: invoicing.module });
  const playground = await wirePlayground(shared, {
    llm,
    persona: persona.module,
    activePersona: persona.activePersona,
    personaPath: fromRepoRoot(config.PLAYGROUND_PERSONA_PATH ?? 'personas/demo/v0.3.0.yaml'),
    trainingDir: fromRepoRoot(config.IMPERA_TRAINING_DIR ?? '.scratch/training'),
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
    copilot: {
      // The copilot panel writes with the person's extension link (ADR 0086 § 8), read as a session would read him:
      // his creators and his shift's at each gesture (ADR 0025).
      linkUser: async (token) => {
        const holder = await trends.module.linkHolder(token);
        return holder === null ? null : currentUserById(db.db, shiftCreators, holder.userId);
      },
      allCreatorIds: persona.allCreatorIds,
    },
  });
  const backups = wireBackups(shared);
  const trends = wireTrends(shared, {
    gateway: options.trendVision ?? llm.gateway,
    persona: persona.module,
    agenda: creatorTasks.module,
    contentDrops: contentDrops.module,
  });
  const supervision = wireSupervision(shared, {
    llm,
    activeVoice: agent.activeVoice,
    allCreatorIds: persona.allCreatorIds,
    conversations: conversations.module,
    payroll: payroll.module,
    scheduling: scheduling.module,
    telegram: telegram.module,
    jobNames: () => Object.keys(tasks),
    salesFeeds: connectors.module.salesFeedStates,
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
    scripts: scripts.module,
    trends: trends.module,
    contractors: contractors.module,
    payroll: payroll.module,
    invoicing: invoicing.module,
    accounting: accounting.module,
    agent: agent.module,
    media: media.module,
    notifications: notifications.module,
    creatorTasks: creatorTasks.module,
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
    ...contractors.tasks,
    ...payroll.tasks,
    ...invoicing.tasks,
    ...notifications.tasks,
    ...contentDrops.tasks,
    ...scripts.tasks,
    ...creatorTasks.tasks,
    ...trends.tasks,
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
      createAuthRoutes(auth, db.db, adminDb.db, config, requireRole, logger, shiftCreators),
      createInvitationLinkRoutes({
        auth,
        db: db.db,
        adminDb: adminDb.db,
        config,
        requireRole,
        recentLogin: shared.recentLogin,
        passwordBreaches,
        shiftCreators,
      }),
      createPasswordResetRoutes({
        auth,
        adminDb: adminDb.db,
        config,
        passwordBreaches,
        privateChat: telegram.module?.privateChat ?? null,
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
      ...wireCreatorArchive(shared, {
        persona: persona.module,
        scheduling: scheduling.module,
        conversations: conversations.module,
      }),
      ...alerts.routes,
      fans.routes(agent.kycSlotsOf, {
        holds: (creatorId, fanId, userId) => conversations.module.isFanHeldBy(creatorId, fanId, userId),
        traceOpening: (creatorId, fanId, trace) =>
          conversations.module.traceFanOpening(creatorId, fanId, trace),
      }),
      ...team.routes,
      ...scheduling.routes,
      ...scripts.routes,
      ...trends.routes,
      ...creatorTasks.routes,
      ...contentDrops.routes,
      ...contractors.routes,
      ...payroll.routes,
      ...invoicing.routes,
      ...accounting.routes,
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
