import {
  BackupRunRequestSchema,
  BackupStatusSchema,
  RecordRestoreTestBodySchema,
  RequestBackupRunBodySchema,
  RestoreTestSchema,
  type BackupRunRequest,
  type BackupStatus,
  type RestoreTest,
} from '@nirvana/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';

import type { RestoreTestActor } from '../domain/ports';

export interface BackupsRoutesOptions {
  /** `requireRole('owner')`: the state of the agency's backups is the owner's alone (ADR 0028 § 5). */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRecentLogin`: entering a restore test, which opens the pay (EQ-17), needs a sign-in under 10 minutes. */
  readonly recentLogin: preValidationAsyncHookHandler;
}

export interface BackupsRoutesApi {
  readonly status: () => Promise<BackupStatus>;
  readonly recordRestoreTest: (
    body: z.output<typeof RecordRestoreTestBodySchema>,
    actor: RestoreTestActor,
  ) => Promise<{ readonly created: boolean; readonly test: RestoreTest }>;
  readonly requestRun: (
    id: string,
    actor: RestoreTestActor,
  ) => Promise<{ readonly created: boolean; readonly request: BackupRunRequest }>;
}

/**
 * `GET /v1/backups/status`: read only, no path or name of the bucket, no fingerprint of the exports.
 * `POST /v1/backups/restore-tests`: the owner enters the quarterly restore test (ADR 0028 § 6).
 * `POST /v1/backups/runs`: the owner asks for an export now (REG-24); the `backup` service runs it.
 */
export function createBackupsRoutes(
  api: BackupsRoutesApi,
  options: BackupsRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);
    app.get('/backups/status', { schema: { response: { 200: BackupStatusSchema } } }, () => api.status());
    app.post(
      '/backups/restore-tests',
      {
        preValidation: options.recentLogin,
        schema: {
          body: RecordRestoreTestBodySchema,
          response: { 200: RestoreTestSchema, 201: RestoreTestSchema },
        },
      },
      async (request, reply) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        const { created, test } = await api.recordRestoreTest(request.body, {
          userId: request.user.id,
          ip: request.ip,
        });
        return reply.code(created ? 201 : 200).send(test);
      },
    );
    app.post(
      '/backups/runs',
      {
        // As entering a test: an owner's action on the agency's safety net, from a recent sign-in.
        preValidation: options.recentLogin,
        schema: {
          body: RequestBackupRunBodySchema,
          response: { 200: BackupRunRequestSchema, 202: BackupRunRequestSchema },
        },
      },
      async (request, reply) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        const { created, request: asked } = await api.requestRun(request.body.id, {
          userId: request.user.id,
          ip: request.ip,
        });
        return reply.code(created ? 202 : 200).send(asked);
      },
    );
    return Promise.resolve();
  };
}
