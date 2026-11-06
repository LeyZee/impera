import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useReports } from '@/reports/api';
import { awaitsDecision, gapWaits, hasGap } from '@/reports/model';
import { useNow } from '@/scheduling/useNow';

interface Line {
  readonly text: string;
  readonly tone: 'warn' | 'quiet';
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/**
 * The end-of-shift reports that wait on the agency, on the Dashboard of the owner and of an active manager (ADR 0073,
 * Charles 06/11 « attaque ça »): those the reader decides now, the gaps among them in amber (explained, or their delay
 * passed), then the gaps still waiting for their member's explanation. A report the automatic check validates within
 * five minutes is no one's to decide. No Telegram: the CRM says it. Nothing while nothing waits, nor while the list is
 * unread (Équipe › Rapports says a server that does not answer).
 */
export function ReportsBanner({ enabled }: { enabled: boolean }): JSX.Element | null {
  const open = useReports(null, enabled);
  const now = useNow();
  if (!enabled || open.data === undefined) return null;
  const { reports } = open.data;
  const decide = reports.filter((report) => awaitsDecision(report, now));
  const gaps = decide.filter(hasGap).length;
  const plain = decide.length - gaps;
  const explaining = reports.filter(
    (report) => report.status === 'submitted' && report.canReview && gapWaits(report, now),
  ).length;
  const lines: Line[] = [
    ...(gaps === 0 ? [] : [{ text: `${plural(gaps, 'écart', 'écarts')} à trancher`, tone: 'warn' as const }]),
    ...(plain === 0
      ? []
      : [{ text: `${plural(plain, 'rapport', 'rapports')} à valider`, tone: 'quiet' as const }]),
    ...(explaining === 0
      ? []
      : [
          {
            text:
              explaining === 1
                ? '1 écart attend l’explication de son membre'
                : `${String(explaining)} écarts attendent l’explication de leur membre`,
            tone: 'quiet' as const,
          },
        ]),
  ];
  if (lines.length === 0) return null;

  return (
    <aside className="nv-plate db-paper nv-enter" aria-labelledby="db-reports-title">
      <div className="db-paper__body">
        <p id="db-reports-title" className="db-paper__title">
          Rapports de fin de shift
        </p>
        <ul className="db-paper__lines">
          {lines.map((line) => (
            <li key={line.text} className="db-paper__line" data-tone={line.tone}>
              <span className="db-paper__dot" aria-hidden="true" />
              <span className="nv-num">{line.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <Link className="nv-btn nv-btn--soft nv-btn--sm db-paper__go" to="/equipe/rapports">
        Voir les rapports
      </Link>
    </aside>
  );
}
