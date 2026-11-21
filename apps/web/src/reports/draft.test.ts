// @vitest-environment jsdom
import { ShiftReportIdSchema } from '@impera/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dropDraft, keepDraft, keptDraft } from './draft';

/* Invented ids (ADR 0010). */
const SHIFT = '0199f2a0-0000-7000-8000-000000000101';
const DRAFT = {
  id: ShiftReportIdSchema.parse('0199f2a0-0000-7000-8000-000000000400'),
  correcting: false,
  amount: '120,50',
  comment: 'Un pack a plu',
  incidentOn: false,
  incident: '',
};
const NEW = { reportId: null, version: null };
const NOW = Date.parse('2026-10-28T00:00:00Z');

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('a report typed and not sent (recette 16/11, CHT-29)', () => {
  it('is given back as it was typed, on the same shift and kind only', () => {
    keepDraft(SHIFT, DRAFT, NEW, NOW);
    expect(keptDraft(SHIFT, false, NEW, NOW + 60_000)).toEqual(DRAFT);
    expect(keptDraft(SHIFT, true, NEW, NOW)).toBeNull();
    expect(keptDraft('0199f2a0-0000-7000-8000-000000000102', false, NEW, NOW)).toBeNull();
    keepDraft(SHIFT, { ...DRAFT, explanation: 'Une vente avant le shift' }, NEW, NOW);
    expect(keptDraft(SHIFT, false, NEW, NOW)?.explanation).toBe('Une vente avant le shift');
  });

  it('is forgotten once sent, after two days, or once the server holds another version', () => {
    keepDraft(SHIFT, DRAFT, NEW, NOW);
    dropDraft(SHIFT, false);
    expect(keptDraft(SHIFT, false, NEW, NOW)).toBeNull();

    keepDraft(SHIFT, DRAFT, NEW, NOW);
    expect(keptDraft(SHIFT, false, NEW, NOW + 2 * 86_400_000 + 1)).toBeNull();
    expect(localStorage.length).toBe(0);

    const sent = { reportId: '0199f2a0-0000-7000-8000-000000000301', version: 1 };
    keepDraft(SHIFT, DRAFT, sent, NOW);
    expect(keptDraft(SHIFT, false, { ...sent, version: 2 }, NOW)).toBeNull();
    // A draft of a new report is not laid over a report sent since from another device.
    keepDraft(SHIFT, DRAFT, NEW, NOW);
    expect(keptDraft(SHIFT, false, sent, NOW)).toBeNull();
  });

  it('reads nothing it cannot trust, and works without storage', () => {
    localStorage.setItem(`impera.report-draft.${SHIFT}.report`, '{"at":"hier"}');
    expect(keptDraft(SHIFT, false, NEW, NOW)).toBeNull();
    localStorage.setItem(`impera.report-draft.${SHIFT}.report`, 'pas du json');
    expect(keptDraft(SHIFT, false, NEW, NOW)).toBeNull();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => {
      keepDraft(SHIFT, DRAFT, NEW, NOW);
    }).not.toThrow();
    expect(keptDraft(SHIFT, false, NEW, NOW)).toBeNull();
  });
});
