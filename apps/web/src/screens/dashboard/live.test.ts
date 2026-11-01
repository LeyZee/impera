import { describe, expect, it } from 'vitest';

import { ago, fromApi, replyDelay, usdNote } from './live';

import { apiDashboard } from '@/test/fakes';

/** Spaces as typed: the screen writes no-break spaces before units and inside hours. */
const flat = (text: string | undefined): string => (text ?? '').replace(/\s/gu, ' ');

const card = (id: string, data = fromApi(apiDashboard())) => data.agent.cards.find((c) => c.id === id);

describe('fromApi', () => {
  it('writes the todos in the trade’s words, how long they wait, the hour at her time (DASH-11, DASH-26)', () => {
    const [todo] = fromApi(apiDashboard()).todos;
    expect(todo).toMatchObject({ kind: 'Mineur possible', title: 'Kévin', tone: 'bad' });
    expect(flat(todo?.at)).toBe('Reçu à 13 h 41');
    const [fresh, late] = fromApi(
      apiDashboard({
        todos: apiDashboard().todos.flatMap((t) => [
          { ...t, id: 'fresh', waitingMinutes: 3 },
          { ...t, id: 'late', waitingMinutes: 19 },
        ]),
      }),
    ).todos;
    expect([flat(fresh?.waiting), fresh?.late]).toEqual(['depuis 3 min', false]);
    expect([flat(late?.waiting), late?.late]).toEqual(['depuis 19 min', true]);
  });

  it('names a send that failed for good', () => {
    const todos = apiDashboard().todos.map(
      (t) => ({ ...t, tone: 'warn', kind: 'send_failed' }) satisfies typeof t,
    );
    const [todo] = fromApi(apiDashboard({ todos })).todos;
    expect(todo).toMatchObject({ kind: 'Envoi échoué', tone: 'warn' });
  });

  it('names a message left with no answer (P3-11)', () => {
    const todos = apiDashboard().todos.map(
      (t) => ({ ...t, tone: 'warn', kind: 'unanswered' }) satisfies typeof t,
    );
    const [todo] = fromApi(apiDashboard({ todos })).todos;
    expect(todo).toMatchObject({ kind: 'Sans réponse', tone: 'warn' });
  });

  it('writes the server’s figures the French way, nothing more', () => {
    expect(card('budget')?.value).toBe('7,40 € sur 20 €');
    expect(card('budget')?.gauge).toEqual({ kind: 'spend', value: 37, mark: 80 });
    expect(card('live-rate')?.value).toBe('64,5 % sans retouche');
    expect(card('activity')?.value).toBe('1 min 42');
    expect(card('voice')?.rows[0]).toEqual(['Temps pour écrire', '3,1 s']);
    expect(card('reveal')?.rows[0]).toEqual(['Dernière lecture', 'il y a 14 s']);
  });

  it('lists only the handoffs that happened, and says when Telegram is off (DASH-16)', () => {
    expect(card('relays')?.title).toBe('Passages à l’humain');
    expect(card('relays')?.sub).toBe('Telegram éteint');
    expect(card('relays')?.rows).toEqual([
      ['Mineur possible', '1'],
      ['Alertes Telegram cette nuit', 'Telegram éteint'],
    ]);
  });

  it('counts only the guards, never a relay for the AI budget, a voice down, no active persona or no named reason', () => {
    const base = apiDashboard();
    const data = fromApi(
      apiDashboard({
        guards: {
          ...base.guards,
          today: {
            ...base.guards.today,
            minor: 1,
            budget: 3,
            llm_unavailable: 5,
            other: 2,
            custom_alert: 1,
            persona_inactive: 4,
          },
        },
      }),
    );
    expect(card('relays', data)?.value).toBe('2 aujourd’hui');
    expect(card('relays', data)?.rows.map(([label]) => label)).toEqual([
      'Mineur possible',
      'Alerte personnalisée',
      'Alertes Telegram cette nuit',
    ]);
    expect(data.agent.foldSummary).toContain('2 passages à l’humain');
    expect(flat(data.agent.foldSummary)).toContain('64,5 % validés sans retouche, objectif 80 %');
  });

  it('says over which period the reply delay is measured, the one chosen for the sales', () => {
    expect(card('activity')?.title).toBe('Délai de réponse habituel aujourd’hui');
    expect(card('activity', fromApi(apiDashboard({ period: 'week' })))?.title).toBe(
      'Délai de réponse habituel sur 7 jours',
    );
    expect(card('activity', fromApi(apiDashboard({ period: 'month' })))?.title).toBe(
      'Délai de réponse habituel sur 30 jours',
    );
  });

  it('names the city of her clock only when the reader’s reads another time', () => {
    const at = (timezone: string, viewer: string): string =>
      fromApi(
        apiDashboard({ creator: { ...apiDashboard().creator, now: '2026-10-28T20:00:00Z', timezone } }),
        'owner',
        viewer,
      ).creator.now.replace(/\s/gu, ' ');
    // Hours written as everywhere in the CRM, « 21 h », « 0 h 44 » (DASH-26).
    expect(at('Europe/Paris', 'Europe/Paris')).toBe('mercredi 28 octobre, 21 h');
    // Another name, the same time: nothing to say.
    expect(at('Europe/Paris', 'Europe/Brussels')).toBe('mercredi 28 octobre, 21 h');
    expect(at('Pacific/Kiritimati', 'Europe/Paris')).toBe('jeudi 29 octobre, 10 h, heure de Kiritimati');
    expect(at('America/New_York', 'Europe/Paris')).toBe('mercredi 28 octobre, 16 h, heure de New York');
  });

  it('writes the first of a month « 1er » (PAIE-19)', () => {
    const now = fromApi(
      apiDashboard({
        creator: { ...apiDashboard().creator, now: '2026-11-01T13:00:00Z', timezone: 'Europe/Paris' },
      }),
      'owner',
      'Europe/Paris',
    ).creator.now.replace(/\s/gu, ' ');
    expect(now).toBe('dimanche 1er novembre, 14 h');
  });

  it('hands Telegram’s night coverage to the banner, off included', () => {
    expect(fromApi(apiDashboard()).telegram).toEqual({ coverage: null });
    const uncovered = apiDashboard({ telegramCoverage: { urgentReachable: false } });
    expect(fromApi(uncovered).telegram).toEqual({ coverage: { urgentReachable: false } });
  });

  it('makes no sale up', () => {
    expect(fromApi(apiDashboard()).sales).toBeNull();
  });

  it('says how the best fans’ dollars were counted, and nothing without a dollar sale (choix de Charles, 28/10)', () => {
    expect(usdNote({ seen: true, rate: { day: '2026-10-27' } })).toBe(
      'Dollars convertis en euros au taux BCE du 27 octobre.',
    );
    expect(usdNote({ seen: true, rate: { day: '2026-11-01' } })).toBe(
      'Dollars convertis en euros au taux BCE du 1er novembre.',
    );
    expect(usdNote({ seen: true, rate: null })).toBe(
      'Les ventes en dollars ne sont pas comptées : aucun taux BCE n’est encore connu.',
    );
    expect(usdNote({ seen: false, rate: { day: '2026-10-27' } })).toBeUndefined();
    expect(fromApi(apiDashboard()).usdNote).toBeUndefined();
    expect(fromApi(apiDashboard({ usdSales: { seen: true, rate: null } })).usdNote).toContain('pas comptées');
  });

  it('keeps the best fans only, a waiting fan is read in Suivi', () => {
    expect(fromApi(apiDashboard()).fans.map((fan) => fan.name)).toEqual(['Théo']);
  });

  it('says where to start under an urgency, without repeating its line (DASH-10)', () => {
    const { agent, todos } = fromApi(apiDashboard());
    expect(agent.lead).toBe('Commence par Kévin.');
    expect(agent.lead).not.toContain(todos[0]?.why ?? '');
  });

  it('says the AI budget past its alert in a sentence, and the worst card in the fold (DASH-06)', () => {
    const near = fromApi(
      apiDashboard({ budget: { spentToday: 18.62, cap: 20, alertAt: 16, costPerEuroSold: null } }),
    );
    expect(flat(near.agent.budgetNote)).toBe('À 18,62 € sur 20 € de budget IA, l’agent s’arrêtera bientôt.');
    expect(card('budget', near)).toMatchObject({ tone: 'warn', alarm: 'Le budget IA approche du plafond' });
    expect(flat(card('budget', near)?.sub)).toBe('alerte à 16 €, arrêt à 20 €');
    expect(fromApi(apiDashboard()).agent.budgetNote).toBeUndefined();
  });

  it('says since when Reveal is disconnected, in the lead (DASH-18)', () => {
    const offline = fromApi(
      apiDashboard({
        reveal: { connected: false, lastReadAt: '2026-10-19T11:13:00Z', late: false, conversations: 0 },
      }),
    );
    expect(offline.agent.lead).toMatch(/^Dernière lecture il y a \d+ (min|h|j)\. L’agent ne lit plus/u);
  });

  it('writes a best fan’s line short enough for a phone (DASH-27)', () => {
    expect(fromApi(apiDashboard()).fans[0]?.line).toMatch(/^depuis /u);
  });

  it('says a Reveal never linked is a step to come, in no colour, not an outage', () => {
    const unlinked = fromApi(
      apiDashboard({
        reveal: { connected: false, lastReadAt: null, late: false, conversations: 0 },
        voice: { ok: false, keyMissing: false, medianWriteMs: null, outagesLast7d: 0 },
      }),
    );
    expect(unlinked.agent).toMatchObject({ tone: 'idle', headline: 'Reveal n’est **pas encore relié**' });
    expect(card('reveal', unlinked)).toMatchObject({ tone: 'idle', value: 'Pas encore reliée' });
    expect(unlinked.agent.foldSummary).toContain('Reveal pas encore relié');
    // Reveal speaks first, the voice is said in the same lead, not only in the fold.
    expect(unlinked.agent.lead).toContain('L’IA qui écrit ne répond pas non plus.');
  });

  it('says a missing key is a step to take, in amber, and where the key goes', () => {
    const noKey = fromApi(
      apiDashboard({ voice: { ok: false, keyMissing: true, medianWriteMs: null, outagesLast7d: 0 } }),
    );
    expect(noKey.agent).toMatchObject({
      tone: 'warn',
      stalled: true,
      headline: 'L’IA qui écrit **attend sa clé**',
      action: 'Poser la clé',
      actionTo: '/reglages/modeles-ia',
    });
    // The page has no « Services » heading: the lead names the page only.
    expect(noKey.agent.lead).toContain('Pose-la dans Réglages › Modèles IA.');
    expect(card('voice', noKey)).toMatchObject({ tone: 'warn', value: 'Clé manquante' });
    expect(card('voice', noKey)?.rows[0]).toEqual(['À poser dans', 'Réglages › Modèles IA']);
    // A manager does not hold Réglages: the card says who sets the key, as the hero does.
    const forTeam = fromApi(
      apiDashboard({ voice: { ok: false, keyMissing: true, medianWriteMs: null, outagesLast7d: 0 } }),
      'team',
    );
    expect(card('voice', forTeam)?.sub).toBe('posée par le propriétaire dans Réglages › Modèles IA');
    expect(card('voice', forTeam)?.rows[0]).toEqual([
      'Posée par',
      'le propriétaire, dans Réglages › Modèles IA',
    ]);
    // Never linked and no key: Reveal leads, the key is said in the same lead.
    const both = fromApi(
      apiDashboard({
        reveal: { connected: false, lastReadAt: null, late: false, conversations: 0 },
        voice: { ok: false, keyMissing: true, medianWriteMs: null, outagesLast7d: 0 },
      }),
    );
    expect(both.agent.lead).toContain('L’IA qui écrit attend aussi sa clé.');
  });

  it('says jobs the worker gave up on in amber, and none when it could not count them', () => {
    const stuck = fromApi(apiDashboard({ jobs: { dead: 3 } }));
    expect(card('activity', stuck)).toMatchObject({ tone: 'warn' });
    expect(card('activity', stuck)?.rows).toContainEqual(['Tâches bloquées', '3, à regarder']);
    expect(stuck.agent.foldSummary).toContain('3 tâches bloquées');
    expect(card('activity')?.rows).toContainEqual(['Tâches bloquées', 'aucune']);
    const unread = fromApi(apiDashboard({ jobs: { dead: null } }));
    expect(card('activity', unread)?.rows).toContainEqual(['Tâches bloquées', 'pas lu']);
    expect(card('activity', unread)?.tone).toBe('ok');
    expect(unread.agent.foldSummary).not.toContain('bloquée');
  });

  it('opens every line in Suivi, on its conversation', () => {
    const [draft] = apiDashboard().todos;
    if (draft === undefined) throw new Error('the fixture has a todo');
    expect(fromApi(apiDashboard()).todos[0]?.conversationId).toBe(draft.conversationId);
    const [todo] = fromApi(
      apiDashboard({ todos: [{ ...draft, tone: 'warn', kind: 'awaiting_approval' }] }),
    ).todos;
    expect(todo).toMatchObject({ kind: 'À valider dans Suivi', conversationId: draft.conversationId });
  });

  it('says a Reveal no longer read in amber, never « Connectée » (recette 28/10, G8)', () => {
    const late = fromApi(
      apiDashboard({
        reveal: { connected: true, lastReadAt: '2026-10-19T11:30:00Z', late: true, conversations: 12 },
      }),
    );
    expect(card('reveal', late)).toMatchObject({ tone: 'warn', value: 'Lecture en retard' });
    expect(card('reveal', late)?.rows[0]).toEqual(['Dernière lecture', 'il y a 30 min']);
    expect(late.agent).toMatchObject({ tone: 'warn', stalled: true, headline: 'Reveal n’est **plus lu**' });
    expect(late.agent.lead).toContain('lu pour la dernière fois il y a 30 min');
    expect(late.agent.foldSummary).toContain('Reveal lu en retard');
    expect(card('reveal')).toMatchObject({ tone: 'ok', value: 'Connectée' });
  });

  it('names what « pas encore mesuré » is about in the summary (recette 28/10, M9)', () => {
    const unmeasured = fromApi(
      apiDashboard({ liveRate: { rate: null, target: 80, decided: 0, threeWeeksAgo: null } }),
    );
    expect(unmeasured.agent.foldSummary).toMatch(/ · taux en réel pas encore mesuré$/u);
  });

  it('says first that Reveal is disconnected, then that the voice is down', () => {
    const offline = apiDashboard({
      reveal: { connected: false, lastReadAt: '2026-10-19T11:00:00Z', late: false, conversations: 0 },
    });
    expect(fromApi(offline).agent).toMatchObject({ tone: 'bad', headline: 'Reveal est **déconnecté**' });
    const mute = apiDashboard({
      voice: { ok: false, keyMissing: false, medianWriteMs: null, outagesLast7d: 3 },
    });
    expect(fromApi(mute).agent).toMatchObject({ tone: 'bad', headline: 'L’IA qui écrit **ne répond plus**' });
    expect(card('voice', fromApi(mute))?.rows[1]).toEqual(['Pannes', '3 heures en 7 j']);
  });

  it('is calm when every card is', () => {
    const calm = apiDashboard({
      liveRate: { rate: 85, target: 80, decided: 140, threeWeeksAgo: 70 },
      guards: { ...apiDashboard().guards, today: { ...apiDashboard().guards.today, minor: 0 } },
    });
    expect(fromApi(calm).agent.tone).toBe('ok');
  });
});

