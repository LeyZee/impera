import { newId, TrendSignalIdSchema, type ContentIdeaDraft } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { filterDayIdeas } from '../ideas';

const signal = newId(TrendSignalIdSchema);

const idea = (toShoot: string): ContentIdeaDraft => ({
  title: 'Routine du soir',
  category: 'instagram_reel',
  toShoot,
  signalId: signal,
  reason: 'Le format monte.',
  shootMinutes: 15,
});

describe('the day’s ideas read her limits as the agent’s guards do (ADR 0056 § 1)', () => {
  it('folds plurals and accents as `touchesTerm` does', () => {
    // An invented creator (ADR 0010): « pied » in her disgusts blocks « Pieds » in the idea.
    const { kept, dropped } = filterDayIdeas(
      [idea('Les Pieds dans le sable.'), idea('Un café en terrasse.')],
      {
        limits: { never_do: [], never_show: [], never_say: [], disgusts: ['pied'] },
        recent: [],
        refused: [],
        liveSignals: new Set([signal]),
      },
    );
    expect(dropped.map(({ drop }) => drop)).toEqual([{ reason: 'limit', term: 'pied' }]);
    expect(kept.map((one) => one.toShoot)).toEqual(['Un café en terrasse.']);
  });
});
