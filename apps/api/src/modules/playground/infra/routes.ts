import {
  AlertTestBodySchema,
  AlertTestResultSchema,
  ApiErrorSchema,
  DesireMarksQuerySchema,
  DomainError,
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
  VoiceBankQuerySchema,
  VoiceBankSchema,
  VoiceBankWithdrawBodySchema,
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
import {
  LlmUnavailable,
  PlaygroundCreatorForbidden,
  VoiceBankOwnerOnly,
  type PlaygroundEngine,
} from '../application/engine';
import type { PlaygroundService } from '../application/playground-service';

import type { VoiceBankView } from './bank';

export interface PlaygroundRoutesOptions {
  /**
   * `requireRole('owner', 'operator')`: the owner, and an operator the routes then keep to an active manager
   * (ADR 0092 § 8); Messa (`creator`) later.
   */
  readonly guard: preValidationAsyncHookHandler;
}

/**
 * Who trains (ADR 0092 § 8): the owner, every creator; an active manager (an operator whose scope is the agency), the
 * creators of his list only, without « Réglages › Alertes », without filing to her bank or withdrawing from it.
 */
type TrainerRight =
  { readonly kind: 'owner' } | { readonly kind: 'manager'; readonly creatorIds: readonly string[] };

function trainerOf(request: FastifyRequest): TrainerRight {
  const { user } = request;
  if (user === null) throw new Error('playground route reached without a session');
  if (user.role === 'owner') return { kind: 'owner' };
  if (user.role === 'operator' && request.membership?.teamScope === 'agency')
    return { kind: 'manager', creatorIds: user.creatorIds };
  throw new DomainError('role_forbidden', 'Réservé au propriétaire et aux managers actifs');
}

/** A manager reaches the creators of his list alone; the owner, every one. */
function ensureCreator(trainer: TrainerRight, creatorId: string): void {
  if (trainer.kind === 'manager' && !trainer.creatorIds.includes(creatorId))
    throw new PlaygroundCreatorForbidden();
}

function ensureOwner(trainer: TrainerRight): void {
  if (trainer.kind !== 'owner') throw new VoiceBankOwnerOnly();
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
  bank?: VoiceBankView,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);
    // After the guard has set the user: anyone else than the owner or an active manager stops here.
    app.addHook('preHandler', (request, _reply, done) => {
      try {
        trainerOf(request);
        done();
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)));
      }
    });

    const engineOf = (request: FastifyRequest): PlaygroundEngine => {
      // The guard has set the user; a route reached without one is a wiring error, not a user error.
      if (request.user === null) throw new Error('playground route reached without a session');
      const trainer = trainerOf(request);
      return service.forUser(
        request.user.id,
        (creatorId) => trainer.kind === 'owner' || trainer.creatorIds.includes(creatorId),
      );
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
        if (body.kind === 'version') ensureCreator(trainerOf(request), body.creatorId);
        const choice =
          body.kind === 'invented' ? null : { creatorId: body.creatorId, versionId: body.versionId };
        return (await service.choose({ userId: request.user.id, role: request.user.role }, choice)).state();
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
      (request) => {
        const trainer = trainerOf(request);
        if (request.body.destination === 'voice_example') ensureOwner(trainer);
        return engineOf(request).rate(
          request.body.verdict,
          request.body.destination,
          trainer.kind === 'owner',
        );
      },
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

    // ADR 0103 § 16: he buys or refuses the paid step of a trial script, fictively; nothing reaches Reveal.
    app.post('/playground/script/buy', { schema: { response: state } }, (request) =>
      engineOf(request).buyScriptStep(),
    );
    app.post('/playground/script/refuse', { schema: { response: state } }, (request) =>
      engineOf(request).refuseScriptStep(),
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
        ensureCreator(trainerOf(request), request.query.creatorId);
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

    // ADR 0102 § 5: her bank in Entraîner, and « Retirer ». Without a database there is no bank to show.
    if (bank !== undefined) {
      app.get(
        '/playground/bank',
        { schema: { querystring: VoiceBankQuerySchema, response: { 200: VoiceBankSchema } } },
        (request) => {
          ensureCreator(trainerOf(request), request.query.creatorId);
          return bank.list(request.query.creatorId, request.query.versionId);
        },
      );
      app.post(
        '/playground/bank/withdraw',
        { schema: { body: VoiceBankWithdrawBodySchema, response: { 200: VoiceBankSchema } } },
        async (request) => {
          ensureOwner(trainerOf(request));
          const { creatorId, versionId, id } = request.body;
          await bank.withdraw(creatorId, id);
          return bank.list(creatorId, versionId);
        },
      );
    }

    // Réglages › Alertes (P4-01): served here, beside the persona the brain reads; `/v1/alerts` stays the module's.
    app.post(
      '/alerts/test',
      { schema: { body: AlertTestBodySchema, response: { 200: AlertTestResultSchema } } },
      (request) => {
        // Réglages are the owner's (ADR 0092 § 8: a manager changes none of her settings).
        if (trainerOf(request).kind !== 'owner')
          throw new DomainError('role_forbidden', 'Réservé au propriétaire');
        return alertTester.test(request.body);
      },
    );

    return Promise.resolve();
  };
}
