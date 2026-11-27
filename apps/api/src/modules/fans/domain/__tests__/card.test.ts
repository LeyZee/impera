import { MessageIdSchema, UserIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  cardOf,
  checkedValue,
  itemsOf,
  neverKept,
  planCardEdit,
  planOtherRetraction,
  quoteOf,
} from '../card';
import { FanCardOtherNotFound, FanCardValueInvalid, FanCardValueRefused } from '../errors';
import { kycSlotsToLearn, planFacts, selectActiveFacts, type FactProposal, type StoredFact } from '../facts';

const chatter = UserIdSchema.parse('00000000-0000-4000-8000-0000000000c1');
const message = MessageIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
const may = new Date('2026-05-10T10:00:00Z');
const june = new Date('2026-06-10T10:00:00Z');
const august = new Date('2026-08-10T10:00:00Z');
const now = new Date('2026-09-01T10:00:00Z');

const stored = (over: Partial<StoredFact> = {}): StoredFact => ({
  id: 'f-1',
  category: 'identity',
  key: 'location',
  value: 'Lyon',
  kind: 'declared',
  confidence: 0.9,
  sourceMessageId: message,
  observedAt: may,
  expiresAt: null,
  supersededBy: null,
  notedBy: null,
  ...over,
});

const note = (over: Partial<StoredFact> = {}): StoredFact =>
  stored({
    id: 'n-1',
    kind: 'noted',
    value: 'Annecy',
    notedBy: chatter,
    sourceMessageId: null,
    observedAt: june,
    ...over,
  });

const proposal = (over: Partial<FactProposal> = {}): FactProposal => ({
  category: 'identity',
  key: 'location',
  value: 'Grenoble',
  kind: 'declared',
  confidence: 0.9,
  sourceMessageId: message,
  observedAt: august,
  ...over,
});

describe('a value of the card (ADR 0085 § 3, § 8)', () => {
  it('keeps a list as items, a one-value field as one item', () => {
    expect(checkedValue('outfits', ['Lingerie rouge', 'Cosplay'])).toBe('Lingerie rouge · Cosplay');
    expect(itemsOf('outfits', 'Lingerie rouge · Cosplay')).toEqual(['Lingerie rouge', 'Cosplay']);
    expect(itemsOf('situation', 'Marié · deux enfants')).toEqual(['Marié · deux enfants']);
  });

  it('refuses a list for one value, a value outside a closed list, a line too long', () => {
    expect(() => checkedValue('first_name', ['Basile', 'Bas'])).toThrow(FanCardValueInvalid);
    expect(() => checkedValue('intensity', ['très hard'])).toThrow(FanCardValueInvalid);
    expect(checkedValue('intensity', ['naughty'])).toBe('naughty');
    expect(() => checkedValue('lead', ['dominant'])).toThrow(FanCardValueInvalid);
    expect(() => checkedValue('hobbies', ['x'.repeat(200), 'y'.repeat(200)])).toThrow(FanCardValueInvalid);
  });

  it('keeps his age as a whole number of years, in digits (recette AGE-13)', () => {
    expect(checkedValue('age', ['25'])).toBe('25');
    expect(checkedValue('age', [' 32 ans '])).toBe('32');
    expect(checkedValue('age', ['17'])).toBe('17');
    for (const value of ['-5', '25,5', '25.5', 'vingt', '0', '120', 'la trentaine']) {
      expect(() => checkedValue('age', [value]), value).toThrow(FanCardValueInvalid);
    }
  });

  it('never keeps what finds him outside the platform', () => {
    for (const value of [
      'basile@example.test',
      '06 12 34 56 78',
      'www.exemple.test',
      'son insta @basile.demo',
      'il est sur Snap',
    ]) {
      expect(neverKept(value), value).toBe(true);
    }
    expect(neverKept('Lyon, il bosse de nuit')).toBe(false);
    expect(() => checkedValue('location', ['12 rue Inventée, 06 12 34 56 78'])).toThrow(FanCardValueRefused);
  });
});

