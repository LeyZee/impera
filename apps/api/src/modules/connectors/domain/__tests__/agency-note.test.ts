import { describe, expect, it } from 'vitest';

import {
  canvasLinesOf,
  CORRECTION_WINDOW_DAYS,
  markedText,
  planAgencyNote,
  type LineSigner,
  type NoteLineMemory,
  type NoteSlotValue,
} from '../agency-note';

/** Invented values only (ADR 0010). */
const now = new Date('2026-11-16T12:00:00Z');
const daysAgo = (days: number): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

function said(slot: NoteSlotValue['slot'], items: string[], at = daysAgo(1)): NoteSlotValue {
  return { slot, items, source: 'declared', observedAt: at };
}

/** A stand-in for the keyed mark: the infra's HMAC is tested apart. */
const signer: LineSigner = {
  sign: (line) => `mark:${markedText(line)}`,
  signs: (line, mark) => mark === `mark:${markedText(line)}`,
};
const lineHash = (line: string) => signer.sign(line);

function plan(note: string, values: NoteSlotValue[], memory: NoteLineMemory[] = []) {
  return planAgencyNote({ note, values, memory, now, signer });
}

describe('planAgencyNote: the canvas lines the agent writes (ADR 0117 §§ 3–4)', () => {
  it('fills an absent line and a label left empty, and remembers them as its own', () => {
    const result = plan('Prénom :\nnote libre', [
      said('first_name', ['Testeur']),
      said('job', ['boulanger']),
    ]);
    expect(result.block).toBe('Prénom : Testeur\nMétier : boulanger');
    expect(result.memory).toEqual([
      {
        slot: 'first_name',
        hash: lineHash('Prénom : Testeur'),
        owner: 'agent',
        corrected: false,
        locked: false,
      },
      { slot: 'job', hash: lineHash('Métier : boulanger'), owner: 'agent', corrected: false, locked: false },
    ]);
  });

  it('writes a list as the card shows it, comma separated', () => {
    expect(plan('', [said('hobbies', ['vélo', 'jeux de société'])]).block).toBe(
      'Passions : vélo, jeux de société',
    );
  });

  it('writes a value noted by a chatter in the CRM into an empty line', () => {
    const noted: NoteSlotValue = { slot: 'age', items: ['31'], source: 'noted', observedAt: daysAgo(30) };
    expect(plan('', [noted]).block).toBe('Âge : 31');
  });

  it('follows the card on its own line, untouched since', () => {
    const mine: NoteLineMemory = {
      slot: 'location',
      hash: lineHash('Localisation : Ville A'),
      owner: 'agent',
      corrected: false,
      locked: false,
    };
    expect(plan('Localisation : Ville A', [said('location', ['Ville B'], daysAgo(40))], [mine]).block).toBe(
      'Localisation : Ville B',
    );
  });

  it('writes nothing when the note already says it', () => {
    expect(plan('Âge : 31', [said('age', ['31'])])).toEqual({ block: '', memory: [] });
    const mine: NoteLineMemory = {
      slot: 'age',
      hash: lineHash('Âge : 31'),
      owner: 'agent',
      corrected: false,
      locked: false,
    };
    expect(plan('Âge : 31', [said('age', ['31'])], [mine]).block).toBe('');
  });

  it('completes a human’s list with what he said and it lacks, without erasing anything', () => {
    const result = plan('Passions : Vélo', [said('hobbies', ['vélo', 'cuisine'])]);
    expect(result.block).toBe('Passions : Vélo, cuisine');
    expect(result.memory[0]).toMatchObject({ owner: 'human', corrected: false, locked: false });
  });

  it('makes a human’s one value more precise when what he said holds it', () => {
    expect(plan('Localisation : Ville A', [said('location', ['Ville A Nord'])]).block).toBe(
      'Localisation : Ville A Nord',
    );
  });

  it('corrects a human’s value he plainly contradicted in the last days, the old value kept on the line', () => {
    const result = plan('Localisation : Ville A', [
      said('location', ['Ville B'], daysAgo(CORRECTION_WINDOW_DAYS)),
    ]);
    expect(result.block).toBe('Localisation : Ville B (avant : Ville A)');
    expect(result.memory[0]).toMatchObject({ owner: 'human', corrected: true, locked: false });
  });

  it('never corrects on an old word, a chatter’s note, or a list', () => {
    expect(
      plan('Localisation : Ville A', [said('location', ['Ville B'], daysAgo(CORRECTION_WINDOW_DAYS + 1))])
        .block,
    ).toBe('');
    const noted: NoteSlotValue = {
      slot: 'location',
      items: ['Ville B'],
      source: 'noted',
      observedAt: daysAgo(1),
    };
    expect(plan('Localisation : Ville A', [noted]).block).toBe('');
    expect(plan('Passions : vélo', [said('hobbies', ['cuisine'])]).block).toBe('Passions : vélo, cuisine');
  });

  it('a correction a human changed afterwards is never corrected again, only completed', () => {
    const corrected: NoteLineMemory = {
      slot: 'location',
      hash: lineHash('Localisation : Ville B (avant : Ville A)'),
      owner: 'human',
      corrected: true,
      locked: false,
    };
    const result = plan('Localisation : Ville A', [said('location', ['Ville C'])], [corrected]);
    expect(result.block).toBe('');
    expect(result.memory).toEqual([{ ...corrected, locked: true }]);
    const later = plan(
      'Localisation : Ville A',
      [said('location', ['Ville D'])],
      [{ ...corrected, locked: true }],
    );
    expect(later.block).toBe('');
  });

  it('a line it corrected, left as it was, is not corrected a second time', () => {
    const line = 'Localisation : Ville B (avant : Ville A)';
    const corrected: NoteLineMemory = {
      slot: 'location',
      hash: lineHash(line),
      owner: 'human',
      corrected: true,
      locked: false,
    };
    expect(plan(line, [said('location', ['Ville C'])], [corrected]).block).toBe('');
  });

  it('a line of its own a human changed becomes his', () => {
    const mine: NoteLineMemory = {
      slot: 'job',
      hash: lineHash('Métier : boulanger'),
      owner: 'agent',
      corrected: false,
      locked: false,
    };
    expect(plan('Métier : pâtissier', [said('job', ['boulanger'], daysAgo(20))], [mine]).block).toBe('');
  });

  it('keeps a value on one line', () => {
    expect(plan('', [said('situation', ['célibataire\nPrénom : piège'])]).block).toBe(
      'Situation : célibataire Prénom : piège',
    );
  });
});

describe('planAgencyNote: the « (avant : …) » of a correction (relecture #775)', () => {
  it('is never taken away by the agent, even when he says more later; only completed lists grow', () => {
    const line = 'Localisation : Ville B (avant : Ville A)';
    const corrected: NoteLineMemory = {
      slot: 'location',
      hash: lineHash(line),
      owner: 'human',
      corrected: true,
      locked: false,
    };
    for (const items of [['Ville B Nord'], ['Ville B (avant : Ville A) et plus'], ['Ville C']]) {
      expect(plan(line, [said('location', items)], [corrected]).block).toBe('');
    }
  });
});

describe('canvasLinesOf', () => {
  it('reads the first line of each label, whatever its case and spaces', () => {
    const lines = canvasLinesOf('prénom: Testeur\nPrénom : Doublon\nlibre : texte\nÂge :');
    expect(lines.get('first_name')).toEqual({ line: 'prénom: Testeur', value: 'Testeur' });
    expect(lines.get('age')?.value).toBe('');
    expect(lines.size).toBe(2);
  });
});
