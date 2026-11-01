import { describe, expect, it } from 'vitest';

import {
  ALERT_ERROR_CODES,
  alertKeywordKey,
  AlertTestBodySchema,
  AlertTestResultSchema,
  AlertTriggerSchema,
  CUSTOM_ALERT_TOPIC,
  CustomAlertBodySchema,
  customAlertNameKey,
  SYSTEM_ALERT_CODES,
  SYSTEM_ALERT_TOPICS,
} from './alerts';
import { EventBodySchema } from './events';
import { TelegramTopicSchema } from './telegram';

const CREATOR = '01900000-0000-7000-8000-000000000010';
const CONVERSATION = '01900000-0000-7000-8000-000000000020';
const ALERT = '01900000-0000-7000-8000-000000000030';

const body = {
  name: 'Appel',
  phrase: null,
  keywords: ['appel'],
  pausesAgent: false,
  notify: true,
  creators: [{ creatorId: CREATOR, enabled: true }],
};

describe('custom alerts (P4-01)', () => {
  it('takes a phrase, words or both, never neither', () => {
    expect(CustomAlertBodySchema.safeParse(body).success).toBe(true);
    expect(
      CustomAlertBodySchema.safeParse({ ...body, phrase: 'Il veut l’appeler', keywords: [] }).success,
    ).toBe(true);
    const neither = CustomAlertBodySchema.safeParse({ ...body, keywords: [] });
    expect(neither.error?.issues.map((i) => i.path.join('.'))).toEqual(['phrase']);
  });

  it('refuses a word twice as the engine reads it, a creator twice, and no creator', () => {
    expect(CustomAlertBodySchema.safeParse({ ...body, keywords: ['Appel', 'appel'] }).success).toBe(false);
    expect(CustomAlertBodySchema.safeParse({ ...body, keywords: ['vidéo', 'video'] }).success).toBe(false);
    expect(
      CustomAlertBodySchema.safeParse({ ...body, keywords: ['Vidéo-perso', 'video perso'] }).success,
    ).toBe(false);
    expect(
      CustomAlertBodySchema.safeParse({ ...body, creators: [...body.creators, ...body.creators] }).success,
    ).toBe(false);
    expect(CustomAlertBodySchema.safeParse({ ...body, creators: [] }).success).toBe(false);
  });

  it('caps the phrase at 500 characters', () => {
    expect(CustomAlertBodySchema.safeParse({ ...body, phrase: 'a'.repeat(500) }).success).toBe(true);
    expect(CustomAlertBodySchema.safeParse({ ...body, phrase: 'a'.repeat(501) }).success).toBe(false);
  });

  it('names the declared word exactly when a word matched', () => {
    const custom = { kind: 'custom', id: ALERT } as const;
    expect(
      AlertTriggerSchema.safeParse({ alert: custom, matchedBy: 'keyword', keyword: 'appel' }).success,
    ).toBe(true);
    expect(AlertTriggerSchema.safeParse({ alert: custom, matchedBy: 'keyword' }).success).toBe(false);
    expect(
      AlertTriggerSchema.safeParse({ alert: custom, matchedBy: 'model', keyword: 'appel' }).success,
    ).toBe(false);
    expect(AlertTriggerSchema.safeParse({ alert: custom, matchedBy: 'model' }).success).toBe(true);
    expect(
      AlertTriggerSchema.safeParse({ alert: { kind: 'system', code: 'other' }, matchedBy: 'rule' }).success,
    ).toBe(false);
  });

  it('carries a trigger on `alert_triggered`, and on the handoff of an alert that pauses', () => {
    const trigger = { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'model' };
    expect(
      EventBodySchema.safeParse({
        type: 'alert_triggered',
        payload: { conversationId: CONVERSATION, trigger, notify: true },
      }).success,
    ).toBe(true);
    expect(
      EventBodySchema.safeParse({
        type: 'handoff_requested',
        payload: {
          conversationId: CONVERSATION,
          cause: 'custom_alert',
          trigger: { alert: { kind: 'custom', id: ALERT }, matchedBy: 'model' },
        },
      }).success,
    ).toBe(true);
    // No free text on the trigger: the fan's words have nowhere to go.
    expect(
      EventBodySchema.safeParse({
        type: 'alert_triggered',
        payload: { conversationId: CONVERSATION, trigger, notify: false, excerpt: 'his words' },
      }).data,
    ).not.toHaveProperty('payload.excerpt');
  });

  it('reads a keyword as the engine does, and refuses one it would never match', () => {
    expect(alertKeywordKey('  Vidéo-PERSO ! ')).toBe('video perso');
    expect(alertKeywordKey('Rendez’vous')).toBe('rendez vous');
    expect(CustomAlertBodySchema.safeParse({ ...body, keywords: ['!!!'] }).success).toBe(false);
  });

  it('sends each alert to a Telegram topic that exists', () => {
    for (const code of SYSTEM_ALERT_CODES) {
      expect(TelegramTopicSchema.safeParse(SYSTEM_ALERT_TOPICS[code]).success).toBe(true);
    }
    expect(CUSTOM_ALERT_TOPIC).toBe('custom');
  });

  it('tries an alert being written on one message, and answers without the fan’s words', () => {
    const alert = { phrase: null, keywords: ['vidéo perso'] };
    const creatorId = '0190f3a4-7c2d-7e5b-9a1f-3b6c8d2e4f10';
    expect(AlertTestBodySchema.safeParse({ creatorId, alert, message: 'une vidéo perso ?' }).success).toBe(
      true,
    );
    // Tried with one creator's active persona: a request that names none is refused.
    expect(AlertTestBodySchema.safeParse({ alert, message: 'une vidéo perso ?' }).success).toBe(false);
    expect(AlertTestBodySchema.safeParse({ creatorId, alert, message: '   ' }).success).toBe(false);
    expect(
      AlertTestBodySchema.safeParse({ creatorId, alert: { phrase: null, keywords: [] }, message: 'coucou' })
        .success,
    ).toBe(false);
    expect(
      AlertTestResultSchema.safeParse({ keywords: ['vidéo perso'], phraseMatched: null, reason: null })
        .success,
    ).toBe(true);
  });

  it('reads two names as one alert whatever their case, accents and spaces around, never their words', () => {
    expect(customAlertNameKey('  APPEL Vidéo ')).toBe(customAlertNameKey('appel video'));
    expect(customAlertNameKey('Éloïse')).toBe('eloise');
    expect(customAlertNameKey('appel vidéo')).not.toBe(customAlertNameKey('appel-vidéo'));
    expect(customAlertNameKey('appel vidéo')).not.toBe(customAlertNameKey('appel  vidéo'));
  });

  it('gives every error code a suffix that sets its status (api.md)', () => {
    for (const code of ALERT_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|invalid|conflict|unprocessable)$/u);
    }
  });
});
