import type { PlaygroundDesire, PlaygroundState } from '@impera/contracts';
import { useState, type JSX } from 'react';

import { DESIRE_BAND_LABELS, DESIRE_SIGNAL_LABELS, movementOf } from '@/agent/desire';

/*
 * His desire score in the playground (P3-12, glossary « Note de désir »), shown to calibrate it: under each of his
 * messages the score it left and what moved it, and in « Pourquoi » the gauge with her two thresholds. The server
 * counts and gives each signal its points; the screen only says them.
 */

type Thresholds = PlaygroundState['desireThresholds'];

/** « +12 », « −30 », or « remise à zéro » for a signal that resets or freezes instead of counting. */
export function pointsLabel(points: number | null): string {
  if (points === null) return '';
  return points >= 0 ? `+${String(points)}` : `−${String(-points)}`;
}

/** A repeated signal (an emoji counted per emoji) is one line, its points added up. */
export function signalLines(
  desire: PlaygroundDesire,
): { readonly key: string; readonly label: string; readonly points: number | null }[] {
  const lines = new Map<string, { label: string; points: number | null; count: number }>();
  for (const { signal, points } of desire.signals) {
    const line = lines.get(signal);
    if (line === undefined) lines.set(signal, { label: DESIRE_SIGNAL_LABELS[signal], points, count: 1 });
    else
      lines.set(signal, {
        ...line,
        points: line.points === null ? null : line.points + (points ?? 0),
        count: line.count + 1,
      });
  }
  return [...lines].map(([key, line]) => ({
    key,
    label: line.count === 1 ? line.label : `${line.label} ×${String(line.count)}`,
    points: line.points,
  }));
}

/** What the score allows her, in her thresholds' words. */
export function desireVerdict(score: number, thresholds: Thresholds): string {
  if (score >= thresholds.script) return 'Assez chaud pour un script';
  if (score >= thresholds.open) return 'Elle peut ouvrir l’intime, pas encore de script';
  return 'Elle n’ouvre pas l’intime elle-même';
}

/** The score under one of his messages: folded to a line, opened to the signals with their points. */
export function DesireTag({ desire }: { desire: PlaygroundDesire }): JSX.Element {
  const [open, setOpen] = useState(false);
  const lines = signalLines(desire);
  return (
    <div className="pg-desire-tag">
      <button
        type="button"
        className="pg-desire-tag__sum"
        aria-expanded={open}
        title="Ce qui a fait bouger sa note de désir"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        Désir <b>{desire.score}</b>
        <span>{movementOf(desire)}</span>
      </button>
      {open ? (
        lines.length === 0 ? (
          <p className="pg-desire-tag__none">Rien n’a bougé sur ce message.</p>
        ) : (
          <ul className="pg-desire-lines">
            {lines.map((line) => (
              <li key={line.key}>
                <span>{line.label}</span>
                <b>{pointsLabel(line.points)}</b>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** « Désir » in « Pourquoi »: the gauge with her two thresholds marked, the band, what moved it. */
export function DesireGauge({
  desire,
  thresholds,
}: {
  desire: PlaygroundDesire;
  thresholds: Thresholds;
}): JSX.Element {
  const lines = signalLines(desire);
  const band = DESIRE_BAND_LABELS[desire.band];
  return (
    <div className="pg-desire">
      <p className="pg-desire__head">
        <b>{desire.score}</b>
        <span>/ 100 · {band}</span>
        <span className="pg-desire__move">{movementOf(desire)}</span>
      </p>
      {/* Never amber nor neon: this gauge counts no budget, as in the fan's sheet. */}
      <span
        className="nv-gauge pg-desire__gauge"
        role="meter"
        aria-label="Note de désir"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={desire.score}
        aria-valuetext={`${String(desire.score)} sur 100, ${band}`}
        style={{ '--nv-gauge-value': `${String(desire.score)}%` }}
      >
        <span className="nv-gauge__fill" />
        <i className="pg-desire__mark" style={{ left: `${String(thresholds.open)}%` }} />
        <i className="pg-desire__mark" style={{ left: `${String(thresholds.script)}%` }} />
      </span>
      <p className="pg-desire__scale">
        Intime à {thresholds.open} · Script à {thresholds.script}
      </p>
      <p className="pg-desire__verdict">{desireVerdict(desire.score, thresholds)}</p>
      {lines.length === 0 ? null : (
        <ul className="pg-desire-lines">
          {lines.map((line) => (
            <li key={line.key}>
              <span>{line.label}</span>
              <b>{pointsLabel(line.points)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
