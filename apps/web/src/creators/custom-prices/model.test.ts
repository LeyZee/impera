import { emptyCustomPriceGrid, quoteCustomOrder } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  changesBetween,
  draftOf,
  eurosOfMinor,
  minorOfEuros,
  newReadyVideo,
  newSupplement,
  percentOf,
  quoteSentence,
  readDraft,
  savedLine,
} from './model';

describe('what the owner types', () => {
  it('reads a price in euros, with a comma or a point, and refuses the rest', () => {
    expect(minorOfEuros('')).toBeNull();
    expect(minorOfEuros('40')).toBe(4_000);
    expect(minorOfEuros('40,5')).toBe(4_050);
    expect(minorOfEuros(' 40.50 € ')).toBe(4_050);
    expect(minorOfEuros('abc')).toBe('invalid');
    expect(minorOfEuros('40,505')).toBe('invalid');
    expect(minorOfEuros('20000')).toBe('invalid');
    expect(eurosOfMinor(4_050)).toBe('40,50');
    expect(eurosOfMinor(4_000)).toBe('40');
  });

  it('reads a percent between 0 and 1000', () => {
    expect(percentOf('50')).toBe(50);
    expect(percentOf('50 %')).toBe(50);
    expect(percentOf('-5')).toBe('invalid');
    expect(percentOf('1001')).toBe('invalid');
  });
});

describe('the videos already shot', () => {
  it('needs a name and a whole range, low end first, at least 1 €', () => {
    const draft = draftOf(emptyCustomPriceGrid());
    const line = newReadyVideo();
    expect(line.id).toMatch(/^rv_[0-9a-f]{8}$/u);
    const typed = { ...draft, readyVideos: [{ ...line, min: '0,50', max: '' }] };
    expect([...readDraft(typed).problems.keys()]).toEqual([
      `${line.id}.label`,
      `${line.id}.min`,
      `${line.id}.max`,
    ]);
    const upside = { ...draft, readyVideos: [{ ...line, label: 'Type A', min: '40', max: '20' }] };
    expect(readDraft(upside).problems.get(`${line.id}.max`)).toBe('Au moins le bas de la fourchette.');
    const good = { ...draft, readyVideos: [{ ...line, label: 'Type A', min: '20', max: '40' }] };
    expect(readDraft(good).grid?.readyVideos).toEqual([
      { id: line.id, label: 'Type A', offered: true, minMinor: 2_000, maxMinor: 4_000 },
    ]);
    expect(changesBetween(draft, good)).toBe(1);
    expect(draftOf(readDraft(good).grid ?? emptyCustomPriceGrid()).readyVideos).toEqual(good.readyVideos);
  });
});

describe('the draft of the grid', () => {
  it('gives back the grid it was made from, and counts no change', () => {
    const grid = emptyCustomPriceGrid();
    const draft = draftOf(grid);
    expect(readDraft(draft).grid).toEqual(grid);
    expect(changesBetween(draft, draft)).toBe(0);
  });

  it('points at each field to fix, and gives no grid until then', () => {
    const draft = draftOf(emptyCustomPriceGrid());
    const typed = {
      formats: draft.formats.map((line) =>
        line.format === 'call' ? { ...line, price: '3,5', minMinutes: '0' } : line,
      ),
      supplements: [...draft.supplements, { ...newSupplement(), percent: '20' }],
      readyVideos: draft.readyVideos,
    };
    const read = readDraft(typed);
    expect(read.grid).toBeNull();
    expect([...read.problems.keys()]).toEqual([
      'call.minMinutes',
      `${typed.supplements.at(-1)?.id ?? ''}.label`,
    ]);
    expect(changesBetween(draft, typed)).toBe(2);
  });

  it('refuses two supplements with the same name', () => {
    const draft = draftOf(emptyCustomPriceGrid());
    const twice = {
      ...draft,
      supplements: [
        ...draft.supplements,
        { ...newSupplement(), label: 'Test A' },
        { ...newSupplement(), label: 'test a' },
      ],
    };
    expect([...readDraft(twice).problems.values()]).toEqual(['Un autre supplément porte déjà ce nom.']);
  });

  it('draws a fresh id each time', () => {
    expect(newSupplement().id).toMatch(/^sup_[0-9a-f]{8}$/u);
    expect(newSupplement().id).not.toBe(newSupplement().id);
  });
});

describe('the calculator sentence', () => {
  it('names the missing lines of an order off the grid, and what she never does', () => {
    const grid = {
      ...emptyCustomPriceGrid(),
      supplements: [{ id: 'sup_0000000a', label: 'Test A', offered: true, percent: null }],
    };
    expect(
      quoteSentence(grid, quoteCustomOrder(grid, { format: 'photo', supplements: ['sup_0000000a'] })),
    ).toBe('Hors grille : Photo pour lui, Test A sans prix. La demande partira à elle sans prix proposé.');
    const never = {
      ...grid,
      formats: grid.formats.map((line) => (line.format === 'call' ? { ...line, offered: false } : line)),
    };
    expect(quoteSentence(never, quoteCustomOrder(never, { format: 'call', supplements: [] }))).toBe(
      'Elle ne le fait pas (Appel) : l’IA déclinera sans lui demander.',
    );
  });

  it('says a grid never saved', () => {
    expect(savedLine(null)).toBe('Jamais enregistrée : remplis les prix, puis enregistre.');
  });
});
