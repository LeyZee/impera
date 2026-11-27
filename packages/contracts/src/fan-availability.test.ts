import { describe, expect, it } from 'vitest';

import { FanAvailabilityRecordSchema, FREE_SEXTING_SESSIONS_KEPT } from './fan-availability';

const RECORD = {
  state: 'unknown',
  signal: null,
  at: null,
  expiresAt: null,
  seen: [],
  sexualizedAt: null,
  askedAt: null,
  hotAt: null,
};

describe('FanAvailabilityRecordSchema, what the conversation keeps per fan (26/11)', () => {
  it('reads a record written before the work tease and the sexting without a sale', () => {
    expect(FanAvailabilityRecordSchema.parse(RECORD)).toEqual(RECORD);
  });

  it('keeps the work tease and the draw of the session, dates read back from the journal', () => {
    const parsed = FanAvailabilityRecordSchema.parse({
      ...RECORD,
      workTease: { startedAt: '2026-11-26T10:00:00.000Z', bitAt: null, stoppedAt: null },
      freeSexting: {
        sessionAt: '2026-11-26T21:00:00.000Z',
        noSale: true,
        noSaleSessions: ['2026-11-26T21:00:00.000Z'],
      },
    });
    expect(parsed.workTease?.startedAt).toEqual(new Date('2026-11-26T10:00:00.000Z'));
    expect(parsed.freeSexting?.noSaleSessions).toEqual([new Date('2026-11-26T21:00:00.000Z')]);
  });

  it('keeps only the last few sessions without a sale', () => {
    const many = Array.from({ length: FREE_SEXTING_SESSIONS_KEPT + 1 }, () => '2026-11-26T21:00:00.000Z');
    const result = FanAvailabilityRecordSchema.safeParse({
      ...RECORD,
      freeSexting: { sessionAt: '2026-11-26T21:00:00.000Z', noSale: false, noSaleSessions: many },
    });
    expect(result.success).toBe(false);
  });
});
