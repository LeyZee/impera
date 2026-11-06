import { describe, expect, it } from 'vitest';

import { fileOf, scriptSegments } from './fixtures';
import { cardDone, cardMeta, fileOfSlot, progressOf, scriptCards, slotLine } from './script-model';

describe('her script, card by card (SC-02 lot b2)', () => {
  it('gives one screen per card, a stage with variants one per series, in the script’s order', () => {
    const cards = scriptCards(scriptSegments);
    expect(cards.map((card) => [card.code, card.title, card.detail, card.slots.length])).toEqual([
      ['E1', 'Salon', 'Elle se dévoile un peu', 2],
      ['P12', 'Pont vers Chambre', 'La suite est dans la chambre', 1],
      ['E2A', 'Chambre', 'Série A · Lumière tamisée', 1],
      ['E2B', 'Chambre', 'Série B · Plein jour', 1],
    ]);
    expect(cards.map((card) => card.slots.map((slot) => slot.key))).toEqual([
      ['salon::0', 'salon::1'],
      ['pont::0'],
      ['chambre:A:0'],
      ['chambre:B:0'],
    ]);
  });

  it('counts the slots she may not leave out, a refused file as empty, one still going up as filled', () => {
    const cards = scriptCards(scriptSegments);
    expect(progressOf(cards, [])).toEqual({ filled: 0, required: 4 });
    const files = [
      fileOf({ slotKey: 'salon::0', state: 'awaiting' }),
      fileOf({ slotKey: 'pont::0', state: 'refused', refusal: 'Ce fichier est abîmé' }),
      fileOf({ slotKey: 'chambre:A:0', kind: 'audio', mime: 'audio/mpeg', state: 'kept' }),
    ];
    expect(progressOf(cards, files)).toEqual({ filled: 2, required: 4 });
    expect(cards.map((card) => cardDone(card, files))).toEqual([true, false, true, false]);
    expect(fileOfSlot(files, 'salon::1')).toBeUndefined();
    expect(cards.map((card) => cardMeta(card, files))).toEqual([
      '1 / 1 média · 1 facultatif',
      '0 / 1 média',
      '1 / 1 média',
      '0 / 1 média',
    ]);
  });

  it('says what each slot waits for, in her words', () => {
    expect(slotLine({ kind: 'image', optional: false, hint: null })).toBe('Photo');
    expect(slotLine({ kind: 'video', optional: true, hint: null, minSeconds: 5, maxSeconds: 20 })).toBe(
      'Vidéo · 5 à 20 s · facultatif',
    );
    expect(slotLine({ kind: 'audio', optional: false, hint: null, maxSeconds: 30 })).toBe(
      'Vocal · 30 s au plus',
    );
  });
});
