import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PersonaSchema, PersonaV2Schema, type Persona, type PersonaV2 } from '@impera/contracts';
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
      { index: 2, code: 'meeting_promise' },
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

describe('sampleReplyFaults, « Réponses typiques » (ADR 0079 § 6)', () => {
  const v2 = (): PersonaV2 =>
    PersonaV2Schema.parse(
      parse(
        readFileSync(
          fileURLToPath(new URL('../../../../../../../personas/demo/v0.3.0.yaml', import.meta.url)),
          'utf8',
        ),
      ),
    );
  const withLines = (...lines: string[]): PersonaV2 => {
    const p = v2();
    p.sheet.conversation.typical_responses = lines.join('\n');
    return p;
  };

  it('lets her demo answers through', () => {
    expect(sampleReplyFaults(v2())).toEqual([]);
  });

  it('reads each line as one answer, by its line, and never the situation before « : »', () => {
    expect(
      sampleReplyFaults(
        withLines(
          'Il propose de se voir en vrai : Haha on verra 😏',
          '',
          'Coucou : *sourit* tu me manques',
          'Je suis une IA tu sais',
        ),
      ),
    ).toEqual([
      { index: 2, code: 'stage_direction' },
      { index: 3, code: 'ai_disclosure' },
    ]);
  });

  it('takes her forbidden words and emojis from the agent’s rules', () => {
    expect(sampleReplyFaults(withLines('Bonne nuit 😂')).map((f) => f.code)).toEqual(['forbidden_term']);
  });
});
