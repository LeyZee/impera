import { ContentIdeaOfDaySchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  correctableCategories,
  correctionOf,
  draftOf,
  draftProblems,
  metricsLine,
  shootLength,
  slashDay,
} from './model';

/** An invented idea, with an invented trend. */
const IDEA = ContentIdeaOfDaySchema.parse({
  id: '0192f3a0-0000-7000-8000-000000000301',
  creatorId: '0192f3a0-0000-7000-8000-0000000000c1',
  state: 'proposed',
  proposedOn: '2026-11-06',
  refusalReason: null,
  title: 'Transition miroir',
  category: 'feed_video',
  toShoot: 'Un plan face au miroir, puis la même tenue en extérieur.',
  signalId: '0192f3a0-0000-7000-8000-000000000401',
  reason: 'Le format monte cette semaine.',
  shootMinutes: 20,
  signal: {
    id: '0192f3a0-0000-7000-8000-000000000401',
    creatorId: null,
    source: 'grok_search',
    kind: 'format',
    text: 'Transitions miroir sur un son qui monte',
    url: null,
    format: 'reel',
    metrics: null,
    observedAt: '2026-11-06T06:00:00.000Z',
    expiresAt: '2026-11-09T06:00:00.000Z',
  },
});

describe('the words of an idea', () => {
  it('says only the figures the page gave', () => {
    expect(metricsLine(null)).toBeNull();
    expect(metricsLine({ views: null, likes: null, comments: null })).toBeNull();
    // The space before « k » is the one the platform's ICU writes.
    expect(metricsLine({ views: 12_300, likes: 840, comments: 1 })).toMatch(
      /^12,3\sk vues · 840 j’aime · 1 commentaire$/u,
    );
    expect(metricsLine({ views: null, likes: null, comments: 31 })).toBe('31 commentaires');
  });

  it('says her shooting time in minutes, then in hours', () => {
    expect(shootLength(20)).toBe('20 min');
    expect(shootLength(60)).toBe('1 h');
    expect(shootLength(90)).toBe('1 h 30');
    expect(shootLength(125)).toBe('2 h 05');
  });

  it('writes a day as dd/mm/yyyy', () => {
    expect(slashDay('2026-11-09T12:00:00.000Z')).toBe('09/11/2026');
  });
});

describe('a corrected idea', () => {
  it('sends nothing but what changed, trimmed', () => {
    expect(correctionOf(IDEA, draftOf(IDEA))).toBeNull();
    expect(correctionOf(IDEA, { ...draftOf(IDEA), title: '  Transition miroir  ' })).toBeNull();
    expect(
      correctionOf(IDEA, { ...draftOf(IDEA), title: 'Miroir, version nuit', shootMinutes: '30' }),
    ).toEqual({
      title: 'Miroir, version nuit',
      shootMinutes: 30,
    });
    expect(correctionOf(IDEA, { ...draftOf(IDEA), category: 'feed_shoot' })).toEqual({
      category: 'feed_shoot',
    });
  });

  it('says what keeps a draft from being sent, field by field', () => {
    expect(draftProblems(draftOf(IDEA))).toEqual({});
    expect(
      draftProblems({
        ...draftOf(IDEA),
        title: ' ',
        toShoot: '',
        reason: 'x'.repeat(201),
        shootMinutes: '0',
      }),
    ).toEqual({
      title: 'Donne-lui un titre.',
      toShoot: 'Dis ce qu’elle tourne.',
      reason: '200 caractères au plus.',
      shootMinutes: 'Entre 1 et 600 minutes.',
    });
    expect(draftProblems({ ...draftOf(IDEA), title: 'x'.repeat(81), shootMinutes: '1,5' })).toEqual({
      title: '80 caractères au plus : c’est le titre de son agenda.',
      shootMinutes: 'Entre 1 et 600 minutes.',
    });
  });
});

describe('the categories of a correction', () => {
  it('never offers « Script »: a script comes from the agency’s structures (ADR 0056)', () => {
    expect(correctableCategories('feed_shoot')).not.toContain('script');
    expect(correctableCategories('feed_shoot')).toContain('feed_shoot');
    // An idea that already says it keeps it shown.
    expect(correctableCategories('script')).toContain('script');
  });
});
