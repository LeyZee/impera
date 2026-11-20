import { useId, type JSX } from 'react';

import { LEVEL_ART } from './level-art';
import './rewards.css';

/*
 * A rank's insignia (CHF-01, ADR 0104 § 16): a medallion of dark glass rimmed in gold, with a fire that grows as
 * the rank rises: sparks, one flame, the same flame with two heads then three, a coil, a serpent, a blaze, a sun of
 * fire. Honorary only: it says a rank, never an amount. Under 40 px it keeps the fire alone, without its glow: the
 * rank's name is always written beside it. Its colours are fixed, like any earned object's gold.
 */

/** The closed list of ranks, the first first (`LEVEL_NAMES` on the server says the same names). */
export const LEVEL_NAMES = [
  'Étincelle',
  'Allumeur',
  'Charmeur',
  'Séducteur',
  'Envoûteur',
  'Tentateur',
  'Brasier',
  'Incendiaire',
] as const;

/** A rank's name, or `null` for a rank this screen does not draw (a newer server). */
export const levelName = (rank: number): string | null => LEVEL_NAMES[rank - 1] ?? null;

const CENTRE = 48;
const RIM = 40;
const GLASS = 34.8;
const GLOSS = 'M8 6h80v26c-22 7-58 7-80 0z';

export function LevelInsignia({
  rank,
  earned = true,
  size,
  glow = false,
  className,
}: {
  /** From 1 to 8. */
  rank: number;
  earned?: boolean;
  /** Its side in pixels: under 40 the fire is drawn alone, without its glow. */
  size: number;
  /** A neon halo around it: for an insignia shown on its own, never in a list. */
  glow?: boolean;
  className?: string;
}): JSX.Element {
  const id = useId();
  const small = size < 40;
  const url = (name: string): string => `url(#${id}${name})`;
  const name = levelName(rank) ?? `Rang ${String(rank)}`;
  const art = LEVEL_ART[rank - 1];
  const common = {
    className: ['rw-trophy', 'rw-level', className].filter(Boolean).join(' '),
    'data-earned': earned,
    viewBox: '0 0 96 96',
    width: size,
    height: size,
    role: 'img',
    'aria-label': `Insigne du rang « ${name} »${earned ? '' : ', pas encore atteint'}`,
  } as const;
  if (!earned || art === undefined)
    return (
      <svg {...common}>
        <circle cx={CENTRE} cy={CENTRE} r={RIM - 1.4} fill="currentColor" opacity={0.1} />
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={RIM - 1.4}
          fill="none"
          stroke="currentColor"
          strokeWidth={small ? 5 : 2.4}
          opacity={0.5}
        />
        {art === undefined ? null : (
          <g transform={art.transform} fill="currentColor" opacity={0.55}>
            {art.fire.map((d, index) => (
              <path key={index} d={d} />
            ))}
          </g>
        )}
      </svg>
    );
  return (
    <svg {...common}>
      <defs>
        <linearGradient id={`${id}r`} x1={0.1} y1={0} x2={0.9} y2={1}>
          <stop offset={0} stopColor="#fff0bd" />
          <stop offset={0.45} stopColor="#e8c37a" />
          <stop offset={1} stopColor="#9a7420" />
        </linearGradient>
        <linearGradient id={`${id}p`} x1={0.5} y1={0} x2={0.5} y2={1}>
          <stop offset={0} stopColor="#5a1230" />
          <stop offset={0.5} stopColor="#2a0c1a" />
          <stop offset={1} stopColor="#120810" />
        </linearGradient>
        <radialGradient id={`${id}h`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset={0} stopColor="#ffcf7a" stopOpacity={art.halo} />
          <stop offset={0.55} stopColor="#ff4f7a" stopOpacity={0.2} />
          <stop offset={1} stopColor="#ff2a4d" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${id}g`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset={0.5} stopColor="#ff2a4d" stopOpacity={1} />
          <stop offset={1} stopColor="#ff2a4d" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${id}f`} cx={0.5} cy={art.heartY} r={art.heartR}>
          <stop offset={0} stopColor="#fffbe0" />
          <stop offset={0.3} stopColor="#ffe45c" />
          <stop offset={0.56} stopColor="#ffa53a" />
          <stop offset={0.8} stopColor="#ff4f5e" />
          <stop offset={1} stopColor="#e0185a" />
        </radialGradient>
        <filter id={`${id}s`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation={art.blur} />
        </filter>
        <clipPath id={`${id}k`}>
          <circle cx={CENTRE} cy={CENTRE} r={GLASS} />
        </clipPath>
      </defs>
      {glow && !small ? (
        <circle className="rw-level__glow" cx={CENTRE} cy={CENTRE} r={48} fill={url('g')} />
      ) : null}
      <circle cx={CENTRE} cy={CENTRE} r={RIM} fill={url('r')} />
      <circle cx={CENTRE} cy={CENTRE} r={GLASS} fill={url('p')} />
      {small ? null : (
        <>
          <circle cx={CENTRE} cy={CENTRE} r={30} fill={url('h')} />
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={GLASS - 2.6}
            fill="none"
            stroke="#e8c37a"
            strokeWidth={0.8}
            opacity={0.35}
          />
        </>
      )}
      <g className="rw-level__fire">
        <g transform={art.transform}>
          {small
            ? (art.small ?? art.fire).map((d, index) => <path key={index} d={d} fill={url('f')} />)
            : art.fire.map((d, index) => (
                <g key={index}>
                  <path className="rw-level__ember" d={d} fill="#ff2a4d" filter={url('s')} />
                  <path d={d} fill={url('f')} />
                </g>
              ))}
          {small
            ? null
            : art.cores.map((d, index) => (
                <path key={index} d={d} fill="#fff2a0" opacity={0.85} filter={url('s')} />
              ))}
        </g>
      </g>
      <g clipPath={url('k')}>
        <path d={GLOSS} fill="#fff" opacity={0.07} />
      </g>
    </svg>
  );
}
