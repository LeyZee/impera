import { describe, expect, it } from 'vitest';

import { reportItems, todoItems, type TodoItem } from './todo';

import { PAST, sent, WAITING, WITHIN } from '@/test/reports';

const NOW = new Date('2026-10-27T09:00:00.000Z');

describe('« À faire » on the Dashboard: its lines (pilotage 12/11, W3)', () => {
  it('says the gaps to decide in amber, the reports to validate, the gaps still waiting for their member', () => {
    const items = reportItems(
      [
        sent(PAST),
        sent(WAITING, 'Un pack payé juste après la fin du shift.'),
        sent(null),
        sent({ state: 'provisional', readMinor: 5_900 }),
        sent(WAITING),
        sent(WITHIN),
      ],
      NOW,
    );
    expect(items.map((item) => [item.title, item.tone, item.to])).toEqual([
      ['2 écarts à trancher', 'warn', '/equipe/rapports'],
      ['2 rapports à valider', 'neutral', '/equipe/rapports'],
      ['1 écart attend l’explication de son membre', 'neutral', '/equipe/rapports'],
    ]);
  });

  it('says nothing of a report the automatic check validates', () => {
    expect(reportItems([sent(WITHIN)], NOW)).toEqual([]);
  });

  it('puts the red first, then the amber, then the plain lines, each group in its reading order', () => {
    const report = (key: string, tone: TodoItem['tone']): TodoItem => ({
      key,
      tone,
      title: key,
      detail: [],
      to: '/equipe/rapports',
      where: 'Rapports',
      members: [],
      more: false,
    });
    const items = todoItems(
      { title: 'Aucune sauvegarde encore', text: 'Rien n’est copié.', restore: 'Aucun essai noté.' },
      [
        {
          kind: 'documents',
          tone: 'neutral',
          text: '2 pièces à examiner',
          members: [{ memberId: 'm1', name: 'Théo' }],
          more: true,
        },
        { kind: 'invoices', tone: 'danger', text: '1 facture en retard', detail: 'L’échéance est passée.' },
      ],
      [report('gaps', 'warn'), report('plain', 'neutral')],
    );
    expect(items.map((item) => [item.tone, item.title])).toEqual([
      ['danger', '1 facture en retard'],
      ['warn', 'Aucune sauvegarde encore'],
      ['warn', 'gaps'],
      ['neutral', '2 pièces à examiner'],
      ['neutral', 'plain'],
    ]);
    // The export's line carries what it holds back; the documents lead to each member's file, not to one screen.
    expect(items[1]?.detail).toEqual(['Rien n’est copié.', 'Aucun essai noté.']);
    expect(items[1]?.to).toBe('/reglages/sauvegardes');
    expect(items.map((item) => item.where)).toEqual([
      'Factures',
      'Sauvegardes',
      'Rapports',
      'Dossiers',
      'Rapports',
    ]);
    expect(items[0]?.detail).toEqual(['L’échéance est passée.']);
    expect(items[3]).toMatchObject({ to: null, more: true, members: [{ memberId: 'm1', name: 'Théo' }] });
  });

  it('is empty while nothing waits: no line, no card', () => {
    expect(todoItems(null, [], [])).toEqual([]);
  });
});