describe('durations', () => {
  it('writes a reply delay in minutes and seconds', () => {
    expect(replyDelay(0.5)).toBe('30 s');
    expect(replyDelay(2)).toBe('2 min');
    expect(replyDelay(1.05)).toBe('1 min 03');
  });

  it('says how long ago, in the largest unit', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(ago('2026-10-19T11:57:00Z', now)).toBe('il y a 3 min');
    expect(ago('2026-10-19T09:00:00Z', now)).toBe('il y a 3 h');
    expect(ago('2026-10-15T12:00:00Z', now)).toBe('il y a 4 j');
  });
});

describe('fromApi for a creator', () => {
  it('shows none of the agency’s figures: its AI spend, its stuck jobs, where its key goes', () => {
    const data = fromApi(
      apiDashboard({
        budget: { spentToday: null, cap: 20, alertAt: 16, costPerEuroSold: null },
        jobs: { dead: null },
        voice: { ok: false, keyMissing: true, medianWriteMs: null, outagesLast7d: 0 },
      }),
      'creator',
    );
    expect(card('budget', data)).toBeUndefined();
    expect(card('activity', data)?.rows.map(([label]) => label)).not.toContain('Tâches bloquées');
    expect(card('voice', data)?.rows.map(([label]) => label)).not.toContain('À poser dans');
    expect(data.agent.foldSummary).not.toContain('€');
  });
});
