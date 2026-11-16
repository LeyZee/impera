import { CustomAlertIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  alertKeywordsIn,
  briefAlerts,
  keywordAlerts,
  MEETING_INSISTENCE_MAX,
  meetingAskOnly,
  phraseAlerts,
  settleAlerts,
  type AlertSettings,
} from '../alerts';

// The demo persona's keywords (personas/demo), fictional messages (ADR 0010).
const KEYWORDS = ['IA', 'Bot', 'Robot', 'Vocal', 'Rencontre', 'Rendez-vous', 'Numéro'];

describe('alertKeywordsIn (P4-01)', () => {
  it('finds her keywords whatever the case, the accents or the punctuation', () => {
    expect(alertKeywordsIn('T’es un BOT ou quoi ?', KEYWORDS)).toEqual(['Bot']);
    expect(alertKeywordsIn('on se fait un rendez vous ?', KEYWORDS)).toEqual(['Rendez-vous']);
    expect(alertKeywordsIn('file moi ton numero', KEYWORDS)).toEqual(['Numéro']);
    expect(alertKeywordsIn('une rencontre... et un vocal ?', KEYWORDS)).toEqual(['Vocal', 'Rencontre']);
  });

  it('matches whole words only', () => {
    expect(alertKeywordsIn('il y a du soleil, tu vois les robots de cuisine ?', KEYWORDS)).toEqual([]);
    expect(alertKeywordsIn('je suis vocaliste', KEYWORDS)).toEqual([]);
    expect(alertKeywordsIn('une idée', KEYWORDS)).toEqual([]);
  });

  it('reads the digits inside his words as letters', () => {
    expect(alertKeywordsIn('t’es un r0b0t ?', KEYWORDS)).toEqual(['Robot']);
    expect(alertKeywordsIn('je rentre à 18h', KEYWORDS)).toEqual([]);
  });

  it('matches nothing without keywords, and ignores an empty one', () => {
    expect(alertKeywordsIn('t’es un bot', [])).toEqual([]);
    expect(alertKeywordsIn('t’es un bot', ['', ' – '])).toEqual([]);
  });
});

describe('her alerts (P4-01)', () => {
  const VIDEO = CustomAlertIdSchema.parse('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');
  const JOB = CustomAlertIdSchema.parse('7a2d3b4c-5e6f-4a71-9b8c-0d1e2f3a4b5c');
  const settings: AlertSettings = {
    custom: [
      {
        id: VIDEO,
        phrase: 'Il demande une vidéo rien que pour lui',
        keywords: ['vidéo perso'],
        pausesAgent: true,
        notify: true,
      },
      { id: JOB, phrase: 'Il parle de perdre son travail', keywords: [], pausesAgent: false, notify: false },
    ],
    systemOn: new Set(['keyword', 'service_request', 'identity_doubt']),
  };
  const ids = (index: number) => `a${String(index + 1)}`;

  it('reads her persona’s words and her alerts’ words in code, naming the word she declared', () => {
    expect(keywordAlerts('Tu me fais une Video-Perso ? et un vocal', ['Vocal'], settings)).toEqual([
      {
        trigger: { alert: { kind: 'system', code: 'keyword' }, matchedBy: 'keyword', keyword: 'Vocal' },
        pauses: 'keyword',
        notify: true,
      },
      {
        trigger: { alert: { kind: 'custom', id: VIDEO }, matchedBy: 'keyword', keyword: 'vidéo perso' },
        pauses: 'keyword',
        notify: true,
      },
    ]);
    expect(keywordAlerts('Coucou', ['Vocal'], settings)).toEqual([]);
  });

  it('gives the brain her phrases with short ids, not the ones a word already set off', () => {
    expect(phraseAlerts(settings, [], ids, 50).map((a) => [a.brainId, a.alert.id])).toEqual([
      ['a1', VIDEO],
      ['a2', JOB],
    ]);
    const byWord = keywordAlerts('une vidéo perso', [], settings);
    expect(phraseAlerts(settings, byWord, ids, 50).map((a) => [a.brainId, a.alert.id])).toEqual([
      ['a1', JOB],
    ]);
    expect(phraseAlerts(settings, [], ids, 1)).toHaveLength(1);
  });

  it('keeps only the ids it gave the brain, and reads the system’s alerts from the intent', () => {
    const asked = phraseAlerts(settings, [], ids, 50);
    expect(
      briefAlerts({ intent: 'small_talk', alertsSeen: ['a1', 'a9'] }, asked, settings.systemOn, false),
    ).toEqual([
      {
        trigger: { alert: { kind: 'custom', id: VIDEO }, matchedBy: 'model' },
        pauses: 'custom_alert',
        notify: true,
      },
    ]);
    expect(briefAlerts({ intent: 'asks_for_service' }, asked, settings.systemOn, true)).toEqual([
      { trigger: { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'model' }, notify: true },
    ]);
    expect(briefAlerts({ intent: 'asks_for_service' }, asked, new Set(['keyword']), true)).toEqual([]);
  });

  it('hands a doubt on who she is to a chatter on shift only; otherwise she answers and a human is let know', () => {
    const doubt = { alert: { kind: 'system', code: 'identity_doubt' }, matchedBy: 'model' } as const;
    expect(briefAlerts({ intent: 'asks_if_bot' }, [], settings.systemOn, true)).toEqual([
      { trigger: doubt, pauses: 'identity_doubt', notify: true },
    ]);
    expect(briefAlerts({ intent: 'asks_if_bot' }, [], settings.systemOn, false)).toEqual([
      { trigger: doubt, notify: true },
    ]);
    expect(briefAlerts({ intent: 'asks_if_bot' }, [], new Set(['keyword']), true)).toEqual([]);
  });

  it('pauses on the first alert that pauses, and makes every other one a notice', () => {
    const service = { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'model' } as const;
    const video = { alert: { kind: 'custom', id: VIDEO }, matchedBy: 'model' } as const;
    const job = { alert: { kind: 'custom', id: JOB }, matchedBy: 'model' } as const;
    expect(
      settleAlerts([
        { trigger: service, notify: true },
        { trigger: video, pauses: 'custom_alert', notify: true },
        { trigger: job, pauses: 'custom_alert', notify: false },
      ]),
    ).toEqual({
      pause: { trigger: video, cause: 'custom_alert' },
      notices: [
        { trigger: service, notify: true },
        { trigger: job, notify: false },
      ],
    });
    expect(settleAlerts([{ trigger: service, notify: false }])).toEqual({
      pause: null,
      notices: [{ trigger: service, notify: false }],
    });
  });
});

