import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { asPersonaV2, StoredPersonaSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { captionWriterPersona, channelWriterPersona, commentWriterPersona } from '../channel-persona';

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

/** The demo persona living in invented places (ADR 0010), to prove a public text never names them. */
const DEMO_V2 = asPersonaV2(DEMO);
const ELSEWHERE = StoredPersonaSchema.parse({
  ...DEMO_V2,
  sheet: {
    ...DEMO_V2.sheet,
    identity: {
      ...DEMO_V2.sheet.identity,
      city: 'Valbrume',
      place_of_life: 'Un studio, quartier de Port-Sénac',
    },
  },
});
const placesOf = (persona: { check(texts: readonly string[]): { code: string; blocking: boolean }[] }) =>
  persona
    .check(['Dimanche tranquille à Valbrume', 'Le soleil sur Port-Sénac'])
    .filter((violation) => violation.blocking && violation.code === 'place_named');

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

  it('never publishes a post naming where she lives (garde des lieux, § 5.9)', () => {
    const elsewhere = channelWriterPersona(
      { version: '0.3.0', creatorName: 'Nora', persona: ELSEWHERE },
      NOW,
    );
    expect(placesOf(elsewhere)).toHaveLength(2);
    expect(elsewhere.check(['Ce soir je réponds à tout le monde ✨'])).toEqual([]);
  });

  it('reads a poll’s question and each answer, never as too many bubbles', () => {
    const violations = persona.check(['Ce soir je fais quoi ?', 'Un live', 'Une story', 'Les deux']);
    expect(violations).toEqual([]);
  });
});

describe('her persona for a reply to an Instagram comment (ADR 0122 § 2)', () => {
  const stored = { version: '0.3.0', creatorName: 'Nora', persona: DEMO };
  const persona = commentWriterPersona(stored, NOW);

  it('reads her public panels only: the same sheet as her channel, never her intimacy', () => {
    expect(persona.personaSheet).toBe(channelWriterPersona(stored, NOW).personaSheet);
    expect(persona.personaSheet).not.toContain('Pratiques / Kinks');
    expect(persona.personaSheet).not.toContain('Jouets sexuels');
    expect(persona.personaSheet).toContain('Zones interdites');
  });

  it('lets a short warm reply through and blocks an explicit one', () => {
    expect(persona.check(['Merci, ça me fait plaisir 🌸'])).toEqual([]);
    expect(persona.check(['J’ai envie de te sucer']).some((violation) => violation.blocking)).toBe(true);
  });

  it('blocks a reply naming where she lives (ADR 0080 § 5.9)', () => {
    expect(placesOf(commentWriterPersona({ ...stored, persona: ELSEWHERE }, NOW))).toHaveLength(2);
  });

  it('blocks a reply that says she is an AI', () => {
    expect(persona.check(['Je suis une IA']).map((violation) => violation.code)).toContain('ai_disclosure');
  });
});

describe('her persona for a caption of her Reels (ADR 0164 § 9)', () => {
  const stored = { version: '0.3.0', creatorName: 'Nora', persona: DEMO };

  it('blocks a caption naming where she lives', () => {
    expect(placesOf(captionWriterPersona({ ...stored, persona: ELSEWHERE }, NOW))).toHaveLength(2);
  });

  it('lets a caption pass that names no place of hers', () => {
    expect(placesOf(captionWriterPersona(stored, NOW))).toEqual([]);
  });
});
