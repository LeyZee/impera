import {
  AlertTestBodySchema,
  AlertTestResultSchema,
  ApiErrorSchema,
  DesireMarksQuerySchema,
  DesireMarksSchema,
  PlaygroundAdvanceBodySchema,
  PlaygroundAnswerSchema,
  PlaygroundBranchBodySchema,
  PlaygroundCompareBodySchema,
  PlaygroundComparisonSchema,
  PlaygroundCreatorMediaBodySchema,
  PlaygroundDesireMarkBodySchema,
  PlaygroundMessageBodySchema,
  PlaygroundNotesBodySchema,
  PlaygroundPersonaBodySchema,
  PlaygroundPresetBodySchema,
  PlaygroundRatingBodySchema,
  PlaygroundRatingResultSchema,
  PlaygroundSituationBodySchema,
  PlaygroundStateSchema,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  DESIRE_WEIGHTS_VERSION,
  desireSignalPoints,
  recountDesire,
  type AlertTester,
} from '../../agent/index';
import type { DesireMarkStore } from '../application/desire-marks';
import { LlmUnavailable, type PlaygroundEngine } from '../application/engine';
import type { PlaygroundService } from '../application/playground-service';

export interface PlaygroundRoutesOptions {
  /** `requireRole('owner')` for now (coordinator, 17/10); Messa (`creator`) later. */
  readonly guard: preValidationAsyncHookHandler;
}

const state = { 200: PlaygroundStateSchema };

/** The marks read back at once: the latest, enough to see where the counting is wrong. */
const MARKS_SHOWN = 500;

/**
 * `/v1/playground` (fiche P3-06): the training screen drives the calibration engine. Nothing is ever sent to a
 * fan. Domain errors go through the central handler (409, 404, 400) except `llm_unavailable`, answered 503 here.
 */
export function createPlaygroundRoutes(
  service: PlaygroundService,
  alertTester: AlertTester,
  desireMarks: DesireMarkStore,
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

    // Recette PRO-21: a creator's version, active or not, or the invented persona; the conversation starts over.
    app.post(
      '/playground/persona',
      { schema: { body: PlaygroundPersonaBodySchema, response: state } },
      async (request) => {
        if (request.user === null) throw new Error('playground route reached without a session');
        const { body } = request;
        const choice =
          body.kind === 'invented' ? null : { creatorId: body.creatorId, versionId: body.versionId };
        return (await service.choose(request.user.id, choice)).state();
      },
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

    // ADR 0103 § 6: the owner marks his desire score after one of his messages.
    app.post(
      '/playground/desire-marks',
      { schema: { body: PlaygroundDesireMarkBodySchema, response: state } },
      (request) => {
        if (request.user === null) throw new Error('playground route reached without a session');
        const { fanMessageNumber, verdict, note } = request.body;
        return engineOf(request).markDesire(
          fanMessageNumber,
          { verdict, ...(note !== undefined && { note }) },
          request.user.id,
        );
      },
    );

    // Her marks read back with the weights in force: what a change of weights does to each of them.
    app.get(
      '/playground/desire-marks',
      { schema: { querystring: DesireMarksQuerySchema, response: { 200: DesireMarksSchema } } },
      async (request) => {
        const marks = await desireMarks.list(request.query.creatorId, MARKS_SHOWN);
        return {
          weightsNow: DESIRE_WEIGHTS_VERSION,
          marks: marks.map((mark) => ({
            id: mark.id,
            markedAt: mark.markedAt.toISOString(),
            fanMessage: mark.fanMessage,
            verdict: mark.verdict,
            note: mark.note,
            before: mark.reading.before,
            scoreThen: mark.reading.score,
            weightsThen: mark.weightsVersion,
            signals: mark.reading.signals.map((signal) => ({ signal, points: desireSignalPoints(signal) })),
            scoreNow: recountDesire(mark.reading),
          })),
        };
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
