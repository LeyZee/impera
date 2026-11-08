import { FAN_CARD_FIELDS, type FanCardEntry, type FanCardValue } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { ageOf, cardError, fieldsOf, groupLine, itemsOf, itemsProblem, sourceLine, valueText } from './model';

const now = new Date('2026-11-08T18:00:00Z');
const value = (patch: Partial<FanCardValue> = {}): FanCardValue => ({
  items: ['Lyon'],
  source: 'declared',
  observedAt: '2026-11-05T18:00:00Z',
  notedBy: null,
  notedByName: null,
  sourceMessageId: null,
  sourceQuote: null,
  ...patch,
});

describe('the fan card (ADR 0085, lot c)', () => {
  it('splits the twenty fields in its three groups, in the card’s order', () => {
    expect(fieldsOf('him')).toHaveLength(13);
    expect(fieldsOf('about_her').map((spec) => spec.field)).toEqual([
      'likes_about_her',
      'dislikes_about_her',
      'outfits',
    ]);
    expect(fieldsOf('intimate')).toHaveLength(4);
    expect(fieldsOf('him').length + fieldsOf('about_her').length + fieldsOf('intimate').length).toBe(
      FAN_CARD_FIELDS.length,
    );
  });

  it('says where a value comes from and how old it is, a guess as a guess', () => {
    expect(sourceLine(value(), now)).toBe('Dit par lui, il y a 3 jours');
    expect(sourceLine(value({ source: 'inferred', observedAt: '2026-11-08T15:00:00Z' }), now)).toBe(
      'Deviné, il y a 3 h',
    );
    expect(sourceLine(value({ source: 'noted', observedAt: '2026-11-07T12:00:00Z' }), now)).toBe(
      'Noté par un chatteur, hier',
    );
    expect(
      sourceLine(value({ source: 'noted', notedByName: 'Léa', observedAt: '2026-11-07T12:00:00Z' }), now),
    ).toBe('Noté par Léa, hier');
    expect(ageOf('2026-11-08T17:59:40Z', now)).toBe('à l’instant');
    expect(ageOf('2026-09-01T18:00:00Z', now)).toBe('il y a 2 mois');
  });

  it('reads a closed value by its label, a list in a row', () => {
    expect(valueText('intensity', ['naughty'])).toBe('Coquin');
    expect(valueText('lead', ['she_leads'])).toBe('Qu’elle mène');
    expect(valueText('outfits', ['lingerie noire', 'cosplay'])).toBe('lingerie noire · cosplay');
  });

  it('counts a group’s known fields and those that wait for a chatter', () => {
    const entries: FanCardEntry[] = [
      { field: 'first_name', current: value({ items: ['Marc'] }), toCheck: [] },
      { field: 'location', current: value({ source: 'noted' }), toCheck: [value({ source: 'inferred' })] },
    ];
    expect(groupLine(entries, 'him')).toEqual({ filled: '2 sur 13', toCheck: 1 });
    expect(groupLine(entries, 'intimate')).toEqual({ filled: '0 sur 4', toCheck: 0 });
  });

  it('takes one line for a one-value field, one item per line for a list, and keeps the save shut when empty', () => {
    expect(itemsOf('  Marc \n', 'one')).toEqual(['Marc']);
    expect(itemsOf('lingerie\n\n cosplay ', 'list')).toEqual(['lingerie', 'cosplay']);
    expect(itemsProblem([])).toBe('Écris une valeur, ou efface la case.');
    expect(itemsProblem(['x'.repeat(301)])).toBe('300 caractères au plus par élément.');
    expect(itemsProblem(['Marc'])).toBeNull();
  });

  it('says a refused value in a chatter’s words, nothing written', () => {
    const body = (code: string): unknown => ({ error: { code, message: 'x', requestId: 'r' } });
    expect(cardError(422, body('fan_card_value_unprocessable'))).toBe(
      'La fiche ne garde ni adresse, ni numéro, ni e‑mail, ni compte ailleurs : rien n’a été écrit.',
    );
    expect(cardError(400, body('fan_card_value_invalid'))).toBe(
      'Cette valeur ne va pas dans cette case : rien n’a été écrit.',
    );
    expect(cardError(0, null)).toBe(
      'Le serveur ne répond pas : rien n’a été écrit. Réessaie dans un instant.',
    );
  });
});
