import { DesireMarkIdSchema, type DesireMark } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { marksSummary, scoreLine } from './DesireMarks';

const MARK: DesireMark = {
  id: DesireMarkIdSchema.parse('0199f2a0-0000-7000-8000-000000000010'),
  markedAt: '2026-11-12T20:00:00.000Z',
  fanMessage: 'je sors du boulot',
  verdict: 'too_high',
  note: null,
  before: 20,
  scoreThen: 34,
  weightsThen: 'desire-1',
  signals: [{ signal: 'states_desire', points: 12 }],
  scoreNow: 34,
};

describe('the owner’s marks on the desire score', () => {
  it('counts them by word, and says when there is none', () => {
    expect(marksSummary([])).toBe('aucune marque');
    expect(marksSummary([{ verdict: 'too_high' }, { verdict: 'too_high' }, { verdict: 'right' }])).toBe(
      '2 trop hautes · 1 juste',
    );
    expect(marksSummary([{ verdict: 'too_low' }])).toBe('1 trop basse');
  });

  it('says what the weights in force make of a mark only once they changed it', () => {
    const mark = MARK;
    expect(scoreLine(mark, 'desire-1')).toBe('Désir 34');
    expect(scoreLine({ ...mark, scoreNow: 22 }, 'desire-2')).toBe(
      'Désir 34 à l’époque, 22 avec les poids actuels',
    );
    expect(scoreLine(mark, 'desire-2')).toBe('Désir 34');
  });
});
