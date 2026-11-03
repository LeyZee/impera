import { describe, expect, it } from 'vitest';

import { escapeText, feedWindow, foldLine, icsOf } from '../calendar-feed';

const encoder = new TextEncoder();

describe('calendar feed (CR-12, RFC 5545)', () => {
  it('escapes what TEXT values must', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  it('folds at 75 octets, never inside a character, the next lines opening with a space', () => {
    const line = `DESCRIPTION:${'é'.repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((part) => part.startsWith(' '))).toBe(true);
    expect(parts.map((part, index) => (index === 0 ? part : part.slice(1))).join('')).toBe(line);
    expect(foldLine('SUMMARY:court')).toBe('SUMMARY:court');
  });

  it('writes one event per shift in UTC, with CRLF ends, and nothing but the slot, the creator and the name', () => {
    const ics = icsOf({
      name: 'Impera · mes shifts',
      stamp: new Date('2026-11-03T08:00:00Z'),
      events: [
        {
          uid: 'abc@nirvana',
          startsAt: new Date('2026-11-04T11:00:00Z'),
          endsAt: new Date('2026-11-04T17:00:00Z'),
          summary: 'Shift · Anna',
          description: 'Théo sur Anna',
        },
      ],
    });
    expect(ics.split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Impera//Shifts//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'NAME:Impera · mes shifts',
      'X-WR-CALNAME:Impera · mes shifts',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
      'BEGIN:VEVENT',
      'UID:abc@nirvana',
      'DTSTAMP:20261103T080000Z',
      'DTSTART:20261104T110000Z',
      'DTEND:20261104T170000Z',
      'SUMMARY:Shift · Anna',
      'DESCRIPTION:Théo sur Anna',
      'TRANSP:OPAQUE',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
    expect(ics.replace(/\r\n/gu, '')).not.toMatch(/\n|\r/u);
  });

  it('reads 42 days around now at most, what calendar_shifts accepts', () => {
    const window = feedWindow(new Date('2026-11-03T08:00:00Z'));
    expect(window.to.getTime() - window.from.getTime()).toBe(42 * 86_400_000);
    expect(window.from.toISOString()).toBe('2026-10-20T08:00:00.000Z');
  });
});
