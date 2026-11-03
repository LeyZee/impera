import { describe, expect, it } from 'vitest';

import { feedAddresses } from './calendar-link';

const PATH = `/v1/calendar-feed/${'a'.repeat(43)}.ics`;

describe('feedAddresses (CR-12)', () => {
  it('gives the https address, its webcal twin for Apple, and Google’s subscription link', () => {
    const addresses = feedAddresses(PATH, 'https://crm.example.test');
    expect(addresses.https).toBe(`https://crm.example.test${PATH}`);
    expect(addresses.webcal).toBe(`webcal://crm.example.test${PATH}`);
    expect(addresses.google).toBe(
      `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(`webcal://crm.example.test${PATH}`)}`,
    );
  });

  it('keeps a port of a local origin', () => {
    expect(feedAddresses(PATH, 'http://localhost:5173').webcal).toBe(`webcal://localhost:5173${PATH}`);
  });
});
