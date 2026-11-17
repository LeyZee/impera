import { DEVICE_TIME_ZONE_PATTERN, OwnTimeZoneSchema, type Me } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { MEMBERS_KEY } from '@/screens/team/api';

/*
 * A member's record takes the zone of the phone the app opens on (recette CHT-01, Charles 16/11): his planning, the
 * reminder of a report and « Mes chiffres » then speak the hour he lives in. Display only: pay, its fortnights and its
 * thresholds keep the agency's zone, a shift keeps its instants. The owner keeps the agency's zone, and a creator's
 * record does not follow: her screens read the phone's hour themselves.
 */

/** The zone this device gives, when it is a place of the IANA regions; `null` for `Etc/`, `UTC` or nothing. */
export function deviceZone(
  read: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | null {
  try {
    const zone = read();
    return zone.length <= 64 && DEVICE_TIME_ZONE_PATTERN.test(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** Sends it for the member's own record: the zone the record keeps, or `null` when it could not be said. */
export async function followDeviceZone(zone: string): Promise<string | null> {
  try {
    const response = await fetch('/v1/team/me/time-zone', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeZone: zone }),
    });
    if (!response.ok) return null;
    return OwnTimeZoneSchema.parse(await response.json()).timeZone;
  } catch {
    // Offline, or a server that does not answer: the record keeps its zone until the next opening.
    return null;
  }
}

/** Whether this account's record follows the phone: a member of the team, not the owner nor a creator. */
export const followsDevice = (user: Me): boolean =>
  user.role === 'operator' && user.team !== null && user.team.status !== 'left';

/**
 * Once per opening: the zone of the phone for the member's record, and the team read again when the record took it.
 * Nothing is sent when the device gives no place (`UTC`, `Etc/…`), and the server writes nothing when it is his
 * already.
 */
export function useFollowDeviceZone(user: Me, read?: () => string): void {
  const client = useQueryClient();
  const sent = useRef(false);
  const follows = followsDevice(user);
  useEffect(() => {
    if (!follows || sent.current) return;
    const zone = deviceZone(read);
    if (zone === null) return;
    sent.current = true;
    void followDeviceZone(zone).then(async (kept) => {
      if (kept === zone) await client.invalidateQueries({ queryKey: MEMBERS_KEY });
    });
  }, [follows, read, client]);
}
