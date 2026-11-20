import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';

import type { Section } from './nav';

import { useReports } from '@/reports/api';
import { awaitsDecision } from '@/reports/model';
import { useNow } from '@/scheduling/useNow';
import { useValidateCount } from '@/screens/pay/data';
import { todosAcrossQuery } from '@/screens/tracking/api';

/**
 * What waits for the reader behind a tab of the rail (ADR 0134 § 8): the conversations to treat on Suivi, the reports
 * to decide on Équipe, the statements to validate on Paie. The counts the sub-tabs and the screens already read, on
 * the same query keys: one number, never two. A read that fails shows the tab without a count, never a wrong figure.
 */

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count > 1 ? many : one}`;

function Count({ count, label }: { count: number; label: string }): JSX.Element | null {
  if (count <= 0) return null;
  return (
    <>
      <span className="nv-count nv-rail__count" aria-hidden="true" title={label}>
        {count > 99 ? '99+' : count}
      </span>
      <span className="sr-only">{`, ${label}`}</span>
    </>
  );
}

function SuiviCount(): JSX.Element | null {
  const queue = useQuery(todosAcrossQuery);
  const count = queue.data?.items.length ?? 0;
  return <Count count={count} label={plural(count, 'conversation à traiter', 'conversations à traiter')} />;
}

function TeamCount(): JSX.Element | null {
  const open = useReports(null);
  const now = useNow();
  const count = (open.data?.reports ?? []).filter((one) => awaitsDecision(one, now)).length;
  return <Count count={count} label={plural(count, 'rapport à décider', 'rapports à décider')} />;
}

function PayCount(): JSX.Element | null {
  const count = useValidateCount();
  return <Count count={count} label={plural(count, 'relevé à valider', 'relevés à valider')} />;
}

/** The sections that carry a count, each read only when its tab is drawn. */
const COUNTS: Partial<Record<Section, () => JSX.Element | null>> = {
  '/suivi': SuiviCount,
  '/equipe': TeamCount,
  '/paie': PayCount,
};

export function RailCount({ section }: { section: Section }): JSX.Element | null {
  const Read = COUNTS[section];
  return Read === undefined ? null : <Read />;
}
