import {
  AlertTestBodySchema,
  AlertTestResultSchema,
  ApiErrorSchema,
  PlaygroundAdvanceBodySchema,
  PlaygroundAnswerSchema,
  PlaygroundBranchBodySchema,
  PlaygroundCompareBodySchema,
  PlaygroundComparisonSchema,
  PlaygroundCreatorMediaBodySchema,
  PlaygroundMessageBodySchema,
  PlaygroundNotesBodySchema,
  PlaygroundPresetBodySchema,
  PlaygroundRatingBodySchema,
  PlaygroundRatingResultSchema,
  PlaygroundSituationBodySchema,
  PlaygroundStateSchema,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { AlertTester } from '../../agent/index';
import { LlmUnavailable, type PlaygroundEngine } from '../application/engine';
import type { PlaygroundService } from '../application/playground-service';

export interface PlaygroundRoutesOptions {
  /** `requireRole('owner')` for now (coordinator, 17/10); Messa (`creator`) later. */
  readonly guard: preValidationAsyncHookHandler;
}

const state = { 200: PlaygroundStateSchema };

/**
 * `/v1/playground` (fiche P3-06): the training screen drives the calibration engine. Nothing is ever sent to a
 * fan. Domain errors go through the central handler (409, 404, 400) except `llm_unavailable`, answered 503 here.
 */
export function createPlaygroundRoutes(
  service: PlaygroundService,
  alertTester: AlertTester,
  options: PlaygroundRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);

    const engineOf = (request: FastifyRequest): PlaygroundEngine => {
      // The guard has set the user; a route reached without one is a wiring error, not a user error.
      if (request.user === null) throw new Error('playground route reached without a session');
      return service.forUser(request.user.id);
    };
    const unavailable = (request: FastifyRequest, error: LlmUnavailable) => ({
      error: { code: error.code, message: error.message, details: {}, requestId: request.id },
    });

    app.get('/playground', { schema: { response: state } }, (request) => engineOf(request).state());

    app.post(
      '/playground/preset',
      { schema: { body: PlaygroundPresetBodySchema, response: state } },
      (request) => engineOf(request).applyPreset(request.body.presetId),
    );

    app.post('/playground/reset', { schema: { response: state } }, (request) => engineOf(request).reset());

    app.post(
      '/playground/messages',
      {
        schema: {
          body: PlaygroundMessageBodySchema,
          response: { 200: PlaygroundAnswerSchema, 503: ApiErrorSchema },
        },
      },
      async (request, reply) => {
        try {
          return await engineOf(request).send(request.body.text, request.body.media ?? []);
        } catch (error) {
          if (error instanceof LlmUnavailable) return reply.code(503).send(unavailable(request, error));
          throw error;
        }
      },
    );

    app.post(
      '/playground/rating',
      { schema: { body: PlaygroundRatingBodySchema, response: { 200: PlaygroundRatingResultSchema } } },
      (request) => engineOf(request).rate(request.body.verdict, request.body.destination),
    );

    app.post(
      '/playground/branch',
      { schema: { body: PlaygroundBranchBodySchema, response: { ...state, 503: ApiErrorSchema } } },
      async (request, reply) => {
        try {
          return await engineOf(request).branch(request.body.fanMessageNumber);
        } catch (error) {
          if (error instanceof LlmUnavailable) return reply.code(503).send(unavailable(request, error));
          throw error;
        }
      },
    );

    app.post(
      '/playground/compare',
      { schema: { body: PlaygroundCompareBodySchema, response: { 200: PlaygroundComparisonSchema } } },
      (request) => engineOf(request).compare(request.body.voiceModel),
    );

    app.patch(
      '/playground/situation',
      { schema: { body: PlaygroundSituationBodySchema, response: state } },
      (request) => engineOf(request).patchSituation(request.body),
    );

    app.post(
      '/playground/advance',
      { schema: { body: PlaygroundAdvanceBodySchema, response: state } },
      (request) => engineOf(request).advance(request.body.hours),
    );

    app.put(
      '/playground/notes',
      { schema: { body: PlaygroundNotesBodySchema, response: state } },
      (request) => engineOf(request).setNotes(request.body.notes),
    );

    app.post(
      '/playground/creator-media',
      { schema: { body: PlaygroundCreatorMediaBodySchema, response: state } },
      (request) => {
        const { isLocked, ...media } = request.body;
        return engineOf(request).sendCreatorMedia(media, isLocked);
      },
    );

    // Réglages › Alertes (P4-01): served here, beside the persona the brain reads; `/v1/alerts` stays the module's.
    app.post(
      '/alerts/test',
      { schema: { body: AlertTestBodySchema, response: { 200: AlertTestResultSchema } } },
      (request) => alertTester.test(request.body),
    );

    return Promise.resolve();
  };
}
