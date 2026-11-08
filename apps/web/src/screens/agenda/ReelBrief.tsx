import type { ReelBrief as ReelSheet } from '@impera/contracts';
import { useId, type CSSProperties, type JSX } from 'react';

import { REEL_CLEAR, REEL_FRAME, REEL_ZONES } from './reel-zones';
import './reel-brief.css';

/** « ≈ 20 s », « ≈ 1 min 30 »: how long the reel lasts. */
export function reelLength(seconds: number): string {
  if (seconds < 60) return `≈ ${String(seconds)} s`;
  const rest = seconds % 60;
  return rest === 0
    ? `≈ ${String(seconds / 60)} min`
    : `≈ ${String(Math.floor(seconds / 60))} min ${String(rest)}`;
}

/** What the drawing says, for a reader who does not see it. */
export function frameDescription(onScreen: string | null): string {
  const text =
    onScreen === null
      ? 'Pas de texte à l’écran.'
      : `Le texte « ${onScreen} » au centre, dans la zone claire.`;
  return `Cadre vertical du reel. ${text} Le haut, le bas et le bord droit, grisés, sont cachés par Instagram.`;
}

/** Where the clear zone sits in the frame, as percentages for the text laid over the drawing. */
const clearBox: CSSProperties = {
  left: `${String((REEL_CLEAR.x / REEL_FRAME.width) * 100)}%`,
  top: `${String((REEL_CLEAR.y / REEL_FRAME.height) * 100)}%`,
  width: `${String((REEL_CLEAR.width / REEL_FRAME.width) * 100)}%`,
  height: `${String((REEL_CLEAR.height / REEL_FRAME.height) * 100)}%`,
};

/** The 9:16 frame: the parts Instagram covers in grey, her text on screen in the clear part. */
function Frame({ onScreen }: { onScreen: string | null }): JSX.Element {
  const hatch = useId();
  const { width, height } = REEL_FRAME;
  const top = height * REEL_ZONES.top;
  const bottom = height * REEL_ZONES.bottom;
  const right = width * REEL_ZONES.right;
  return (
    <div className="ag-reel__frame" role="img" aria-label={frameDescription(onScreen)}>
      <svg viewBox={`0 0 ${String(width)} ${String(height)}`} aria-hidden="true" focusable="false">
        <defs>
          <pattern
            id={hatch}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="4" className="ag-reel__hatch" />
          </pattern>
        </defs>
        <rect className="ag-reel__screen" x="0.5" y="0.5" width={width - 1} height={height - 1} rx="7" />
        <g className="ag-reel__covered">
          <rect x="0.5" y="0.5" width={width - 1} height={top} rx="7" />
          <rect x="0.5" y={height - bottom} width={width - 1} height={bottom - 0.5} rx="7" />
          <rect x={width - right} y={top} width={right - 0.5} height={height - top - bottom} />
        </g>
        <g fill={`url(#${hatch})`}>
          <rect x="0.5" y="0.5" width={width - 1} height={top} rx="7" />
          <rect x="0.5" y={height - bottom} width={width - 1} height={bottom - 0.5} rx="7" />
          <rect x={width - right} y={top} width={right - 0.5} height={height - top - bottom} />
        </g>
        <rect className="ag-reel__edge" x="0.5" y="0.5" width={width - 1} height={height - 1} rx="7" />
      </svg>
      {onScreen === null ? null : (
        <span className="ag-reel__clear" style={clearBox} aria-hidden="true">
          <span className="ag-reel__onscreen">{onScreen}</span>
        </span>
      )}
    </div>
  );
}

/**
 * Her reel sheet (ADR 0082 § 3, VEI-08), drawn rather than read: her first sentence big, where her text goes on the
 * image, what she films in which order, how it ends, how long. The same component on her phone and in the agency's
 * preview, so that what the agency writes is exactly what she sees. Her words only: a first sentence, a text on
 * screen, shots, an end.
 */
export function ReelBrief({ brief }: { brief: ReelSheet }): JSX.Element {
  return (
    <div className="ag-reel">
      <section className="ag-reel__hook" aria-label="Ta première phrase">
        <span className="ag-reel__label">Ta première phrase</span>
        <q className="ag-reel__quote">{brief.hook}</q>
      </section>
      <div className="ag-reel__body">
        <figure className="ag-reel__figure">
          <Frame onScreen={brief.onScreen} />
          <figcaption className="ag-reel__caption">
            {brief.onScreen === null ? 'Pas de texte à l’écran' : 'Garde ton texte dans la zone claire'}
          </figcaption>
        </figure>
        <div className="ag-reel__plan">
          <section aria-label="Ce que tu filmes">
            <span className="ag-reel__label">Ce que tu filmes</span>
            <ol className="ag-reel__shots">
              {brief.shots.map((shot, index) => (
                // Lines of one sheet, never reordered while shown: their place is their key.
                <li key={index} className="ag-reel__shot">
                  <span className="ag-reel__n nv-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span>{shot}</span>
                </li>
              ))}
            </ol>
          </section>
          {brief.ending === null ? null : (
            <section aria-label="Pour finir">
              <span className="ag-reel__label">Pour finir</span>
              <p className="ag-reel__ending">{brief.ending}</p>
            </section>
          )}
          <p className="ag-reel__length">
            <span className="ag-reel__label">Durée</span>{' '}
            <span className="nv-num">{reelLength(brief.seconds)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
