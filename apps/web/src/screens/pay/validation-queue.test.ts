// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  answeredValidation,
  cutText,
  cutValidations,
  endValidations,
  queueValidations,
} from './validation-queue';

/** Invented ids: nothing real. */
const PERIOD = '2026-11-01';
const rows = [
  { id: 'a', status: 'validated' as const },
  { id: 'b', status: 'validated' as const },
  { id: 'c', status: 'draft' as const },
];

afterEach(() => {
  window.sessionStorage.clear();
});

describe('a batch of validations the page was left during (recette COUV-13)', () => {
  it('says what a cut batch left still to validate, once', () => {
    queueValidations(PERIOD, ['a', 'b', 'c']);
    answeredValidation('a');
    // Left here: « b » went out but its answer never came; the period read again says it validated.
    expect(cutValidations('2026-11-16', rows)).toBeNull();
    expect(cutValidations(PERIOD, rows)).toBe(1);
    expect(cutValidations(PERIOD, rows)).toBeNull();
    expect(cutText(1)).toMatch(/^1 relevé n’a pas été validé/u);
    expect(cutText(2)).toMatch(/^2 relevés n’ont pas été validés/u);
  });

  it('says nothing after a batch that ran to its end', () => {
    queueValidations(PERIOD, ['a', 'b', 'c']);
    endValidations();
    expect(cutValidations(PERIOD, rows)).toBeNull();
  });
});
