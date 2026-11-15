import type { CreatorAgenda } from '@impera/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useMemo, type JSX } from 'react';

import { freshnessOf, readAtWords } from './freshness';
import { rangeKey, snapshotAtOf } from './offline';

import { useOnline } from '@/pwa/online';

/**
 * What her screen says of the agenda it shows when that is not the server's fresh answer (CRE-02): « Mise à jour… » under
 * the title while her kept copy is read again; amber, with the copy's age, when it cannot be: « Hors ligne » without a
 * network, « Le serveur ne répond pas » and « Réessayer » with one. Agenda and Aujourd'hui say it the same way.
 */
export function FreshnessNote({
  read,
  from,
  to,
  waiting = null,
}: {
  read: UseQueryResult<CreatorAgenda>;
  from: string;
  to: string;
  /** Her ticks not sent yet, where the screen sends them (Agenda); `null` where it does not say (Aujourd'hui). */
  waiting?: number | null;
}): JSX.Element | null {
  const online = useOnline();
  const range = rangeKey(from, to);
  // Read again from the phone each time an answer lands: the copy's age moves with it.
  const keptAt = useMemo(() => snapshotAtOf(range), [range, read.dataUpdatedAt]);
  const agenda = read.data;
  const freshness = freshnessOf({
    shown: agenda !== undefined,
    online,
    isError: read.isError,
    isFetching: read.isFetching,
    paused: read.fetchStatus === 'paused',
    dataUpdatedAt: read.dataUpdatedAt,
    keptAt,
  });
  if (agenda === undefined || freshness.kind === 'fresh') return null;
  if (freshness.kind === 'updating')
    return (
      <p className="ag-updating" role="status">
        <span className="nv-dot nv-dot--live" aria-hidden="true" />
        Mise à jour…
      </p>
    );
  const copy =
    freshness.readAt === null
      ? 'tu vois ta dernière lecture.'
      : `tu vois ta dernière lecture, ${readAtWords(freshness.readAt, agenda.timeZone, agenda.today)}.`;
  if (freshness.kind === 'offline')
    return (
      <p className="ag-offline" role="status">
        <span>
          Hors ligne : {copy}
          {waiting === null
            ? null
            : waiting > 0
              ? ` ${String(waiting)} ${waiting > 1 ? 'coches partiront' : 'coche partira'} au retour du réseau.`
              : ' Tes coches partiront au retour du réseau.'}
        </span>
      </p>
    );
  return (
    <p className="ag-offline" role="status">
      <span>Le serveur ne répond pas : {copy}</span>
      <button
        type="button"
        className="nv-btn nv-btn--soft nv-btn--sm"
        disabled={read.isFetching}
        aria-busy={read.isFetching}
        onClick={() => {
          void read.refetch();
        }}
      >
        Réessayer
      </button>
    </p>
  );
}
