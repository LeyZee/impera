import type { JobName } from '@nirvana/contracts';
import type { Database } from '@nirvana/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Task } from 'graphile-worker';

import type { RequireRole } from '../auth';
import type { Config } from '../config';
import type { Logger } from '../logger';

/**
 * Jobs of the contracts that no worker task takes yet (operations.md: Graphile keeps them queued, the Dashboard counts
 * them as stuck). Every other job must have its task: `composition-root.ts` types the merged list on the rest, so a
 * task forgotten for a job added to `JOB_NAMES` does not compile, and `__tests__/architecture.test.ts` finds each other
 * job's task written once, in one wiring file.
 */
export const JOBS_WITHOUT_TASK = [
  'fans.refresh_summary',
  'media.describe',
] as const satisfies readonly JobName[];
type JobWithoutTask = (typeof JOBS_WITHOUT_TASK)[number];
export type JobWithTask = Exclude<JobName, JobWithoutTask>;

/** The tasks a wiring file registers: the jobs named after its module, each exactly once (ADR 0047 § 3). */
export type TasksOf<Prefix extends string> = Record<Extract<JobWithTask, `${Prefix}.${string}`>, Task>;

/** The tasks of a module whose jobs keep another module's prefix (ADR 0047 § 1: `payroll.*` split in four), by name. */
export type TasksNamed<Name extends JobWithTask> = Record<Name, Task>;

/** What every wiring file is built from: the shared dependencies `composition-root.ts` makes once. */
export interface Shared {
  readonly config: Config;
  readonly logger: Logger;
  /** Application role: RLS applies. */
  readonly db: Database;
  /** Owner role: unscoped jobs, system reads. */
  readonly adminDb: Database;
  readonly requireRole: RequireRole;
  /** Sensitive actions ask for a session opened less than 10 minutes ago (ADR 0016). */
  readonly recentLogin: preValidationAsyncHookHandler;
}

/** A routes plugin, mounted under `/v1` by the server. */
export type Routes = FastifyPluginAsyncZod;
