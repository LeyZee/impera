import type { ShiftReport } from '@impera/contracts';

import type { BackupBanner } from './backups';
import type { PaperworkLine } from './paperwork';

import { awaitsDecision, gapWaits, hasGap } from '@/reports/model';

/**
 * « À faire » on the Dashboard of the owner and of an active manager (pilotage 12/11, W3): what waits on the reader,
 * one line each, the most pressing first. Red is the one urgency (an invoice past due), amber a warning (a copy
 * missing, a due date close, a contest or a gap to decide), the rest is plain. Counted from what the server computed,
 * never from a clock of the screen. No line, no card.
 */

export type TodoTone = 'danger' | 'warn' | 'neutral';

/** Where a line is settled; a line of documents leads to each member's file instead. */
export type TodoTarget = '/paie/factures' | '/equipe/rapports' | '/reglages/sauvegardes';

export interface TodoItem {
  readonly key: string;
  readonly tone: TodoTone;
  readonly title: string;
  /** What it holds back, under the title; empty for a line that says it all. */
  readonly detail: readonly string[];
  readonly to: TodoTarget | null;
  /** The screen it belongs to, said beside the line: « Factures », « Rapports ». */
  readonly where: string;
  /** The members whose documents wait, each opening his file. */
  readonly members: readonly { readonly memberId: string; readonly name: string }[];
  readonly more: boolean;
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

const RANK: Readonly<Record<TodoTone, number>> = { danger: 0, warn: 1, neutral: 2 };

/**
 * The end-of-shift reports that wait on the agency (ADR 0073): the gaps the reader decides now (explained, or their
 * delay passed), the plain reports to validate, then the gaps still waiting for their member's explanation. A report
 * the automatic check validates is no one's to decide.
 */
export function reportItems(reports: readonly ShiftReport[], now: Date): TodoItem[] {
  const decide = reports.filter((report) => awaitsDecision(report, now));
  const gaps = decide.filter(hasGap).length;
  const plain = decide.length - gaps;
  const explaining = reports.filter(
    (report) => report.status === 'submitted' && report.canReview && gapWaits(report, now),
  ).length;
  const line = (key: string, tone: TodoTone, title: string): TodoItem => ({
    key,
    tone,
    title,
    detail: [],
    to: '/equipe/rapports',
    where: 'Rapports',
    members: [],
    more: false,
  });
  return [
    ...(gaps === 0 ? [] : [line('reports-gaps', 'warn', `${plural(gaps, 'écart', 'écarts')} à trancher`)]),
    ...(plain === 0
      ? []
      : [line('reports-plain', 'neutral', `${plural(plain, 'rapport', 'rapports')} à valider`)]),
    ...(explaining === 0
      ? []
      : [
          line(
            'reports-explaining',
            'neutral',
            explaining === 1
              ? '1 écart attend l’explication de son membre'
              : `${String(explaining)} écarts attendent l’explication de leur membre`,
          ),
        ]),
  ];
}

/** How many lines the card shows before « Et N autres »: the figures stay close under it on a busy day. */
export const TODO_SHOWN = 4;

/** Every line of the card, the red first, then the amber, then the plain ones; each group in its reading order. */
export function todoItems(
  backup: BackupBanner | null,
  paperwork: readonly PaperworkLine[],
  reports: readonly TodoItem[],
): TodoItem[] {
  const items: TodoItem[] = [
    ...paperwork.map((line, index): TodoItem => ({
      key: `paper-${String(index)}`,
      tone: line.tone,
      title: line.text,
      detail: line.kind === 'invoices' && line.detail !== null ? [line.detail] : [],
      to: line.kind === 'invoices' ? '/paie/factures' : null,
      where: line.kind === 'invoices' ? 'Factures' : 'Dossiers',
      members: line.kind === 'documents' ? line.members : [],
      more: line.kind === 'documents' && line.more,
    })),
    ...(backup === null
      ? []
      : [
          {
            key: 'backup',
            tone: 'warn' as const,
            title: backup.title,
            detail: [backup.text, ...(backup.restore === null ? [] : [backup.restore])],
            to: '/reglages/sauvegardes' as const,
            where: 'Sauvegardes',
            members: [],
            more: false,
          },
        ]),
    ...reports,
  ];
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RANK[a.item.tone] - RANK[b.item.tone] || a.index - b.index)
    .map(({ item }) => item);
}
