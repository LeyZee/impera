import { describe, expect, it } from 'vitest';

import { otherZones } from './ZoneInput';

describe('otherZones (recette 05/11, PRO-13)', () => {
  it('names each city and its region in French, sorted as French sorts', () => {
    const cities = otherZones(['Europe/Bucharest', 'Africa/Cairo', 'Africa/Accra', 'Indian/Reunion']).map(
      (one) => one.city,
    );
    expect(cities).toEqual([
      'Accra · Afrique',
      'Bucarest · Europe',
      'La Réunion · océan Indien',
      'Le Caire · Afrique',
    ]);
  });

  it('leaves out the aliases, a country’s local zones, and the agency’s own zones listed first', () => {
    const zones = otherZones([
      'UTC',
      'Etc/GMT+1',
      'US/Eastern',
      'America/Indiana/Knox',
      'America/Argentina/Salta',
      'Europe/Paris',
      'America/Chicago',
    ]).map((one) => one.zone);
    expect(zones).toEqual(['America/Chicago']);
  });

  it('shows no English region in what the browser offers', () => {
    const regions = new Set(
      otherZones(Intl.supportedValuesOf('timeZone')).map((one) => one.city.split(' · ')[1]),
    );
    for (const english of ['Africa', 'America', 'Asia', 'Indian', 'Pacific', 'Atlantic', 'Australia']) {
      expect(regions.has(english)).toBe(false);
    }
  });
});
