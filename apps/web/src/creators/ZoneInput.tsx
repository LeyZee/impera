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

/** « Tokyo · Asia »: a city read as one, its region beside it, for every other zone the browser knows. */
const OTHERS: readonly { readonly zone: string; readonly city: string }[] = Intl.supportedValuesOf('timeZone')
  .filter((zone) => !FIRST_ZONES.has(zone))
  .map((zone) => {
    const region = zone.includes('/') ? zone.split('/')[0] : undefined;
    return { zone, city: region === undefined ? cityOf(zone) : `${cityOf(zone)} · ${region}` };
  })
  .toSorted((a, b) => a.city.localeCompare(b.city, 'fr'));

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
