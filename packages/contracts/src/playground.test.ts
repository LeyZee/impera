import { describe, expect, it } from 'vitest';

import {
  PlaygroundMessageBodySchema,
  PlaygroundRatingBodySchema,
  PlaygroundSituationBodySchema,
  PlaygroundStateSchema,
  VerdictSchema,
} from './playground';

describe('playground contracts', () => {
  it('names the persona it plays, never with an empty name', () => {
    const persona = PlaygroundStateSchema.shape.persona;
    expect(persona.parse({ name: 'Elena' })).toEqual({ name: 'Elena' });
    expect(persona.safeParse({ name: '' }).success).toBe(false);
  });

  it('takes a fan media as a kind and a few words, flags optional', () => {
    const body = PlaygroundMessageBodySchema.parse({
      text: 'Regarde',
      media: [{ kind: 'image', factualDescription: 'Un selfie dans un miroir.', flags: ['possible_minor'] }],
    });
    expect(body.media?.[0]?.flags).toEqual(['possible_minor']);
    expect(
      PlaygroundMessageBodySchema.safeParse({ text: 'x', media: [{ kind: 'gif', factualDescription: 'x' }] })
        .success,
    ).toBe(false);
  });

  it('reads the three verdicts and refuses an empty correction', () => {
    expect(VerdictSchema.parse({ kind: 'rejected', reason: 'too_long' })).toEqual({
      kind: 'rejected',
      reason: 'too_long',
    });
    expect(VerdictSchema.safeParse({ kind: 'corrected', text: '   ' }).success).toBe(false);
    expect(
      PlaygroundRatingBodySchema.safeParse({ verdict: { kind: 'validated' }, destination: 'elsewhere' })
        .success,
    ).toBe(false);
  });

  it('accepts her clock as hh:mm only', () => {
    expect(PlaygroundSituationBodySchema.safeParse({ localTime: '23:30' }).success).toBe(true);
    expect(PlaygroundSituationBodySchema.safeParse({ localTime: '24:00' }).success).toBe(false);
  });
});
