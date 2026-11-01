import {
  CreatorIdSchema,
  type CreatorId,
  CustomAlertGroupSchema,
  SystemAlertSettingSchema,
  type CustomAlertGroup,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  bodyOf,
  canSave,
  cleanKeywords,
  creatorsLine,
  draftIssues,
  draftOf,
  EMPTY_DRAFT,
  hasChanges,
  newDraft,
  pauseLine,
  sameTest,
  switchedBody,
  systemLine,
  telegramHeadLine,
  telegramLine,
  testBodyOf,
  testCreatorOf,
  testHint,
  testCostLine,
  testVerdict,
} from './model';

/* Invented creators: no real person. */
const id = (n: number) => CreatorIdSchema.parse(`0192f3a0-0000-7000-8000-0000000000c${String(n)}`);
const NORA = { id: id(1), displayName: 'Nora Vidal' };
const LEA = { id: id(2), displayName: 'Léa' };
const IRIS = { id: id(3), displayName: 'Iris' };
const ZOE = { id: id(4), displayName: 'Zoé' };
const ALL = [NORA, LEA, IRIS, ZOE];

const saved = (patch: Partial<Record<string, unknown>> = {}): CustomAlertGroup =>
  CustomAlertGroupSchema.parse({
    groupId: '0192f3a0-0000-7000-8000-0000000000a1',
    name: 'Vidéo perso',
    phrase: 'Le fan demande une vidéo faite pour lui',
    keywords: ['vidéo perso'],
    pausesAgent: false,
    notify: true,
    creators: [
      { creatorId: NORA.id, enabled: true, alertId: '0192f3a0-0000-7000-8000-0000000000b1' },
      { creatorId: LEA.id, enabled: false, alertId: '0192f3a0-0000-7000-8000-0000000000b2' },
    ],
    createdAt: '2026-10-27T10:00:00Z',
    updatedAt: '2026-10-27T10:00:00Z',
    ...patch,
  });

describe('an alert of her own, before it is saved (P4-01)', () => {
  it('says on each field what keeps it from being saved', () => {
    expect(draftIssues(EMPTY_DRAFT)).toEqual({
      name: 'Donne-lui un nom.',
      watch: 'Une phrase, des mots-clés, ou les deux : sinon elle ne surveille rien.',
      creators: 'Choisis au moins une créatrice.',
    });
    expect(
      draftIssues({ ...EMPTY_DRAFT, name: 'x'.repeat(81), phrase: 'x'.repeat(501), creatorIds: [NORA.id] }),
    ).toEqual({ name: '80 caractères au plus.', phrase: '500 caractères au plus.' });
    expect(
      draftIssues({
        ...EMPTY_DRAFT,
        name: 'Appel',
        keywords: Array.from({ length: 41 }, (_, n) => `mot${String(n)}`),
        creatorIds: [NORA.id],
      }),
    ).toEqual({ watch: '40 mots-clés au plus.' });
  });

  it('saves a phrase alone, keywords alone, or both, and nothing that watches nothing', () => {
    const base = { ...EMPTY_DRAFT, name: 'Vidéo perso', creatorIds: [NORA.id] };
    expect(canSave({ ...base, phrase: 'Le fan demande une vidéo faite pour lui' })).toBe(true);
    expect(canSave({ ...base, keywords: ['vidéo perso'] })).toBe(true);
    expect(canSave({ ...base, phrase: '   ' })).toBe(false);
    // A word the agent could never match does not count.
    expect(canSave({ ...base, keywords: ['!!!'] })).toBe(false);
  });

  it('keeps each keyword once as the agent reads it', () => {
    expect(
      cleanKeywords([' Vidéo ', 'video', 'appel', '', 'APPEL', 'Rendez-vous', 'rendez vous', '!!!']),
    ).toEqual(['Vidéo', 'appel', 'Rendez-vous']);
  });

  it('starts on every creator: an alert almost always watches them all (REG-18)', () => {
    expect(newDraft([NORA]).creatorIds).toEqual([NORA.id]);
    expect(newDraft(ALL).creatorIds).toEqual(ALL.map((creator) => creator.id));
    expect(newDraft(ALL).notify).toBe(true);
    expect(newDraft(ALL).pausesAgent).toBe(false);
  });
});

