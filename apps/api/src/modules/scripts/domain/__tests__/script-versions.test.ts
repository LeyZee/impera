import type { PreparedBranch, PreparedScriptContent } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { versionContentOf, versionGaps } from '../script-versions';

/** Invented keys and texts: a demo script, never one of hers. */
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function branch(n: number, over: Partial<PreparedBranch> = {}): PreparedBranch {
  return {
    key: key(n),
    condition: null,
    teaser: 'Je viens de finir ma journée',
    offerText: 'Un bonsoir sous le plaid',
    media: [{ ref: `m${String(n)}` }],
    afterMedia: { justAfter: 'Alors ?', unread: '', readNotBought: '' },
    priceMinor: n === 1 ? 0 : 1200,
    currency: 'EUR',
    ...over,
  };
}

const source: PreparedScriptContent = {
  name: 'Soirée cocooning',
  description: 'Un soir de pluie, chez elle.',
  moment: 'night',
  steps: [
    { key: key(901), rhythm: 3, branches: [branch(1)] },
    {
      key: key(902),
      rhythm: 2,
      branches: [
        branch(2, { condition: { kind: 'none' } }),
        branch(3, { condition: { kind: 'text', text: 'S’il a parlé de pluie' } }),
      ],
    },
  ],
};

const english = (content: PreparedScriptContent): PreparedScriptContent => ({
  ...content,
  name: 'Cozy evening',
  description: 'A rainy night, at home.',
  steps: content.steps.map((step) => ({
    ...step,
    branches: step.branches.map((one) => ({
      ...one,
      teaser: 'Just finished my day',
      offerText: 'A goodnight under the blanket',
      afterMedia: { justAfter: 'So?', unread: '', readNotBought: '' },
    })),
  })),
});

describe('a version of a script in another language', () => {
  it('starts from its source: the same steps, media, prices and conditions, its texts to translate', () => {
    const made = versionContentOf(source, null);
    expect(made.name).toBe('');
    expect(made.moment).toBe('night');
    expect(
      made.steps.map((step) => step.branches.map((one) => [one.key, one.priceMinor, one.media])),
    ).toEqual(source.steps.map((step) => step.branches.map((one) => [one.key, one.priceMinor, one.media])));
    expect(made.steps[1]?.branches[1]).toMatchObject({
      teaser: '',
      offerText: '',
      condition: { kind: 'text', text: 'S’il a parlé de pluie' },
    });
    expect(versionGaps(source, { ...made, name: 'Cozy evening' })).toEqual([]);
  });

  it('has no gap of its own once translated with a name of its own', () => {
    expect(versionGaps(source, english(source))).toEqual([]);
  });

  it('never takes its source’s name: an import would recognise neither', () => {
    expect(
      versionGaps(source, { ...english(source), name: ' Soirée cocooning ' }).map((g) => g.code),
    ).toEqual(['version_name_same']);
  });

  it('differs as soon as a price, a media, a branch, a rhythm or the moment is not its source’s', () => {
    const translated = english(source);
    const withStep = (at: number, step: PreparedScriptContent['steps'][number]) => ({
      ...translated,
      steps: translated.steps.map((one, i) => (i === at ? step : one)),
    });
    const second = translated.steps[1];
    if (second === undefined) throw new Error('two steps');
    const priced = withStep(1, {
      ...second,
      branches: second.branches.map((one, i) => (i === 0 ? { ...one, priceMinor: 900 } : one)),
    });
    const otherMedia = withStep(1, {
      ...second,
      branches: second.branches.map((one, i) => (i === 0 ? { ...one, media: [{ ref: 'm9' }] } : one)),
    });
    const fewer = withStep(1, { ...second, branches: second.branches.slice(0, 1) });
    const slower = withStep(1, { ...second, rhythm: 5 });
    for (const version of [priced, otherMedia, fewer, slower, { ...translated, moment: 'day' as const }])
      expect(versionGaps(source, version).map((g) => g.code)).toEqual(['version_differs']);
  });

  it('keeps its own words for a text condition, which the AI reads', () => {
    const translated = english(source);
    const second = translated.steps[1];
    if (second === undefined) throw new Error('two steps');
    const reworded = {
      ...translated,
      steps: [
        translated.steps[0],
        {
          ...second,
          branches: second.branches.map((one, i) =>
            i === 1 ? { ...one, condition: { kind: 'text' as const, text: 'If he talked about rain' } } : one,
          ),
        },
      ].filter((step) => step !== undefined),
    };
    expect(versionGaps(source, reworded)).toEqual([]);
  });

  it('never says a price or a currency in a text', () => {
    const translated = english(source);
    const said = (offerText: string) => ({
      ...translated,
      steps: translated.steps.map((step, at) =>
        at === 1
          ? { ...step, branches: step.branches.map((one, i) => (i === 0 ? { ...one, offerText } : one)) }
          : step,
      ),
    });
    for (const text of ['Only 12 € tonight', 'just $9', '15 euros for you', '9.99 USD'])
      expect(versionGaps(source, said(text))).toEqual([
        { code: 'version_mentions_price', step: 1, branch: key(2), term: null },
      ]);
    expect(versionGaps(source, said('Three photos, just for you, at 11 tonight'))).toEqual([]);
  });

  it('is set right on its source and keeps the texts of the branches it had', () => {
    const translated = english(source);
    const moved: PreparedScriptContent = {
      ...source,
      steps: [...source.steps, { key: key(903), rhythm: 1, branches: [branch(4)] }],
    };
    const right = versionContentOf(moved, translated);
    expect(right.name).toBe('Cozy evening');
    expect(right.steps[0]?.branches[0]?.offerText).toBe('A goodnight under the blanket');
    expect(right.steps[2]?.branches[0]?.offerText).toBe('');
    expect(versionGaps(moved, right).map((g) => g.code)).toEqual([]);
  });
});
