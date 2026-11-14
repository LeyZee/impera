import { CreatorIdSchema, TeamMemberIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { fortnightOf, modeOf, onShiftOf, requestOf, salesOf, todosOf } from './model';

// Everything below is invented (ADR 0010).
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const member = (n: number, name: string, endsAt: string) => ({
  memberId: TeamMemberIdSchema.parse(`0192f3a0-0000-7000-8000-00000000000${String(n)}`),
  name,
  endsAt,
});
const flat = (text: string): string => text.replace(/\s/gu, ' ');

describe('the words of a card of the list of Créatrices', () => {
  it('names her mode, Arrêt in amber and never in red', () => {
    expect(modeOf('auto')).toEqual({ label: 'Automatique', tone: 'ok' });
    expect(modeOf('copilot')).toEqual({ label: 'Copilote', tone: 'calm' });
    expect(modeOf('stop')).toEqual({ label: 'Arrêt', tone: 'warn' });
  });

  it('says her fortnight and its revenue, or why there is none', () => {
    expect(fortnightOf('2026-11-16', '2026-11-20')).toBe('du 16 au 20 nov.');
    expect(fortnightOf('2026-11-01', '2026-11-01')).toBe('le 1 nov.');
    const sales = { from: '2026-11-01', to: '2026-11-09', sales: 3, refunds: 1, revenueMinor: 123_450 };
    expect(flat(salesOf({ ...sales, usdLeftOut: false }).value)).toBe('1 234,50 €');
    expect(salesOf({ ...sales, usdLeftOut: true }).note).toBe('du 1 au 9 nov., hors ventes en dollars');
    expect(salesOf(null)).toEqual({ value: '—', note: 'Registre des ventes non relié' });
  });

  it('says who is on shift on her, in the reader’s zone', () => {
    expect(onShiftOf([], 'Europe/Paris')).toBe('Personne en ce moment');
    expect(flat(onShiftOf([member(1, 'Théo', '2026-11-20T22:00:00Z')], 'Europe/Paris'))).toBe(
      'Théo jusqu’à 23 h',
    );
    expect(
      onShiftOf(
        [member(1, 'Théo', '2026-11-20T22:00:00Z'), member(2, 'Nora', '2026-11-20T23:00:00Z')],
        'Europe/Paris',
      ),
    ).toBe('Théo et Nora');
    expect(
      onShiftOf(
        [
          member(1, 'Théo', '2026-11-20T22:00:00Z'),
          member(2, 'Nora', '2026-11-20T23:00:00Z'),
          member(3, 'Maya', '2026-11-20T23:00:00Z'),
        ],
        'Europe/Paris',
      ),
    ).toBe('Théo, Nora et 1 autre');
  });

  it('says the first content due, late or not, and how many more wait', () => {
    expect(requestOf({ open: 0, next: null }, '2026-11-20')).toBeNull();
    expect(
      requestOf(
        { open: 1, next: { category: 'feed_shoot', dueOn: '2026-11-21', late: false } },
        '2026-11-20',
      ),
    ).toEqual({ value: '📸 Feed · Séance boudoir', note: 'Pour demain', late: false });
    const late = requestOf(
      { open: 3, next: { category: 'script', dueOn: '2026-11-18', late: true } },
      '2026-11-20',
    );
    expect(late?.late).toBe(true);
    expect(late?.note).toBe('En retard depuis mercredi · 2 autres attendus');
  });

  it('counts « À traiter », red only when something urgent waits', () => {
    expect(todosOf(undefined)).toEqual({ text: 'Rien', tone: 'calm' });
    const count = { creatorId: CREATOR, name: 'Anna', todos: 2, grave: 0 };
    expect(todosOf(count)).toEqual({ text: '2', tone: 'warn' });
    expect(todosOf({ ...count, grave: 2 })).toEqual({ text: '2, dont 2 urgents', tone: 'bad' });
  });
});