describe('what goes to the server', () => {
  it('sends an empty phrase as null and cleaned words', () => {
    const body = bodyOf(
      {
        ...EMPTY_DRAFT,
        name: ' Appel ',
        phrase: '  ',
        keywords: ['appel', 'Appel', 'cam'],
        creatorIds: [NORA.id],
      },
      null,
    );
    expect(body).toEqual({
      name: 'Appel',
      phrase: null,
      keywords: ['appel', 'cam'],
      pausesAgent: false,
      notify: true,
      creators: [{ creatorId: NORA.id, enabled: true }],
    });
  });

  it('keeps each creator’s switch, and gives a creator added the alert’s state', () => {
    const alert = saved();
    const body = bodyOf({ ...draftOf(alert), creatorIds: [NORA.id, LEA.id, IRIS.id] }, alert);
    expect(body.creators).toEqual([
      { creatorId: NORA.id, enabled: true },
      { creatorId: LEA.id, enabled: false },
      { creatorId: IRIS.id, enabled: true },
    ]);
    const off = saved({
      creators: [{ creatorId: NORA.id, enabled: false, alertId: '0192f3a0-0000-7000-8000-0000000000b1' }],
    });
    expect(bodyOf({ ...draftOf(off), creatorIds: [NORA.id, IRIS.id] }, off).creators).toEqual([
      { creatorId: NORA.id, enabled: false },
      { creatorId: IRIS.id, enabled: false },
    ]);
  });

  it('turns the alert on or off for all its creators from its line', () => {
    expect(switchedBody(saved(), true).creators).toEqual([
      { creatorId: NORA.id, enabled: true },
      { creatorId: LEA.id, enabled: true },
    ]);
  });

  it('has nothing to save until the draft differs from what is stored', () => {
    const alert = saved();
    expect(hasChanges(draftOf(alert), alert)).toBe(false);
    expect(hasChanges({ ...draftOf(alert), name: 'Vidéo perso ' }, alert)).toBe(false);
    expect(hasChanges({ ...draftOf(alert), creatorIds: [LEA.id, NORA.id] }, alert)).toBe(false);
    expect(hasChanges({ ...draftOf(alert), notify: false }, alert)).toBe(true);
    expect(hasChanges(EMPTY_DRAFT, null)).toBe(true);
  });
});

describe('an alert on its line', () => {
  it('names its creators, or all of them', () => {
    expect(creatorsLine([NORA.id, LEA.id, IRIS.id, ZOE.id], ALL)).toBe('Toutes les créatrices');
    expect(creatorsLine([NORA.id], ALL)).toBe('Nora Vidal');
    expect(creatorsLine([NORA.id, LEA.id], ALL)).toBe('Nora Vidal et Léa');
    expect(creatorsLine([NORA.id, LEA.id, IRIS.id], ALL)).toBe('Nora Vidal, Léa et 1 autre');
    expect(creatorsLine([], ALL)).toBe('Aucune créatrice');
    // A lone creator is named, never « toutes ».
    expect(creatorsLine([NORA.id], [NORA])).toBe('Nora Vidal');
  });

  it('says whether it pauses the agent, and what its test costs', () => {
    expect(pauseLine(true)).toBe('Met l’agent en pause sur ce fan et passe la main à un humain');
    expect(pauseLine(false)).toBe('Prévient sans mettre l’agent en pause');
    expect(testCostLine({ phrase: '' })).toBe('Les mots-clés se testent sans IA.');
    expect(testCostLine({ phrase: 'Le fan demande un appel' })).toContain('un appel au modèle');
  });
});

