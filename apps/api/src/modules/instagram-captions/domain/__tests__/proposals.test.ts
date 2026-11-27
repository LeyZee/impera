import { NewCreatorDecisionSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { captionFaults } from '../caption-guard';
import { captionDecision, captionSubject, keepCaptions, type WrittenCaption } from '../proposals';

const DROP = '0b0f6c0e-6a52-4a53-9c0e-0d4f5a1f2b3c';
const three: WrittenCaption[] = [
  { style: 'question', text: 'Team lever de soleil ou team grasse mat ?' },
  { style: 'teasing', text: 'Devine où je me suis réveillée ce matin' },
  { style: 'funny', text: 'Mon café a refroidi trois fois pendant ce Reel' },
];

describe('the guard of a caption (ADR 0057 § 6, ADR 0055 § 1)', () => {
  it('lets a plain caption pass', () => {
    expect(captionFaults('Dimanche tout doux #sunday')).toEqual([]);
  });

  it('refuses an adult platform, a link, a price, « lien en bio », six keywords, nudity, nothing and too long', () => {
    expect(captionFaults('La suite sur OnlyFans')).toContain('adult_platform');
    expect(captionFaults('Le lien en bio pour la suite')).toContain('adult_platform');
    expect(captionFaults('Tout est sur exemple.com')).toContain('link');
    expect(captionFaults('Pour 10 € seulement')).toContain('price');
    expect(captionFaults('#a #b #c #d #e #f')).toContain('too_many_keywords');
    expect(captionFaults('Toute nue au réveil')).toContain('nudity');
    expect(captionFaults('   ')).toContain('length');
    expect(captionFaults('a'.repeat(2201))).toContain('length');
  });
});

describe('what is kept of the captions the model wrote', () => {
  it('keeps three captions that pass, in the order written', () => {
    expect(keepCaptions(three)).toEqual({ kept: three, refusedBy: [] });
  });

  it('leaves out a caption the guard refuses and names the rule, never the text', () => {
    const read = keepCaptions([three[0]!, { style: 'story', text: 'Viens voir exemple.com' }, three[2]!]);
    expect(read.kept).toEqual([three[0], three[2]]);
    expect(read.refusedBy).toEqual(['link']);
  });

  it('leaves out a style or a text given twice, and anything past the third', () => {
    const read = keepCaptions([
      three[0]!,
      { style: 'question', text: 'Une autre question ?' },
      { style: 'story', text: 'team lever de soleil, ou team grasse mat' },
      three[1]!,
      three[2]!,
      { style: 'short', text: 'Dimanche.' },
    ]);
    expect(read.kept).toEqual(three);
  });
});

describe('the decision card of a caption', () => {
  it('fits the contract of a decision: three rows, each style once, other ideas three times', () => {
    const decision = captionDecision(DROP, three, new Date('2026-11-22T20:00:00.000Z'));
    expect(NewCreatorDecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision.subject).toBe(captionSubject(DROP));
    expect(decision.answers.map((answer) => answer.label)).toEqual(['Question', 'Taquine', 'Drôle']);
    expect(decision.otherIdeasLeft).toBe(3);
  });
});