describe('meetingAskOnly (ADR 0143 § 15, bounds 24 to 28)', () => {
  const words = ['rencontre', 'se voir', 'adresse'];

  it('lets code answer a plain meeting ask: her word only lets the team know', () => {
    expect(meetingAskOnly('Tu voudrais qu’on se rencontre un jour ?', words, [])).toBe(true);
    expect(meetingAskOnly('on pourrait se voir ?', words, ['salut', 'ça va'])).toBe(true);
    const fired = keywordAlerts('on pourrait se voir ?', words, { custom: [], systemOn: new Set() }, true);
    expect(fired).toEqual([expect.objectContaining({ notify: true })]);
    expect(fired[0]?.pauses).toBeUndefined();
  });

  it('pauses on any other word of hers in the same message', () => {
    expect(meetingAskOnly('on peut se voir ? donne ton adresse', words, [])).toBe(false);
  });

  it('pauses when he names a place, a date or an address, or hints he knows where she is', () => {
    expect(meetingAskOnly('on se voit samedi ?', words, [])).toBe(false);
    expect(meetingAskOnly('on se rencontre à la gare ?', words, [])).toBe(false);
    expect(meetingAskOnly('on se voit le 12/05 ?', words, [])).toBe(false);
    expect(meetingAskOnly('je sais où tu habites, on se voit ?', words, [])).toBe(false);
    expect(meetingAskOnly('on se voit à 20h ?', words, [])).toBe(false);
  });

  it('pauses when the code cannot tell it is a meeting ask', () => {
    expect(meetingAskOnly('j’ai fait une belle rencontre hier', words, [])).toBe(false);
    expect(meetingAskOnly('bonjour', words, [])).toBe(false);
  });

  it('pauses again once he insisted', () => {
    const asked = ['on se voit ?', 'allez on se rencontre'];
    expect(meetingAskOnly('stp on pourrait se voir', words, asked.slice(0, MEETING_INSISTENCE_MAX - 1))).toBe(
      true,
    );
    expect(meetingAskOnly('stp on pourrait se voir', words, asked)).toBe(false);
  });

  it('without the exception, her word pauses as before', () => {
    const fired = keywordAlerts('on pourrait se voir ?', words, { custom: [], systemOn: new Set() });
    expect(fired[0]?.pauses).toBe('keyword');
  });
});
