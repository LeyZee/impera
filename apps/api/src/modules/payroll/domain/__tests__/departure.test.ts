import { DomainError, PayPeriodSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { assertDocumentsSettled, closingPeriodOf, finalFor } from '../departure';

const period = (value: string) => PayPeriodSchema.parse(value);

describe('the closing fortnight of a member who left (EQ-14, ADR 0039 § 6)', () => {
  it('is the period after the one that holds the day he left', () => {
    expect(closingPeriodOf('2025-07-03')).toBe('2025-07-16');
    expect(closingPeriodOf('2025-07-15')).toBe('2025-07-16');
    expect(closingPeriodOf('2025-07-16')).toBe('2025-08-01');
    expect(closingPeriodOf('2025-07-31')).toBe('2025-08-01');
    expect(closingPeriodOf('2025-12-20')).toBe('2026-01-01');
  });

  it('does not exist while he has not left', () => {
    expect(closingPeriodOf(null)).toBeNull();
    expect(finalFor(null, period('2025-07-16'))).toBe(false);
  });

  it('makes each statement of his final from it on, never before: the departure fortnight is an ordinary one', () => {
    expect(finalFor('2025-07-03', period('2025-07-01'))).toBe(false);
    expect(finalFor('2025-07-03', period('2025-06-16'))).toBe(false);
    expect(finalFor('2025-07-03', period('2025-07-16'))).toBe(true);
    expect(finalFor('2025-07-03', period('2025-09-01'))).toBe(true);
  });
});

describe('a final statement and the documents still open (ADR 0039 § 6)', () => {
  it('is validated once none of the member’s documents awaits an answer or stays contested', () => {
    expect(() => {
      assertDocumentsSettled(true, 0);
    }).not.toThrow();
  });

  it('is refused while one is open, and says how many', () => {
    try {
      assertDocumentsSettled(true, 2);
      throw new Error('no error');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        code: 'commission_statement_documents_open_conflict',
        details: { count: 2 },
      });
    }
  });

  it('never holds back a statement that is not final', () => {
    expect(() => {
      assertDocumentsSettled(false, 3);
    }).not.toThrow();
  });
});
