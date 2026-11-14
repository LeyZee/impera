import type { CreatorId, DesireMark, DesireMarkVerdict, PlaygroundState } from '@impera/contracts';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';

import { DESIRE_MARK_WORDS } from './Desire';
import type { Playground } from './usePlayground';

/*
 * « Calibrer le désir » (ADR 0103 § 6): the owner's marks on the desire score, kept per creator, and what the weights
 * in force make of each. The weights stay in code; this says where they are wrong, so a change is decided on his marks
 * and checked on them before it ships.
 */

const SHOWN = 8;

const COUNT_WORDS: Readonly<Record<DesireMarkVerdict, readonly [string, string]>> = {
  too_high: ['trop haute', 'trop hautes'],
  right: ['juste', 'justes'],
  too_low: ['trop basse', 'trop basses'],
};

/** « 3 trop hautes · 1 juste », or « aucune marque » before the first. */
export function marksSummary(marks: readonly Pick<DesireMark, 'verdict'>[]): string {
  if (marks.length === 0) return 'aucune marque';
  return (['too_high', 'right', 'too_low'] as const)
    .map((verdict) => {
      const count = marks.filter((m) => m.verdict === verdict).length;
      const [one, many] = COUNT_WORDS[verdict];
      return count === 0 ? null : `${String(count)} ${count === 1 ? one : many}`;
    })
    .filter((part) => part !== null)
    .join(' · ');
}

/** The score as it was, and, once the weights changed, what they make of the same signals now. */
export function scoreLine(mark: DesireMark, weightsNow: string): string {
  const then = `Désir ${String(mark.scoreThen)}`;
  if (mark.weightsThen === weightsNow || mark.scoreNow === mark.scoreThen) return then;
  return `${then} à l’époque, ${String(mark.scoreNow)} avec les poids actuels`;
}

export function DesireMarksFold({
  state,
  pg,
}: {
  state: PlaygroundState;
  pg: Playground;
}): JSX.Element | null {
  const creatorId: CreatorId | null = state.persona.played?.creatorId ?? null;
  // A new mark on screen asks for the list again.
  const marksOnScreen = state.history
    .flatMap((t) => (t.desire?.mark === undefined ? [] : [t.desire.mark]))
    .join();
  const query = useQuery({
    queryKey: ['playground', 'desire-marks', pg.client.isDemo, creatorId, marksOnScreen],
    queryFn: () => pg.client.desireMarks(creatorId),
    enabled: creatorId !== null || pg.client.isDemo,
    retry: false,
  });
  // The invented persona keeps no marks: no fold to promise them.
  if (creatorId === null && !pg.client.isDemo) return null;
  const marks = query.data?.marks ?? [];
  return (
    <details className="nv-disclosure pg-fold">
      <summary>
        <span className="nv-disclosure__title">Calibrer le désir</span>
        <span className="nv-disclosure__sum">{query.isError ? 'indisponible' : marksSummary(marks)}</span>
      </summary>
      <div className="nv-disclosure__body">
        <p className="pg-hint">
          Ouvre la note sous un de ses messages et dis si elle te semble trop haute, juste ou trop basse. Les
          poids se corrigent sur tes marques. Avec les poids actuels, seul ce message est recompté, pas la
          suite.
        </p>
        {marks.length === 0 ? null : (
          <ul className="pg-marks">
            {marks.slice(0, SHOWN).map((mark) => (
              <li key={mark.id}>
                <span className="pg-marks__msg">« {mark.fanMessage} »</span>
                <span className="pg-marks__meta">
                  {scoreLine(mark, query.data?.weightsNow ?? mark.weightsThen)} ·{' '}
                  {DESIRE_MARK_WORDS[mark.verdict]}
                </span>
              </li>
            ))}
          </ul>
        )}
        {marks.length > SHOWN ? (
          <p className="pg-hint">{`Et ${String(marks.length - SHOWN)} plus anciennes.`}</p>
        ) : null}
      </div>
    </details>
  );
}