describe('a chatter writes a field (§ 6)', () => {
  it('writes a noted line in the field’s category, superseding every active fact of the field', () => {
    const before = [stored(), stored({ id: 'f-2', category: 'life', observedAt: august })];
    const [write] = planCardEdit('location', { items: ['Annecy'] }, before, [], chatter, now);
    expect(write).toEqual({
      fact: {
        category: 'identity',
        key: 'location',
        value: 'Annecy',
        kind: 'noted',
        confidence: 1,
        sourceMessageId: null,
        observedAt: now,
        expiresAt: null,
        notedBy: chatter,
      },
      supersedes: 'f-2',
      alsoSupersedes: ['f-1'],
    });
  });

  it('clears a field with an empty noted line, and does nothing on an empty field', () => {
    expect(planCardEdit('location', { clear: true }, [stored()], [], chatter, now)[0]?.fact.value).toBe('');
    expect(planCardEdit('pets', { clear: true }, [stored()], [], chatter, now)).toEqual([]);
  });

  it('is idempotent, unless a value waits under the note: writing it again settles it', () => {
    const noted = note();
    expect(planCardEdit('location', { items: ['Annecy'] }, [noted], [], chatter, now)).toEqual([]);
    const waiting = stored({ id: 'p-1', value: 'Grenoble', observedAt: august, supersededBy: noted.id });
    expect(planCardEdit('location', { items: ['Annecy'] }, [noted], [waiting], chatter, now)).toHaveLength(1);
  });
});

describe('the AI against a chatter’s note (§ 6)', () => {
  it('never replaces it: another value waits « à vérifier », once', () => {
    const noted = note();
    const [write] = planFacts([noted], [proposal()], now);
    expect(write).toMatchObject({ fact: { value: 'Grenoble' }, supersedes: null, overriddenBy: noted.id });
    const waiting = stored({ id: 'p-1', value: 'Grenoble', observedAt: august, supersededBy: noted.id });
    expect(planFacts([noted], [proposal()], now, [waiting])).toEqual([]);
    expect(planFacts([noted], [proposal({ value: 'annecy' })], now)).toEqual([]);
  });

  it('leaves a chatter’s hand-back note a note, whatever its key: it fills no field', () => {
    const handBack = proposal({ category: 'operator_note', key: 'first_name', value: 'Prénom à demander' });
    const [write] = planFacts([], [handBack], now);
    expect(write?.fact.category).toBe('operator_note');
    expect(
      kycSlotsToLearn(['first_name'], [stored({ category: 'operator_note', key: 'first_name' })], now),
    ).toEqual(['first_name']);
    const card = cardOf(
      [stored({ category: 'operator_note', key: 'first_name', value: 'À demander' })],
      [],
      now,
    );
    expect(card.fields.find((entry) => entry.field === 'first_name')?.current).toBeNull();
    expect(card.others.map((other) => other.value)).toEqual(['À demander']);
  });

  it('writes a card field in its card category, one slot whatever the category it is proposed under', () => {
    const [write] = planFacts([stored()], [proposal({ category: 'life' })], now);
    expect(write).toMatchObject({ fact: { category: 'identity', value: 'Grenoble' }, supersedes: 'f-1' });
  });
});

describe('the card as it reads (§ 3, § 5)', () => {
  it('shows each field in order: the strongest source, what waits under a note, then « Autres »', () => {
    const noted = note();
    const waiting = stored({
      id: 'p-1',
      value: 'Grenoble',
      kind: 'inferred',
      observedAt: august,
      supersededBy: noted.id,
    });
    const older = stored({ id: 'p-0', value: 'Lyon', observedAt: may, supersededBy: noted.id });
    const card = cardOf(
      [
        noted,
        stored({
          id: 'o-1',
          category: 'operator_note',
          key: 'note_1',
          value: 'Aime qu’on le taquine',
          observedAt: august,
        }),
        stored({ id: 'h-1', category: 'interests', key: 'Hobbies', value: 'Rugby · Jeux vidéo' }),
      ],
      [waiting, older],
      now,
      new Map([[chatter, 'Léa']]),
    );
    expect(card.fields.map((entry) => entry.field)[0]).toBe('first_name');
    expect(card.fields.find((entry) => entry.field === 'location')).toEqual({
      field: 'location',
      current: {
        items: ['Annecy'],
        source: 'noted',
        observedAt: june,
        notedBy: chatter,
        notedByName: 'Léa',
        sourceMessageId: null,
      },
      toCheck: [
        {
          items: ['Grenoble'],
          source: 'inferred',
          observedAt: august,
          notedBy: null,
          notedByName: null,
          sourceMessageId: message,
        },
      ],
    });
    expect(card.fields.find((entry) => entry.field === 'hobbies')?.current?.items).toEqual([
      'Rugby',
      'Jeux vidéo',
    ]);
    expect(card.others).toEqual([
      {
        factId: 'o-1',
        key: 'note_1',
        value: 'Aime qu’on le taquine',
        source: 'noted',
        observedAt: august,
        notedBy: null,
        notedByName: null,
      },
    ]);
  });

  it('shows a cleared field empty', () => {
    const card = cardOf([note({ value: '' })], [], now);
    expect(card.fields.find((entry) => entry.field === 'location')?.current).toBeNull();
  });
});

