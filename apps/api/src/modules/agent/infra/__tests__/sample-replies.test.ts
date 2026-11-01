import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PersonaSchema, type Persona } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { sampleReplyFaults } from '../sample-replies';

/** The fictional demo persona with its blocks (ADR 0010). */
const demo = (): Persona =>
  PersonaSchema.parse(
    parse(
      readFileSync(
        fileURLToPath(new URL('../../../../../../../personas/demo/v0.2.0.yaml', import.meta.url)),
        'utf8',
      ),
    ),
  );

const withReplies = (...replies: string[]): Persona => ({
  ...demo(),
  sample_replies: replies.map((reply) => ({ situation: null, reply })),
});

describe('sampleReplyFaults (P5-01)', () => {
  it('lets her demo answers through', () => {
    expect(sampleReplyFaults(demo())).toEqual([]);
  });

  it('names each answer a hard guard would block, by its place and code', () => {
    expect(
      sampleReplyFaults(
        withReplies(
          'Coucou toi 😏',
          '*sourit* tu me manques',
          'On se voit en vrai samedi ? on se fait un rdv',
          'Je suis malade et j’ai des dettes, achète mon pack',
          'Je suis une IA tu sais',
        ),
      ),
    ).toEqual([
      { index: 1, code: 'stage_direction' },
      { index: 2, code: 'platform_meeting_word' },
      { index: 3, code: 'fake_emergency' },
      { index: 4, code: 'ai_disclosure' },
    ]);
  });

  it('reads her own forbidden words and emojis, never a soft guard', () => {
    const faults = sampleReplyFaults(withReplies('Haha 😂', 'Pas d’humiliation ici', 'x'.repeat(400)));
    expect(faults).toEqual([
      { index: 0, code: 'forbidden_term' },
      { index: 1, code: 'forbidden_term' },
    ]);
  });
});
