import { describe, expect, it } from 'vitest';

import { withAgencyBlock } from '../note';
import { fingerprintOf } from '../sends';

/** Invented notes only (ADR 0010). */
describe('withAgencyBlock: the agency’s canvas lines in a Reveal client note (spec § 5)', () => {
  it('writes the block into an empty note, in the canvas order', () => {
    expect(withAgencyBlock('', 'Âge : 31\nPrénom : Julien')).toBe('Prénom : Julien\nÂge : 31');
  });

  it('replaces a canvas line in place and keeps every other line word for word', () => {
    const note = 'Prénom : Julien\n  rappel : aime les chats  \nLocalisation : Ville de test\n\nfin';
    expect(withAgencyBlock(note, 'Localisation : Autre ville')).toBe(
      'Prénom : Julien\n  rappel : aime les chats  \nLocalisation : Autre ville\n\nfin',
    );
  });

  it('adds a new label after the last canvas line, or on top when the note has none', () => {
    expect(withAgencyBlock('Prénom : Julien\nnote libre', 'Métier : boulanger')).toBe(
      'Prénom : Julien\nMétier : boulanger\nnote libre',
    );
    expect(withAgencyBlock('note libre', 'Métier : boulanger')).toBe('Métier : boulanger\nnote libre');
  });

  it('reads a label whatever its case and spaces, and replaces only its first line', () => {
    expect(withAgencyBlock('prénom: Julien\nPrénom : Doublon', 'Prénom : Jules')).toBe(
      'Prénom : Jules\nPrénom : Doublon',
    );
  });

  it('gives back the same note when the block already says it', () => {
    const note = 'Prénom : Julien\nÂge : 31';
    expect(withAgencyBlock(note, 'Âge : 31')).toBe(note);
  });

  it('refuses a line out of the canvas, or one label twice', () => {
    expect(withAgencyBlock('', 'Vu au concert')).toBeNull();
    expect(withAgencyBlock('', 'Couleur : bleu')).toBeNull();
    expect(withAgencyBlock('', 'Âge : 31\nÂge : 32')).toBeNull();
  });
});

describe('fingerprintOf: what `connector_sends` keeps of a send (spec § 5)', () => {
  it('is a SHA-256 that does not depend on the media order, and changes with the text', () => {
    const a = fingerprintOf({ text: 'Coucou', scriptRef: null, mediaIds: ['m1', 'm2'] });
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(fingerprintOf({ text: 'Coucou', scriptRef: null, mediaIds: ['m2', 'm1'] })).toBe(a);
    expect(fingerprintOf({ text: 'Salut', scriptRef: null, mediaIds: ['m1', 'm2'] })).not.toBe(a);
  });

  it('leaves a script step’s text out: the step names it, and Reveal may fill its %NAME%', () => {
    const step = (text: string) => fingerprintOf({ text, scriptRef: 's1', mediaIds: ['m1'] });
    expect(step('Coucou %NAME%')).toBe(step('Coucou Julien'));
    expect(fingerprintOf({ text: '', scriptRef: 's2', mediaIds: ['m1'] })).not.toBe(step(''));
  });
});
