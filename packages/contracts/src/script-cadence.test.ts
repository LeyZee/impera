import { describe, expect, it } from 'vitest';

import { nextScriptDue, ScriptCadenceDaysSchema } from './scripts';

describe('the due day of her next script (SC-02)', () => {
  it('asks the first one a week ahead', () => {
    expect(nextScriptDue(null, 14, '2026-11-05')).toBe('2026-11-12');
  });

  it('asks each next one `days` after the last, a week before it is due', () => {
    expect(nextScriptDue('2026-11-12', 14, '2026-11-18')).toBeNull();
    expect(nextScriptDue('2026-11-12', 14, '2026-11-19')).toBe('2026-11-26');
    expect(nextScriptDue('2026-11-12', 14, '2026-11-25')).toBe('2026-11-26');
  });

  it('asks no further ahead than the cadence itself', () => {
    expect(nextScriptDue(null, 3, '2026-11-05')).toBe('2026-11-08');
    expect(nextScriptDue('2026-11-08', 3, '2026-11-07')).toBeNull();
    expect(nextScriptDue('2026-11-08', 3, '2026-11-08')).toBe('2026-11-11');
  });

  it('starts again from today after a pause, never with a request already late', () => {
    expect(nextScriptDue('2026-10-01', 14, '2026-11-05')).toBe('2026-11-12');
  });

  it('crosses months and years', () => {
    expect(nextScriptDue('2026-12-25', 14, '2027-01-01')).toBe('2027-01-08');
  });

  it('keeps the cadence between 1 and 90 days', () => {
    expect(ScriptCadenceDaysSchema.safeParse(0).success).toBe(false);
    expect(ScriptCadenceDaysSchema.safeParse(91).success).toBe(false);
    expect(ScriptCadenceDaysSchema.safeParse(14).success).toBe(true);
  });
});
