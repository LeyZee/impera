import { describe, expect, it } from 'vitest';

import { CALENDAR_FEED_PREFIX, CalendarLinkCreatedSchema, CalendarLinkTokenSchema } from './calendar';

const TOKEN = 'a'.repeat(42) + '_';

describe('calendar link (CR-12, ADR 0045 § 5)', () => {
  it('takes a 256-bit base64url token and nothing else', () => {
    expect(CalendarLinkTokenSchema.safeParse(TOKEN).success).toBe(true);
    expect(CalendarLinkTokenSchema.safeParse(TOKEN.slice(1)).success).toBe(false);
    expect(CalendarLinkTokenSchema.safeParse(`${TOKEN.slice(1)}/`).success).toBe(false);
  });

  it('gives the address as a path of the feed, never another one', () => {
    const at = '2026-11-03T08:00:00.000Z';
    expect(
      CalendarLinkCreatedSchema.safeParse({ path: `${CALENDAR_FEED_PREFIX}${TOKEN}.ics`, createdAt: at })
        .success,
    ).toBe(true);
    expect(
      CalendarLinkCreatedSchema.safeParse({ path: `https://example.test/${TOKEN}.ics`, createdAt: at })
        .success,
    ).toBe(false);
  });
});