describe('where it goes on Telegram', () => {
  const coverage = [
    { creatorId: NORA.id, displayName: 'Nora Vidal', urgentReachable: true, topicsWithoutGroup: [] },
    { creatorId: LEA.id, displayName: 'Léa', urgentReachable: true, topicsWithoutGroup: ['custom' as const] },
    {
      creatorId: IRIS.id,
      displayName: 'Iris',
      urgentReachable: false,
      topicsWithoutGroup: ['custom' as const],
    },
  ];
  const line = (creatorIds: CreatorId[], notify = true) =>
    telegramLine({
      notify,
      topic: 'custom',
      topicLabel: 'Alertes personnalisées',
      creatorIds,
      routing: coverage,
    });

  it('reads the routing of Réglages › Telegram, creator by creator', () => {
    expect(line([NORA.id])).toEqual({
      kind: 'sent',
      text: 'Part sur Telegram, dans « Alertes personnalisées »',
    });
    expect(line([NORA.id, LEA.id])).toEqual({
      kind: 'missing',
      text: 'Aucun groupe Telegram ne reçoit « Alertes personnalisées » pour Léa',
      topic: 'custom',
    });
    expect(line([LEA.id, IRIS.id])?.text).toBe(
      'Aucun groupe Telegram ne reçoit « Alertes personnalisées » pour Léa et Iris',
    );
  });

  it('says it stays in the history when it is not sent, and nothing while the routing is unknown', () => {
    expect(line([LEA.id], false)).toEqual({
      kind: 'silent',
      text: 'Gardée dans l’historique, sans Telegram',
    });
    for (const routing of ['off', 'none', null] as const) {
      expect(
        telegramLine({ notify: true, topic: 'custom', topicLabel: 'x', creatorIds: [NORA.id], routing }),
      ).toBeNull();
    }
  });

  it('says once, in the head, when Telegram carries nothing', () => {
    expect(telegramHeadLine('off')).toBe(
      'Telegram n’est pas branché sur ce serveur : les alertes restent dans l’historique du Suivi.',
    );
    expect(telegramHeadLine('none')).toBe(
      'Aucun groupe Telegram ne reçoit encore rien : les alertes restent dans l’historique du Suivi.',
    );
    expect(telegramHeadLine([])).toBeNull();
    expect(telegramHeadLine(null)).toBeNull();
  });
});

describe('a system alert', () => {
  const setting = (
    code: 'keyword' | 'service_request',
    creators: { creatorId: string; enabled: boolean }[],
  ) => SystemAlertSettingSchema.parse({ code, locked: code === 'keyword', creators });

  it('says for whom it is on, a creator without a row counting as on', () => {
    expect(systemLine(setting('service_request', []), ALL)).toBe('Active pour toutes');
    expect(
      systemLine(
        setting('service_request', [
          { creatorId: IRIS.id, enabled: false },
          { creatorId: ZOE.id, enabled: false },
        ]),
        ALL,
      ),
    ).toBe('Active pour Nora Vidal et Léa');
    expect(
      systemLine(
        setting(
          'service_request',
          ALL.map((c) => ({ creatorId: c.id, enabled: false })),
        ),
        ALL,
      ),
    ).toBe('Coupée pour toutes');
    expect(systemLine(setting('service_request', [{ creatorId: NORA.id, enabled: false }]), [NORA])).toBe(
      'Coupée',
    );
  });

  it('says why her persona’s words cannot be switched off here', () => {
    expect(systemLine(setting('keyword', []), ALL)).toBe(
      'Ne se coupe pas ici : un mot se retire dans sa persona.',
    );
  });
});

