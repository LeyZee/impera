import {
  ConversationEventViewSchema,
  DashboardTodoSchema,
  DraftViewSchema,
  MessageViewSchema,
  type ConversationEventView,
  type DraftView,
  type MessageView,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { decisionError, draftsOf, isOutdated, threadOf, todoLabel, whyHuman } from './reader-model';

/* Invented messages: no real fan. */
const CONVERSATION = '0192f3a0-0000-7000-8000-000000000001';
const DRAFT = '0192f3a0-0000-7000-8000-0000000000d1';

function message(n: number, patch: Partial<MessageView> = {}): MessageView {
  return MessageViewSchema.parse({
    id: `0192f3a0-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
    direction: 'inbound',
    author: 'fan',
    text: `Message ${String(n)}`,
    media: [],
    priceMinor: null,
    currency: null,
    isPaid: false,
    draftId: null,
    platformCreatedAt: `2026-10-19T12:${String(n).padStart(2, '0')}:00Z`,
    ...patch,
  });
}

function event(seq: number, minute: number, body: Record<string, unknown>): ConversationEventView {
  return ConversationEventViewSchema.parse({
    seq,
    actor: 'system',
    createdAt: `2026-10-19T12:${String(minute).padStart(2, '0')}:30Z`,
    ...body,
  });
}

const apiError = (code: string, details: Record<string, unknown> = {}) => ({
  error: { code, message: 'x', details, requestId: 'r' },
});

describe('threadOf', () => {
  it('says the agent stepped back because she has no active persona (recette G4)', () => {
    const items = threadOf({
      messages: [message(1)],
      events: [
        event(1, 1, {
          type: 'handoff_requested',
          payload: { conversationId: CONVERSATION, cause: 'persona_inactive' },
        }),
      ],
    });
    expect(items.flatMap((i) => (i.kind === 'note' ? [i.text] : []))).toEqual([
      'L’agent passe la main (Pas de persona active pour cette créatrice)',
    ]);
  });

  it('names each media by its kind, with what it shows once described (SUIVI-26)', () => {
    const [item] = threadOf({
      messages: [
        message(1, {
          text: '',
          media: [
            { kind: 'video', isLocked: true, description: 'Elle danse dans une chambre, lumière tamisée.' },
            { kind: 'image', isLocked: true, description: null },
          ],
          priceMinor: 4990,
          currency: 'EUR',
        }),
      ],
      events: [],
    });
    expect(item).toMatchObject({
      media: [
        { label: 'Vidéo', description: 'Elle danse dans une chambre, lumière tamisée.' },
        { label: 'Photo', description: null },
      ],
    });
  });

  it('reads oldest first, and notes where the agent stepped back or a draft was refused', () => {
    const items = threadOf({
      // The API pages newest first.
      messages: [
        message(3, { direction: 'outbound', author: 'human', text: 'Je suis là' }),
        message(1, { priceMinor: 1500, currency: 'EUR', isPaid: true }),
      ],
      events: [
        event(3, 2, {
          type: 'handoff_requested',
          payload: { conversationId: CONVERSATION, cause: 'distress', reason: 'Il parle de tout arrêter' },
        }),
        event(2, 1, {
          type: 'draft_rejected',
          payload: {
            draftId: '0192f3a0-0000-7000-8000-0000000000d1',
            status: 'rejected',
            reason: 'Trop froid',
          },
        }),
        event(1, 1, {
          type: 'draft_created',
          payload: { draftId: '0192f3a0-0000-7000-8000-0000000000d1', status: 'pending' },
        }),
      ],
    });
    expect(items.map((i) => (i.kind === 'note' ? `note: ${i.text}` : `${i.from}: ${i.text}`))).toEqual([
      'fan: Message 1',
      'note: Brouillon refusé : Trop froid',
      'note: L’agent passe la main (Détresse) : Il parle de tout arrêter',
      'creator: Je suis là',
    ]);
    expect(items[0]).toMatchObject({ ppv: { price: '15 €', isPaid: true } });
    expect(items[3]).toMatchObject({ byHuman: true });
  });

  it('notes an alert that let the agent go on, as calmly as the other notes', () => {
    const alert = '0192f3a0-0000-7000-8000-0000000000a1';
    const items = threadOf({
      messages: [message(1)],
      events: [
        event(2, 2, {
          type: 'alert_triggered',
          payload: {
            conversationId: CONVERSATION,
            trigger: { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'rule' },
            notify: true,
          },
        }),
        event(1, 1, {
          type: 'alert_triggered',
          payload: {
            conversationId: CONVERSATION,
            trigger: { alert: { kind: 'custom', id: alert }, matchedBy: 'keyword', keyword: 'anniversaire' },
            notify: false,
          },
        }),
      ],
    });
    expect(items.map((i) => (i.kind === 'note' ? `note: ${i.text}` : `${i.from}: ${i.text}`))).toEqual([
      'fan: Message 1',
      'note: Alerte personnalisée (mot « anniversaire ») : l’agent continue',
      'note: Alerte « Demande de service » : l’agent continue',
    ]);
  });

  it('gives the latest handoff, for the line above the thread', () => {
    const events = [
      event(5, 9, { type: 'handoff_requested', payload: { conversationId: CONVERSATION, cause: 'meeting' } }),
      event(1, 1, { type: 'handoff_requested', payload: { conversationId: CONVERSATION, cause: 'minor' } }),
    ];
    expect(whyHuman({ events })).toBe('L’agent passe la main (Demande de rencontre)');
    expect(whyHuman({ events: [] })).toBeNull();
  });

  it('says a person took the hand, not an old handoff the hand was given back for', () => {
    const handoff = event(1, 1, {
      type: 'handoff_requested',
      payload: { conversationId: CONVERSATION, cause: 'meeting' },
    });
    const ended = event(2, 2, { type: 'takeover_ended', payload: { conversationId: CONVERSATION } });
    const started = event(3, 3, { type: 'takeover_started', payload: { conversationId: CONVERSATION } });
    expect(whyHuman({ events: [started, ended, handoff] })).toBe('Un humain a repris la main');
    expect(whyHuman({ events: [started] })).toBe('Un humain a repris la main');
  });

  it('says why a send failed for good, when the code is one a person can act on', () => {
    const failed = (error?: string) =>
      threadOf({
        messages: [],
        events: [
          event(1, 1, {
            type: 'send_failed',
            payload: {
              conversationId: CONVERSATION,
              draftId: DRAFT,
              idempotencyKey: 'k',
              attempt: 3,
              isFinal: true,
              ...(error === undefined ? {} : { error }),
            },
          }),
        ],
      }).map((i) => i.text);
    expect(failed('connector_session_expired')).toEqual([
      'L’envoi a échoué, rien n’est parti : la session Reveal a expiré',
    ]);
    expect(failed('send_error')).toEqual(['L’envoi a échoué, rien n’est parti']);
    expect(failed('connector_unavailable')).toEqual([
      'L’envoi a échoué, rien n’est parti : aucun connecteur n’est branché pour cette plateforme',
    ]);
    // A key every object has is not a code.
    expect(failed('toString')).toEqual(['L’envoi a échoué, rien n’est parti']);
    expect(failed()).toEqual(['L’envoi a échoué, rien n’est parti']);
  });

  it('writes the price of a paid media with its cents (ADR 0011)', () => {
    const [item] = threadOf({ messages: [message(1, { priceMinor: 4990, currency: 'EUR' })], events: [] });
    expect(item).toMatchObject({ ppv: { price: '49,90\u00a0€' } });
  });

  it('says once that his answer waits for her opening, on the reader’s clock (P3-14)', () => {
    // 12:01 and 12:05 in UTC are 14:01 and 14:05 in Paris; her slot opens the next morning, then the Monday after.
    const deferred = (seq: number, minute: number, until: string) =>
      event(seq, minute, { type: 'reply_deferred', payload: { reason: 'outside_hours', until } });
    const items = threadOf(
      {
        messages: [message(4), message(1)],
        events: [
          deferred(9, 6, '2026-10-26T08:00:00Z'),
          deferred(8, 5, '2026-10-20T07:00:00Z'),
          deferred(7, 1, '2026-10-20T07:00:00Z'),
        ],
      },
      'Europe/Paris',
    );
    expect(items.map((i) => i.text)).toEqual([
      'Message 1',
      'Hors de ses heures : la réponse attend l’ouverture de son créneau, demain à 9\u00a0h',
      'Message 4',
      'Hors de ses heures : la réponse attend l’ouverture de son créneau, lundi à 9\u00a0h',
    ]);
    const sameDay = threadOf(
      { messages: [], events: [deferred(1, 1, '2026-10-19T16:30:00Z')] },
      'Europe/Paris',
    );
    expect(sameDay.map((i) => i.text)).toEqual([
      'Hors de ses heures : la réponse attend l’ouverture de son créneau, à 18\u00a0h\u00a030',
    ]);
  });
});

describe('draftsOf', () => {
  const draft = (status: DraftView['status']): DraftView =>
    DraftViewSchema.parse({
      id: DRAFT,
      status,
      bubbles: ['Coucou'],
      finalBubbles: null,
      createdAt: '2026-10-19T12:01:00Z',
    });
  const finalFailure = event(4, 3, {
    type: 'send_failed',
    payload: { conversationId: CONVERSATION, draftId: DRAFT, idempotencyKey: 'k', attempt: 3, isFinal: true },
  });

  it('never says « Envoi en cours » and the failure at once: the final failure wins', () => {
    const read = draftsOf({
      detail: { state: 'sending', openDrafts: [draft('approved')], failedDraft: null },
      events: [finalFailure],
    });
    expect(read).toEqual({ state: 'error', sending: [], failed: draft('approved') });
  });

  it('keeps a draft on its way while nothing says it failed, and the failed one the server gives', () => {
    expect(
      draftsOf({
        detail: { state: 'sending', openDrafts: [draft('edited')], failedDraft: null },
        events: [],
      }),
    ).toEqual({ state: 'sending', sending: [draft('edited')], failed: null });
    expect(
      draftsOf({ detail: { state: 'error', openDrafts: [], failedDraft: draft('failed') }, events: [] }),
    ).toEqual({ state: 'error', sending: [], failed: draft('failed') });
  });
});

describe('decisionError', () => {
  it('says a creator without an active persona sends nothing, and where to activate one (recette G4)', () => {
    expect(decisionError(422, apiError('persona_inactive_unprocessable', {}))).toBe(
      'Ce message ne peut pas partir : cette créatrice n’a pas de persona active. Active une version dans Créatrices › Persona.',
    );
  });

  it('says which guard blocks a draft, in words', () => {
    expect(
      decisionError(422, apiError('draft_unprocessable', { guards: ['meeting_promise', 'contact_info'] })),
    ).toBe(
      'Ce message ne peut pas partir : une promesse de rencontre, des coordonnées. Retouche-le ou refuse-le.',
    );
    expect(decisionError(422, apiError('draft_unprocessable', { guards: ['discount'] }))).toBe(
      'Ce message ne peut pas partir : une remise ou une négociation. Retouche-le ou refuse-le.',
    );
    expect(decisionError(422, apiError('draft_unprocessable', { guards: ['explicit_before_age'] }))).toBe(
      'Ce message ne peut pas partir : du contenu explicite avant l’âge confirmé. Retouche-le ou refuse-le.',
    );
    expect(
      decisionError(422, apiError('draft_unprocessable', { guards: ['stage_direction', 'media_not_sent'] })),
    ).toBe(
      'Ce message ne peut pas partir : une didascalie (« *sourit* », « (rires) »), un média annoncé qui n’est pas joint. Retouche-le ou refuse-le.',
    );
    expect(
      decisionError(
        422,
        apiError('draft_unprocessable', {
          guards: ['platform_meeting_word', 'fake_emergency', 'not_a_guard'],
        }),
      ),
    ).toBe(
      'Ce message ne peut pas partir : un mot de rencontre que Reveal repère, une maladie, une dette ou une urgence pour vendre. Retouche-le ou refuse-le.',
    );
    expect(decisionError(422, apiError('draft_unprocessable'))).toBe(
      'Ce message ne peut pas partir : une garde le bloque. Retouche-le ou refuse-le.',
    );
  });

  it('says why nothing may leave, and blames the server only when it does not answer', () => {
    expect(decisionError(409, apiError('kill_switch_conflict'))).toContain('L’arrêt est actif');
    expect(decisionError(409, apiError('session_expired_conflict'))).toContain('La session Reveal a expiré');
    expect(decisionError(409, apiError('draft_conflict'))).toContain('a changé entre-temps');
    // Only a chatter whose shift or handover closed gets a 403 there: never « only chatters decide ».
    expect(decisionError(403, apiError('forbidden'))).toBe(
      'Cette conversation n’est plus ouverte pour toi (shift terminé ou passation rendue).',
    );
    expect(decisionError(400, apiError('draft_invalid'))).toBe(
      'Ce message ne peut pas partir tel quel : une bulle est vide ou trop longue (2 000 caractères au plus, 10 bulles au plus).',
    );
    expect(decisionError(401, apiError('unauthorized'))).toBe('Ta session a expiré : reconnecte-toi.');
    expect(decisionError(503, null)).toBe(
      'Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.',
    );
    expect(decisionError(0, null)).toBe(
      'Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.',
    );
  });
});

describe('isOutdated', () => {
  it('is a decision that came too late: decided elsewhere, moved on, or gone', () => {
    expect(isOutdated(409, apiError('draft_conflict'))).toBe(true);
    expect(isOutdated(409, apiError('transition_conflict'))).toBe(true);
    expect(isOutdated(404, null)).toBe(true);
    expect(isOutdated(409, apiError('kill_switch_conflict'))).toBe(false);
    expect(isOutdated(422, apiError('draft_unprocessable'))).toBe(false);
    expect(isOutdated(0, null)).toBe(false);
  });
});

describe('todoLabel', () => {
  it('names each line of « À traiter », a send that failed for good included', () => {
    const todo = (kind: string) =>
      DashboardTodoSchema.parse({
        id: `${kind}-1`,
        tone: 'warn',
        kind,
        title: 'Fan',
        why: 'Pourquoi.',
        at: '2026-10-19T12:00:00Z',
        waitingMinutes: 3,
        conversationId: CONVERSATION,
        fanId: '0192f3a0-0000-7000-8000-000000000002',
      });
    expect(todoLabel(todo('send_failed'))).toBe('Envoi échoué');
    expect(todoLabel(todo('awaiting_approval'))).toBe('Brouillon à valider');
    expect(todoLabel(todo('unanswered'))).toBe('Sans réponse');
  });
});
