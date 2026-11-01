import {
  AlertTriggerItemSchema,
  CustomAlertGroupIdSchema,
  CustomAlertIdSchema,
  type AlertTriggerItem,
  type CustomAlertGroupId,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  alertChoices,
  alertsOf,
  ownedAlerts,
  choiceOf,
  markAllTargets,
  markedLine,
  mergeTriggers,
  reasonAddsSomething,
  whenLine,
} from './model';

/* Invented creators and fans: no real person. */
const NORA = '0192f3a0-0000-7000-8000-0000000000c1';
const LEA = '0192f3a0-0000-7000-8000-0000000000c2';
const GROUP = CustomAlertGroupIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');

const item = (n: number, creatorId: string, at: string, patch: Partial<AlertTriggerItem> = {}) =>
  AlertTriggerItemSchema.parse({
    id: `0192f3a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
    creatorId,
    conversationId: '0192f3a0-0000-7000-8000-0000000000d1',
    fanId: '0192f3a0-0000-7000-8000-0000000000f1',
    fanDisplayName: 'Théo',
    trigger: { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'rule' },
    alertGroupId: null,
    alertName: 'Demande de service',
    pausedAgent: false,
    reason: 'Le fan demande un service (contenu sur mesure, appel, cam ou vocal).',
    at,
    seenAt: null,
    ...patch,
  });

describe('the history of several creators as one list (P4-01)', () => {
  it('puts every creator’s triggers newest first', () => {
    const merged = mergeTriggers([
      {
        creatorId: NORA,
        items: [item(1, NORA, '2026-10-28T10:00:00.000Z'), item(2, NORA, '2026-10-28T08:00:00.000Z')],
        nextCursor: null,
      },
      { creatorId: LEA, items: [item(3, LEA, '2026-10-28T09:00:00.000Z')], nextCursor: null },
    ]);
    expect(merged.items.map((one) => one.at)).toEqual([
      '2026-10-28T10:00:00.000Z',
      '2026-10-28T09:00:00.000Z',
      '2026-10-28T08:00:00.000Z',
    ]);
    expect(merged.hasMore).toBe(false);
  });

  it('stops at the last trigger read of a creator with more to read, so nothing of hers is skipped', () => {
    const merged = mergeTriggers([
      // Léa has more past 09:00: Nora's 08:00 could come after one of Léa's not read yet.
      { creatorId: LEA, items: [item(3, LEA, '2026-10-28T09:00:00.000Z')], nextCursor: 'next' },
      {
        creatorId: NORA,
        items: [item(1, NORA, '2026-10-28T10:00:00.000Z'), item(2, NORA, '2026-10-28T08:00:00.000Z')],
        nextCursor: null,
      },
    ]);
    expect(merged.items.map((one) => one.at)).toEqual([
      '2026-10-28T10:00:00.000Z',
      '2026-10-28T09:00:00.000Z',
    ]);
    expect(merged.hasMore).toBe(true);
  });

  it('keeps another creator’s trigger of the edge’s very millisecond for « Voir plus »', () => {
    const at = '2026-10-28T09:00:00.000Z';
    const merged = mergeTriggers([
      // Léa's next page could hold another trigger of 09:00 that sorts before Nora's.
      { creatorId: LEA, items: [item(3, LEA, at)], nextCursor: 'next' },
      {
        creatorId: NORA,
        items: [item(1, NORA, '2026-10-28T10:00:00.000Z'), item(2, NORA, at)],
        nextCursor: null,
      },
    ]);
    expect(merged.items.map((one) => one.id)).toEqual([
      '0192f3a0-0000-7000-8000-000000000001',
      '0192f3a0-0000-7000-8000-000000000003',
    ]);
  });

  it('keeps one order for two triggers of the same millisecond', () => {
    const at = '2026-10-28T10:00:00.000Z';
    const once = mergeTriggers([
      { creatorId: NORA, items: [item(1, NORA, at), item(2, NORA, at)], nextCursor: null },
    ]);
    const again = mergeTriggers([
      { creatorId: NORA, items: [item(2, NORA, at), item(1, NORA, at)], nextCursor: null },
    ]);
    expect(once.items.map((one) => one.id)).toEqual(again.items.map((one) => one.id));
  });
});

describe('« Tout marquer comme vu »', () => {
  it('names, for each creator shown, her newest trigger', () => {
    expect(
      markAllTargets([
        item(2, NORA, '2026-10-28T08:00:00.000Z'),
        item(1, NORA, '2026-10-28T10:00:00.000Z'),
        item(3, LEA, '2026-10-28T09:00:00.000Z'),
      ]),
    ).toEqual([
      { creatorId: NORA, untilId: '0192f3a0-0000-7000-8000-000000000001' },
      { creatorId: LEA, untilId: '0192f3a0-0000-7000-8000-000000000003' },
    ]);
    expect(markAllTargets([])).toEqual([]);
  });

  it('says what it marked', () => {
    expect(markedLine(0)).toBe('Tout était déjà vu.');
    expect(markedLine(1)).toBe('1 alerte marquée comme vue.');
    expect(markedLine(12)).toBe('12 alertes marquées comme vues.');
  });
});

describe('when a trigger rang', () => {
  const now = new Date('2026-10-28T14:00:00Z');
  const zone = 'Europe/Paris';

  it('reads « il y a » within the hour, then the day and the time in the reader’s zone', () => {
    expect(whenLine('2026-10-28T13:55:00Z', now, zone)).toBe('il y a 5 min');
    expect(whenLine('2026-10-28T10:30:00Z', now, zone)).toBe('aujourd’hui à 11 h 30');
    expect(whenLine('2026-10-27T08:00:00Z', now, zone)).toBe('hier à 9 h');
    expect(whenLine('2026-10-21T21:05:00Z', now, zone)).toBe('mer. 21 oct. à 23 h 05');
  });
});

describe('the alert filter', () => {
  it('offers the system’s alerts, then hers by name, each once', () => {
    expect(
      alertChoices([
        { groupId: GROUP, name: 'Vidéo perso', creatorId: NORA },
        {
          groupId: CustomAlertGroupIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a2'),
          name: 'Appel',
          creatorId: NORA,
        },
        { groupId: GROUP, name: 'Vidéo perso', creatorId: LEA },
      ]).map((one) => one.label),
    ).toEqual([
      'Mot-clé de sa persona',
      'Demande de service',
      'Doute sur la personne',
      'Appel',
      'Vidéo perso',
    ]);
  });

  it('reads its value back, and anything else as every alert', () => {
    expect(choiceOf('identity_doubt')).toBe('identity_doubt');
    expect(choiceOf(GROUP)).toBe(GROUP);
    expect(choiceOf('')).toBeNull();
    expect(choiceOf('sale')).toBeNull();
  });

  it('keeps her alerts named on the lines read, and never the system’s', () => {
    expect(
      alertsOf([
        item(1, NORA, '2026-10-28T10:00:00.000Z', {
          trigger: {
            alert: { kind: 'custom', id: CustomAlertIdSchema.parse('0192f3a0-0000-7000-8000-0000000000b1') },
            matchedBy: 'model',
          },
          alertGroupId: GROUP,
          alertName: 'Vidéo perso',
        }),
        item(2, NORA, '2026-10-28T09:00:00.000Z'),
      ]),
    ).toEqual([{ groupId: GROUP, name: 'Vidéo perso', creatorId: NORA }]);
  });

  it('offers, with one creator chosen, only the alerts that watch her, and always the one chosen', () => {
    const other = CustomAlertGroupIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a2');
    const known = ownedAlerts([
      { groupId: GROUP, name: 'Vidéo perso', creators: [{ creatorId: NORA }, { creatorId: LEA }] },
      { groupId: other, name: 'Appel', creators: [{ creatorId: LEA }] },
    ]);
    const custom = (creator: string | null, chosen: CustomAlertGroupId | null = null) =>
      alertChoices(known, creator, chosen)
        .slice(3)
        .map((one) => one.label);
    expect(custom(null)).toEqual(['Appel', 'Vidéo perso']);
    expect(custom(NORA)).toEqual(['Vidéo perso']);
    expect(custom(LEA)).toEqual(['Appel', 'Vidéo perso']);
    expect(custom(NORA, other)).toEqual(['Appel', 'Vidéo perso']);
  });
  it('keeps the server’s line only when it says more than the alert’s name', () => {
    const at = '2026-10-28T10:00:00.000Z';
    expect(reasonAddsSomething(item(1, NORA, at))).toBe(false);
    expect(
      reasonAddsSomething(
        item(2, NORA, at, {
          trigger: { alert: { kind: 'system', code: 'keyword' }, matchedBy: 'keyword', keyword: 'adresse' },
        }),
      ),
    ).toBe(true);
    expect(
      reasonAddsSomething(
        item(3, NORA, at, {
          trigger: {
            alert: { kind: 'custom', id: CustomAlertIdSchema.parse('0192f3a0-0000-7000-8000-0000000000b1') },
            matchedBy: 'model',
          },
        }),
      ),
    ).toBe(true);
  });
});