describe('« Tester »', () => {
  const words = { phrase: '', keywords: ['Vidéo perso', ' custom '], creatorIds: [NORA.id] };
  const both = {
    phrase: ' Le fan demande une vidéo faite pour lui ',
    keywords: ['custom'],
    creatorIds: [NORA.id],
  };

  it('sends the alert as written, its phrase and words trimmed, once there is something to try', () => {
    expect(testBodyOf(both, ' tu me fais une vidéo ? ')).toEqual({
      creatorId: NORA.id,
      alert: { phrase: 'Le fan demande une vidéo faite pour lui', keywords: ['custom'] },
      message: 'tu me fais une vidéo ?',
    });
    expect(testBodyOf(words, 'custom stp')?.alert).toEqual({
      phrase: null,
      keywords: ['Vidéo perso', 'custom'],
    });
    expect(testBodyOf({ ...both, phrase: ' ', keywords: [] }, 'custom stp')).toBeNull();
    expect(testBodyOf(both, '  ')).toBeNull();
    expect(testBodyOf(both, 'x'.repeat(4_001))).toBeNull();
  });

  it('sends nothing the route would refuse for its words', () => {
    expect(testBodyOf({ ...both, phrase: '', keywords: ['x'.repeat(101)] }, 'custom stp')).toBeNull();
    expect(testBodyOf({ ...both, phrase: '', keywords: ['?!'] }, 'custom stp')).toBeNull();
    const many = Array.from({ length: 41 }, (_, index) => `mot${String(index)}`);
    expect(testBodyOf({ ...both, phrase: '', keywords: many }, 'custom stp')).toBeNull();
  });

  it('says why « Tester » waits once a message is written', () => {
    expect(testHint(both, '')).toBeNull();
    expect(testHint(both, 'custom stp')).toBeNull();
    expect(testHint(both, 'x'.repeat(4_001))).toBe(
      'Ce message est trop long pour un essai : 4\u202f000 caractères au plus.',
    );
    expect(testHint({ ...both, phrase: ' ', keywords: ['!!!'] }, 'custom stp')).toBe(
      'Écris une phrase ou un mot-clé à tester.',
    );
    const many = Array.from({ length: 41 }, (_, index) => `mot${String(index)}`);
    expect(testHint({ ...both, phrase: '', keywords: many }, 'custom stp')).toBe(
      'Corrige l’alerte au-dessus pour la tester.',
    );
  });

  it('names the creator whose persona reads the phrase: the one picked among the alert’s, or the first (M13)', () => {
    const two = { ...both, creatorIds: [NORA.id, LEA.id] };
    expect(testCreatorOf(two, null)).toBe(NORA.id);
    expect(testCreatorOf(two, LEA.id)).toBe(LEA.id);
    expect(testCreatorOf(both, LEA.id)).toBe(NORA.id);
    expect(testBodyOf(two, 'bonjour', LEA.id)?.creatorId).toBe(LEA.id);
    expect(testBodyOf({ ...both, creatorIds: [] }, 'bonjour')).toBeNull();
    expect(testHint({ ...both, creatorIds: [] }, 'bonjour')).toBe(
      'Choisis une créatrice au-dessus pour tester.',
    );
  });

  it('knows an answer for another creator, phrase, other words or another message', () => {
    const sent = testBodyOf(both, 'tu me fais une vidéo ?');
    if (sent === null) throw new Error('nothing to try');
    expect(sameTest(sent, { ...sent })).toBe(true);
    expect(sameTest(sent, { ...sent, message: 'autre chose' })).toBe(false);
    expect(sameTest(sent, { ...sent, creatorId: LEA.id })).toBe(false);
    expect(sameTest(sent, { ...sent, alert: { ...sent.alert, keywords: ['custom', 'perso'] } })).toBe(false);
    expect(sameTest(sent, { ...sent, alert: { ...sent.alert, phrase: null } })).toBe(false);
  });

  it('says whether it would ring, word by word and for the phrase', () => {
    const sent = testBodyOf(both, 'une custom stp');
    if (sent === null) throw new Error('nothing to try');
    expect(testVerdict(sent, { keywords: ['custom'], phraseMatched: false, reason: null }, true)).toEqual({
      rings: true,
      headline: 'Elle sonnerait, et mettrait l’agent en pause pour ce fan.',
      lines: ['Mot-clé trouvé : « custom ».', 'L’IA ne reconnaît pas la situation de la phrase.'],
      warning: null,
    });
    expect(testVerdict(sent, { keywords: [], phraseMatched: true, reason: null }, false)).toEqual({
      rings: true,
      headline: 'Elle sonnerait.',
      lines: ['Aucun de ses mots-clés n’est dans ce message.', 'L’IA reconnaît la situation de la phrase.'],
      warning: null,
    });
    const onlyWords = testBodyOf(words, 'bonjour');
    if (onlyWords === null) throw new Error('nothing to try');
    expect(testVerdict(onlyWords, { keywords: [], phraseMatched: null, reason: null }, false)).toEqual({
      rings: false,
      headline: 'Elle ne sonnerait pas.',
      lines: ['Aucun de ses mots-clés n’est dans ce message.'],
      warning: null,
    });
    expect(
      testVerdict(
        onlyWords,
        { keywords: ['Vidéo perso', 'custom'], phraseMatched: null, reason: null },
        false,
      ).lines,
    ).toEqual(['Mots-clés trouvés : « Vidéo perso », « custom ».']);
  });

  it('says why the phrase could not be read, as the server wrote it', () => {
    const sent = testBodyOf(both, 'bonjour');
    if (sent === null) throw new Error('nothing to try');
    const reason = 'Le budget IA du jour est atteint : la phrase sera lisible après minuit.';
    expect(testVerdict(sent, { keywords: [], phraseMatched: null, reason }, false)).toEqual({
      rings: false,
      headline: 'La phrase n’a pas pu être lue.',
      lines: ['Aucun de ses mots-clés n’est dans ce message.'],
      warning: reason,
    });
  });
});
