import type { NewCreatorDecision } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { CaptionWritingFailed } from '../../domain/errors';
import type { CaptionRequest, DescribedReel, ProposeDeps } from '../../domain/ports';
import type { WrittenCaption } from '../../domain/proposals';
import { proposeCaptions } from '../propose';

const CREATOR = '5d0c2f4e-3b1a-4c7d-8e9f-0a1b2c3d4e5f';
const MEDIUM = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const DROP = '0b0f6c0e-6a52-4a53-9c0e-0d4f5a1f2b3c';
const NOW = new Date('2026-11-21T10:00:00.000Z');

const reel: DescribedReel = {
  dropId: DROP,
  category: 'instagram_reel',
  description: 'Elle marche sur une plage au lever du soleil.',
  sentence: 'Tournée ce matin',
  durationS: 12,
};
const three: WrittenCaption[] = [
  { style: 'question', text: 'Team lever de soleil ou team grasse mat ?' },
  { style: 'teasing', text: 'Devine où je me suis réveillée ce matin' },
  { style: 'funny', text: 'Mon café a refroidi trois fois pendant ce Reel' },
];

function setup(
  answers: (readonly WrittenCaption[] | 'budget' | 'failed')[],
  options: { readonly drops?: readonly DescribedReel[]; readonly persona?: boolean } = {},
): { deps: ProposeDeps; asked: NewCreatorDecision[]; requests: CaptionRequest[] } {
  const asked: NewCreatorDecision[] = [];
  const requests: CaptionRequest[] = [];
  const deps: ProposeDeps = {
    drops: () => Promise.resolve(options.drops ?? [reel]),
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
    examples: () => Promise.resolve(['Dimanche tout doux']),
    writer: {
      write: (request) => {
        requests.push(request);
        return Promise.resolve(answers.shift() ?? 'failed');
      },
    },
    asking: {
      ask: (_creatorId, decision) => {
        asked.push(decision);
        return Promise.resolve(true);
      },
      asked: (_creatorId, subject) => Promise.resolve(asked.some((one) => one.subject === subject)),
    },
  };
  return { deps, asked, requests };
}

describe('instagram_captions.propose (ADR 0164 § 9)', () => {
  it('asks her three captions for a Reel just described, from the video, her sentence and her examples', async () => {
    const { deps, asked, requests } = setup([three]);

    expect(await proposeCaptions(deps, CREATOR, MEDIUM, NOW)).toEqual({ asked: 1, already: 0, refused: 0 });

    expect(asked).toHaveLength(1);
    expect(asked[0]?.answers.map((answer) => answer.text)).toEqual(three.map((caption) => caption.text));
    expect(asked[0]?.expiresAt).toBe('2026-11-28T10:00:00.000Z');
    expect(requests[0]).toMatchObject({
      mediaDescription: reel.description,
      sentence: 'Tournée ce matin',
      examples: ['Dimanche tout doux'],
    });
  });

  it('proposes nothing twice for the same Reel: a description redone asks no model', async () => {
    const { deps, asked, requests } = setup([three, three]);
    await proposeCaptions(deps, CREATOR, MEDIUM, NOW);

    expect(await proposeCaptions(deps, CREATOR, MEDIUM, NOW)).toEqual({ asked: 0, already: 1, refused: 0 });
    expect(asked).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('does nothing for a drop that is not a Reel, nor without a live drop', async () => {
    const photo = setup([three], { drops: [{ ...reel, category: 'instagram_post' }] });
    expect(await proposeCaptions(photo.deps, CREATOR, MEDIUM, NOW)).toBe('nothing');
    expect(photo.requests).toHaveLength(0);
    expect(await proposeCaptions(setup([three], { drops: [] }).deps, CREATOR, MEDIUM, NOW)).toBe('nothing');
  });

  it('writes nothing in her name without an active persona', async () => {
    const { deps, requests } = setup([three], { persona: false });
    expect(await proposeCaptions(deps, CREATOR, MEDIUM, NOW)).toBe('off');
    expect(requests).toHaveLength(0);
  });

  it('asks the model once more when a guard refused a caption, naming the rule and never the text', async () => {
    const { deps, asked, requests } = setup([
      [
        three[0]!,
        { style: 'story', text: 'La suite sur exemple.com' },
        { style: 'short', text: 'Je suis une IA' },
      ],
      [three[1]!, three[2]!, { style: 'question', text: 'Encore une question ?' }],
    ]);

    expect(await proposeCaptions(deps, CREATOR, MEDIUM, NOW)).toEqual({ asked: 1, already: 0, refused: 0 });

    expect(requests[1]?.refusedBy).toEqual(['link', 'ai_disclosure']);
    expect(asked[0]?.answers.map((answer) => answer.text)).toEqual(three.map((caption) => caption.text));
  });

  it('asks with two captions when the rewrite leaves no third, and nothing with fewer', async () => {
    const bad: WrittenCaption = { style: 'story', text: 'Pour 10 € seulement' };
    const two = setup([[three[0]!, three[1]!, bad], [bad]]);
    expect(await proposeCaptions(two.deps, CREATOR, MEDIUM, NOW)).toEqual({
      asked: 1,
      already: 0,
      refused: 0,
    });
    expect(two.asked[0]?.answers).toHaveLength(2);

    const one = setup([[three[0]!, bad], [bad]]);
    expect(await proposeCaptions(one.deps, CREATOR, MEDIUM, NOW)).toEqual({
      asked: 0,
      already: 0,
      refused: 1,
    });
    expect(one.asked).toHaveLength(0);
  });

  it('comes back later when the day’s budget is spent, and fails when every model failed', async () => {
    expect(await proposeCaptions(setup(['budget']).deps, CREATOR, MEDIUM, NOW)).toBe('budget');
    await expect(proposeCaptions(setup(['failed']).deps, CREATOR, MEDIUM, NOW)).rejects.toBeInstanceOf(
      CaptionWritingFailed,
    );
  });
});