describe('the quote of his message (§ 5)', () => {
  it('keeps his words on one line, cut with an ellipsis, and nothing for a media alone', () => {
    expect(quoteOf('  je suis\n  à Lyon  ')).toBe('je suis à Lyon');
    const long = quoteOf('a'.repeat(250));
    expect(long).toHaveLength(200);
    expect(long?.endsWith('…')).toBe(true);
    expect(quoteOf(' \n ')).toBeNull();
  });
});

describe('a cleared field', () => {
  it('is never read as a value: not in the context, and to learn again', () => {
    const cleared = note({ value: '' });
    expect(selectActiveFacts([cleared], now)).toEqual([]);
    expect(kycSlotsToLearn(['location', 'age'], [cleared], now)).toEqual(['location', 'age']);
  });
});

describe('« Autres »: its author, and « Retirer » (trou béant 17)', () => {
  const handBack = note({
    id: 'o-2',
    category: 'operator_note',
    key: 'note_2',
    value: 'Ne jamais parler de sa femme',
  });
  const retired = UserIdSchema.parse('00000000-0000-4000-8000-0000000000c2');

  it('names who left a note at the hand-back', () => {
    expect(cardOf([handBack], [], now, new Map([[chatter, 'Léa']])).others).toEqual([
      expect.objectContaining({ factId: 'o-2', source: 'noted', notedBy: chatter, notedByName: 'Léa' }),
    ]);
  });

  it('a note left with its author is kept noted in their name, and a replay writes nothing', () => {
    const written = planFacts(
      [],
      [proposal({ category: 'operator_note', key: 'note_2', notedBy: chatter })],
      now,
    );
    expect(written.map(({ fact }) => [fact.kind, fact.notedBy])).toEqual([['noted', chatter]]);
    const replay = planFacts(
      [note({ id: 'o-2', category: 'operator_note', key: 'note_2', value: 'Grenoble', observedAt: august })],
      [proposal({ category: 'operator_note', key: 'note_2', notedBy: chatter })],
      now,
    );
    expect(replay).toEqual([]);
  });

  it('retracts a line with an empty line in the name of who retracts, that the AI no longer reads', () => {
    const [write, ...rest] = planOtherRetraction('o-2', [handBack], retired, now);
    expect(rest).toEqual([]);
    expect(write).toEqual({
      fact: {
        category: 'operator_note',
        key: 'note_2',
        value: '',
        kind: 'noted',
        confidence: 1,
        sourceMessageId: null,
        observedAt: now,
        expiresAt: null,
        notedBy: retired,
      },
      supersedes: 'o-2',
    });
    const after = [
      { ...handBack, supersededBy: 'r-1' },
      { ...(write?.fact ?? handBack), id: 'r-1', supersededBy: null },
    ];
    expect(cardOf(after, [], now).others).toEqual([]);
    expect(selectActiveFacts(after, now)).toEqual([]);
  });

  it('retracts a fact the AI kept off the fields, never a field nor a line retracted already', () => {
    const job = stored({ id: 'x-1', category: 'interests', key: 'collection', value: 'Montres anciennes' });
    expect(planOtherRetraction('x-1', [job], retired, now)[0]?.supersedes).toBe('x-1');
    expect(() => planOtherRetraction('f-1', [stored()], retired, now)).toThrow(FanCardOtherNotFound);
    expect(() => planOtherRetraction('o-2', [{ ...handBack, value: '' }], retired, now)).toThrow(
      FanCardOtherNotFound,
    );
    expect(() => planOtherRetraction('absent', [handBack], retired, now)).toThrow(FanCardOtherNotFound);
  });
});
