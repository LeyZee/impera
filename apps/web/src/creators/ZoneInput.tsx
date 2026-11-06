import { type JSX } from 'react';

import { cityOf } from '@/scheduling/time';
import { Select, type SelectOption } from '@/shell/Select';

/** Where a new creator lives unless the owner says otherwise. */
export const DEFAULT_ZONE = 'Europe/Paris';

/** What a zone the server does not know reads as, at her creation and when she moves. */
export const UNKNOWN_ZONE = 'Ce fuseau n’existe pas. Choisis une ville dans la liste.';

/**
 * The zones the agency works with, first. Each reads as `cityOf` names it everywhere else, a city of the same hour that
 * has no zone of its own beside it: « Toronto (Montréal) », never « Montréal » then « Toronto » (CREA-27).
 */
const FIRST: readonly { readonly zone: string; readonly city: string }[] = [
  { zone: 'Europe/Paris', city: cityOf('Europe/Paris') },
  { zone: 'Europe/Brussels', city: cityOf('Europe/Brussels') },
  { zone: 'Europe/Zurich', city: `${cityOf('Europe/Zurich')} (Genève)` },
  { zone: 'America/Toronto', city: `${cityOf('America/Toronto')} (Montréal)` },
  { zone: 'Africa/Porto-Novo', city: cityOf('Africa/Porto-Novo') },
  { zone: 'Africa/Abidjan', city: cityOf('Africa/Abidjan') },
  { zone: 'Africa/Dakar', city: cityOf('Africa/Dakar') },
  { zone: 'Africa/Lome', city: cityOf('Africa/Lome') },
  { zone: 'Indian/Antananarivo', city: cityOf('Indian/Antananarivo') },
];
const FIRST_ZONES: ReadonlySet<string> = new Set(FIRST.map((one) => one.zone));

/** The regions of the zones, in French: « Monterrey · Amérique », never « · America » (recette #566, PRO-13). */
const REGIONS: ReadonlyMap<string, string> = new Map([
  ['Africa', 'Afrique'],
  ['America', 'Amérique'],
  ['Antarctica', 'Antarctique'],
  ['Arctic', 'Arctique'],
  ['Asia', 'Asie'],
  ['Atlantic', 'Atlantique'],
  ['Australia', 'Australie'],
  ['Europe', 'Europe'],
  ['Indian', 'océan Indien'],
  ['Pacific', 'Pacifique'],
]);

/**
 * « Tokyo · Asie », « Le Caire · Afrique »: a city in French, its region beside it, for every other zone the browser
 * knows. Neither aliases (« UTC », « Etc/GMT+1 », « US/Eastern ») nor a country's local zones (« America/Indiana/Knox »,
 * « America/Argentina/Salta »): a city of a region, once (PRO-13).
 */
export function otherZones(
  zones: readonly string[],
): readonly { readonly zone: string; readonly city: string }[] {
  return zones
    .filter((zone) => !FIRST_ZONES.has(zone))
    .flatMap((zone) => {
      const parts = zone.split('/');
      const region = parts.length === 2 ? REGIONS.get(parts[0] ?? '') : undefined;
      return region === undefined ? [] : [{ zone, city: `${cityOf(zone)} · ${region}` }];
    })
    .toSorted((a, b) => a.city.localeCompare(b.city, 'fr'));
}
const OTHERS = otherZones(Intl.supportedValuesOf('timeZone'));

const ZONE_OPTIONS: readonly SelectOption<string>[] = [
  ...FIRST.map((one) => ({ value: one.zone, label: one.city, group: 'Les plus courantes' })),
  ...OTHERS.map((one) => ({ value: one.zone, label: one.city, group: 'Toutes les villes' })),
];

/**
 * A creator's zone, chosen by city (« Paris », « Toronto (Montréal) ») with the zone kept behind it (CREA-27): never an
 * identifier to type. A zone she already has outside the list shows as it is. Used at creation and to move her.
 */
export function ZoneInput({
  id,
  value,
  onChange,
  invalid = false,
}: {
  id: string;
  value: string;
  onChange: (zone: string) => void;
  invalid?: boolean;
}): JSX.Element {
  return (
    <Select
      id={id}
      value={value}
      invalid={invalid}
      options={ZONE_OPTIONS}
      placeholder="Choisir une ville…"
      searchLabel="Chercher une ville"
      empty="Aucune ville ne correspond."
      onChange={onChange}
    />
  );
}
