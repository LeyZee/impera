import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { StoredPersonaSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { channelWriterPersona } from '../channel-persona';

/** The fictional demo persona of the repository (ADR 0010: never a real one in a test). */
const DEMO = StoredPersonaSchema.parse(
  parse(
    readFileSync(
      fileURLToPath(new URL('../../../../../../../personas/demo/v0.3.0.yaml', import.meta.url)),
      'utf8',
    ),
  ),
);
const NOW = new Date('2026-11-08T10:00:00Z');

describe('her persona for a post of her channel (ADR 0080 § 5)', () => {
  const persona = channelWriterPersona({ version: '0.3.0', creatorName: 'Nora', persona: DEMO }, NOW);

  it('reads her sheet as her drafts do, without her intimacy but with her strict limits', () => {
    expect(persona.version).toBe('0.3.0');
    expect(persona.creatorName).toBe('Elena');
    expect(persona.personaSheet).toContain('Elena');
    expect(persona.personaSheet).not.toContain('Pratiques / Kinks');
    expect(persona.personaSheet).not.toContain('Jouets sexuels');
    expect(persona.personaSheet).toContain('Zones interdites');
  });

  it('never asks for the media of a post that has one (no media_not_sent on the channel)', () => {
    expect(persona.check(['Regarde cette photo, nouvelle tenue ✨']).map((v) => v.code)).not.toContain(
      'media_not_sent',
    );
  });

  it('lets a post of hers through', () => {
    expect(persona.check(['Ce soir je réponds à tout le monde ✨ le lien est juste en dessous'])).toEqual([]);
  });

  it('blocks what the agent blocks, her forbidden emojis, and anything explicit on a public channel', () => {
    const codes = (text: string): string[] =>
      persona
        .check([text])
        .filter((v) => v.blocking)
        .map((v) => v.code);
    expect(codes('Je suis une IA, désolée')).toContain('ai_disclosure');
    expect(codes('Trop drôle 😂')).toContain('forbidden_term');
    expect(codes('Je me touche en pensant à vous')).toContain('explicit_before_age');
  });

  it('reads a poll’s question and each answer, never as too many bubbles', () => {
    const violations = persona.check(['Ce soir je fais quoi ?', 'Un live', 'Une story', 'Les deux']);
    expect(violations).toEqual([]);
  });
});
