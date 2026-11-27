import { describe, expect, it } from 'vitest';

import { CaptionHintUnknown } from '../../domain/errors';
import type { CaptionRequest, DescribedReel, OtherCaptionsDeps } from '../../domain/ports';
import type { WrittenCaption } from '../../domain/proposals';
import { otherCaptions, type OtherCaptionsAsk } from '../other-ideas';

const CREATOR = '5d0c2f4e-3b1a-4c7d-8e9f-0a1b2c3d4e5f';
const DROP = '0b0f6c0e-6a52-4a53-9c0e-0d4f5a1f2b3c';

const reel: DescribedReel = {
  dropId: DROP,
  category: 'instagram_reel',
  description: 'Elle marche sur une plage au lever du soleil.',
  sentence: 'Tournée ce matin',
  durationS: 12,
};
const other: WrittenCaption[] = [
  { style: 'short', text: 'Réveil salé' },
  { style: 'story', text: 'Trois réveils pour ce lever de soleil' },
  { style: 'funny', text: 'Mon café a refroidi trois fois' },
];
const ask: OtherCaptionsAsk = {
  creatorId: CREATOR,
  subject: `drop:${DROP}`,
  shown: [{ text: 'Team lever de soleil ?' }, { text: 'Devine où je suis' }],
  wish: { hints: ['shorter', 'with_question'], note: 'Parle du café' },
};

function setup(
  answers: (readonly WrittenCaption[] | 'budget' | 'failed')[],
  options: { readonly reel?: DescribedReel | null; readonly persona?: boolean } = {},
): { deps: OtherCaptionsDeps; requests: CaptionRequest[] } {
  const requests: CaptionRequest[] = [];
  const deps: OtherCaptionsDeps = {
    reel: () => Promise.resolve(options.reel === undefined ? reel : options.reel),
    persona: () =>
      Promise.resolve(
        options.persona === false
          ? null
          : {
              creatorName: 'Lina',
              personaSheet: 'identity:\n  first_name: Lina',
              blocking: (text) => (text.includes('une IA') ? ['ai_disclosure'] : []),
            },
      ),
    examples: () => Promise.resolve([]),
    writer: {
      write: (request) => {
        requests.push(request);
        return Promise.resolve(answers.shift() ?? 'failed');
      },
    },
  };
  return { deps, requests };
}

describe('other captions for the same Reel (ADR 0164 § 9)', () => {
  it('writes three other captions from her hints in her screen’s words, her line and what she already reads', async () => {
    const { deps, requests } = setup([other]);

    const answers = await otherCaptions(deps, ask);

    expect(answers).toMatchObject([
      { key: 'short', label: 'Courte', text: 'Réveil salé' },
      { key: 'story', label: 'Raconte' },
      { key: 'funny', label: 'Drôle' },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      mediaDescription: reel.description,
      sentence: 'Tournée ce matin',
      otherIdeas: {
        hints: ['Plus courte', 'Avec une question'],
        note: 'Parle du café',
        seen: ['Team lever de soleil ?', 'Devine où je suis'],
      },
    });
  });

  it('refuses a hint her screen does not offer, before any call', async () => {
    const { deps, requests } = setup([other]);

    await expect(
      otherCaptions(deps, { ...ask, wish: { hints: ['louder'], note: '' } }),
    ).rejects.toBeInstanceOf(CaptionHintUnknown);
    expect(requests).toHaveLength(0);
  });

  it('never offers again a caption she already reads, nor one the guards refuse', async () => {
    const { deps } = setup([
      [
        { style: 'short', text: 'devine où je suis !' },
        { style: 'story', text: 'Je suis une IA, au fait' },
        { style: 'funny', text: 'Mon café a refroidi trois fois' },
      ],
      [
        { style: 'teasing', text: 'Le lien est sur onlyfans.com' },
        { style: 'question', text: 'Plutôt mer ou montagne ?' },
      ],
    ]);

    const answers = await otherCaptions(deps, ask);

    expect(answers).toMatchObject([{ key: 'funny' }, { key: 'question', text: 'Plutôt mer ou montagne ?' }]);
  });

  it.each([
    ['the Reel is gone', setup([other], { reel: null })],
    ['the drop is not a Reel', setup([other], { reel: { ...reel, category: 'instagram_post' } })],
    ['she has no active persona', setup([other], { persona: false })],
    ['the day’s budget is spent', setup(['budget'])],
    ['every model failed', setup(['failed'])],
    ['fewer than a choice is left', setup([[other[0] ?? { style: 'short', text: 'Réveil salé' }], []])],
  ])('proposes nothing for now when %s', async (_why, { deps }) => {
    await expect(otherCaptions(deps, ask)).resolves.toBe('unavailable');
  });

  it('proposes nothing for a subject that is not a drop', async () => {
    const { deps, requests } = setup([other]);

    await expect(otherCaptions(deps, { ...ask, subject: `reel:${DROP}` })).resolves.toBe('unavailable');
    expect(requests).toHaveLength(0);
  });
});
